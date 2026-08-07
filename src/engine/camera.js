// src/engine/camera.js
// Smooth dead-zone follow camera, clamped to the level bounds, with decaying
// screen shake. DOM-free (imports constants only).
//
// cam = {x, y, shake, shakeT, ...}
//   x, y  — final integer top-left of the view in world px (shake baked in).
//           Renderers can use these directly: ctx.translate(-cam.x, -cam.y).
//   shake — current shake magnitude in px.
//   shakeT— seconds of shake remaining.

import {
  TILE, VIEW_W, VIEW_H,
  CAM_DEAD_X, CAM_DEAD_Y, CAM_LERP_X, CAM_LERP_Y, CAM_LOOK_Y, CAM_SHAKE_DECAY,
} from './constants.js';

/**
 * @param {{rows?: string[]}} level
 */
export function createCamera(level) {
  const cam = {
    x: 0,
    y: 0,
    shake: 0,
    shakeT: 0,
    // internals (floating point follow position, kept out of the rendered x/y)
    baseX: 0,
    baseY: 0,
    w: VIEW_W,
    h: VIEW_H,
    levelW: 0,
    levelH: 0,
    seed: 0x2f6e2b1 >>> 0,
    snap: true,
  };
  measure(cam, level);
  return cam;
}

/**
 * Smooth follow toward (targetX, targetY) — usually the player's centre — with a
 * small dead-zone, clamped so the view never shows outside the level, plus shake.
 */
export function updateCamera(cam, targetX, targetY, dt, level) {
  if (!cam) return cam;
  if (level) measure(cam, level);

  const step = (typeof dt === 'number' && isFinite(dt) && dt > 0) ? Math.min(dt, 0.1) : 0;
  const tx = numberOr(targetX, cam.baseX + cam.w / 2);
  const ty = numberOr(targetY, cam.baseY + cam.h / 2) + CAM_LOOK_Y;

  // --- dead-zone: the camera only chases once the target leaves the box ---
  let goalCX = cam.baseX + cam.w / 2;
  const dx = tx - goalCX;
  if (dx > CAM_DEAD_X) goalCX = tx - CAM_DEAD_X;
  else if (dx < -CAM_DEAD_X) goalCX = tx + CAM_DEAD_X;

  let goalCY = cam.baseY + cam.h / 2;
  const dy = ty - goalCY;
  if (dy > CAM_DEAD_Y) goalCY = ty - CAM_DEAD_Y;
  else if (dy < -CAM_DEAD_Y) goalCY = ty + CAM_DEAD_Y;

  const goalX = goalCX - cam.w / 2;
  const goalY = goalCY - cam.h / 2;

  if (cam.snap || step === 0) {
    cam.baseX = goalX;
    cam.baseY = goalY;
    cam.snap = false;
  } else {
    const kx = 1 - Math.exp(-CAM_LERP_X * step);
    const ky = 1 - Math.exp(-CAM_LERP_Y * step);
    cam.baseX += (goalX - cam.baseX) * kx;
    cam.baseY += (goalY - cam.baseY) * ky;
    if (Math.abs(goalX - cam.baseX) < 0.05) cam.baseX = goalX;
    if (Math.abs(goalY - cam.baseY) < 0.05) cam.baseY = goalY;
  }

  cam.baseX = clampX(cam, cam.baseX);
  cam.baseY = clampY(cam, cam.baseY);

  // --- shake decay ---
  let ox = 0;
  let oy = 0;
  if (cam.shakeT > 0) {
    cam.shakeT -= step;
    cam.shake *= Math.pow(CAM_SHAKE_DECAY, step);
    if (cam.shakeT <= 0 || cam.shake < 0.05) {
      cam.shakeT = 0;
      cam.shake = 0;
    } else {
      ox = (rand(cam) * 2 - 1) * cam.shake;
      oy = (rand(cam) * 2 - 1) * cam.shake;
    }
  } else {
    cam.shakeT = 0;
    cam.shake = 0;
  }

  // Clamp again after shake so the view never reveals outside the level.
  cam.x = Math.round(clampX(cam, cam.baseX + ox));
  cam.y = Math.round(clampY(cam, cam.baseY + oy));
  return cam;
}

/** Add screen shake, in pixels of maximum offset. */
export function shake(cam, amount) {
  if (!cam) return;
  const a = numberOr(amount, 0);
  if (a <= 0) return;
  cam.shake = Math.max(cam.shake || 0, a);
  cam.shakeT = Math.max(cam.shakeT || 0, 0.18 + Math.min(a, 12) * 0.02);
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function measure(cam, level) {
  const rows = level && level.rows;
  if (rows && rows.length) {
    let w = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (typeof r === 'string' && r.length > w) w = r.length;
    }
    cam.levelW = w * TILE;
    cam.levelH = rows.length * TILE;
  } else {
    cam.levelW = cam.levelW || cam.w;
    cam.levelH = cam.levelH || cam.h;
  }
}

function clampX(cam, x) {
  if (cam.levelW <= cam.w) return (cam.levelW - cam.w) / 2; // centre small levels
  if (x < 0) return 0;
  const max = cam.levelW - cam.w;
  return x > max ? max : x;
}

function clampY(cam, y) {
  if (cam.levelH <= cam.h) return (cam.levelH - cam.h) / 2;
  if (y < 0) return 0;
  const max = cam.levelH - cam.h;
  return y > max ? max : y;
}

// Small deterministic LCG so shake never depends on Math.random.
function rand(cam) {
  cam.seed = (cam.seed * 1664525 + 1013904223) >>> 0;
  return cam.seed / 4294967296;
}

function numberOr(v, fallback) {
  return (typeof v === 'number' && isFinite(v)) ? v : fallback;
}
