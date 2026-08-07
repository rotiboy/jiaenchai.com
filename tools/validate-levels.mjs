#!/usr/bin/env node
// tools/validate-levels.mjs — asserts every rule in CONTRACT §2 for every level.
// Zero dependencies. Exits non-zero on any failure.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { LEVELS, getLevel } from '../src/game/levels/index.js';
import { THEMES } from '../src/game/sprites.js';
import {
  TILE,
  LEVEL_H,
  LEVEL_W_MIN,
  LEVEL_W_MAX,
  JUMP_V,
  GRAVITY,
  RUN_SPEED,
} from '../src/engine/constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const LEGEND = new Set([
  '.', '#', '=', '^', '~', 'o', '*', 'E', 'F', 'H', 'V', 'N', '?', 'C', 'P', 'G', 'B',
]);
const SOLIDISH = new Set(['#', '?']);
const STANDABLE = new Set(['#', '?', '=']);
const HAZARD = new Set(['^', '~']);
const MAX_GAP = 6;      // §2: horizontal gaps in the walkable path ≤ 6 tiles
const MAX_RISE = 3;     // §2: a step up ≤ 3 tiles in one jump

let failures = 0;
let checks = 0;
const fail = (level, msg) => {
  failures++;
  console.error(`  ✗ [${level}] ${msg}`);
};
const ok = () => { checks++; };
const assert = (cond, level, msg) => { if (cond) ok(); else fail(level, msg); };

/* ------------------------------------------------------------------ helpers */

function countChar(rows, ch) {
  let n = 0;
  for (const r of rows) for (const c of r) if (c === ch) n++;
  return n;
}

function findAll(rows, ch) {
  const out = [];
  for (let ty = 0; ty < rows.length; ty++) {
    for (let tx = 0; tx < rows[ty].length; tx++) {
      if (rows[ty][tx] === ch) out.push({ tx, ty });
    }
  }
  return out;
}

/* ------------------------------------------- standing spots + route search
 * A "spot" is a tile the player can stand on top of: the tile itself is
 * standable (# ? =) and the tile above it is free of solids and hazards, so
 * the 14px-tall player fits. Every column can have several spots (ground plus
 * floating ledges), which is why a naive per-column surface scan is wrong —
 * a ceiling or a decorative block would masquerade as "the ground".
 */
function buildSpots(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const spots = [];            // spots[tx] = sorted array of ty (top → bottom)
  for (let tx = 0; tx < w; tx++) {
    const col = [];
    for (let ty = 0; ty < h; ty++) {
      if (!STANDABLE.has(rows[ty][tx])) continue;
      const head = ty - 1 >= 0 ? rows[ty - 1][tx] : '.';
      if (SOLIDISH.has(head) || HAZARD.has(head)) continue;
      // The tile the player's body occupies must not be a hazard, and the
      // tile it stands on must not be a hazard either (pools are lethal).
      col.push(ty);
    }
    spots[tx] = col;
  }
  return spots;
}

// Where does the player end up when they arrive in column `nx` from height
// `ty`? They land on the first spot at or below (ty - rise) — i.e. gravity
// picks the topmost spot that is not above their reach.
function landingsIn(spots, nx, fromTy) {
  const col = spots[nx] || [];
  const out = [];
  for (const ty of col) {
    if (fromTy - ty > MAX_RISE) continue;  // too high to climb in one jump
    out.push(ty);
  }
  return out;
}

/**
 * Breadth-first search over standing spots using ONLY moves that satisfy the
 * §2 authoring limits (rise ≤ 3 tiles, horizontal gap ≤ 6 tiles). If G is
 * reachable, a §2-legal walkable path from P to G provably exists.
 * Returns {ok, visited, best} where best is the furthest x reached.
 */
function routeSearch(rows, P, G, banned, prebuiltSpots) {
  const w = rows[0].length;
  const spots = prebuiltSpots || buildSpots(rows);
  const key = (tx, ty) => ty * w + tx;
  const blocked = (tx, ty) => !!banned && banned.has(key(tx, ty));

  // Start: the spot the player lands on in P's column.
  const startCol = spots[P.tx] || [];
  const start = startCol.filter((ty) => ty >= P.ty && !blocked(P.tx, ty));
  if (!start.length) return { ok: false, visited: new Set(), best: -1, reason: 'P has no standing spot' };

  const seen = new Set();
  const queue = [];
  for (const ty of start) { seen.add(key(P.tx, ty)); queue.push([P.tx, ty]); }

  let best = P.tx;
  let head = 0;
  while (head < queue.length) {
    const [tx, ty] = queue[head++];
    if (tx > best) best = tx;
    for (const dir of [1, -1]) {
      // d = 1 is a walk/step; d = 2..MAX_GAP+1 is a jump over a gap of d-1.
      for (let d = 1; d <= MAX_GAP + 1; d++) {
        const nx = tx + dir * d;
        if (nx < 0 || nx >= w) break;
        for (const ny of landingsIn(spots, nx, ty)) {
          const k = key(nx, ny);
          if (seen.has(k) || blocked(nx, ny)) continue;
          seen.add(k);
          queue.push([nx, ny]);
        }
      }
    }
  }

  // G is reached if any spot in G's column (at or below the door's own row,
  // since the door sits on the ground) was visited.
  const goalSpots = (spots[G.tx] || []).filter((ty) => ty >= G.ty);
  const ok = goalSpots.some((ty) => seen.has(key(G.tx, ty)));
  return { ok, visited: seen, best, spots };
}

/* ------------------------------------------------------------------- checks */

function validateLevel(level, expectedIndex) {
  const id = level && level.id ? level.id : `#${expectedIndex}`;

  if (!level || typeof level !== 'object') {
    fail(id, 'level module did not export an object');
    return;
  }

  /* --- metadata ---------------------------------------------------------- */
  assert(typeof level.id === 'string' && /^[a-z0-9-]+$/.test(level.id), id,
    `id must be kebab-case, got ${JSON.stringify(level.id)}`);
  assert(level.index === expectedIndex, id,
    `index must be ${expectedIndex}, got ${level.index}`);
  for (const key of ['company', 'role', 'period', 'theme', 'tagline', 'collectibleName']) {
    assert(typeof level[key] === 'string' && level[key].length > 0, id,
      `${key} must be a non-empty string`);
  }
  assert(Object.prototype.hasOwnProperty.call(THEMES, level.theme), id,
    `theme '${level.theme}' is not a key of THEMES`);
  const validUnlocks = [null, 'dash', 'doubleJump', 'glide', 'companion'];
  assert(validUnlocks.includes(level.unlocks ?? null), id,
    `unlocks must be one of ${validUnlocks.join('|')}, got ${JSON.stringify(level.unlocks)}`);
  if ((level.unlocks ?? null) === null) {
    assert((level.unlockLabel ?? null) === null, id,
      'unlockLabel must be null when unlocks is null');
  } else {
    assert(typeof level.unlockLabel === 'string' && level.unlockLabel.length > 0, id,
      'unlockLabel must be a non-empty string when unlocks is set');
  }
  assert(Array.isArray(level.bullets) && level.bullets.length > 0, id,
    'bullets must be a non-empty array');
  assert(Array.isArray(level.npcs), id, 'npcs must be an array');
  assert(Array.isArray(level.signs), id, 'signs must be an array');
  for (const s of level.signs || []) {
    assert(typeof s === 'string' && s.length > 0, id, 'every signs[] entry must be a string');
  }
  for (const n of level.npcs || []) {
    assert(n && typeof n.name === 'string' && Array.isArray(n.lines) && n.lines.length > 0, id,
      'every npcs[] entry needs {name, lines[]}');
  }

  /* --- rows -------------------------------------------------------------- */
  const rows = level.rows;
  if (!Array.isArray(rows) || rows.some((r) => typeof r !== 'string')) {
    fail(id, 'rows must be an array of strings');
    return;
  }
  assert(rows.length === LEVEL_H, id, `height must be exactly ${LEVEL_H}, got ${rows.length}`);

  const widths = new Set(rows.map((r) => r.length));
  assert(widths.size === 1, id,
    `all rows must be the same length, got ${[...widths].sort((a, b) => a - b).join(',')}`);
  const w = rows[0].length;
  assert(w >= LEVEL_W_MIN && w <= LEVEL_W_MAX, id,
    `width must be ${LEVEL_W_MIN}–${LEVEL_W_MAX}, got ${w}`);
  if (widths.size !== 1 || rows.length !== LEVEL_H) return;

  // legend
  const bad = new Map();
  for (let ty = 0; ty < rows.length; ty++) {
    for (let tx = 0; tx < rows[ty].length; tx++) {
      const ch = rows[ty][tx];
      if (!LEGEND.has(ch)) bad.set(ch, (bad.get(ch) || 0) + 1);
    }
  }
  assert(bad.size === 0, id,
    `illegal tile chars: ${[...bad].map(([c, n]) => `${JSON.stringify(c)}×${n}`).join(', ')}`);

  /* --- spawn / goal ------------------------------------------------------ */
  const pList = findAll(rows, 'P');
  const gList = findAll(rows, 'G');
  assert(pList.length === 1, id, `exactly one P required, got ${pList.length}`);
  assert(gList.length === 1, id, `exactly one G required, got ${gList.length}`);
  if (pList.length !== 1 || gList.length !== 1) return;
  const P = pList[0];
  const G = gList[0];
  assert(G.tx >= w * 0.88, id,
    `G must be in the right-hand 12% (tx ≥ ${Math.ceil(w * 0.88)}), got ${G.tx}`);

  // P and G need something to stand on
  const under = (t) => (t.ty + 1 < rows.length ? rows[t.ty + 1][t.tx] : '#');
  assert(STANDABLE.has(under(P)), id, `P at (${P.tx},${P.ty}) has no floor beneath it`);
  assert(STANDABLE.has(under(G)), id, `G at (${G.tx},${G.ty}) has no floor beneath it`);

  /* --- bottom row -------------------------------------------------------- */
  const bottom = rows[LEVEL_H - 1];
  const bottomOk = [...bottom].every((c) => c === '#' || c === '~');
  assert(bottomOk, id, 'bottom row (19) must be entirely # or ~');

  /* --- collectibles ------------------------------------------------------ */
  const coins = countChar(rows, 'o');
  const arts = countChar(rows, '*');
  const total = coins + arts;
  assert(total >= 12 && total <= 30, id,
    `collectibles must be 12–30, got ${total} (${coins} o + ${arts} *)`);
  assert(arts >= 1 && arts <= 3, id, `* count must be 1–3, got ${arts}`);

  /* --- npc / sign parity ------------------------------------------------- */
  assert(countChar(rows, 'N') === (level.npcs || []).length, id,
    `N count ${countChar(rows, 'N')} != npcs.length ${(level.npcs || []).length}`);
  assert(countChar(rows, '?') === (level.signs || []).length, id,
    `? count ${countChar(rows, '?')} != signs.length ${(level.signs || []).length}`);

  /* --- boss -------------------------------------------------------------- */
  const bosses = countChar(rows, 'B');
  if (expectedIndex === LEVELS.length - 1) {
    assert(bosses === 1, id, `final level must contain exactly one B, got ${bosses}`);
  } else {
    assert(bosses === 0, id, `only the final level may contain B, got ${bosses}`);
  }

  /* --- walkers need ground ----------------------------------------------- */
  for (const e of findAll(rows, 'E')) {
    const below = e.ty + 1 < rows.length ? rows[e.ty + 1][e.tx] : '#';
    assert(STANDABLE.has(below), id, `walker E at (${e.tx},${e.ty}) has no floor beneath it`);
  }

  /* --- §2 route: gaps ≤ 6, rises ≤ 3, P → G ------------------------------ */
  // The route search only ever takes moves that respect the §2 limits, so a
  // successful search *is* the proof that a legal walkable path exists.
  const route = routeSearch(rows, P, G);
  assert(route.ok, id,
    `no §2-legal route (gap ≤ ${MAX_GAP}, rise ≤ ${MAX_RISE}) from P(x=${P.tx}) to G(x=${G.tx});`
    + ` search stalled at x=${route.best}`);

  /* --- no unavoidable hazard wall ---------------------------------------- */
  // §2: no ^/~ under a required landing that has no alternative. buildSpots
  // already refuses any spot whose tile or head tile is a hazard, so what is
  // left to prove is that the hazard-free spots actually form a continuous,
  // *reachable* run of footing between P and G. A stretch of columns wider
  // than one jump with no reachable safe footing is exactly the damage wall
  // §2 forbids.
  //
  // (Testing `!HAZARD.has(rows[ty][tx])` on a spot instead would be vacuous:
  // STANDABLE and HAZARD are disjoint, so it can never be false.)
  if (route.ok) {
    const w2 = rows[0].length;
    const lo = Math.min(P.tx, G.tx);
    const hi = Math.max(P.tx, G.tx);
    let worstRun = 0;
    let runStart = -1;
    let cur = 0;
    for (let tx = lo; tx <= hi; tx++) {
      const col = route.spots[tx] || [];
      const anySafe = col.some((ty) => route.visited.has(ty * w2 + tx));
      if (!anySafe) {
        cur++;
        if (cur > worstRun) { worstRun = cur; runStart = tx - cur + 1; }
      } else {
        cur = 0;
      }
    }
    assert(worstRun <= MAX_GAP, id,
      `${worstRun}-tile stretch with no reachable safe footing at x=${runStart}`);

    // The literal §2 rule: a landing spot with ^/~ directly underneath (miss it
    // and you are in the spikes) is only legal if the chapter is still
    // completable without it. Ban each such spot in turn and re-run the search.
    const perch = [];
    for (let tx = 0; tx < w2; tx++) {
      for (const ty of route.spots[tx] || []) {
        if (!route.visited.has(ty * w2 + tx)) continue;
        if (tx === P.tx || tx === G.tx) continue;
        const belowTy = ty + 1;
        if (belowTy < rows.length && HAZARD.has(rows[belowTy][tx])) perch.push({ tx, ty });
      }
    }
    for (const s of perch) {
      const alt = routeSearch(rows, P, G, new Set([s.ty * w2 + s.tx]), route.spots);
      assert(alt.ok, id,
        `landing at (${s.tx},${s.ty}) sits directly over ${JSON.stringify(rows[s.ty + 1][s.tx])}`
        + ' and is the only way through — §2 forbids an unavoidable hazard landing');
    }
  }

  /* --- checkpoints are on the route -------------------------------------- */
  for (const cp of findAll(rows, 'C')) {
    const below = cp.ty + 1 < rows.length ? rows[cp.ty + 1][cp.tx] : '#';
    assert(STANDABLE.has(below), id,
      `checkpoint C at (${cp.tx},${cp.ty}) has no floor beneath it`);
  }
}

/* --------------------------------------------------------- bullet verbatim */

/**
 * Parses CONTRACT §7 into per-level blocks keyed off its
 * `**N. \`id\` — ...**` headers, returning {id: {index, location, bullets[]}}.
 *
 * Membership in "some bullet somewhere in the file" is not the property we
 * need: a bullet moved to the wrong chapter, a dropped bullet and a reordered
 * list would all pass that. The block itself, in order, is the contract.
 */
function parseContractSection7() {
  const contract = readFileSync(join(ROOT, 'CONTRACT.md'), 'utf8');
  const lines = contract.split('\n');

  let start = lines.findIndex((l) => /^##\s*7\.\s/.test(l));
  if (start < 0) return null;
  start += 1;
  let end = lines.findIndex((l, i) => i > start && /^###?\s/.test(l));
  if (end < 0) end = lines.length;

  const blocks = new Map();
  let cur = null;
  // The header may be followed on the same line by "Theme `x`." prose.
  const HEADER = /^\*\*(\d+)\.\s+`([a-z0-9-]+)`\s*—\s*(.*?)\*\*/;

  for (let i = start; i < end; i++) {
    const line = lines[i];
    const m = HEADER.exec(line.trim());
    if (m) {
      cur = { index: Number(m[1]), id: m[2], heading: m[3].trim(), bullets: [] };
      blocks.set(cur.id, cur);
      continue;
    }
    if (cur && line.startsWith('- ')) cur.bullets.push(line.slice(2).trim());
  }
  return blocks;
}

function validateBulletsVerbatim() {
  const blocks = parseContractSection7();
  if (!blocks) {
    fail('contract', 'could not locate CONTRACT §7');
    return;
  }
  assert(blocks.size === LEVELS.length, 'contract',
    `CONTRACT §7 declares ${blocks.size} chapters, LEVELS has ${LEVELS.length}`);

  for (const level of LEVELS) {
    const block = blocks.get(level.id);
    if (!block) {
      fail(level.id, 'no CONTRACT §7 block with this id');
      continue;
    }
    assert(block.index === level.index, level.id,
      `CONTRACT §7 lists this chapter as ${block.index}, level.index is ${level.index}`);

    const want = block.bullets;
    const got = (level.bullets || []).map((b) => String(b).trim());
    assert(got.length === want.length, level.id,
      `expected ${want.length} bullets from CONTRACT §7, got ${got.length}`);
    const n = Math.max(want.length, got.length);
    for (let i = 0; i < n; i++) {
      assert(got[i] === want[i], level.id,
        `bullet ${i} does not match CONTRACT §7 verbatim/in order\n`
        + `      contract: ${JSON.stringify((want[i] || '').slice(0, 80))}\n`
        + `      level   : ${JSON.stringify((got[i] || '').slice(0, 80))}`);
    }

    // Employment headings read "Role, Company, <location>, PERIOD." — four or
    // more comma-separated parts. The education chapter ("Institution, Course,
    // years.") states no location, so only its type is checked.
    if (typeof level.location !== 'string' || !level.location.length) {
      fail(level.id, 'location must be a non-empty string');
    } else if (block.heading.split(',').length >= 4) {
      assert(block.heading.includes(level.location), level.id,
        `location ${JSON.stringify(level.location)} does not appear in the`
        + ` CONTRACT §7 heading ${JSON.stringify(block.heading)}`);
    } else {
      ok();
    }
  }
}

/* ------------------------------------------------------------------- runner */

console.log('validate-levels: checking', LEVELS.length, 'levels\n');

assert(LEVELS.length === 7, 'index', `expected 7 levels, got ${LEVELS.length}`);
const ids = LEVELS.map((l) => l.id);
assert(new Set(ids).size === ids.length, 'index', `duplicate level ids: ${ids.join(',')}`);
for (let i = 0; i < LEVELS.length; i++) {
  assert(getLevel(i) === LEVELS[i], 'index', `getLevel(${i}) mismatch`);
  assert(getLevel(LEVELS[i].id) === LEVELS[i], 'index', `getLevel('${LEVELS[i].id}') mismatch`);
}
assert(getLevel('nope') === undefined, 'index', 'getLevel of unknown id must be undefined');

for (let i = 0; i < LEVELS.length; i++) {
  const l = LEVELS[i];
  const before = failures;
  validateLevel(l, i);
  const w = Array.isArray(l.rows) && typeof l.rows[0] === 'string' ? l.rows[0].length : '?';
  const status = failures === before ? 'ok  ' : 'FAIL';
  console.log(`  ${status} ${String(i)}. ${String(l.id).padEnd(22)} ${w}×${(l.rows || []).length}`);
}

validateBulletsVerbatim();

// Sanity: the constants the validator reasons about are the real ones.
const jumpTiles = (JUMP_V * JUMP_V) / (2 * GRAVITY) / TILE;
assert(jumpTiles >= 3.2, 'constants', `jump clears only ${jumpTiles.toFixed(2)} tiles`);
assert(RUN_SPEED > 0, 'constants', 'RUN_SPEED must be positive');

console.log(`\nvalidate-levels: ${checks} checks, ${failures} failure(s)`);
if (failures) {
  console.error('validate-levels: FAILED');
  process.exit(1);
}
console.log('validate-levels: OK');
