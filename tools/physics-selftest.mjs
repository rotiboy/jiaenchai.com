// tools/physics-selftest.mjs
// Headless self-test for src/engine/physics.js. Pure Node, no DOM, no deps.
//   node tools/physics-selftest.mjs
//
// Owned by the engine agent.

import {
  tileAt, isSolid, isOneWay, isHazard, aabb, moveAndCollide, overlappingTiles,
} from '../src/engine/physics.js';
import { TILE, GRAVITY, MAX_FALL, RUN_SPEED, JUMP_V, PLAYER_W, PLAYER_H } from '../src/engine/constants.js';

const DT = 1 / 60;
let failures = 0;
let checks = 0;

function ok(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.error('  FAIL  ' + msg);
  }
}

function near(a, b, tol, msg) {
  checks++;
  if (!(Math.abs(a - b) <= tol)) {
    failures++;
    console.error(`  FAIL  ${msg} (got ${a}, expected ${b} ±${tol})`);
  }
}

function mkLevel(rows) {
  const w = Math.max(...rows.map((r) => r.length));
  return { id: 'test', rows: rows.map((r) => r.padEnd(w, '.')) };
}

function mkBody(x, y, opts = {}) {
  return {
    x, y,
    w: opts.w ?? PLAYER_W,
    h: opts.h ?? PLAYER_H,
    vx: opts.vx ?? 0,
    vy: opts.vy ?? 0,
    onGround: false,
    hitCeiling: false,
    hitWallL: false,
    hitWallR: false,
    dropTimer: opts.dropTimer ?? 0,
  };
}

// Simulate one frame the way player.js will: gravity, then sweep.
function tick(body, level, dt = DT, gravity = true) {
  if (gravity) {
    body.vy += GRAVITY * dt;
    if (body.vy > MAX_FALL) body.vy = MAX_FALL;
  }
  return moveAndCollide(body, level, dt);
}

// ---------------------------------------------------------------------------
console.log('physics self-test');

// --- 0. tile helpers + out-of-bounds semantics -----------------------------
{
  const level = mkLevel([
    '..........',
    '..........',
    '####..####',
  ]);
  ok(tileAt(level, 0, 2) === '#', 'tileAt reads the map');
  ok(tileAt(level, 4, 2) === '.', 'tileAt reads empty tiles');
  ok(tileAt(level, -1, 1) === '#', 'left of the map is solid');
  ok(tileAt(level, 999, 1) === '#', 'right of the map is solid');
  ok(tileAt(level, 3, -5) === '.', 'above the map is empty');
  ok(tileAt(level, 3, 99) === '#', 'below the map is solid');

  ok(isSolid('#') && isSolid('?'), "'#' and '?' are solid");
  ok(!isSolid('=') && !isSolid('.') && !isSolid('o'), 'only # and ? are solid');
  ok(isOneWay('=') && !isOneWay('#'), 'one-way detection');
  ok(isHazard('^') && isHazard('~') && !isHazard('#'), 'hazard detection');

  ok(aabb({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), 'aabb overlap');
  ok(!aabb({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), 'aabb touching edges do not overlap');

  const tiles = overlappingTiles(mkBody(TILE * 2, TILE * 1), level);
  ok(tiles.length >= 1 && tiles.every((t) => typeof t.ch === 'string'), 'overlappingTiles shape');
}

// --- 1. falls and rests exactly on the ground ------------------------------
{
  const level = mkLevel([
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '##########',
  ]);
  const body = mkBody(TILE * 3, 4);
  for (let i = 0; i < 180; i++) tick(body, level);

  const floorTop = 5 * TILE;
  near(body.y + body.h, floorTop, 1e-6, 'body rests exactly on the ground');
  ok(body.onGround === true, 'onGround is true while resting');
  ok(body.vy === 0, 'vy is 0 while resting');
  ok(body.hitCeiling === false, 'no phantom ceiling hit');

  // No jitter: the resting position must be bit-identical frame to frame.
  const restY = body.y;
  let moved = 0;
  for (let i = 0; i < 60; i++) {
    tick(body, level);
    if (body.y !== restY) moved++;
    if (!body.onGround) moved += 100;
  }
  ok(moved === 0, 'resting on the ground is jitter-free and stays grounded');

  // Grounded reporting survives a caller that zeroes vy itself.
  body.vy = 0;
  moveAndCollide(body, level, DT);
  ok(body.onGround === true, 'onGround holds even when vy is already 0');
}

// --- 2. running into a wall stops with hitWallR ----------------------------
{
  const level = mkLevel([
    '..........',
    '..........',
    '.......#..',
    '.......#..',
    '.......#..',
    '##########',
  ]);
  const body = mkBody(TILE * 1, 5 * TILE - PLAYER_H);
  let sawWall = false;
  for (let i = 0; i < 120; i++) {
    body.vx = RUN_SPEED;           // the player re-applies run speed every frame
    tick(body, level);
    if (body.hitWallR) sawWall = true;
  }
  ok(sawWall, 'hitWallR reported when running into a wall');
  ok(body.hitWallR === true, 'hitWallR still reported while pressed against the wall');
  ok(body.hitWallL === false, 'hitWallL not falsely reported');
  near(body.x + body.w, 7 * TILE, 1e-6, 'body stops flush against the wall');
  ok(body.vx === 0, 'vx zeroed by the wall');
  ok(body.onGround === true, 'still grounded against the wall');

  // ...and the mirror case.
  const level2 = mkLevel([
    '..........',
    '..#.......',
    '..#.......',
    '..#.......',
    '..#.......',
    '##########',
  ]);
  const b2 = mkBody(TILE * 6, 5 * TILE - PLAYER_H);
  b2.vx = -RUN_SPEED;
  for (let i = 0; i < 120; i++) { b2.vx = -RUN_SPEED; tick(b2, level2); }
  ok(b2.hitWallL === true, 'hitWallL reported when running left into a wall');
  near(b2.x, 3 * TILE, 1e-6, 'body stops flush against the left wall');

  // Out-of-bounds sides act as solid walls.
  const b3 = mkBody(TILE * 1, 5 * TILE - PLAYER_H, { vx: -RUN_SPEED });
  for (let i = 0; i < 120; i++) { b3.vx = -RUN_SPEED; tick(b3, level); }
  near(b3.x, 0, 1e-6, 'body is stopped by the left map edge');
  ok(b3.hitWallL === true, 'left map edge reports hitWallL');
}

// --- 3. one-way platform: pass through from below, land on it from above ---
{
  const level = mkLevel([
    '..........',
    '..........',
    '..........',
    '..====....',
    '..........',
    '##########',
  ]);
  const platTop = 3 * TILE;
  const body = mkBody(TILE * 3, 5 * TILE - PLAYER_H);
  ok(body.y + body.h > platTop, 'test setup: body starts below the platform');

  // Jump.
  body.vy = JUMP_V;
  let passedThrough = false;
  let ceilingHit = false;
  for (let i = 0; i < 20; i++) {
    tick(body, level);
    if (body.hitCeiling) ceilingHit = true;
    if (body.y + body.h <= platTop) passedThrough = true;
    if (passedThrough) break;
  }
  ok(passedThrough, 'body passes upward through the one-way platform');
  ok(!ceilingHit, 'one-way platform never blocks upward movement');

  // Now fall back down onto it.
  let landed = false;
  for (let i = 0; i < 90; i++) {
    tick(body, level);
    if (body.onGround) { landed = true; break; }
  }
  ok(landed, 'body lands coming down onto the one-way platform');
  near(body.y + body.h, platTop, 1e-6, 'body rests exactly on the one-way platform top');
  ok(body.vy === 0, 'vy zeroed on the one-way platform');

  // Stable rest on the platform.
  const restY = body.y;
  let jitter = 0;
  for (let i = 0; i < 60; i++) {
    tick(body, level);
    if (body.y !== restY || !body.onGround) jitter++;
  }
  ok(jitter === 0, 'resting on a one-way platform is jitter-free');

  // Drop-through with dropTimer.
  body.dropTimer = 0.16;
  let fellThrough = false;
  for (let i = 0; i < 60; i++) {
    tick(body, level);
    if (body.y > platTop + 4) { fellThrough = true; break; }
  }
  ok(fellThrough, 'dropTimer lets the body fall through the one-way platform');
  for (let i = 0; i < 90; i++) tick(body, level);
  near(body.y + body.h, 5 * TILE, 1e-6, 'body lands on the floor after dropping through');
  ok(body.dropTimer === 0, 'dropTimer decays to zero');

  // Fast fall must still land on the one-way platform (no tunnelling).
  for (const speed of [400, 1500, 5000]) {
    const fb = mkBody(TILE * 3, 0, { vy: speed });
    let n = 0;
    while (!fb.onGround && n < 400) { moveAndCollide(fb, level, DT); n++; }
    near(fb.y + fb.h, platTop, 1e-6, `vy=${speed}: fast fall lands on the one-way platform`);
  }

  // Fast rise must still pass through it.
  const rb = mkBody(TILE * 3, 5 * TILE - PLAYER_H, { vy: -1500 });
  let blocked = false;
  for (let i = 0; i < 3; i++) {
    rb.vy = -1500;
    moveAndCollide(rb, level, DT);
    if (rb.hitCeiling) blocked = true;
  }
  ok(blocked === false, 'fast rise is not blocked by the one-way platform');
  ok(rb.y + rb.h < platTop, 'fast rise clears the one-way platform');
}

// --- 3b. the world below the map is solid ---------------------------------
{
  const level = mkLevel([
    '..........',
    '..........',
    '.........#',
  ]);
  const body = mkBody(TILE * 3, 0, { vy: MAX_FALL });
  for (let i = 0; i < 200; i++) tick(body, level);
  near(body.y + body.h, 3 * TILE, 1e-6, 'body rests on the implicit floor below the map');
  ok(body.onGround === true, 'below-map floor reports onGround');
}

// --- 4. fast falling body does not tunnel a 1-tile floor -------------------
{
  const level = mkLevel([
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..#####...',   // a single tile-thick floor with empty space beneath it
    '..........',
    '..........',
  ]);
  const floorTop = 7 * TILE;

  for (const speed of [400, 900, 2000, 6000, 20000]) {
    const body = mkBody(TILE * 4, 0, { vy: speed });
    let steps = 0;
    while (!body.onGround && steps < 600) { moveAndCollide(body, level, DT); steps++; }
    ok(body.onGround === true, `vy=${speed}: body is caught by the 1-tile floor`);
    near(body.y + body.h, floorTop, 1e-6, `vy=${speed}: rests exactly on the floor top`);
    ok(body.vy === 0, `vy=${speed}: vertical speed zeroed`);
  }

  // Same, but with a big dt (worst case a clamped frame can produce).
  const body = mkBody(TILE * 4, 0, { vy: 400 });
  let steps = 0;
  while (!body.onGround && steps < 200) { moveAndCollide(body, level, 1 / 30); steps++; }
  ok(body.onGround === true, 'dt=1/30 fast fall does not tunnel');
  near(body.y + body.h, floorTop, 1e-6, 'dt=1/30 fast fall rests on the floor top');

  // Horizontal tunnelling through a 1-tile wall.
  const wallLevel = mkLevel([
    '..........',
    '..........',
    '.....#....',
    '.....#....',
    '..........',
  ]);
  const hb = mkBody(TILE * 1, 2 * TILE + 1, { vx: 4000 });
  for (let i = 0; i < 60 && !hb.hitWallR; i++) moveAndCollide(hb, wallLevel, DT);
  ok(hb.hitWallR === true, 'fast horizontal body does not tunnel through a 1-tile wall');
  near(hb.x + hb.w, 5 * TILE, 1e-6, 'fast horizontal body stops flush against the wall');
}

// --- 5. ceiling + '?' block bumped from below ------------------------------
{
  const level = mkLevel([
    '..........',
    '..#?#.....',
    '..........',
    '..........',
    '..........',
    '##########',
  ]);
  // Line the body up under the '?' at tx=3.
  const body = mkBody(3 * TILE + 3, 5 * TILE - PLAYER_H);
  body.vy = JUMP_V;
  let bump = null;
  for (let i = 0; i < 30; i++) {
    const r = tick(body, level);
    if (r.bumpedTile) { bump = r.bumpedTile; break; }
  }
  ok(bump !== null, 'bumpedTile returned for a ? block struck from below');
  if (bump) {
    ok(bump.tx === 3 && bump.ty === 1 && bump.ch === '?', 'bumpedTile carries {tx,ty,ch}');
  }
  ok(body.hitCeiling === true, 'hitCeiling reported on the bump');
  near(body.y, 2 * TILE, 1e-6, 'body pushed flush beneath the block');
  ok(body.vy === 0, 'vy zeroed on the ceiling');

  // A plain '#' ceiling reports no bumpedTile.
  const b2 = mkBody(2 * TILE + 3, 5 * TILE - PLAYER_H, { vy: JUMP_V });
  let bumped = false;
  let ceil = false;
  for (let i = 0; i < 30; i++) {
    const r = tick(b2, level);
    if (r.bumpedTile) bumped = true;
    if (b2.hitCeiling) { ceil = true; break; }
  }
  ok(ceil === true, 'plain ceiling reports hitCeiling');
  ok(bumped === false, 'plain ceiling reports no bumpedTile');
}

// --- 6. a full run: walk a corridor, no sticking on tile seams -------------
{
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push('.'.repeat(40));
  rows.push('#'.repeat(40));
  const level = mkLevel(rows);
  const body = mkBody(TILE, 5 * TILE - PLAYER_H);
  let stuck = 0;
  for (let i = 0; i < 300; i++) {
    body.vx = RUN_SPEED;
    const before = body.x;
    tick(body, level);
    if (body.x - before < RUN_SPEED * DT - 1e-6 && body.x + body.w < 39 * TILE) stuck++;
  }
  ok(stuck === 0, 'running along flat ground never snags on tile seams');
  ok(body.onGround === true, 'still grounded after the run');
}

// ---------------------------------------------------------------------------
if (failures > 0) {
  console.error(`\nphysics self-test FAILED: ${failures}/${checks} checks failed`);
  process.exit(1);
}
console.log(`physics self-test OK (${checks} checks)`);
