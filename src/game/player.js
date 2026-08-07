// src/game/player.js — player simulation. DOM-free: importable in bare Node.js.
// Owns movement feel: accel/friction, variable jump, coyote time, jump buffering,
// double jump, dash, glide, and the companion drone.
//
// Side channels to the rest of the game (the integrator drains these):
//   game.sfxQueue   -> array of sound names, e.g. 'jump'
//   game.particles  -> array of {x,y,vx,vy,life,maxLife,color,size}
//   game.shakeRequest -> number (camera shake amount)
//   game.toast      -> {text, sub, t}

import {
  TILE,
  GRAVITY,
  MAX_FALL,
  RUN_SPEED,
  RUN_ACCEL,
  RUN_FRICTION,
  AIR_ACCEL,
  JUMP_V,
  JUMP_CUT,
  COYOTE,
  JUMP_BUFFER,
  DASH_SPEED,
  DASH_TIME,
  DASH_COOLDOWN,
  GLIDE_FALL,
  PLAYER_W,
  PLAYER_H,
} from '../engine/constants.js';
import {
  moveAndCollide,
  overlappingTiles,
  isHazard,
  isOneWay,
  tileAt,
} from '../engine/physics.js';

const MAX_DT = 1 / 30;
const HURT_TIME = 0.34;
const INVULN_TIME = 1.2;
const DEATH_TIME = 1.0;
const DROP_TIME = 0.2;
const AIR_DRAG = 260;          // px/s^2 applied when no horizontal input in the air
const LAND_DASH_FLOOR = 0.16;  // landing refreshes the dash, but never to zero
const COMPANION_RANGE = 40;    // vacuum radius, px
const COMPANION_PULL = 260;    // px/s a vacuumed coin travels toward the player
const MAX_PARTICLES = 420;

/* ------------------------------------------------------------------ utils */

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function approach(v, target, delta) {
  if (v < target) return Math.min(v + delta, target);
  if (v > target) return Math.max(v - delta, target);
  return target;
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
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.6;
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

function setAnim(p, name) {
  if (p.anim !== name) {
    p.anim = name;
    p.animT = 0;
  }
}

/* ----------------------------------------------------------------- create */

export function createPlayer(level) {
  const rows = level && Array.isArray(level.rows) ? level.rows : [];
  let sx = TILE * 2;
  let sy = TILE * 2;
  for (let ty = 0; ty < rows.length; ty++) {
    const row = typeof rows[ty] === 'string' ? rows[ty] : '';
    const tx = row.indexOf('P');
    if (tx >= 0) {
      sx = tx * TILE + (TILE - PLAYER_W) / 2;
      sy = ty * TILE + (TILE - PLAYER_H);
      break;
    }
  }
  return {
    x: sx,
    y: sy,
    w: PLAYER_W,
    h: PLAYER_H,
    vx: 0,
    vy: 0,
    onGround: false,
    hitCeiling: false,
    hitWallL: false,
    hitWallR: false,
    dropTimer: 0,
    facing: 1,
    anim: 'idle',
    animT: 0,
    t: 0,
    coyote: 0,
    buffer: 0,
    jumps: 1,
    maxJumps: 1,
    jumpHeld: false,
    dashT: 0,
    dashCd: 0,
    dashDir: 1,
    gliding: false,
    invuln: 0,
    hurtT: 0,
    dead: false,
    deadT: 0,
    spawnX: sx,
    spawnY: sy,
    companion: null,
  };
}

/* ------------------------------------------------------------- sub-systems */

function standingOnOneWay(p, level) {
  if (!level) return false;
  const ty = Math.floor((p.y + p.h + 1) / TILE);
  const x0 = Math.floor((p.x + 1) / TILE);
  const x1 = Math.floor((p.x + p.w - 1) / TILE);
  for (let tx = x0; tx <= x1; tx++) {
    if (isOneWay(tileAt(level, tx, ty))) return true;
  }
  return false;
}

function doJump(p, game, isAir) {
  p.vy = isAir ? JUMP_V * 0.94 : JUMP_V;
  p.buffer = 0;
  p.coyote = 0;
  p.onGround = false;
  p.jumpHeld = true;
  p.gliding = false;
  p.jumps = isAir ? Math.max(0, p.jumps - 1) : Math.max(0, p.maxJumps - 1);
  sfx(game, 'jump');
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h;
  if (isAir) {
    puff(game, cx, cy - 2, 8, '#9be7ff', 70, 0.32, 2, 30);
  } else {
    puff(game, cx, cy, 4, '#ffffff', 42, 0.24, 1, 120);
  }
}

function revealSign(game, bumped) {
  if (!game || !bumped) return;
  const ents = game.entities;
  if (!ents || !Array.isArray(ents.signs)) return;
  for (let i = 0; i < ents.signs.length; i++) {
    const s = ents.signs[i];
    if (s.tx === bumped.tx && s.ty === bumped.ty) {
      s.bumpT = 0.3;
      s.revealed = true;
      game.toast = { text: s.text || '', sub: 'NOTE', t: 0 };
      sfx(game, 'select');
      puff(game, s.x + TILE / 2, s.y + TILE, 6, '#ffe08a', 55, 0.3, 1, 240);
      return;
    }
  }
}

function updateCompanion(p, game, dt) {
  const ab = (game && game.abilities) || {};
  if (!ab.companion) {
    p.companion = null;
    if (game && typeof game === 'object') game.companion = null;
    return;
  }
  let c = p.companion;
  if (!c) {
    c = { x: p.x + p.w / 2, y: p.y - 12, vx: 0, vy: 0, t: 0 };
    p.companion = c;
  }
  if (game && typeof game === 'object') game.companion = c;

  c.t += dt;
  const tx = p.x + p.w / 2 - p.facing * 13;
  const ty = p.y - 10 + Math.sin(c.t * 3.1) * 2.5;
  const k = 90;                       // spring stiffness
  const damp = Math.exp(-7 * dt);     // frame-rate independent damping
  c.vx = (c.vx + (tx - c.x) * k * dt) * damp;
  c.vy = (c.vy + (ty - c.y) * k * dt) * damp;
  c.vx = clamp(c.vx, -420, 420);
  c.vy = clamp(c.vy, -420, 420);
  c.x += c.vx * dt;
  c.y += c.vy * dt;

  // Vacuum: flag coins within COMPANION_RANGE of the drone, then reel them in
  // toward the player so the normal pickup test in collideEntities collects them.
  const coins = game && game.entities && game.entities.coins;
  if (!Array.isArray(coins)) return;
  const px = p.x + p.w / 2;
  const py = p.y + p.h / 2;
  for (let i = 0; i < coins.length; i++) {
    const co = coins[i];
    if (!co || co.taken) continue;
    const cx = co.x + (co.w || 8) / 2;
    const cy = co.y + (co.h || 8) / 2;
    if (!co.attracted) {
      const dx = cx - c.x;
      const dy = cy - c.y;
      if (dx * dx + dy * dy <= COMPANION_RANGE * COMPANION_RANGE) {
        co.attracted = true;
        particle(game, cx, cy, 0, -20, 0.25, '#9be7ff', 1, 0);
      }
    }
    if (co.attracted) {
      const dx = px - cx;
      const dy = py - cy;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const step = Math.min(d, COMPANION_PULL * dt);
      co.x += (dx / d) * step;
      co.y += (dy / d) * step;
      co.homeY = co.y;
    }
  }
}

/* ----------------------------------------------------------------- update */

export function updatePlayer(p, level, controls, dt, game) {
  if (!p) return;
  const g = game && typeof game === 'object' ? game : {};
  const c = controls || {};
  const ab = g.abilities || {};
  const step = clamp(Number(dt) || 0, 0, MAX_DT);
  if (step <= 0) return;

  p.t += step;
  p.animT += step;
  if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - step);
  if (p.hurtT > 0) p.hurtT = Math.max(0, p.hurtT - step);
  if (p.dashCd > 0) p.dashCd = Math.max(0, p.dashCd - step);

  /* --- dead: short arc, then auto-respawn (works with no state.js present) */
  if (p.dead) {
    p.deadT += step;
    p.gliding = false;
    p.dashT = 0;
    p.vy = Math.min(p.vy + GRAVITY * step, MAX_FALL);
    p.y += p.vy * step;
    setAnim(p, 'hurt');
    if (p.deadT >= DEATH_TIME) respawnPlayer(p, g);
    return;
  }

  const dir = (c.right ? 1 : 0) - (c.left ? 1 : 0);

  /* --------------------------------------------------------- jump plumbing */
  p.maxJumps = ab.doubleJump ? 2 : 1;
  if (p.jumps > p.maxJumps) p.jumps = p.maxJumps;
  if (p.onGround) {
    p.coyote = COYOTE;
    p.jumps = p.maxJumps;
  } else {
    p.coyote = Math.max(0, p.coyote - step);
    // Walking off a ledge costs the ground jump once coyote time lapses.
    if (p.coyote <= 0 && p.jumps >= p.maxJumps) p.jumps = Math.max(0, p.maxJumps - 1);
  }
  if (c.jumpPressed) p.buffer = JUMP_BUFFER;
  else p.buffer = Math.max(0, p.buffer - step);

  /* ------------------------------------------------------ drop-through '=' */
  if (c.down && c.jumpPressed && p.onGround && standingOnOneWay(p, level)) {
    p.dropTimer = DROP_TIME;
    p.buffer = 0;
    p.onGround = false;
    p.y += 1;
    puff(g, p.x + p.w / 2, p.y + p.h, 3, '#ffffff', 30, 0.2, 1, 160);
  }

  /* ------------------------------------------------------------------ dash */
  if (
    ab.dash &&
    c.dashPressed &&
    p.dashT <= 0 &&
    p.dashCd <= 0
  ) {
    p.dashDir = dir !== 0 ? dir : p.facing;
    p.facing = p.dashDir;
    p.dashT = DASH_TIME;
    p.dashCd = DASH_TIME + DASH_COOLDOWN;
    p.vy = 0;
    p.gliding = false;
    p.buffer = 0;
    sfx(g, 'dash');
    shakeReq(g, 2.5);
    puff(g, p.x + p.w / 2, p.y + p.h / 2, 7, '#8ef0ff', 90, 0.28, 2, 0);
  }

  /* ------------------------------------------------------------- horizontal */
  if (p.dashT > 0) {
    p.dashT = Math.max(0, p.dashT - step);
    p.vx = p.dashDir * DASH_SPEED;
    particle(
      g,
      p.x + p.w / 2 - p.dashDir * 3,
      p.y + p.h / 2 + (Math.random() * 6 - 3),
      -p.dashDir * 30,
      -6,
      0.2,
      '#bff4ff',
      2,
      0,
    );
    if (p.dashT <= 0) {
      p.vx = p.dashDir * RUN_SPEED * 1.05;
    }
  } else {
    const accel = p.onGround ? RUN_ACCEL : AIR_ACCEL;
    if (dir !== 0) {
      p.facing = dir;
      const target = dir * RUN_SPEED;
      if (dir > 0 ? p.vx < target : p.vx > target) {
        p.vx += dir * accel * step;
        p.vx = dir > 0 ? Math.min(p.vx, target) : Math.max(p.vx, target);
      } else {
        // Over top speed (dash exit / knockback): bleed back down.
        p.vx = approach(p.vx, target, (p.onGround ? RUN_FRICTION : AIR_DRAG) * step);
      }
    } else {
      p.vx = approach(p.vx, 0, (p.onGround ? RUN_FRICTION : AIR_DRAG) * step);
    }
  }

  /* ------------------------------------------------------------------ jump */
  if (p.buffer > 0 && p.dashT <= 0) {
    if (p.onGround || p.coyote > 0) {
      doJump(p, g, false);
    } else if (ab.doubleJump && p.jumps > 0) {
      doJump(p, g, true);
    }
  }

  // Variable height: releasing jump while rising clips the arc.
  if (p.jumpHeld && !c.jump) {
    if (p.vy < 0) p.vy *= JUMP_CUT;
    p.jumpHeld = false;
  }

  /* ----------------------------------------------------------------- glide */
  p.gliding = !!(ab.glide && c.jump && !p.onGround && p.dashT <= 0 && p.vy > 20);

  /* --------------------------------------------------------------- gravity */
  if (p.dashT > 0) {
    p.vy = 0;
  } else {
    p.vy += GRAVITY * (p.gliding ? 0.45 : 1) * step;
    const maxFall = p.gliding ? GLIDE_FALL : MAX_FALL;
    if (p.vy > maxFall) p.vy = maxFall;
    if (p.gliding && Math.random() < 0.35) {
      particle(
        g,
        p.x + p.w / 2 + (Math.random() * 10 - 5),
        p.y + 2,
        p.vx * -0.1,
        -14,
        0.35,
        '#cfe9ff',
        1,
        -30,
      );
    }
  }

  /* ------------------------------------------------------------- integrate */
  const wasOnGround = p.onGround;
  const fallSpeed = p.vy;
  const beforeDrop = p.dropTimer;
  const res = moveAndCollide(p, level, step);
  // physics.js may or may not tick dropTimer itself — only tick it here if not.
  if (p.dropTimer > 0 && p.dropTimer === beforeDrop) {
    p.dropTimer = Math.max(0, p.dropTimer - step);
  }

  if (res && res.bumpedTile) revealSign(g, res.bumpedTile);

  if (p.onGround) {
    p.gliding = false;
    if (!wasOnGround) {
      p.jumps = p.maxJumps;
      p.coyote = COYOTE;
      if (p.dashCd > LAND_DASH_FLOOR) p.dashCd = LAND_DASH_FLOOR;
      if (fallSpeed > 220) {
        puff(g, p.x + p.w / 2, p.y + p.h, 5, '#d8d8d8', 46, 0.24, 1, 200);
        if (fallSpeed > 380) shakeReq(g, 1.5);
      }
    }
  }
  if (p.hitCeiling && p.vy < 0) p.vy = 0;

  /* --------------------------------------------------------------- hazards */
  const tiles = overlappingTiles(p, level);
  if (Array.isArray(tiles)) {
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] && isHazard(tiles[i].ch)) {
        hurtPlayer(p, g);
        break;
      }
    }
  }
  // Safety net: fell out of the world (levels are sealed, but never trust it).
  const rows = level && Array.isArray(level.rows) ? level.rows : null;
  if (rows && p.y > rows.length * TILE + 48 && !p.dead) {
    g.hearts = 0;
    p.dead = true;
    p.deadT = 0;
    p.invuln = 999;
    p.vy = -180;
    sfx(g, 'hurt');
  }

  /* ------------------------------------------------------------- companion */
  updateCompanion(p, g, step);

  /* ------------------------------------------------------------------ anim */
  if (p.hurtT > 0) setAnim(p, 'hurt');
  else if (p.dashT > 0) setAnim(p, 'dash');
  else if (p.gliding) setAnim(p, 'glide');
  else if (!p.onGround) setAnim(p, p.vy < 0 ? 'jump' : 'fall');
  else if (Math.abs(p.vx) > 10) setAnim(p, 'run');
  else setAnim(p, 'idle');
}

/* ------------------------------------------------------------------ damage */

export function hurtPlayer(p, game) {
  if (!p || p.dead || p.invuln > 0) return false;
  const g = game && typeof game === 'object' ? game : {};

  p.invuln = INVULN_TIME;
  p.hurtT = HURT_TIME;
  p.dashT = 0;
  p.gliding = false;
  p.buffer = 0;
  p.vy = -200;
  p.vx = -p.facing * 150;
  setAnim(p, 'hurt');

  const hearts = typeof g.hearts === 'number' ? g.hearts : 3;
  g.hearts = Math.max(0, hearts - 1);

  sfx(g, 'hurt');
  shakeReq(g, 6);
  puff(g, p.x + p.w / 2, p.y + p.h / 2, 10, '#ff5c6a', 130, 0.45, 2, 260);

  if (g.hearts <= 0) {
    p.dead = true;
    p.deadT = 0;
    p.vx = 0;
    p.vy = -260;
    p.invuln = 999;
    shakeReq(g, 9);
    puff(g, p.x + p.w / 2, p.y + p.h / 2, 14, '#ffd166', 160, 0.6, 2, 300);
  }
  return true;
}

/* ----------------------------------------------------------------- respawn */

export function respawnPlayer(p, game) {
  if (!p) return;
  const g = game && typeof game === 'object' ? game : {};
  const wasDead = !!p.dead;

  let x = p.spawnX;
  let y = p.spawnY;
  if (g.spawnPoint && typeof g.spawnPoint.x === 'number') {
    x = g.spawnPoint.x;
    y = g.spawnPoint.y;
  } else {
    const cps = g.entities && g.entities.checkpoints;
    if (Array.isArray(cps)) {
      let best = null;
      for (let i = 0; i < cps.length; i++) {
        const cp = cps[i];
        if (cp && cp.active && (!best || cp.x > best.x)) best = cp;
      }
      if (best) {
        x = typeof best.px === 'number' ? best.px : best.x;
        y = typeof best.py === 'number' ? best.py : best.y;
      }
    }
  }

  if (wasDead) {
    const lives = typeof g.lives === 'number' ? g.lives : 3;
    g.lives = lives - 1;
    // CONTRACT §5: "0 lives → level restart". Three deaths spend the three
    // lives; the restart fires the moment the counter reaches zero, not below.
    if (g.lives <= 0) {
      // Out of lives: no game-over screen — ask the integrator for a clean
      // restart of the level and start over from the level spawn.
      g.lives = 3;
      g.requestLevelRestart = true;
      x = p.spawnX;
      y = p.spawnY;
    }
  }

  p.x = x;
  p.y = y;
  p.vx = 0;
  p.vy = 0;
  p.onGround = false;
  p.hitCeiling = false;
  p.hitWallL = false;
  p.hitWallR = false;
  p.dropTimer = 0;
  p.dead = false;
  p.deadT = 0;
  p.hurtT = 0;
  p.invuln = 1.0;
  p.dashT = 0;
  p.dashCd = 0;
  p.gliding = false;
  p.jumpHeld = false;
  p.buffer = 0;
  p.coyote = 0;
  p.maxJumps = g.abilities && g.abilities.doubleJump ? 2 : 1;
  p.jumps = p.maxJumps;
  p.companion = null;
  setAnim(p, 'idle');

  g.hearts = 3;
  if (wasDead) {
    sfx(g, 'select');
    puff(g, p.x + p.w / 2, p.y + p.h / 2, 8, '#9be7ff', 90, 0.4, 2, 120);
  }
}
