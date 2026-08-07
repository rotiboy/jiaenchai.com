#!/usr/bin/env node
// tools/headless-play.mjs — CONTRACT §6.
//
// Imports physics.js / player.js / entities.js / levels/index.js in bare Node
// (no DOM whatsoever) and runs a scripted bot through every level:
//   * holds right
//   * jumps when a wall is ahead or a gap/hazard is within 2 tiles
//   * dashes when available and the gap is > 4 tiles
//   * retries with jitter, up to 40 attempts × 90 simulated seconds each
// Asserts the goal is reached on every level. This is the primary proof the
// game is actually playable.

import { TILE, FIXED_DT } from '../src/engine/constants.js';
import { tileAt, isSolid, isOneWay, isHazard } from '../src/engine/physics.js';
import { createPlayer, updatePlayer } from '../src/game/player.js';
import {
  spawnEntities,
  updateEntities,
  collideEntities,
} from '../src/game/entities.js';
import { LEVELS } from '../src/game/levels/index.js';

const MAX_ATTEMPTS = 40;
const SIM_SECONDS = 90;
const STEPS = Math.round(SIM_SECONDS / FIXED_DT);

/* ------------------------------------------------------- deterministic RNG */
// player.js and entities.js sprinkle Math.random() through their particle and
// projectile code. Seed it so a failing attempt can be reproduced exactly.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const REAL_RANDOM = Math.random;

/* ------------------------------------------------------------- abilities */
// A level is played with the abilities unlocked by the levels *before* it —
// completing a chapter is what grants its reward (CONTRACT §7).
function abilitiesFor(index) {
  const ab = { dash: false, doubleJump: false, glide: false, companion: false };
  for (let i = 0; i < index; i++) {
    const u = LEVELS[i].unlocks;
    if (u && Object.prototype.hasOwnProperty.call(ab, u)) ab[u] = true;
  }
  return ab;
}

/* ------------------------------------------------------------ world probes */

function solidAt(level, tx, ty) {
  return isSolid(tileAt(level, tx, ty));
}
function standableAt(level, tx, ty) {
  const ch = tileAt(level, tx, ty);
  return isSolid(ch) || isOneWay(ch);
}
function hazardAt(level, tx, ty) {
  return isHazard(tileAt(level, tx, ty));
}

// How many tiles of empty floor lie ahead of the player before the next
// standable column? Returns 0 when the very next column has footing.
function gapAhead(level, p, dir, look) {
  const footTy = Math.floor((p.y + p.h + 2) / TILE);
  const edgeTx = Math.floor((dir > 0 ? p.x + p.w - 1 : p.x + 1) / TILE);
  let n = 0;
  for (let i = 1; i <= look; i++) {
    const tx = edgeTx + dir * i;
    const safe =
      (standableAt(level, tx, footTy) && !hazardAt(level, tx, footTy)) ||
      (standableAt(level, tx, footTy + 1) && !hazardAt(level, tx, footTy + 1));
    if (safe) return n;
    n++;
  }
  return n;
}

// Is there a wall in front of the player at body or head height?
function wallAhead(level, p, dir) {
  const tx = Math.floor((dir > 0 ? p.x + p.w + 2 : p.x - 2) / TILE);
  const bodyTy = Math.floor((p.y + p.h - 3) / TILE);
  const headTy = Math.floor((p.y + 2) / TILE);
  return solidAt(level, tx, bodyTy) || solidAt(level, tx, headTy);
}

// Hazard tile within `look` tiles ahead, at foot or body height.
function hazardAhead(level, p, dir, look) {
  const edgeTx = Math.floor((dir > 0 ? p.x + p.w - 1 : p.x + 1) / TILE);
  const footTy = Math.floor((p.y + p.h + 2) / TILE);
  const bodyTy = Math.floor((p.y + p.h - 3) / TILE);
  for (let i = 1; i <= look; i++) {
    const tx = edgeTx + dir * i;
    if (hazardAt(level, tx, footTy) || hazardAt(level, tx, bodyTy)) return i;
  }
  return 0;
}

// Rise (in tiles) of the first standable surface ahead, relative to the
// player's feet. Positive means it is higher than the player.
function riseAhead(level, p, dir, look) {
  const footTy = Math.floor((p.y + p.h + 2) / TILE);
  const edgeTx = Math.floor((dir > 0 ? p.x + p.w - 1 : p.x + 1) / TILE);
  let best = 0;
  for (let i = 1; i <= look; i++) {
    const tx = edgeTx + dir * i;
    for (let up = 1; up <= 4; up++) {
      if (solidAt(level, tx, footTy - up) && !solidAt(level, tx, footTy - up - 1)) {
        if (up > best) best = up;
        break;
      }
    }
  }
  return best;
}

/* ---------------------------------------------------------------- the bot */

function makeControls() {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    jumpPressed: false,
    dash: false,
    dashPressed: false,
    action: false,
    actionPressed: false,
  };
}

function botStep(game, ctl, bot, rnd) {
  const p = game.player;
  const level = game.level;
  const ab = game.abilities;
  const e = game.entities;

  // reset edges
  ctl.left = ctl.right = ctl.up = ctl.down = false;
  ctl.jump = false;
  ctl.jumpPressed = false;
  ctl.dash = false;
  ctl.dashPressed = false;

  if (p.dead) return;

  const px = p.x + p.w / 2;

  // The final level's door only opens once "The Backlog" is defeated, so while
  // the boss lives the bot navigates to the boss instead of to the door.
  const boss = e.boss;
  const bossBlocks = !!(boss && boss.alive && e.door && !e.door.open);
  const targetX = bossBlocks
    ? boss.x + boss.w / 2
    : (e.door ? e.door.x + e.door.w / 2 : level.rows[0].length * TILE);

  /* ---------------------------------------------------------- boss arena */
  // Only take over once the bot is actually in the arena — otherwise it would
  // walk the whole level with the stomp routine and never jump a step-up.
  if (bossBlocks && Math.abs(targetX - px) < 140) {
    const dx = targetX - px;
    const adx = Math.abs(dx);
    const feetAbove = p.y + p.h <= boss.y + 2;   // clear to drop on its head

    // Dodge lobbed tickets: forward-simulate each one and step aside if it is
    // going to land on us. This is what keeps the bot's hearts alive long
    // enough to land all five stomps.
    let dodge = 0;
    if (!feetAbove && p.invuln <= 0 && Array.isArray(boss.projectiles)) {
      for (const pr of boss.projectiles) {
        let qx = pr.x;
        let qy = pr.y;
        let qvy = pr.vy;
        for (let s = 0; s < 36; s++) {
          qvy += 520 * FIXED_DT;
          qx += pr.vx * FIXED_DT;
          qy += qvy * FIXED_DT;
          if (
            qx + pr.w > p.x - 12 && qx < p.x + p.w + 12 &&
            qy + pr.h > p.y - 8 && qy < p.y + p.h + 8
          ) {
            dodge = qx + pr.w / 2 < p.x + p.w / 2 ? 1 : -1;
            break;
          }
        }
        if (dodge) break;
      }
    }
    if (dodge) {
      if (dodge > 0) ctl.right = true; else ctl.left = true;
      if (p.onGround) { ctl.jump = true; ctl.jumpPressed = !bot.jumpHeld; }
      else if (p.vy < 0) ctl.jump = true;
      bot.jumpHeld = ctl.jump;
      return;
    }

    if (p.onGround) {
      // The arena floor is always below the boss's lowest bob, so standing is
      // safe. Set up at a horizontal offset so the ascent misses its body,
      // then launch.
      const band = 42 + bot.bossAim;             // jitter the launch offset
      if (adx < band - 10) { if (dx > 0) ctl.left = true; else ctl.right = true; }
      else if (adx > band + 12) { if (dx > 0) ctl.right = true; else ctl.left = true; }
      else {
        ctl.jump = true;
        ctl.jumpPressed = !bot.jumpHeld;
      }
    } else {
      // Rising: keep the full arc, stay clear of the boss's flanks.
      if (p.vy < 0) {
        ctl.jump = true;
        if (!feetAbove) { if (dx > 0) ctl.left = true; else ctl.right = true; }
        else if (adx > 4) { if (dx > 0) ctl.right = true; else ctl.left = true; }
      }
      // Spend the air jump at the apex for maximum height.
      if (ab.doubleJump && p.jumps > 0 && p.vy > -40 && !feetAbove) {
        ctl.jump = true;
        ctl.jumpPressed = !bot.jumpHeld;
      }
      // Falling: hold jump so glide slows the descent, and home in on the head.
      if (p.vy >= 0) {
        if (ab.glide) ctl.jump = true;
        if (feetAbove) {
          if (adx > 3) { if (dx > 0) ctl.right = true; else ctl.left = true; }
        } else if (dx > 0) ctl.left = true;
        else ctl.right = true;
      }
    }
    bot.jumpHeld = ctl.jump;
    return;
  }

  /* ------------------------------------------------------------- routing */
  let dir = 1;
  if (bot.backUntil > bot.frame) dir = -1;             // unstick manoeuvre
  else if (px > targetX + 10) dir = -1;                // overshot the target
  if (dir > 0) ctl.right = true;
  else ctl.left = true;

  const look = 6;
  const gap = gapAhead(level, p, dir, look);
  const hz = hazardAhead(level, p, dir, 3);
  const rise = riseAhead(level, p, dir, 2);
  const wall = wallAhead(level, p, dir);

  // Enemy directly ahead on the ground: hop onto it (stomp) rather than walk in.
  let enemyAhead = false;
  if (Array.isArray(e.enemies)) {
    for (const en of e.enemies) {
      if (!en.alive) continue;
      const d = (en.x + en.w / 2 - px) * dir;
      if (d > 0 && d < 30 && Math.abs(en.y - p.y) < 26) { enemyAhead = true; break; }
    }
  }

  /* --------------------------------------------------------------- jump */
  let wantJump = false;
  if (p.onGround) {
    if (wall && rise > 0) wantJump = true;
    if (gap >= 1 + bot.gapBias) wantJump = true;
    if (hz > 0 && hz <= 2) wantJump = true;
    if (rise > 0 && gap === 0 && wall) wantJump = true;
    if (enemyAhead) wantJump = true;
    if (bot.forceJump > 0) { wantJump = true; bot.forceJump--; }
  } else {
    // Hold jump while rising. player.js cuts a released jump to 45% of its
    // velocity, which is not even enough to clear a single-tile step, so the
    // bot holds until it has gained the height the take-off called for.
    const needTop = bot.takeoffY - bot.needRise;
    if (p.vy < 0 && (bot.holdAll || p.y > needTop)) ctl.jump = true;
    // Double jump to save a bad leap or to clear a tall step.
    if (
      ab.doubleJump &&
      p.jumps > 0 &&
      p.vy > 60 &&
      (bot.lastGap >= 3 || bot.lastRise >= 3) &&
      !p.onGround
    ) {
      ctl.jump = true;
      ctl.jumpPressed = !bot.jumpHeld;
    }
    // Glide over long falls so the bot does not overshoot into a pit wall.
    if (ab.glide && p.vy > 120 && bot.lastGap >= 4) ctl.jump = true;
  }

  if (wantJump) {
    bot.lastGap = gap;
    bot.lastRise = rise;
    bot.takeoffY = p.y;
    // Hold the jump button until this much height has been gained: enough to
    // clear the step ahead, or a healthy arc when clearing a gap.
    bot.needRise = Math.max(rise * TILE + 14, gap >= 2 ? 34 : 12, hz > 0 ? 30 : 0);
    ctl.jump = true;
    ctl.jumpPressed = !bot.jumpHeld;
  }

  /* --------------------------------------------------------------- dash */
  if (ab.dash && p.dashCd <= 0) {
    const wideGap = gap > 4 || (gap > 3 && bot.eagerDash);
    if (wideGap && !p.onGround && p.vy > -60) {
      ctl.dash = true;
      ctl.dashPressed = !bot.dashHeld;
    } else if (wideGap && p.onGround && bot.dashOnGround) {
      ctl.dash = true;
      ctl.dashPressed = !bot.dashHeld;
    }
  }

  /* ------------------------------------------------------------ unstick */
  // Each manoeuvre is fired once and given a fixed budget of frames, then the
  // stuck counter restarts. Without the reset the bot latches into permanent
  // reverse the moment it wanders onto a side route.
  if (bot.stuck > 70 && bot.manoeuvreUntil <= bot.frame) {
    bot.manoeuvre = (bot.manoeuvre + 1) % 4;
    bot.manoeuvreUntil = bot.frame + 18 + Math.floor(rnd() * 22);
    bot.stuck = 0;
    if (bot.manoeuvre === 1) bot.backUntil = bot.manoeuvreUntil;
  }
  if (bot.manoeuvreUntil > bot.frame) {
    if (bot.manoeuvre === 0 && p.onGround) {
      // straight up-and-over
      bot.takeoffY = p.y;
      bot.needRise = 56;
      ctl.jump = true;
      ctl.jumpPressed = !bot.jumpHeld;
    } else if (bot.manoeuvre === 2 && ab.dash && p.dashCd <= 0) {
      ctl.dash = true;
      ctl.dashPressed = !bot.dashHeld;
    } else if (bot.manoeuvre === 3) {
      // drop through a one-way platform, or hop off a ledge
      ctl.down = true;
      ctl.jump = true;
      ctl.jumpPressed = !bot.jumpHeld;
    }
  }

  bot.jumpHeld = ctl.jump;
  bot.dashHeld = ctl.dash;
}

/* ------------------------------------------------------------ one attempt */

export function attempt(level, index, seed, trace) {
  const rnd = mulberry32(seed);
  Math.random = rnd;
  try {
    const game = {
      level,
      levelIndex: index,
      abilities: abilitiesFor(index),
      hearts: 3,
      lives: 3,
      coins: 0,
      coinsTotal: 0,
      timeMs: 0,
      particles: [],
      sfxQueue: [],
      shakeRequest: 0,
      reachedDoor: false,
      spawnPoint: null,
    };
    game.player = createPlayer(level);
    game.entities = spawnEntities(level);

    const ctl = makeControls();
    const bot = {
      frame: 0,
      stuck: 0,
      bestX: game.player.x,
      backUntil: 0,
      forceJump: 0,
      manoeuvre: -1,
      manoeuvreUntil: 0,
      jumpHeld: false,
      dashHeld: false,
      lastGap: 0,
      lastRise: 0,
      // jitter knobs, varied per attempt
      gapBias: seed % 3 === 0 ? 0 : 1,
      eagerDash: rnd() < 0.5,
      dashOnGround: rnd() < 0.35,
      holdAll: rnd() < 0.6,
      takeoffY: 0,
      needRise: 0,
      bossAim: Math.floor(rnd() * 26),
    };

    let restarts = 0;
    for (let step = 0; step < STEPS; step++) {
      bot.frame = step;
      botStep(game, ctl, bot, rnd);
      if (trace) trace(step, game, ctl, bot);

      updatePlayer(game.player, level, ctl, FIXED_DT, game);
      updateEntities(game, FIXED_DT);
      collideEntities(game, FIXED_DT);

      // side channels the real game drains every frame
      game.sfxQueue.length = 0;
      game.shakeRequest = 0;
      if (game.particles.length > 400) game.particles.length = 0;

      if (game.reachedDoor) {
        return { ok: true, frames: step, x: game.player.x, restarts };
      }

      // Out of lives: the integrator restarts the chapter; do the same here.
      if (game.requestLevelRestart) {
        game.requestLevelRestart = false;
        restarts++;
        if (restarts > 4) break;
        game.entities = spawnEntities(level);
        game.player = createPlayer(level);
        game.spawnPoint = null;
        game.hearts = 3;
        game.lives = 3;
        game.coins = 0;
        bot.stuck = 0;
        bot.bestX = game.player.x;
        continue;
      }

      // progress / stuck tracking
      if (game.player.x > bot.bestX + 1) {
        bot.bestX = game.player.x;
        bot.stuck = 0;
      } else {
        bot.stuck++;
      }
    }
    return { ok: false, frames: STEPS, x: game.player.x, best: bot.bestX, restarts };
  } finally {
    Math.random = REAL_RANDOM;
  }
}

/* ------------------------------------------------------------------ runner */

export function main() {

  console.log(`headless-play: ${LEVELS.length} levels, up to ${MAX_ATTEMPTS} attempts ×`
    + ` ${SIM_SECONDS}s each\n`);

  let failed = 0;
  const t0 = Date.now();

  for (let i = 0; i < LEVELS.length; i++) {
    const level = LEVELS[i];
    const ab = abilitiesFor(i);
    const abList = Object.keys(ab).filter((k) => ab[k]).join(',') || 'none';
    let won = null;
    let tries = 0;
    let far = 0;

    for (let a = 0; a < MAX_ATTEMPTS; a++) {
      tries = a + 1;
      const r = attempt(level, i, (i + 1) * 7919 + a * 104729 + 1);
      if (r.ok) { won = r; break; }
      far = Math.max(far, r.best || r.x);
    }

    if (won) {
      const secs = (won.frames * FIXED_DT).toFixed(1);
      console.log(
        `  ok   ${i}. ${String(level.id).padEnd(22)} goal in ${String(secs).padStart(5)}s`
        + ` on attempt ${String(tries).padStart(2)}  [abilities: ${abList}]`
        + (won.restarts ? `  (${won.restarts} chapter restart(s))` : ''),
      );
    } else {
      failed++;
      const w = level.rows[0].length * TILE;
      console.error(
        `  FAIL ${i}. ${level.id} — never reached the goal in ${MAX_ATTEMPTS} attempts;`
        + ` furthest x=${Math.round(far)} of ${w}px (${((far / w) * 100).toFixed(1)}%)`
        + `  [abilities: ${abList}]`,
      );
    }
  }

  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nheadless-play: ${LEVELS.length - failed}/${LEVELS.length} levels completed in ${dur}s`);
  failed += flyerContainment();
  if (failed) {
    console.error('headless-play: FAILED');
    process.exit(1);
  }
  console.log('headless-play: OK');

}

/* ------------------------------------------------- flyer tile containment */
// Flyers move in closed form (sine bob + horizontal chase) instead of running
// tile collision, so their reachable box has to be provably solid-free —
// otherwise they drift inside blocks and damage the player from within the
// geometry they are standing on, where a stomp is impossible (vy = 0).
function overlapsSolidTile(level, b) {
  const x0 = Math.floor(b.x / TILE);
  const x1 = Math.floor((b.x + b.w - 0.001) / TILE);
  const y0 = Math.floor(b.y / TILE);
  const y1 = Math.floor((b.y + b.h - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (isSolid(tileAt(level, tx, ty))) return { tx, ty };
    }
  }
  return null;
}

function flyerContainment() {
  let bad = 0;
  let flyers = 0;
  for (const level of LEVELS) {
    const game = {
      level,
      entities: spawnEntities(level),
      particles: [],
      player: createPlayer(level),
    };
    const list = game.entities.enemies.filter((e) => e.type === 'flyer');
    flyers += list.length;
    if (!list.length) continue;
    const span = level.rows[0].length * TILE;
    // Drag the player across the whole level so every flyer is chased to both
    // ends of its range, and bob through several full sine periods.
    for (let step = 0; step < 3600; step++) {
      game.player.x = 8 + ((step * 3) % span);
      game.player.y = 100;
      updateEntities(game, FIXED_DT);
      for (const en of list) {
        const hit = overlapsSolidTile(level, en);
        if (!hit) continue;
        bad++;
        if (bad <= 5) {
          console.error(
            `  FAIL flyer in ${level.id} spawned at (${en.tx},${en.ty}) reached`
            + ` (${en.x.toFixed(1)},${en.y.toFixed(1)}) — inside solid tile (${hit.tx},${hit.ty})`,
          );
        }
      }
    }
  }
  if (bad) {
    console.error(`  FAIL ${bad} frame(s) with a flyer inside solid geometry`);
    return 1;
  }
  console.log(`headless-play: ${flyers} flyers stay clear of solid tiles`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
