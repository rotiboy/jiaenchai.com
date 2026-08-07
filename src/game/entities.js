// src/game/entities.js — world entities: coins, enemies, moving platforms, NPCs,
// info signs, checkpoints, the goal door and the boss. DOM-free: importable in
// bare Node.js.
//
// Side channels to the rest of the game (the integrator drains these):
//   game.sfxQueue     -> array of sound names, e.g. 'coin'
//   game.particles    -> array of {x,y,vx,vy,life,maxLife,color,size}
//   game.shakeRequest -> number (camera shake amount)
//   game.toast        -> {text, sub, t}
//   game.prompt       -> {text,x,y,npc} | null   (action prompt near an NPC)
//   game.reachedDoor  -> true once the player touches an open goal door

import {
  TILE,
  GRAVITY,
  MAX_FALL,
  PLAYER_W,
  PLAYER_H,
} from '../engine/constants.js';
import {
  moveAndCollide,
  overlappingTiles,
  isSolid,
  isOneWay,
  isHazard,
  tileAt,
  aabb,
} from '../engine/physics.js';

const MAX_DT = 1 / 30;

const WALK_SPEED = 34;
const FLY_SPEED = 26;
const FLY_AMP = 20;
const FLY_RANGE = 64;
const PLAT_SPEED = 40;
const PLAT_RANGE = TILE * 3;
const PLAT_H = TILE;

const STOMP_WINDOW = 6;      // CONTRACT §5: player bottom within 6px of the enemy top
const STOMP_BOUNCE = -240;
const HURT_TIME = 0.34;
const INVULN_TIME = 1.2;
const NPC_RANGE = 34;

const BOSS_W = 40;
const BOSS_H = 28;
const BOSS_HP = 5;
const BOSS_CYCLE = 2.2;      // seconds between volleys
const BOSS_SHOTS = 3;
const BOSS_SHOT_GAP = 0.16;
const BOSS_RANGE = TILE * 3; // horizontal drift limit around the arena centre
const TICKET_GRAV = 520;
const MAX_PARTICLES = 420;

/* ------------------------------------------------------------------ utils */

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function bag(game, key) {
  if (!game || typeof game !== 'object') return null;
  if (!Array.isArray(game[key])) game[key] = [];
  return game[key];
}

function sfx(game, name) {
  const q = bag(game, 'sfxQueue');
  if (q) q.push(name);
}

function shakeReq(game, amount) {
  if (!game || typeof game !== 'object') return;
  const cur = typeof game.shakeRequest === 'number' ? game.shakeRequest : 0;
  game.shakeRequest = Math.max(cur, amount);
}

function particle(game, x, y, vx, vy, life, color, size, grav) {
  const ps = bag(game, 'particles');
  if (!ps || ps.length >= MAX_PARTICLES) return;
  ps.push({
    x,
    y,
    vx,
    vy,
    life,
    maxLife: life,
    color,
    size,
    grav: typeof grav === 'number' ? grav : 220,
  });
}

function puff(game, x, y, n, color, spread, life, size, grav) {
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.7;
    const s = spread * (0.35 + Math.random() * 0.65);
    particle(
      game,
      x,
      y,
      Math.cos(a) * s,
      Math.sin(a) * s,
      life * (0.6 + Math.random() * 0.6),
      color,
      size,
      grav,
    );
  }
}

function rowChar(rows, tx, ty) {
  if (ty < 0 || ty >= rows.length) return '.';
  const row = rows[ty];
  if (typeof row !== 'string' || tx < 0 || tx >= row.length) return '.';
  return row[tx];
}

function rectHit(a, bx, by, bw, bh) {
  return a.x < bx + bw && a.x + a.w > bx && a.y < by + bh && a.y + a.h > by;
}

/** True when the box [x,y,w,h] overlaps no solid tile of `level`. */
function boxIsFree(level, x, y, w, h) {
  if (!level) return true;
  const x0 = Math.floor(x / TILE);
  const x1 = Math.floor((x + w - 0.001) / TILE);
  const y0 = Math.floor(y / TILE);
  const y1 = Math.floor((y + h - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (isSolid(tileAt(level, tx, ty))) return false;
    }
  }
  return true;
}

/**
 * Flyers do not run tile collision every frame (their motion is a closed-form
 * sine + chase). Instead the *whole area they can ever occupy* is measured once
 * at spawn and shrunk until it contains no solid tile, so they can never end up
 * inside the geometry the player is standing on.
 */
function fitFlyerBounds(level, en) {
  const step = 2;
  let amp = 0;
  for (let d = step; d <= FLY_AMP; d += step) {
    if (!boxIsFree(level, en.x, en.baseY - d, en.w, en.h + d * 2)) break;
    amp = d;
  }
  const top = en.baseY - amp;
  const boxH = en.h + amp * 2;

  let left = 0;
  for (let d = step; d <= FLY_RANGE; d += step) {
    if (!boxIsFree(level, en.homeX - d, top, en.w + d, boxH)) break;
    left = d;
  }
  let right = 0;
  for (let d = step; d <= FLY_RANGE; d += step) {
    if (!boxIsFree(level, en.homeX, top, en.w + d, boxH)) break;
    right = d;
  }

  en.amp = amp;
  en.rangeL = left;
  en.rangeR = right;
}

/* ------------------------------------------------------------------ spawn */

function makeCoin(tx, ty, kind) {
  const big = kind === 'artifact';
  const w = big ? 12 : 8;
  const h = big ? 12 : 8;
  const x = tx * TILE + (TILE - w) / 2;
  const y = ty * TILE + (TILE - h) / 2;
  return {
    kind,
    tx,
    ty,
    x,
    y,
    w,
    h,
    homeX: x,
    homeY: y,
    value: big ? 5 : 1,
    taken: false,
    attracted: false,
    t: 0,
    phase: ((tx * 0.7 + ty * 1.3) % (Math.PI * 2)),
  };
}

function makeBoss(tx, ty) {
  const x = tx * TILE + (TILE - BOSS_W) / 2;
  const y = ty * TILE + (TILE - BOSS_H) / 2;
  return {
    type: 'boss',
    name: 'The Backlog',
    x,
    y,
    w: BOSS_W,
    h: BOSS_H,
    homeX: x,
    homeY: y,
    hp: BOSS_HP,
    maxHp: BOSS_HP,
    alive: true,
    dying: 0,
    t: 0,
    flash: 0,
    invuln: 0,
    fireT: 0,
    shots: 0,
    shotT: 0,
    projectiles: [],
    tx,
    ty,
  };
}

export function spawnEntities(level) {
  const rows = level && Array.isArray(level.rows) ? level.rows : [];
  const out = {
    coins: [],
    enemies: [],
    platforms: [],
    npcs: [],
    signs: [],
    checkpoints: [],
    door: null,
    boss: null,
    projectiles: [],
    t: 0,
  };

  const npcTiles = [];
  const signTiles = [];
  const taken = new Set();

  for (let ty = 0; ty < rows.length; ty++) {
    const row = typeof rows[ty] === 'string' ? rows[ty] : '';
    for (let tx = 0; tx < row.length; tx++) {
      const ch = row[tx];
      switch (ch) {
        case 'o':
          out.coins.push(makeCoin(tx, ty, 'coin'));
          break;
        case '*':
          out.coins.push(makeCoin(tx, ty, 'artifact'));
          break;
        case 'E': {
          const leftSolid = isSolid(rowChar(rows, tx - 1, ty));
          out.enemies.push({
            type: 'walker',
            x: tx * TILE + 2,
            y: ty * TILE + 2,
            w: 12,
            h: 14,
            vx: 0,
            vy: 0,
            dir: leftSolid ? 1 : -1,
            facing: leftSolid ? 1 : -1,
            onGround: false,
            hitCeiling: false,
            hitWallL: false,
            hitWallR: false,
            dropTimer: 0,
            alive: true,
            deadT: 0,
            t: 0,
            homeX: tx * TILE + 2,
            homeY: ty * TILE + 2,
            tx,
            ty,
          });
          break;
        }
        case 'F':
          out.enemies.push({
            type: 'flyer',
            x: tx * TILE + 2,
            y: ty * TILE + 2,
            w: 12,
            h: 12,
            vx: 0,
            vy: 0,
            facing: -1,
            alive: true,
            deadT: 0,
            t: 0,
            baseY: ty * TILE + 2,
            homeX: tx * TILE + 2,
            homeY: ty * TILE + 2,
            phase: ((tx * 0.9 + ty * 0.5) % (Math.PI * 2)),
            tx,
            ty,
          });
          break;
        case 'H':
        case 'V': {
          const key = ty * 10000 + tx;
          if (taken.has(key)) break;
          let run = 1;
          while (tx + run < row.length && row[tx + run] === ch) {
            taken.add(ty * 10000 + (tx + run));
            run++;
          }
          taken.add(key);
          const px = tx * TILE;
          const py = ty * TILE;
          out.platforms.push({
            type: ch === 'H' ? 'h' : 'v',
            x: px,
            y: py,
            w: run * TILE,
            h: PLAT_H,
            ox: px,
            oy: py,
            dir: ch === 'H' ? 1 : -1,
            speed: PLAT_SPEED,
            range: PLAT_RANGE,
            dx: 0,
            dy: 0,
            t: 0,
            tx,
            ty,
          });
          break;
        }
        case 'N':
          npcTiles.push({ tx, ty });
          break;
        case '?':
          signTiles.push({ tx, ty });
          break;
        case 'C':
          out.checkpoints.push({
            tx,
            ty,
            x: tx * TILE,
            y: ty * TILE,
            w: TILE,
            h: TILE,
            px: tx * TILE + (TILE - PLAYER_W) / 2,
            py: ty * TILE + (TILE - PLAYER_H),
            active: false,
            t: 0,
          });
          break;
        case 'G':
          if (!out.door) {
            out.door = {
              tx,
              ty,
              x: tx * TILE,
              y: ty * TILE,
              w: TILE,
              h: TILE,
              open: true,
              reached: false,
              t: 0,
            };
          }
          break;
        case 'B':
          if (!out.boss) out.boss = makeBoss(tx, ty);
          break;
        default:
          break;
      }
    }
  }

  // Confine every flyer to a solid-free box around its spawn.
  for (let i = 0; i < out.enemies.length; i++) {
    const en = out.enemies[i];
    if (en.type === 'flyer') fitFlyerBounds(level, en);
  }

  // NPCs and signs are indexed strictly left-to-right so they line up with
  // level.npcs[] / level.signs[] by index.
  const byX = (a, b) => (a.tx - b.tx) || (a.ty - b.ty);
  npcTiles.sort(byX);
  signTiles.sort(byX);

  const npcData = level && Array.isArray(level.npcs) ? level.npcs : [];
  const signData = level && Array.isArray(level.signs) ? level.signs : [];

  for (let i = 0; i < npcTiles.length; i++) {
    const { tx, ty } = npcTiles[i];
    const data = npcData[i] || {};
    out.npcs.push({
      index: i,
      kind: i,
      tx,
      ty,
      x: tx * TILE + 2,
      y: ty * TILE,
      w: 12,
      h: TILE,
      name: typeof data.name === 'string' ? data.name : 'Colleague',
      lines: Array.isArray(data.lines) ? data.lines.slice() : [],
      near: false,
      talked: false,
      t: 0,
    });
  }

  for (let i = 0; i < signTiles.length; i++) {
    const { tx, ty } = signTiles[i];
    out.signs.push({
      index: i,
      tx,
      ty,
      x: tx * TILE,
      y: ty * TILE,
      w: TILE,
      h: TILE,
      text: typeof signData[i] === 'string' ? signData[i] : '',
      revealed: false,
      bumpT: 0,
    });
  }

  // The goal door starts locked when a boss guards the level.
  if (out.door && out.boss) out.door.open = false;
  if (out.boss) out.projectiles = out.boss.projectiles;

  return out;
}

/* -------------------------------------------------------------- particles */

function updateParticles(game, dt) {
  const ps = game && game.particles;
  if (!Array.isArray(ps)) return;
  for (let i = ps.length - 1; i >= 0; i--) {
    const q = ps[i];
    if (!q) {
      ps.splice(i, 1);
      continue;
    }
    q.life -= dt;
    if (q.life <= 0) {
      ps.splice(i, 1);
      continue;
    }
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.vy += (typeof q.grav === 'number' ? q.grav : 220) * dt;
    q.vx *= 1 - Math.min(0.9, 1.2 * dt);
  }
}

/* ----------------------------------------------------------------- riding */

function ridesOn(p, pl) {
  if (!p || p.dead) return false;
  const bottom = p.y + p.h;
  return (
    p.x + p.w > pl.x + 1 &&
    p.x < pl.x + pl.w - 1 &&
    bottom >= pl.y - 3 &&
    bottom <= pl.y + 8 &&
    p.vy >= -1
  );
}

/* ----------------------------------------------------------------- update */

export function updateEntities(game, dt) {
  if (!game || typeof game !== 'object') return;
  const step = clamp(Number(dt) || 0, 0, MAX_DT);
  const e = game.entities;
  if (!e) {
    updateParticles(game, step);
    return;
  }
  if (step <= 0) return;

  const level = game.level;
  const p = game.player;
  e.t = (e.t || 0) + step;

  /* ------------------------------------------------------- moving platforms */
  if (Array.isArray(e.platforms)) {
    for (let i = 0; i < e.platforms.length; i++) {
      const pl = e.platforms[i];
      pl.t += step;
      const riding = ridesOn(p, pl);
      const px = pl.x;
      const py = pl.y;
      if (pl.type === 'h') {
        pl.x += pl.speed * pl.dir * step;
        if (pl.x > pl.ox + pl.range) {
          pl.x = pl.ox + pl.range;
          pl.dir = -1;
        } else if (pl.x < pl.ox - pl.range) {
          pl.x = pl.ox - pl.range;
          pl.dir = 1;
        }
      } else {
        pl.y += pl.speed * pl.dir * step;
        if (pl.y > pl.oy + pl.range) {
          pl.y = pl.oy + pl.range;
          pl.dir = -1;
        } else if (pl.y < pl.oy - pl.range) {
          pl.y = pl.oy - pl.range;
          pl.dir = 1;
        }
      }
      pl.dx = pl.x - px;
      pl.dy = pl.y - py;
      // Carry the rider before it resolves its own movement this frame.
      if (riding && p) {
        p.x += pl.dx;
        p.y += pl.dy;
        if (pl.dy > 0) p.vy = Math.max(p.vy, 0);
      }
    }
  }

  /* ------------------------------------------------------------------ coins */
  if (Array.isArray(e.coins)) {
    for (let i = 0; i < e.coins.length; i++) {
      const c = e.coins[i];
      if (c.taken) continue;
      c.t += step;
      if (c.attracted) continue; // the companion drone is steering it
      c.y = c.homeY + Math.sin(c.t * 3 + c.phase) * (c.kind === 'artifact' ? 2.5 : 1.5);
    }
  }

  /* ---------------------------------------------------------------- enemies */
  if (Array.isArray(e.enemies)) {
    for (let i = 0; i < e.enemies.length; i++) {
      const en = e.enemies[i];
      if (!en.alive) {
        en.deadT += step;
        continue;
      }
      en.t += step;
      if (en.type === 'walker') {
        en.vx = en.dir * WALK_SPEED;
        en.vy = Math.min(en.vy + GRAVITY * step, MAX_FALL);
        if (level) {
          const before = en.dropTimer;
          moveAndCollide(en, level, step);
          if (en.dropTimer > 0 && en.dropTimer === before) en.dropTimer = 0;
          if (en.hitWallL) en.dir = 1;
          else if (en.hitWallR) en.dir = -1;
          if (en.onGround) {
            // Turn at ledges and in front of hazards.
            const probeX = en.dir > 0 ? en.x + en.w + 2 : en.x - 2;
            const footTx = Math.floor(probeX / TILE);
            const belowTy = Math.floor((en.y + en.h + 3) / TILE);
            const below = tileAt(level, footTx, belowTy);
            const ahead = tileAt(level, footTx, Math.floor((en.y + en.h - 2) / TILE));
            if ((!isSolid(below) && !isOneWay(below)) || isHazard(below) || isHazard(ahead)) {
              en.dir = -en.dir;
            }
          }
          // Nudged into a hazard anyway (level edits, knockback): bounce out.
          const inside = overlappingTiles(en, level);
          if (Array.isArray(inside)) {
            for (let k = 0; k < inside.length; k++) {
              if (inside[k] && isHazard(inside[k].ch)) {
                en.dir = -en.dir;
                en.vy = -140;
                break;
              }
            }
          }
        } else {
          en.x += en.vx * step;
        }
        en.facing = en.dir;
      } else if (en.type === 'flyer') {
        // Bounds were fitted to the surrounding solids at spawn, so the flyer
        // is never inside a block and can always be met head-on or stomped.
        const amp = typeof en.amp === 'number' ? en.amp : FLY_AMP;
        const rangeL = typeof en.rangeL === 'number' ? en.rangeL : FLY_RANGE;
        const rangeR = typeof en.rangeR === 'number' ? en.rangeR : FLY_RANGE;
        en.y = en.baseY + Math.sin(en.t * 2.2 + (en.phase || 0)) * amp;
        if (p && !p.dead) {
          const d = p.x + p.w / 2 - (en.x + en.w / 2);
          const move = clamp(d, -FLY_SPEED * step, FLY_SPEED * step);
          en.x = clamp(en.x + move, en.homeX - rangeL, en.homeX + rangeR);
          en.facing = d < 0 ? -1 : 1;
        }
      }
    }
  }

  /* -------------------------------------------------------- decorative bits */
  if (Array.isArray(e.signs)) {
    for (let i = 0; i < e.signs.length; i++) {
      const s = e.signs[i];
      if (s.bumpT > 0) s.bumpT = Math.max(0, s.bumpT - step);
    }
  }
  if (Array.isArray(e.checkpoints)) {
    for (let i = 0; i < e.checkpoints.length; i++) e.checkpoints[i].t += step;
  }
  if (Array.isArray(e.npcs)) {
    for (let i = 0; i < e.npcs.length; i++) e.npcs[i].t += step;
  }
  if (e.door) e.door.t += step;

  /* ------------------------------------------------------------------- boss */
  game.__entTick = (game.__entTick || 0) + 1;
  updateBoss(game, step);

  updateParticles(game, step);
}

/* ------------------------------------------------------------------- boss */

function fireTicket(game, b, index) {
  const p = game.player;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h * 0.7;
  const targetX = p ? p.x + p.w / 2 : cx - 80;
  const dx = targetX - cx;
  const spread = [0.7, 1, 1.3][index % 3];
  const vy = -200 - index * 34;
  const flight = (2 * Math.abs(vy)) / TICKET_GRAV || 0.8;
  const vx = clamp((dx / flight) * spread, -200, 200);
  b.projectiles.push({
    type: 'ticket',
    x: cx - 3,
    y: cy,
    w: 7,
    h: 7,
    vx,
    vy,
    t: 0,
    life: 5,
    dead: false,
    spin: Math.random() * Math.PI,
  });
  sfx(game, 'boss');
  particle(game, cx, cy, vx * 0.2, vy * 0.2, 0.3, '#ffd166', 2, 0);
}

export function updateBoss(game, dt) {
  if (!game || typeof game !== 'object') return;
  const e = game.entities;
  if (!e || !e.boss) return;
  const b = e.boss;
  const step = clamp(Number(dt) || 0, 0, MAX_DT);
  if (step <= 0) return;

  // Guard against being ticked twice in one frame when the integrator calls
  // both updateEntities() (which drives the boss) and updateBoss().
  const tick = game.__entTick || 0;
  if (tick !== 0) {
    if (b.__tick === tick) return;
    b.__tick = tick;
  }

  b.t += step;
  if (b.flash > 0) b.flash = Math.max(0, b.flash - step);
  if (b.invuln > 0) b.invuln = Math.max(0, b.invuln - step);

  const p = game.player;

  if (b.alive) {
    // Hover: bob vertically, drift toward the player inside the arena.
    let targetX = b.homeX;
    if (p && !p.dead) {
      targetX = clamp(
        p.x + p.w / 2 - b.w / 2,
        b.homeX - BOSS_RANGE,
        b.homeX + BOSS_RANGE,
      );
    }
    b.x += (targetX - b.x) * Math.min(1, 1.6 * step);
    b.y = b.homeY + Math.sin(b.t * 1.6) * 10;

    // Volley: three lobbed tickets on a ~2.2s cycle, only when engaged.
    const engaged = !p || p.dead
      ? false
      : Math.abs(p.x + p.w / 2 - (b.x + b.w / 2)) < 240;
    if (engaged) {
      b.fireT += step;
      if (b.shots <= 0 && b.fireT >= BOSS_CYCLE) {
        b.fireT = 0;
        b.shots = BOSS_SHOTS;
        b.shotT = 0;
      }
      if (b.shots > 0) {
        b.shotT -= step;
        if (b.shotT <= 0) {
          fireTicket(game, b, BOSS_SHOTS - b.shots);
          b.shots -= 1;
          b.shotT = BOSS_SHOT_GAP;
        }
      }
    } else {
      b.fireT = Math.min(b.fireT + step, BOSS_CYCLE);
    }
  } else {
    b.dying += step;
    if (b.dying < 1.2 && Math.random() < 0.4) {
      puff(game, b.x + b.w / 2, b.y + b.h / 2, 3, '#ff9f43', 90, 0.5, 2, 120);
    }
  }

  /* --------------------------------------------------------- ticket flight */
  const level = game.level;
  for (let i = b.projectiles.length - 1; i >= 0; i--) {
    const pr = b.projectiles[i];
    pr.t += step;
    pr.life -= step;
    pr.vy += TICKET_GRAV * step;
    pr.x += pr.vx * step;
    pr.y += pr.vy * step;
    if (level) {
      const ch = tileAt(level, Math.floor((pr.x + pr.w / 2) / TILE), Math.floor((pr.y + pr.h / 2) / TILE));
      if (isSolid(ch)) pr.dead = true;
    }
    if (pr.life <= 0 || pr.dead) {
      puff(game, pr.x + pr.w / 2, pr.y + pr.h / 2, 4, '#ffd166', 60, 0.3, 1, 260);
      b.projectiles.splice(i, 1);
    }
  }
  if (e.projectiles !== b.projectiles) e.projectiles = b.projectiles;
}

function damageBoss(game, b, p) {
  b.hp -= 1;
  b.flash = 0.55;
  b.invuln = 0.9;
  if (p) {
    p.vy = -300;
    p.dashCd = Math.min(p.dashCd, 0.12);
    p.jumps = p.maxJumps;
  }
  shakeReq(game, 8);
  sfx(game, 'stomp');
  puff(game, b.x + b.w / 2, b.y + b.h / 2, 10, '#ff9f43', 120, 0.4, 2, 180);

  if (b.hp <= 0) {
    b.hp = 0;
    b.alive = false;
    b.dying = 0;
    b.shots = 0;
    b.projectiles.length = 0;
    sfx(game, 'boss');
    sfx(game, 'unlock');
    shakeReq(game, 14);
    puff(game, b.x + b.w / 2, b.y + b.h / 2, 26, '#ffd166', 220, 0.9, 3, 200);
    puff(game, b.x + b.w / 2, b.y + b.h / 2, 16, '#ff5c6a', 160, 0.7, 2, 160);

    const e = game.entities;
    // Drop the artifact and open the way out.
    if (e && Array.isArray(e.coins)) {
      const drop = makeCoin(
        Math.floor((b.x + b.w / 2) / TILE),
        Math.floor((b.y + b.h / 2) / TILE),
        'artifact',
      );
      drop.dropped = true;
      e.coins.push(drop);
      if (typeof game.coinsTotal === 'number') game.coinsTotal += drop.value;
    }
    if (e && e.door) e.door.open = true;
    game.toast = { text: 'THE BACKLOG IS CLEARED', sub: 'The door is open', t: 0 };
  }
}

/* ----------------------------------------------------------------- damage */

function damagePlayer(game, p, srcX) {
  if (!p || p.dead || p.invuln > 0) return false;

  p.invuln = INVULN_TIME;
  p.hurtT = HURT_TIME;
  p.dashT = 0;
  p.gliding = false;
  p.buffer = 0;
  const centre = p.x + p.w / 2;
  const away = typeof srcX === 'number' ? (centre < srcX ? -1 : 1) : -p.facing;
  p.vx = away * 155;
  p.vy = -200;
  p.anim = 'hurt';
  p.animT = 0;

  const hearts = typeof game.hearts === 'number' ? game.hearts : 3;
  game.hearts = Math.max(0, hearts - 1);

  sfx(game, 'hurt');
  shakeReq(game, 6);
  puff(game, centre, p.y + p.h / 2, 10, '#ff5c6a', 130, 0.45, 2, 260);

  if (game.hearts <= 0) {
    p.dead = true;
    p.deadT = 0;
    p.vx = 0;
    p.vy = -260;
    p.invuln = 999;
    shakeReq(game, 9);
    puff(game, centre, p.y + p.h / 2, 14, '#ffd166', 160, 0.6, 2, 300);
  }
  return true;
}

/* --------------------------------------------------------------- collision */

export function collideEntities(game, dt) {
  if (!game || typeof game !== 'object') return;
  const e = game.entities;
  const p = game.player;
  if (!e || !p) return;
  void dt; // collision resolution is positional; dt is part of the contract shape

  /* ---------------------------------------------------- moving platform top */
  if (Array.isArray(e.platforms)) {
    for (let i = 0; i < e.platforms.length; i++) {
      const pl = e.platforms[i];
      if (p.dead) break;
      if (p.x + p.w <= pl.x + 1 || p.x >= pl.x + pl.w - 1) continue;
      const bottom = p.y + p.h;
      if (p.vy >= 0 && bottom >= pl.y - 1 && bottom <= pl.y + Math.max(9, pl.h * 0.6)) {
        p.y = pl.y - p.h;
        p.vy = 0;
        p.onGround = true;
        p.gliding = false;
      }
    }
  }

  if (p.dead) return;

  /* ----------------------------------------------------------- collectibles */
  if (Array.isArray(e.coins)) {
    for (let i = 0; i < e.coins.length; i++) {
      const c = e.coins[i];
      if (c.taken) continue;
      if (!aabb(p, c)) continue;
      c.taken = true;
      const value = typeof c.value === 'number' ? c.value : 1;
      game.coins = (typeof game.coins === 'number' ? game.coins : 0) + value;
      const artifact = c.kind === 'artifact';
      sfx(game, artifact ? 'artifact' : 'coin');
      puff(
        game,
        c.x + c.w / 2,
        c.y + c.h / 2,
        artifact ? 12 : 5,
        artifact ? '#ffd166' : '#ffe08a',
        artifact ? 120 : 60,
        artifact ? 0.55 : 0.3,
        artifact ? 2 : 1,
        artifact ? 160 : 120,
      );
      if (artifact) {
        shakeReq(game, 3);
        const name =
          (game.level && game.level.collectibleName) || 'Key Artifact';
        game.toast = { text: 'KEY ' + String(name).toUpperCase(), sub: 'Worth 5', t: 0 };
      }
    }
  }

  /* --------------------------------------------------------------- enemies */
  if (Array.isArray(e.enemies)) {
    for (let i = 0; i < e.enemies.length; i++) {
      const en = e.enemies[i];
      if (!en.alive || p.dead) continue;
      if (!aabb(p, en)) continue;
      const bottom = p.y + p.h;
      if (p.vy > 0 && bottom <= en.y + STOMP_WINDOW) {
        en.alive = false;
        en.deadT = 0;
        p.vy = STOMP_BOUNCE;
        p.jumps = p.maxJumps;
        p.jumpHeld = true;
        if (p.dashCd > 0.12) p.dashCd = 0.12;
        sfx(game, 'stomp');
        shakeReq(game, 3);
        puff(game, en.x + en.w / 2, en.y + en.h / 2, 9, '#b06cf0', 110, 0.4, 2, 200);
      } else {
        damagePlayer(game, p, en.x + en.w / 2);
      }
    }
  }

  /* ------------------------------------------------------------------ boss */
  const b = e.boss;
  if (b && !p.dead) {
    if (b.alive && aabb(p, b)) {
      const bottom = p.y + p.h;
      const fromAbove = p.vy > 0 && bottom <= b.y + b.h * 0.6;
      if (fromAbove) {
        if (b.invuln <= 0) damageBoss(game, b, p);
        else p.vy = -200;
      } else {
        damagePlayer(game, p, b.x + b.w / 2);
      }
    }
    if (Array.isArray(b.projectiles)) {
      for (let i = b.projectiles.length - 1; i >= 0; i--) {
        const pr = b.projectiles[i];
        if (!aabb(p, pr)) continue;
        pr.dead = true;
        puff(game, pr.x + pr.w / 2, pr.y + pr.h / 2, 6, '#ffd166', 90, 0.35, 1, 240);
        b.projectiles.splice(i, 1);
        damagePlayer(game, p, pr.x + pr.w / 2);
        if (p.dead) break;
      }
    }
  }

  if (p.dead) return;

  /* ------------------------------------------------------------ checkpoints */
  if (Array.isArray(e.checkpoints)) {
    for (let i = 0; i < e.checkpoints.length; i++) {
      const cp = e.checkpoints[i];
      if (cp.active) continue;
      if (!rectHit(p, cp.x - 6, cp.y - 10, cp.w + 12, cp.h + 12)) continue;
      cp.active = true;
      game.checkpoint = cp;
      game.spawnPoint = { x: cp.px, y: cp.py };
      sfx(game, 'checkpoint');
      game.toast = { text: 'CHECKPOINT', sub: 'Progress saved', t: 0 };
      puff(game, cp.x + TILE / 2, cp.y + TILE / 2, 10, '#7ef0a0', 110, 0.5, 2, 60);
    }
  }

  /* ------------------------------------------------------------------- NPCs */
  let near = null;
  if (Array.isArray(e.npcs)) {
    for (let i = 0; i < e.npcs.length; i++) {
      const n = e.npcs[i];
      const dx = p.x + p.w / 2 - (n.x + n.w / 2);
      const dy = p.y + p.h / 2 - (n.y + n.h / 2);
      n.near = dx * dx + dy * dy <= NPC_RANGE * NPC_RANGE;
      if (n.near && !near) near = n;
    }
  }
  game.nearNpc = near;
  game.prompt = near
    ? { text: 'TALK', x: near.x + near.w / 2, y: near.y - 4, npc: near }
    : null;

  /* ------------------------------------------------------------------- door */
  const d = e.door;
  if (d && d.open && rectHit(p, d.x - 3, d.y - 3, d.w + 6, d.h + 6)) {
    if (!d.reached) {
      d.reached = true;
      game.reachedDoor = true;
      sfx(game, 'door');
      puff(game, d.x + d.w / 2, d.y + d.h / 2, 12, '#9be7ff', 110, 0.6, 2, 40);
    }
  }
  // Hazard tiles under the player are handled by updatePlayer().
}
