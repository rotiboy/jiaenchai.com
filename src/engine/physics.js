// src/engine/physics.js
// Tile-based swept AABB collision. DOM-free: importable in bare Node.js.
//
// Body shape: {x, y, w, h, vx, vy, onGround, hitCeiling, hitWallL, hitWallR, dropTimer}
// Level shape: {rows: [string, ...]} — see CONTRACT §2.
//
// Out-of-bounds tiles: left of x=0 and right of the row edge are solid '#',
// above the map is empty '.', below the map is solid '#'.

import { TILE, EPS, SUBSTEP_PX, ONE_WAY_TOL, GROUND_PROBE } from './constants.js';

/**
 * Tile char at tile coords. Never throws; returns the out-of-bounds char.
 * @returns {string}
 */
export function tileAt(level, tx, ty) {
  const rows = level && level.rows;
  if (!rows || rows.length === 0) return '#';
  if (ty < 0) return '.';
  if (ty >= rows.length) return '#';
  const row = rows[ty];
  if (typeof row !== 'string') return '#';
  if (tx < 0 || tx >= row.length) return '#';
  const ch = row.charAt(tx);
  return ch === '' ? '#' : ch;
}

/** Solid from every direction. */
export function isSolid(ch) {
  return ch === '#' || ch === '?';
}

/** One-way platform: solid only when landed on from above. */
export function isOneWay(ch) {
  return ch === '=';
}

/** Damaging tile. */
export function isHazard(ch) {
  return ch === '^' || ch === '~';
}

/** AABB overlap test on {x,y,w,h}. Touching edges do not count as overlap. */
export function aabb(a, b) {
  return (
    a.x < b.x + b.w &&
    b.x < a.x + a.w &&
    a.y < b.y + b.h &&
    b.y < a.y + a.h
  );
}

/**
 * Sweeps `body` along X then Y with tile collision, sub-stepping so nothing can
 * tunnel through a one-tile-thick surface. Mutates `body`:
 *   x, y, vx, vy, onGround, hitCeiling, hitWallL, hitWallR, dropTimer
 * @returns {{bumpedTile: {tx:number,ty:number,ch:string}|null}}
 */
export function moveAndCollide(body, level, dt) {
  const out = { bumpedTile: null };

  body.onGround = false;
  body.hitCeiling = false;
  body.hitWallL = false;
  body.hitWallR = false;

  if (typeof body.vx !== 'number' || !isFinite(body.vx)) body.vx = 0;
  if (typeof body.vy !== 'number' || !isFinite(body.vy)) body.vy = 0;
  if (typeof body.dropTimer !== 'number' || !isFinite(body.dropTimer)) body.dropTimer = 0;

  const step = (typeof dt === 'number' && isFinite(dt) && dt > 0) ? dt : 0;

  if (step > 0) {
    const travel = Math.max(Math.abs(body.vx), Math.abs(body.vy)) * step;
    let n = Math.ceil(travel / SUBSTEP_PX);
    if (!(n > 0)) n = 1;
    if (n > 1024) n = 1024;      // hard sanity cap for absurd velocities
    const sdt = step / n;
    for (let i = 0; i < n; i++) {
      sweepX(body, level, body.vx * sdt);
      sweepY(body, level, body.vy * sdt, out);
    }
    if (body.dropTimer > 0) {
      body.dropTimer -= step;
      if (body.dropTimer < 0) body.dropTimer = 0;
    }
  }

  // Keep onGround stable when vertical motion is zero (e.g. the caller zeroed vy
  // while resting) — probe a hair below the feet without moving the body.
  if (!body.onGround && body.vy >= 0) groundProbe(body, level);

  return out;
}

/** Every tile overlapped by the body's AABB, as {tx,ty,ch}. */
export function overlappingTiles(body, level) {
  const list = [];
  const x0 = Math.floor(body.x / TILE);
  const x1 = Math.max(x0, Math.floor((body.x + body.w - EPS) / TILE));
  const y0 = Math.floor(body.y / TILE);
  const y1 = Math.max(y0, Math.floor((body.y + body.h - EPS) / TILE));
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      list.push({ tx, ty, ch: tileAt(level, tx, ty) });
    }
  }
  return list;
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function columnBlocked(level, tx, y0, y1) {
  for (let ty = y0; ty <= y1; ty++) {
    if (isSolid(tileAt(level, tx, ty))) return true;
  }
  return false;
}

function sweepX(body, level, dx) {
  if (!dx) return;
  body.x += dx;

  const y0 = Math.floor(body.y / TILE);
  const y1 = Math.max(y0, Math.floor((body.y + body.h - EPS) / TILE));
  const x0 = Math.floor(body.x / TILE);
  const x1 = Math.max(x0, Math.floor((body.x + body.w - EPS) / TILE));

  if (dx > 0) {
    // Resolve against the left-most solid column we now overlap.
    for (let tx = x0; tx <= x1; tx++) {
      if (columnBlocked(level, tx, y0, y1)) {
        body.x = tx * TILE - body.w;
        body.vx = 0;
        body.hitWallR = true;
        return;
      }
    }
  } else {
    // Resolve against the right-most solid column we now overlap.
    for (let tx = x1; tx >= x0; tx--) {
      if (columnBlocked(level, tx, y0, y1)) {
        body.x = (tx + 1) * TILE;
        body.vx = 0;
        body.hitWallL = true;
        return;
      }
    }
  }
}

function sweepY(body, level, dy, out) {
  if (!dy) return;

  const prevBottom = body.y + body.h;
  body.y += dy;

  const x0 = Math.floor(body.x / TILE);
  const x1 = Math.max(x0, Math.floor((body.x + body.w - EPS) / TILE));
  const ty0 = Math.floor(body.y / TILE);
  const ty1 = Math.max(ty0, Math.floor((body.y + body.h - EPS) / TILE));

  if (dy > 0) {
    // Falling: resolve against the top-most blocking row we now overlap.
    for (let ty = ty0; ty <= ty1; ty++) {
      let blocked = false;
      for (let tx = x0; tx <= x1; tx++) {
        const ch = tileAt(level, tx, ty);
        if (isSolid(ch)) { blocked = true; break; }
        if (isOneWay(ch) && canLandOnOneWay(body, prevBottom, ty)) { blocked = true; break; }
      }
      if (blocked) {
        body.y = ty * TILE - body.h;
        body.vy = 0;
        body.onGround = true;
        return;
      }
    }
  } else {
    // Rising: resolve against the bottom-most solid row we now overlap.
    // One-way platforms never block upward motion.
    for (let ty = ty1; ty >= ty0; ty--) {
      let hitCh = null;
      let hitTx = -1;
      for (let tx = x0; tx <= x1; tx++) {
        const ch = tileAt(level, tx, ty);
        if (!isSolid(ch)) continue;
        if (hitCh === null || (ch === '?' && hitCh !== '?')) {
          hitCh = ch;
          hitTx = tx;
        }
        if (ch === '?') break; // prefer reporting the info block
      }
      if (hitCh !== null) {
        body.y = (ty + 1) * TILE;
        body.vy = 0;
        body.hitCeiling = true;
        if (hitCh === '?') out.bumpedTile = { tx: hitTx, ty, ch: hitCh };
        return;
      }
    }
  }
}

function canLandOnOneWay(body, prevBottom, ty) {
  if (body.dropTimer > 0) return false;
  return prevBottom <= ty * TILE + ONE_WAY_TOL;
}

function groundProbe(body, level) {
  const bottom = body.y + body.h;
  const rowNow = Math.floor((bottom - EPS) / TILE);
  const rowProbe = Math.floor((bottom + GROUND_PROBE - EPS) / TILE);
  if (rowProbe === rowNow) return; // not resting against a tile boundary

  const x0 = Math.floor(body.x / TILE);
  const x1 = Math.max(x0, Math.floor((body.x + body.w - EPS) / TILE));
  for (let tx = x0; tx <= x1; tx++) {
    const ch = tileAt(level, tx, rowProbe);
    if (isSolid(ch)) { body.onGround = true; return; }
    if (isOneWay(ch) && body.dropTimer <= 0 && bottom <= rowProbe * TILE + ONE_WAY_TOL) {
      body.onGround = true;
      return;
    }
  }
}
