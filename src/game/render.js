// src/game/render.js
// World renderer: sky, three parallax layers per theme, tiles, entities,
// particles, player, vignette. Canvas-2D only, no assets, no text.

import { TILE, VIEW_W, VIEW_H } from '../engine/constants.js';
import {
  THEMES,
  drawPlayer,
  drawWalker,
  drawFlyer,
  drawCoin,
  drawArtifact,
  drawNpc,
  drawDoor,
  drawCheckpoint,
  drawBoss,
  drawCompanion,
} from './sprites.js';

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const T0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

function clock() {
  const n = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  return (n - T0) / 1000;
}

function num(v, d) {
  return typeof v === 'number' && isFinite(v) ? v : d;
}

function fr(ctx, x, y, w, h, c) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

function hex(h) {
  let s = String(h || '#000000').replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r, g, b) {
  const v = (Math.max(0, Math.min(255, r | 0)) << 16) |
    (Math.max(0, Math.min(255, g | 0)) << 8) |
    Math.max(0, Math.min(255, b | 0));
  return '#' + ('000000' + v.toString(16)).slice(-6);
}

function mix(a, b, t) {
  const A = hex(a);
  const B = hex(b);
  const k = Math.max(0, Math.min(1, t));
  return toHex(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k);
}

function rgba(h, a) {
  const c = hex(h);
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
}

function lighten(c, t) {
  return mix(c, '#ffffff', t);
}

function darken(c, t) {
  return mix(c, '#000000', t);
}

// deterministic 0..1 noise
function hash(i, j) {
  let n = (i | 0) * 374761393 + (j | 0) * 668265263 + 1442695040;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967296;
}

function createCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

// ---------------------------------------------------------------------------
// Renderer setup
// ---------------------------------------------------------------------------

export function initRenderer(canvasEl) {
  if (!canvasEl) return null;
  canvasEl.width = VIEW_W;
  canvasEl.height = VIEW_H;
  const ctx = canvasEl.getContext('2d', { alpha: false });
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.mozImageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
    ctx.msImageSmoothingEnabled = false;
    ctx.textBaseline = 'top';
  }
  if (canvasEl.style) {
    canvasEl.style.imageRendering = 'pixelated';
    canvasEl.style.display = 'block';
  }
  resizeCanvas(canvasEl);
  return ctx;
}

/**
 * Letterbox the picture into its host box.
 * @param {HTMLCanvasElement} canvasEl
 * @param {{fill?: boolean}} [opts] `fill` drops the whole-number scale snap.
 */
export function resizeCanvas(canvasEl, opts) {
  if (!canvasEl || typeof window === 'undefined') return 1;
  const parent = canvasEl.parentElement;
  const availW = Math.max(160, (parent && parent.clientWidth) || window.innerWidth || VIEW_W);
  // Prefer the host box's own height (index.html gives the canvas a 16:9
  // `.screen` with `overflow:hidden`). Falling back to a fraction of the window
  // can compute a scale taller than that box, which then gets clipped.
  const parentH = parent && parent.clientHeight > 0 ? parent.clientHeight : 0;
  const availH = Math.max(120, parentH || (window.innerHeight || VIEW_H) * 0.82);
  let scale = Math.min(availW / VIEW_W, availH / VIEW_H);
  // In the page the picture snaps to a whole multiple of 480×270 so every source
  // pixel is exactly the same size. Fullscreen trades that for reach: a landscape
  // phone fits about 1.44×, and flooring that to 1× would leave a postage stamp
  // in the middle of the screen the player just asked to fill. Below 1× the
  // fractional path is the only option anyway, so this is the same compromise.
  if (!(opts && opts.fill) && scale >= 1) scale = Math.max(1, Math.floor(scale));
  else scale = Math.max(0.25, Math.round(scale * 100) / 100);
  const w = Math.round(VIEW_W * scale);
  // Derive the height from the rounded width so the CSS box stays exactly 16:9.
  // Rounding both independently produces e.g. 350×197 (1.777 → 1.7766), which
  // makes `object-fit: contain` rescale the bitmap non-integrally inside it.
  const h = Math.round((w * VIEW_H) / VIEW_W);
  if (canvasEl.style) {
    canvasEl.style.width = w + 'px';
    canvasEl.style.height = h + 'px';
  }
  // Publish the picture box so the CRT overlays can sit on the picture rather
  // than on the letterbox bars around it.
  if (parent && parent.style && typeof parent.style.setProperty === 'function') {
    parent.style.setProperty('--cq-screen-w', w + 'px');
    parent.style.setProperty('--cq-screen-h', h + 'px');
  }
  const ctx = canvasEl.getContext ? canvasEl.getContext('2d') : null;
  if (ctx) ctx.imageSmoothingEnabled = false;
  return scale;
}

// ---------------------------------------------------------------------------
// Parallax layer construction (baked into tiling offscreen canvases)
// ---------------------------------------------------------------------------

const LAYER_TOP = 40;                 // layer canvases extend above the view
const LAYER_H = VIEW_H + LAYER_TOP * 2;
const FACTORS = [0.12, 0.32, 0.58];   // far / mid / near scroll factors

const layerCache = new Map();

function makeLayer(width, paint) {
  const c = createCanvas(width, LAYER_H);
  if (!c) return null;
  const cx = c.getContext('2d');
  if (!cx) return null;
  cx.imageSmoothingEnabled = false;
  cx.translate(0, LAYER_TOP);
  const lights = [];
  paint(cx, width, lights);
  return { canvas: c, w: width, lights };
}

// Seamless rolling ridge. k1/k2 are integer harmonics so the pattern tiles.
function ridge(cx, w, color, rim, baseY, amp, k1, k2, phase, bottom) {
  const step = 2;
  for (let x = 0; x < w; x += step) {
    const a = (x / w) * Math.PI * 2;
    const y = Math.round(
      baseY - Math.sin(a * k1 + phase) * amp - Math.sin(a * k2 + phase * 1.7) * amp * 0.38
    );
    fr(cx, x, y, step, bottom - y, color);
    if (rim) fr(cx, x, y, step, 2, rim);
  }
}

// Smooth vertical colour wash — used for tropical/dusk skies instead of hard bands.
function skyWash(cx, w, y0, y1, stops, peak) {
  const n = Math.max(1, y1 - y0);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const f = u * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(f));
    const c = mix(stops[k], stops[k + 1], f - k);
    const a = (peak || 0.3) * Math.pow(u, 1.7);
    fr(cx, 0, y0 + i, w, 1, rgba(c, a));
  }
}

// Soft square halo that fades outward — reads as a glow at pixel scale.
function glowBox(ctx, x, y, w, h, color, maxR, peak) {
  for (let r = maxR; r >= 1; r--) {
    const u = 1 - r / maxR;
    ctx.globalAlpha = peak * u * u * 0.14;
    fr(ctx, x - r, y - r, w + r * 2, h + r * 2, color);
  }
  ctx.globalAlpha = 1;
}

function cloud(cx, x, y, s, c, under) {
  fr(cx, x, y + 3 * s, 22 * s, 4 * s, c);
  fr(cx, x + 4 * s, y, 12 * s, 5 * s, c);
  fr(cx, x + 12 * s, y + 1 * s, 9 * s, 4 * s, c);
  fr(cx, x + 2 * s, y + 1 * s, 6 * s, 3 * s, c);
  if (under) fr(cx, x, y + 6 * s, 22 * s, 1 * s, under);
}

// Bake a grid of windows; a share of them are registered as animated lights.
function windowGrid(cx, lights, x, y, w, h, cw, ch, gap, dark, seed, litRate, color) {
  for (let wy = y; wy + ch <= y + h; wy += ch + gap) {
    for (let wx = x; wx + cw <= x + w; wx += cw + gap) {
      fr(cx, wx, wy, cw, ch, dark);
      if (hash(wx * 7 + seed, wy * 13 + seed) < litRate) lights.push([wx, wy, cw, ch, color]);
    }
  }
}

// --- bristol ---------------------------------------------------------------

function bristolFar(cx, w, lights) {
  const th = THEMES.bristol;
  for (let i = 0; i < 5; i++) {
    const x = Math.round(hash(i, 11) * (w - 60)) + 10;
    const y = 24 + Math.round(hash(i, 12) * 44);
    cloud(cx, x, y, hash(i, 13) > 0.5 ? 2 : 1, '#ffffff', '#f4dfc0');
  }
  ridge(cx, w, th.far, lighten(th.far, 0.25), 152, 18, 1, 3, 0.4, VIEW_H + LAYER_TOP);
  ridge(cx, w, mix(th.far, th.mid, 0.35), null, 166, 12, 2, 5, 2.1, VIEW_H + LAYER_TOP);
  // hedgerow stitching on the far fields
  for (let i = 0; i < 26; i++) {
    const x = Math.round(hash(i, 21) * w);
    const y = 172 + Math.round(hash(i, 22) * 16);
    fr(cx, x, y, 6 + Math.round(hash(i, 23) * 8), 1, darken(th.far, 0.2));
  }
}

function cliftonBridge(cx, x, deckY, dark, mid) {
  const span = 118;
  const towerH = 44;
  // gorge cliffs
  for (let i = 0; i < 26; i++) {
    const cy = deckY + 4 + Math.round(hash(i, 41) * 6);
    fr(cx, x - 26 + i, cy, 1, 90, dark);
    fr(cx, x + span + i, cy + Math.round(hash(i, 42) * 5), 1, 90, dark);
  }
  // deck
  fr(cx, x - 20, deckY, span + 44, 3, dark);
  fr(cx, x - 20, deckY, span + 44, 1, mid);
  // towers
  for (let s = 0; s < 2; s++) {
    const tx = s === 0 ? x + 2 : x + span - 12;
    fr(cx, tx, deckY - towerH, 10, towerH, dark);
    fr(cx, tx, deckY - towerH, 10, 2, mid);
    fr(cx, tx - 2, deckY - towerH - 3, 14, 3, dark);
    fr(cx, tx - 1, deckY - towerH - 5, 12, 2, dark);
    // arched opening
    fr(cx, tx + 3, deckY - 14, 4, 14, mid);
    fr(cx, tx + 4, deckY - 16, 2, 3, mid);
  }
  // main catenary + hangers
  const topY = deckY - towerH - 2;
  const ax = x + 7;
  const bx = x + span - 7;
  const midX = (ax + bx) / 2;
  const half = (bx - ax) / 2;
  for (let px = ax; px <= bx; px++) {
    const u = (px - midX) / half;
    const cy = Math.round(deckY - 8 - (deckY - 8 - topY) * u * u);
    fr(cx, px, cy, 1, 2, dark);
    if ((px - ax) % 7 === 0) fr(cx, px, cy, 1, deckY - cy, dark);
  }
  // side stays down to the anchorages
  for (let i = 0; i < 22; i++) {
    fr(cx, ax - 1 - i, topY + Math.round((i * i) / 26), 1, 2, dark);
    fr(cx, bx + 1 + i, topY + Math.round((i * i) / 26), 1, 2, dark);
  }
}

function bristolMid(cx, w, lights) {
  const th = THEMES.bristol;
  ridge(cx, w, th.mid, lighten(th.mid, 0.22), 178, 14, 1, 4, 1.2, VIEW_H + LAYER_TOP);
  cliftonBridge(cx, 150, 150, darken(th.mid, 0.42), darken(th.mid, 0.18));
  // a church spire and cottages in the valley
  fr(cx, 430, 158, 8, 24, darken(th.mid, 0.35));
  fr(cx, 431, 146, 6, 12, darken(th.mid, 0.35));
  fr(cx, 433, 138, 2, 8, darken(th.mid, 0.35));
  for (let i = 0; i < 5; i++) {
    const x = 40 + i * 17 + Math.round(hash(i, 61) * 6);
    const hgt = 8 + Math.round(hash(i, 62) * 5);
    const roof = darken(th.mid, 0.45);
    fr(cx, x, 176 - hgt, 12, hgt, darken(th.mid, 0.28));
    // pitched roof, stepped
    for (let r = 0; r < 4; r++) fr(cx, x + r, 176 - hgt - 1 - r, 12 - r * 2, 2, roof);
    fr(cx, x + 8, 176 - hgt - 8, 2, 5, roof);
    lights.push([x + 3, 176 - hgt + 3, 2, 2, '#ffd88a']);
  }
}

function bristolNear(cx, w, lights) {
  const th = THEMES.bristol;
  fr(cx, 0, 208, w, VIEW_H + LAYER_TOP - 208, th.near);
  for (let x = 0; x < w; x += 2) {
    const y = 208 - Math.round(Math.abs(Math.sin((x / w) * Math.PI * 6)) * 3);
    fr(cx, x, y, 2, 210 - y + 2, th.near);
  }
  // trees
  for (let i = 0; i < 4; i++) {
    const x = 20 + i * 60 + Math.round(hash(i, 71) * 10);
    const top = 150 + Math.round(hash(i, 72) * 18);
    fr(cx, x + 5, top + 18, 4, 44, darken(th.near, 0.25));
    fr(cx, x - 2, top + 6, 18, 16, th.near);
    fr(cx, x + 1, top, 12, 10, th.near);
    fr(cx, x + 3, top - 3, 8, 5, th.near);
    fr(cx, x + 2, top + 2, 5, 3, lighten(th.near, 0.14));
    fr(cx, x - 1, top + 9, 4, 4, lighten(th.near, 0.09));
  }
  // dry stone wall
  for (let x = 0; x < w; x += 6) {
    const y = 204 + (x % 12 === 0 ? 0 : 1);
    fr(cx, x, y, 5, 5, darken(th.near, 0.2));
    fr(cx, x, y, 5, 1, lighten(th.near, 0.16));
  }
  // grass tufts
  for (let i = 0; i < 40; i++) {
    const x = Math.round(hash(i, 81) * w);
    fr(cx, x, 200 + Math.round(hash(i, 82) * 4), 1, 4, lighten(th.near, 0.22));
  }
}

// --- edinburgh -------------------------------------------------------------

function edinburghFar(cx, w, lights) {
  const th = THEMES.edinburgh;
  for (let i = 0; i < 7; i++) {
    const x = Math.round(hash(i, 91) * (w - 50));
    const y = 18 + Math.round(hash(i, 92) * 50);
    cloud(cx, x, y, hash(i, 93) > 0.6 ? 2 : 1, rgba('#c9d3de', 0.55), null);
  }
  ridge(cx, w, th.far, lighten(th.far, 0.16), 140, 22, 1, 2, 0.9, VIEW_H + LAYER_TOP);
  // Arthur's Seat style hump
  for (let i = 0; i < 90; i++) {
    const u = i / 90;
    const hgt = Math.round(Math.sin(u * Math.PI) * 34);
    fr(cx, 300 + i, 150 - hgt, 1, hgt + 60, mix(th.far, th.mid, 0.4));
    if (hgt > 2) fr(cx, 300 + i, 150 - hgt, 1, 2, lighten(th.far, 0.14));
  }
}

function edinburghMid(cx, w, lights) {
  const th = THEMES.edinburgh;
  ridge(cx, w, th.mid, lighten(th.mid, 0.14), 168, 10, 2, 5, 2.4, VIEW_H + LAYER_TOP);
  // Castle Rock — a craggy plinth with vertical striations
  const bx = 190;
  for (let i = 0; i < 150; i++) {
    const u = i / 150;
    const top = 132 + Math.round(Math.pow(Math.abs(u - 0.42) * 2.1, 2.2) * 46) + Math.round(hash(i, 101) * 3);
    fr(cx, bx + i, top, 1, 200, darken(th.mid, 0.22));
    if (i % 7 === 0) fr(cx, bx + i, top + 6, 1, 40, darken(th.mid, 0.4));
    if (i % 11 === 3) fr(cx, bx + i, top + 2, 1, 16, lighten(th.mid, 0.12));
  }
  // castle on the rock
  const cxx = bx + 34;
  const cy = 132;
  const stone = mix(th.mid, '#8b8f9c', 0.45);
  const stoneD = darken(stone, 0.28);
  fr(cx, cxx, cy - 18, 60, 20, stone);
  fr(cx, cxx, cy - 18, 60, 2, lighten(stone, 0.18));
  for (let i = 0; i < 10; i++) fr(cx, cxx + i * 6, cy - 22, 4, 4, stone);
  // keep
  fr(cx, cxx + 16, cy - 42, 18, 26, stone);
  for (let i = 0; i < 3; i++) fr(cx, cxx + 17 + i * 6, cy - 46, 4, 5, stone);
  // round towers with conical roofs
  for (const tx of [cxx - 4, cxx + 50]) {
    fr(cx, tx, cy - 34, 12, 34, stone);
    fr(cx, tx, cy - 34, 12, 2, lighten(stone, 0.2));
    fr(cx, tx + 1, cy - 40, 10, 6, stoneD);
    fr(cx, tx + 3, cy - 45, 6, 5, stoneD);
    fr(cx, tx + 5, cy - 48, 2, 3, stoneD);
  }
  // flag
  fr(cx, cxx + 24, cy - 58, 1, 12, stoneD);
  fr(cx, cxx + 25, cy - 58, 7, 5, '#3a5f9e');
  // castle windows
  windowGrid(cx, lights, cxx + 4, cy - 14, 52, 12, 2, 4, 4, darken(stone, 0.55), 3, 0.55);
  windowGrid(cx, lights, cxx + 19, cy - 38, 12, 18, 2, 4, 4, darken(stone, 0.55), 5, 0.6);
}

function edinburghNear(cx, w, lights) {
  const th = THEMES.edinburgh;
  const period = 84;
  for (let m = 0; m * period < w; m++) {
    const x = m * period;
    const hgt = 62 + Math.round(hash(m, 111) * 22);
    const top = 214 - hgt;
    const body = m % 2 ? th.near : darken(th.near, 0.12);
    fr(cx, x + 2, top, period - 4, hgt + 60, body);
    // crow-stepped gable on the left edge
    for (let s = 0; s < 6; s++) {
      fr(cx, x + 2 - 3, top + s * 4, 6, 4, body);
      fr(cx, x + 2 - 3, top + s * 4, 6, 1, lighten(body, 0.18));
    }
    for (let s = 0; s < 6; s++) {
      fr(cx, x + period - 5, top + s * 4, 6, 4, body);
      fr(cx, x + period - 5, top + s * 4, 6, 1, lighten(body, 0.18));
    }
    // roof ridge + chimney stack with pots
    fr(cx, x + 2, top - 2, period - 4, 2, lighten(body, 0.22));
    const chx = x + 20 + Math.round(hash(m, 112) * 30);
    fr(cx, chx, top - 14, 12, 14, darken(body, 0.2));
    for (let p = 0; p < 3; p++) fr(cx, chx + 1 + p * 4, top - 18, 3, 5, darken(body, 0.45));
    // slate texture
    for (let i = 0; i < 10; i++) {
      fr(cx, x + 4 + Math.round(hash(m * 9 + i, 113) * (period - 12)),
        top + 6 + Math.round(hash(i, 114) * (hgt - 12)), 3, 1, lighten(body, 0.1));
    }
    windowGrid(cx, lights, x + 8, top + 10, period - 18, hgt - 16, 5, 7, 7, darken(body, 0.5), m + 1, 0.5);
  }
}

// --- hospital --------------------------------------------------------------

function hospitalFar(cx, w, lights) {
  const th = THEMES.hospital;
  for (let i = 0; i < 6; i++) {
    const x = Math.round(hash(i, 121) * (w - 50));
    const y = 26 + Math.round(hash(i, 122) * 40);
    cloud(cx, x, y, 2, '#ffffff', '#dff0f2');
  }
  ridge(cx, w, th.far, lighten(th.far, 0.4), 150, 10, 1, 3, 1.4, VIEW_H + LAYER_TOP);
  // distant blocks
  for (let i = 0; i < 7; i++) {
    const x = 12 + i * 66 + Math.round(hash(i, 123) * 12);
    const hgt = 22 + Math.round(hash(i, 124) * 26);
    fr(cx, x, 150 - hgt, 34, hgt, mix(th.far, th.mid, 0.5));
    fr(cx, x, 150 - hgt, 34, 2, lighten(th.far, 0.3));
    windowGrid(cx, lights, x + 3, 150 - hgt + 5, 28, hgt - 9, 4, 4, 4, mix(th.mid, '#ffffff', 0.35), i, 0.3);
  }
}

function hospitalMid(cx, w, lights) {
  const th = THEMES.hospital;
  const top = 116;
  fr(cx, 0, top, w, VIEW_H + LAYER_TOP - top, '#f4fbfc');
  fr(cx, 0, top, w, 4, th.mid);
  fr(cx, 0, top + 4, w, 2, lighten(th.mid, 0.35));
  // ward window bays
  const period = 60;
  for (let m = 0; m * period < w; m++) {
    const x = m * period + 8;
    fr(cx, x - 3, top + 14, 46, 44, mix(th.mid, '#ffffff', 0.55));
    fr(cx, x, top + 17, 40, 38, '#dff2f5');
    // frame
    fr(cx, x + 19, top + 17, 2, 38, mix(th.mid, '#ffffff', 0.3));
    fr(cx, x, top + 34, 40, 2, mix(th.mid, '#ffffff', 0.3));
    // blinds
    for (let b = 0; b < 5; b++) fr(cx, x + 1, top + 19 + b * 3, 38, 1, rgba('#9fd4dc', 0.55));
    // warm interior glow registered as a light
    lights.push([x + 2, top + 38, 16, 15, '#fff3dc']);
    lights.push([x + 22, top + 20, 16, 12, '#fff3dc']);
    // health plus emblem on the pier between bays
    if (m % 2 === 0) {
      fr(cx, x + 47, top + 24, 4, 12, th.accent);
      fr(cx, x + 43, top + 28, 12, 4, th.accent);
      fr(cx, x + 47, top + 24, 4, 1, lighten(th.accent, 0.4));
    }
    // teal string course under each bay
    fr(cx, x - 6, top + 60, 52, 3, th.accent);
    fr(cx, x - 6, top + 60, 52, 1, lighten(th.accent, 0.35));
  }
  fr(cx, 0, top + 88, w, 6, mix(th.mid, '#ffffff', 0.25));
}

function hospitalNear(cx, w, lights) {
  const th = THEMES.hospital;
  const base = 216;
  fr(cx, 0, base, w, VIEW_H + LAYER_TOP - base, th.near);
  fr(cx, 0, base, w, 2, lighten(th.near, 0.4));
  fr(cx, 0, base - 10, w, 3, mix(th.near, '#ffffff', 0.5));
  const period = 68;
  for (let m = 0; m * period < w; m++) {
    const x = m * period;
    // handrail posts
    fr(cx, x + 10, base - 10, 3, 12, darken(th.near, 0.25));
    fr(cx, x + 44, base - 10, 3, 12, darken(th.near, 0.25));
    if (m % 3 === 0) {
      // planter
      fr(cx, x + 24, base - 12, 14, 12, mix(th.near, '#ffffff', 0.35));
      fr(cx, x + 24, base - 12, 14, 2, '#ffffff');
      fr(cx, x + 27, base - 22, 3, 10, '#4f9a5e');
      fr(cx, x + 24, base - 20, 5, 3, '#5fb06d');
      fr(cx, x + 32, base - 24, 6, 4, '#5fb06d');
      fr(cx, x + 30, base - 18, 6, 3, '#3f8a51');
    } else if (m % 3 === 1) {
      // ward trolley silhouette
      fr(cx, x + 22, base - 16, 22, 4, mix(th.near, '#ffffff', 0.45));
      fr(cx, x + 24, base - 12, 2, 10, darken(th.near, 0.3));
      fr(cx, x + 40, base - 12, 2, 10, darken(th.near, 0.3));
      fr(cx, x + 40, base - 26, 2, 10, darken(th.near, 0.3));
      fr(cx, x + 36, base - 30, 10, 5, mix(th.near, '#ffffff', 0.6));
    }
  }
}

// --- classroom -------------------------------------------------------------

function classroomFar(cx, w, lights) {
  const th = THEMES.classroom;
  fr(cx, 0, 0, w, VIEW_H + LAYER_TOP, th.far);
  // afternoon light shafts
  for (let i = 0; i < 6; i++) {
    const x = 30 + i * 78;
    for (let k = 0; k < 26; k++) {
      fr(cx, x + k, -LAYER_TOP + k * 2, 16, 2, rgba('#fff4d2', 0.09));
    }
  }
  // picture rail and ceiling band
  fr(cx, 0, 40, w, 4, mix(th.far, '#ffffff', 0.4));
  fr(cx, 0, 44, w, 2, darken(th.far, 0.12));
  // clock-less wall dots (pinholes)
  for (let i = 0; i < 40; i++) {
    fr(cx, Math.round(hash(i, 131) * w), 60 + Math.round(hash(i, 132) * 90), 1, 1, darken(th.far, 0.1));
  }
}

function classroomMid(cx, w, lights) {
  const th = THEMES.classroom;
  const period = 176;
  for (let m = 0; m * period < w; m++) {
    const x = m * period + 12;
    if (m % 2 === 0) {
      // whiteboard
      fr(cx, x, 78, 128, 62, '#8a8f96');
      fr(cx, x + 2, 80, 124, 56, '#fbfdff');
      fr(cx, x + 2, 80, 124, 3, '#e6ecf2');
      // abstract marker squiggles (no letterforms)
      for (let s = 0; s < 3; s++) {
        const cy = 92 + s * 14;
        const col = s === 0 ? '#2f6fd0' : s === 1 ? '#d0453f' : '#3f9a5e';
        for (let k = 0; k < 100; k += 2) {
          const yy = cy + Math.round(Math.sin(k * 0.22 + s * 1.7) * 3);
          if (hash(k + s * 31, m) > 0.22) fr(cx, x + 10 + k, yy, 2, 1, col);
        }
      }
      // a small bar chart doodle
      for (let b = 0; b < 4; b++) {
        const bh = 6 + Math.round(hash(b, m + 7) * 14);
        fr(cx, x + 96 + b * 6, 130 - bh, 4, bh, '#2f6fd0');
      }
      fr(cx, x + 90, 130, 32, 1, '#5a6270');
      // marker tray
      fr(cx, x, 140, 128, 4, '#6f757e');
      fr(cx, x + 8, 138, 10, 2, '#d0453f');
      fr(cx, x + 22, 138, 10, 2, '#2f6fd0');
    } else {
      // pinboard with sticky notes
      fr(cx, x + 6, 74, 116, 70, '#8a5f36');
      fr(cx, x + 9, 77, 110, 64, '#c79a63');
      const notes = ['#f2c94c', '#f2994a', '#6fcf97', '#56ccf2', '#f27b8c', '#bb6bd9'];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 5; c++) {
          const nx = x + 14 + c * 21 + Math.round(hash(r * 5 + c, m) * 3);
          const ny = 82 + r * 20 + Math.round(hash(c, r + m) * 3);
          fr(cx, nx, ny, 16, 16, notes[(r * 5 + c + m) % notes.length]);
          fr(cx, nx, ny, 16, 3, lighten(notes[(r * 5 + c + m) % notes.length], 0.3));
          fr(cx, nx + 2, ny + 7, 10, 1, rgba('#000000', 0.18));
          fr(cx, nx + 2, ny + 10, 7, 1, rgba('#000000', 0.14));
        }
      }
    }
  }
  fr(cx, 0, 152, w, 6, darken(th.mid, 0.18));
}

function classroomNear(cx, w, lights) {
  const th = THEMES.classroom;
  const base = 214;
  fr(cx, 0, base + 12, w, VIEW_H + LAYER_TOP - base, darken(th.near, 0.18));
  const period = 78;
  for (let m = 0; m * period < w; m++) {
    const x = m * period;
    // desk
    fr(cx, x + 6, base, 58, 6, th.near);
    fr(cx, x + 6, base, 58, 2, lighten(th.near, 0.24));
    fr(cx, x + 10, base + 6, 4, 22, darken(th.near, 0.24));
    fr(cx, x + 56, base + 6, 4, 22, darken(th.near, 0.24));
    // chair back
    fr(cx, x + 24, base - 18, 20, 4, darken(th.near, 0.1));
    fr(cx, x + 32, base - 14, 4, 16, darken(th.near, 0.28));
    // desk clutter
    if (m % 2 === 0) {
      fr(cx, x + 14, base - 8, 14, 8, '#5a6272');
      fr(cx, x + 15, base - 7, 12, 6, '#8ee6ff');
      fr(cx, x + 12, base - 1, 18, 1, '#2b3140');
    } else {
      fr(cx, x + 40, base - 6, 12, 6, '#f2efe6');
      fr(cx, x + 40, base - 6, 12, 1, '#d0cbbd');
      fr(cx, x + 20, base - 9, 6, 9, '#f2f2ef');
      fr(cx, x + 20, base - 9, 6, 2, '#8a5a3c');
    }
  }
  // bookshelf every four modules
  for (let m = 0; m * period * 4 < w; m++) {
    const x = m * period * 4 + 40;
    fr(cx, x, base - 62, 46, 62, darken(th.near, 0.3));
    for (let s = 0; s < 3; s++) {
      fr(cx, x + 2, base - 58 + s * 20, 42, 2, lighten(th.near, 0.12));
      for (let b = 0; b < 9; b++) {
        const bh = 10 + Math.round(hash(b, s + m) * 6);
        const col = ['#d0453f', '#2f6fd0', '#3f9a5e', '#f2c94c', '#bb6bd9'][(b + s) % 5];
        fr(cx, x + 3 + b * 4, base - 58 + s * 20 - bh + 2, 3, bh, col);
      }
    }
  }
}

// --- fintech ---------------------------------------------------------------

function fintechFar(cx, w, lights) {
  const th = THEMES.fintech;
  for (let i = 0; i < 90; i++) {
    const x = Math.round(hash(i, 141) * w);
    const y = Math.round(hash(i, 142) * 150) - 20;
    const b = hash(i, 143);
    fr(cx, x, y, 1, 1, b > 0.8 ? '#ffffff' : b > 0.5 ? '#bcd8ff' : '#7f9ad0');
  }
  // city glow
  for (let i = 0; i < 40; i++) {
    fr(cx, 0, 150 - i, w, 1, rgba('#2b4fa0', 0.012 * i));
  }
  ridge(cx, w, th.far, null, 168, 12, 1, 4, 0.7, VIEW_H + LAYER_TOP);
}

function fintechMid(cx, w, lights) {
  const th = THEMES.fintech;
  const baseline = 172;
  // faint chart grid
  for (let g = 0; g < 6; g++) fr(cx, 0, 84 + g * 18, w, 1, rgba('#4a6ab0', 0.16));
  // candlestick skyline
  let prev = baseline - 40;
  for (let x = 4; x < w; x += 12) {
    const i = x / 12;
    const drift = Math.sin((x / w) * Math.PI * 2) * 26 + Math.sin((x / w) * Math.PI * 6) * 12;
    const open = baseline - 42 - drift + (hash(i, 151) - 0.5) * 22;
    const close = baseline - 42 - drift + (hash(i, 152) - 0.5) * 22;
    const top = Math.round(Math.min(open, close));
    const bot = Math.round(Math.max(open, close));
    const bull = close < open;
    const col = bull ? th.accent : th.hazard;
    const wickT = top - 4 - Math.round(hash(i, 153) * 10);
    const wickB = bot + 4 + Math.round(hash(i, 154) * 10);
    fr(cx, x + 3, wickT, 2, wickB - wickT, darken(col, 0.45));
    fr(cx, x, top, 8, Math.max(3, bot - top), col);
    fr(cx, x, top, 8, 1, lighten(col, 0.4));
    fr(cx, x, Math.max(top, bot - 1), 8, 1, darken(col, 0.35));
    // body extends down to the ground like a tower
    fr(cx, x + 1, bot, 6, baseline - bot + 40, darken(th.mid, 0.1));
    windowGrid(cx, lights, x + 2, bot + 4, 4, Math.max(0, baseline - bot - 6), 1, 2, 2, darken(th.mid, 0.3), i, 0.35);
    // trend line
    fr(cx, x, Math.round((prev + top) / 2), 12, 1, rgba('#7ef3ff', 0.35));
    prev = top;
  }
  fr(cx, 0, baseline + 40, w, 20, darken(th.mid, 0.2));
}

function fintechNear(cx, w, lights) {
  const th = THEMES.fintech;
  const base = 226;
  const period = 74;
  for (let m = 0; m * period < w; m++) {
    const x = m * period;
    const hgt = 46 + Math.round(hash(m, 161) * 34);
    const neon = ['#00e6a0', '#35d6ff', '#ff4d6d', '#c39bff'][m % 4];
    fr(cx, x + 2, base - hgt, period - 6, hgt + 60, th.near);
    fr(cx, x + 2, base - hgt, period - 6, 2, mix(th.near, neon, 0.25));
    // neon window strips
    for (let r = 0; r < 6; r++) {
      const yy = base - hgt + 8 + r * 8;
      if (yy > base - 6) break;
      fr(cx, x + 6, yy, period - 14, 3, darken(th.near, 0.45));
      lights.push([x + 6, yy, period - 14, 3, r === 2 ? '#ffffff' : neon]);
    }
    // rooftop mast
    fr(cx, x + Math.round(period / 2), base - hgt - 12, 2, 12, darken(th.near, 0.3));
    fr(cx, x + Math.round(period / 2) - 1, base - hgt - 14, 4, 3, th.hazard);
  }
  // ticker rail across the bottom
  fr(cx, 0, base + 6, w, 8, darken(th.near, 0.35));
  for (let i = 0; i < w; i += 6) {
    fr(cx, i, base + 8, 4, 4, hash(i, 171) > 0.5 ? rgba('#00e6a0', 0.5) : rgba('#ff4d6d', 0.45));
  }
}

// --- salon (Tokyo dusk) ----------------------------------------------------

function salonFar(cx, w, lights) {
  const th = THEMES.salon;
  skyWash(cx, w, 30, 150, ['#3a2059', '#7d3f78', '#d1668f', '#ff9f8e'], 0.34);
  // thin horizon streaks
  for (let i = 0; i < 7; i++) {
    const y = 118 + i * 5;
    const x = Math.round(hash(i, 179) * w * 0.5);
    fr(cx, x, y, Math.round(80 + hash(i, 178) * 180), 2, rgba('#ffc4a8', 0.14 + i * 0.02));
  }
  ridge(cx, w, th.far, mix(th.far, '#ff9ec4', 0.3), 152, 20, 1, 3, 1.9, VIEW_H + LAYER_TOP);
  ridge(cx, w, darken(th.far, 0.2), null, 168, 12, 2, 5, 0.5, VIEW_H + LAYER_TOP);
  for (let i = 0; i < 5; i++) {
    const x = Math.round(hash(i, 181) * (w - 60));
    cloud(cx, x, 34 + Math.round(hash(i, 182) * 30), hash(i, 183) > 0.5 ? 2 : 1, rgba('#ffc7d8', 0.4), null);
  }
}

function torii(cx, x, y, hgt, wide, red, rim) {
  const pw = 8;
  const span = wide;
  // pillars, slightly battered inward
  fr(cx, x, y + 6, pw, hgt, red);
  fr(cx, x + span - pw, y + 6, pw, hgt, red);
  fr(cx, x, y + 6, 2, hgt, rim);
  fr(cx, x + span - pw, y + 6, 2, hgt, rim);
  // base stones
  fr(cx, x - 3, y + hgt + 2, pw + 6, 5, darken(red, 0.5));
  fr(cx, x + span - pw - 3, y + hgt + 2, pw + 6, 5, darken(red, 0.5));
  // nuki (lower beam)
  fr(cx, x - 2, y + 26, span + 4, 5, red);
  fr(cx, x - 2, y + 26, span + 4, 1, rim);
  // shimaki (second beam) and kasagi (curved top beam)
  fr(cx, x - 6, y + 14, span + 12, 5, red);
  fr(cx, x - 12, y + 8, span + 24, 5, red);
  fr(cx, x - 12, y + 8, span + 24, 1, rim);
  // upward sweep at the ends
  fr(cx, x - 16, y + 6, 6, 4, red);
  fr(cx, x + span + 10, y + 6, 6, 4, red);
  fr(cx, x - 19, y + 4, 5, 3, red);
  fr(cx, x + span + 14, y + 4, 5, 3, red);
  // gakuzuka (central strut)
  fr(cx, x + Math.round(span / 2) - 3, y + 18, 7, 9, red);
  fr(cx, x + Math.round(span / 2) - 3, y + 18, 7, 1, rim);
}

function salonMid(cx, w, lights) {
  const th = THEMES.salon;
  const dark = darken(th.mid, 0.45);
  ridge(cx, w, th.mid, mix(th.mid, th.accent, 0.16), 182, 8, 2, 6, 1.1, VIEW_H + LAYER_TOP);
  // torii gate, vermillion against the dusk
  torii(cx, 62, 96, 82, 64, '#8f2a3c', '#c4485a');
  // five-tier pagoda
  const px0 = 226;
  const body = darken(th.mid, 0.3);
  const roof = '#2a1230';
  for (let l = 0; l < 4; l++) {
    const wd = 58 - l * 12;
    const x = px0 + l * 6;
    const y = 168 - l * 22;
    // body first, roof over it
    fr(cx, x + 3, y - 16, wd - 6, 20, body);
    windowGrid(cx, lights, x + 6, y - 12, wd - 12, 8, 4, 5, 4, darken(th.mid, 0.55), l + 3, 0.75, '#ffd08a');
    // double eave with upturned corners
    fr(cx, x - 7, y - 2, wd + 14, 3, roof);
    fr(cx, x - 4, y - 5, wd + 8, 3, roof);
    fr(cx, x - 1, y - 8, wd + 2, 3, roof);
    fr(cx, x - 11, y - 4, 5, 3, roof);
    fr(cx, x + wd + 6, y - 4, 5, 3, roof);
    fr(cx, x - 13, y - 7, 4, 3, roof);
    fr(cx, x + wd + 9, y - 7, 4, 3, roof);
    fr(cx, x - 7, y - 2, wd + 14, 1, mix(roof, th.accent, 0.25));
  }
  // sorin finial
  const fx = px0 + 24 + 10;
  fr(cx, fx, 66, 2, 22, roof);
  for (let i = 0; i < 4; i++) fr(cx, fx - 3, 70 + i * 4, 8, 2, roof);
  fr(cx, fx - 2, 62, 6, 4, mix(roof, th.accent, 0.4));
  // low city blocks
  for (let i = 0; i < 9; i++) {
    const x = 330 + i * 34 + Math.round(hash(i, 191) * 8);
    const hgt = 30 + Math.round(hash(i, 192) * 40);
    fr(cx, x, 178 - hgt, 26, hgt + 40, darken(th.mid, 0.2));
    fr(cx, x, 178 - hgt, 26, 2, mix(th.mid, th.accent, 0.2));
    windowGrid(cx, lights, x + 3, 178 - hgt + 5, 20, hgt - 10, 3, 4, 3, darken(th.mid, 0.45), i, 0.45,
      i % 3 === 0 ? '#8ef0ff' : '#ffd08a');
  }
}

function salonNear(cx, w, lights) {
  const th = THEMES.salon;
  const base = 226;
  const period = 92;
  const NEON = ['#ff77c8', '#8ef0ff', '#ffe08a', '#b28cff'];
  for (let m = 0; m * period < w; m++) {
    const x = m * period;
    const hgt = 54 + Math.round(hash(m, 201) * 26);
    const neon = NEON[m % NEON.length];
    fr(cx, x + 2, base - hgt, period - 6, hgt + 60, th.near);
    fr(cx, x + 2, base - hgt, period - 6, 3, darken(th.near, 0.35));
    fr(cx, x, base - hgt - 3, period - 2, 3, darken(th.near, 0.5));
    // upper storey windows
    windowGrid(cx, lights, x + 8, base - hgt + 8, period - 20, Math.max(6, hgt - 40), 7, 8, 6,
      darken(th.near, 0.45), m + 5, 0.5, '#ffd7b0');
    // vertical neon sign column
    const sx = x + 6 + Math.round(hash(m, 202) * 6);
    fr(cx, sx - 1, base - hgt + 4, 12, 40, darken(th.near, 0.55));
    for (let k = 0; k < 4; k++) lights.push([sx + 1, base - hgt + 7 + k * 9, 8, 6, neon]);
    // horizontal sign box over the shopfront
    fr(cx, x + 32, base - 32, 44, 11, darken(th.near, 0.55));
    lights.push([x + 34, base - 30, 40, 7, NEON[(m + 1) % NEON.length]]);
    // slim striped awning
    fr(cx, x + 4, base - 19, period - 10, 4, darken(th.near, 0.4));
    for (let s = 0; s < 4; s++) fr(cx, x + 6 + s * 20, base - 19, 9, 4, rgba('#f2eae6', 0.5));
    fr(cx, x + 4, base - 15, period - 10, 1, darken(th.near, 0.6));
    // two paper lanterns hanging from the awning
    for (let l = 0; l < 2; l++) {
      const lx = x + 22 + l * 40;
      fr(cx, lx + 2, base - 15, 1, 3, darken(th.near, 0.6));
      fr(cx, lx, base - 12, 7, 9, '#efe6dd');
      fr(cx, lx, base - 12, 7, 2, '#c8384f');
      fr(cx, lx, base - 5, 7, 2, '#c8384f');
      lights.push([lx + 1, base - 10, 5, 5, '#ffdca8']);
    }
    // shopfront glass
    fr(cx, x + 6, base - 14, period - 14, 14, darken(th.near, 0.3));
    fr(cx, x + 9, base - 12, 22, 11, rgba('#ffd7ea', 0.16));
    fr(cx, x + 52, base - 12, 18, 11, rgba('#d7f2ff', 0.12));
  }
}

// --- kl --------------------------------------------------------------------

function klFar(cx, w, lights) {
  const th = THEMES.kl;
  skyWash(cx, w, 20, 152, ['#2a2f6e', '#6a4a86', '#c9707e', '#ffb066'], 0.32);
  for (let i = 0; i < 8; i++) {
    const y = 112 + i * 5;
    const x = Math.round(hash(i, 209) * w * 0.6);
    fr(cx, x, y, Math.round(70 + hash(i, 208) * 190), 2, rgba('#ffd0a0', 0.12 + i * 0.015));
  }
  for (let i = 0; i < 40; i++) {
    fr(cx, Math.round(hash(i, 211) * w), Math.round(hash(i, 212) * 70) - 20, 1, 1, rgba('#ffffff', 0.6));
  }
  ridge(cx, w, th.far, mix(th.far, '#ffb98a', 0.2), 156, 16, 1, 3, 2.6, VIEW_H + LAYER_TOP);
  // birds
  for (let i = 0; i < 6; i++) {
    const x = Math.round(hash(i, 213) * (w - 20)) + 6;
    const y = 40 + Math.round(hash(i, 214) * 30);
    fr(cx, x, y, 2, 1, rgba('#3a2f4a', 0.7));
    fr(cx, x + 2, y - 1, 2, 1, rgba('#3a2f4a', 0.7));
    fr(cx, x + 4, y, 2, 1, rgba('#3a2f4a', 0.7));
  }
}

function petronas(cx, x, baseY, body, hi, lights) {
  const towerH = 118;
  for (let s = 0; s < 2; s++) {
    const tx = x + s * 46;
    // 5 tapering tiers
    const tiers = [
      [0, 34, 34], [3, 28, 26], [6, 22, 20], [9, 16, 16], [11, 12, 12],
    ];
    let y = baseY;
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      const seg = Math.round(towerH / tiers.length);
      y = baseY - seg * (i + 1);
      fr(cx, tx + t[0], y, t[1], seg + 2, body);
      fr(cx, tx + t[0], y, t[1], 2, hi);
      fr(cx, tx + t[0] + t[1] - 3, y, 3, seg + 2, darken(body, 0.25));
      // ribbed facade
      for (let r = 2; r < t[1] - 3; r += 4) fr(cx, tx + t[0] + r, y + 3, 1, seg - 3, darken(body, 0.18));
      windowGrid(cx, lights, tx + t[0] + 2, y + 4, t[1] - 6, seg - 6, 2, 3, 3, darken(body, 0.35), i * 7 + s, 0.32);
    }
    // pinnacle + spire
    fr(cx, tx + 13, baseY - towerH - 8, 8, 8, body);
    fr(cx, tx + 15, baseY - towerH - 16, 4, 8, body);
    fr(cx, tx + 16, baseY - towerH - 30, 2, 14, hi);
    fr(cx, tx + 15, baseY - towerH - 34, 4, 4, hi);
  }
  // skybridge
  const by = baseY - Math.round(towerH * 0.52);
  fr(cx, x + 30, by, 26, 5, hi);
  fr(cx, x + 30, by + 5, 26, 2, darken(body, 0.3));
  for (let i = 0; i < 5; i++) fr(cx, x + 32 + i * 5, by + 1, 2, 3, darken(body, 0.4));
  // bridge legs
  for (let i = 0; i < 14; i++) {
    fr(cx, x + 34 - Math.round(i * 0.5), by + 7 + i, 2, 2, darken(body, 0.25));
    fr(cx, x + 52 + Math.round(i * 0.5), by + 7 + i, 2, 2, darken(body, 0.25));
  }
  // podium
  fr(cx, x - 8, baseY, 96, 22, darken(body, 0.15));
  fr(cx, x - 8, baseY, 96, 2, hi);
}

function klMid(cx, w, lights) {
  const th = THEMES.kl;
  const baseY = 176;
  const body = mix(th.mid, '#6f7ab0', 0.35);
  const hi = mix(body, '#ffd9a8', 0.35);
  // background skyline
  for (let i = 0; i < 16; i++) {
    const x = i * 40 + Math.round(hash(i, 221) * 10);
    const hgt = 26 + Math.round(hash(i, 222) * 52);
    fr(cx, x, baseY - hgt, 30, hgt + 30, darken(th.mid, 0.18));
    fr(cx, x, baseY - hgt, 30, 2, mix(th.mid, '#ffb98a', 0.25));
    windowGrid(cx, lights, x + 3, baseY - hgt + 5, 24, hgt - 10, 2, 3, 3, darken(th.mid, 0.4), i, 0.3);
  }
  // KL Tower (Menara)
  const kx = 340;
  fr(cx, kx, baseY - 96, 8, 96, body);
  fr(cx, kx + 2, baseY - 96, 2, 96, hi);
  fr(cx, kx - 6, baseY - 116, 20, 12, body);
  fr(cx, kx - 6, baseY - 116, 20, 2, hi);
  fr(cx, kx - 3, baseY - 122, 14, 6, darken(body, 0.2));
  fr(cx, kx + 2, baseY - 140, 3, 18, hi);
  windowGrid(cx, lights, kx - 4, baseY - 114, 16, 8, 2, 3, 2, darken(body, 0.4), 9, 0.7);
  // Petronas Twin Towers, the hero silhouette
  petronas(cx, 150, baseY, body, hi, lights);
}

function klNear(cx, w, lights) {
  const th = THEMES.kl;
  const base = 226;
  const period = 96;
  for (let m = 0; m * period < w; m++) {
    const x = m * period;
    // shophouse row
    const hgt = 52 + Math.round(hash(m, 231) * 14);
    fr(cx, x + 2, base - hgt, period - 6, hgt + 60, th.near);
    fr(cx, x, base - hgt - 4, period - 2, 5, darken(th.near, 0.3));
    fr(cx, x + 4, base - hgt + 4, period - 10, 2, lighten(th.near, 0.12));
    // shuttered windows
    for (let k = 0; k < 3; k++) {
      const wx = x + 10 + k * 26;
      fr(cx, wx, base - hgt + 12, 16, 18, darken(th.near, 0.4));
      fr(cx, wx + 1, base - hgt + 13, 14, 16, darken(th.near, 0.55));
      lights.push([wx + 2, base - hgt + 14, 12, 14]);
    }
    // five-foot-way arcade
    fr(cx, x + 4, base - 20, period - 10, 4, darken(th.near, 0.35));
    for (let k = 0; k < 4; k++) fr(cx, x + 6 + k * 22, base - 16, 4, 18, darken(th.near, 0.28));
    // palm tree
    const tx = x + 70;
    fr(cx, tx, base - 46, 3, 48, darken(th.near, 0.15));
    for (let f = 0; f < 6; f++) {
      const a = -2.6 + f * 0.52;
      for (let k = 1; k < 12; k++) {
        const fx = tx + 1 + Math.round(Math.cos(a) * k);
        const fy = base - 46 + Math.round(Math.sin(a) * k * 0.7) + Math.round(k * k * 0.03);
        fr(cx, fx, fy, 2, 1, f % 2 ? '#2f5a3a' : '#3d7048');
      }
    }
    fr(cx, tx - 1, base - 48, 5, 3, '#2f5a3a');
  }
  // elevated rail line
  fr(cx, 0, base - 74, w, 5, darken(th.near, 0.45));
  fr(cx, 0, base - 70, w, 2, darken(th.near, 0.2));
  for (let i = 0; i * 64 < w; i++) {
    fr(cx, i * 64 + 24, base - 69, 6, 24, darken(th.near, 0.4));
  }
}

const LAYER_PAINTERS = {
  bristol: [bristolFar, bristolMid, bristolNear],
  edinburgh: [edinburghFar, edinburghMid, edinburghNear],
  hospital: [hospitalFar, hospitalMid, hospitalNear],
  classroom: [classroomFar, classroomMid, classroomNear],
  fintech: [fintechFar, fintechMid, fintechNear],
  salon: [salonFar, salonMid, salonNear],
  kl: [klFar, klMid, klNear],
};

const LAYER_WIDTHS = {
  bristol: [480, 640, 264],
  edinburgh: [480, 720, 252],
  hospital: [480, 480, 408],
  classroom: [480, 704, 468],
  fintech: [480, 480, 444],
  salon: [480, 640, 460],
  kl: [480, 640, 480],
};

const LIGHT_COLORS = {
  bristol: '#ffd88a',
  edinburgh: '#ffcf7a',
  hospital: '#fff6e2',
  classroom: '#fff0c4',
  fintech: '#00e6a0',
  salon: '#ff8fd0',
  kl: '#ffd98a',
};

function getLayer(key, i) {
  const ck = key + ':' + i;
  let l = layerCache.get(ck);
  if (l !== undefined) return l;
  const painters = LAYER_PAINTERS[key] || LAYER_PAINTERS.bristol;
  const widths = LAYER_WIDTHS[key] || LAYER_WIDTHS.bristol;
  l = makeLayer(widths[i], painters[i]);
  layerCache.set(ck, l);
  return l;
}

function blitLayer(ctx, layer, ox, oy, lightColor, t, glow) {
  if (!layer) return;
  const w = layer.w;
  const start = -(((ox % w) + w) % w);
  const y = Math.round(oy) - LAYER_TOP;
  for (let x = start; x < VIEW_W; x += w) {
    ctx.drawImage(layer.canvas, Math.round(x), y);
  }
  if (!layer.lights.length) return;
  const ly = Math.round(oy);
  let rep = 0;
  for (let x = start; x < VIEW_W; x += w) {
    const bx = Math.round(x);
    for (let i = 0; i < layer.lights.length; i++) {
      const L = layer.lights[i];
      const sx = bx + L[0];
      if (sx + L[2] < 0 || sx > VIEW_W) continue;
      const h = hash(i * 31 + rep * 977, i * 7 + 3);
      if (Math.sin(t * (0.25 + h * 0.7) + h * 41) < -0.55) continue;
      const col = L[4] || lightColor;
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.55 + 0.45 * h;
      ctx.fillRect(sx, L[1] + ly, L[2], L[3]);
      if (glow && L[2] > 3) {
        ctx.globalAlpha = 0.12;
        ctx.fillRect(sx - 2, L[1] + ly - 2, L[2] + 4, L[3] + 4);
      }
      ctx.globalAlpha = 1;
    }
    rep++;
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------

const skyCache = { ctx: null, key: null, grad: null };

function drawSky(ctx, key, th) {
  if (skyCache.ctx !== ctx || skyCache.key !== key || !skyCache.grad) {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    const top = (th.sky && th.sky[0]) || '#000000';
    const bot = (th.sky && th.sky[1]) || '#222222';
    g.addColorStop(0, top);
    g.addColorStop(0.55, mix(top, bot, 0.55));
    g.addColorStop(1, bot);
    skyCache.ctx = ctx;
    skyCache.key = key;
    skyCache.grad = g;
  }
  ctx.fillStyle = skyCache.grad;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

function drawSkyFeature(ctx, key, th, camX, oy, t) {
  // A single non-repeating sun/moon anchored loosely to the world.
  const x = Math.round(360 - camX * 0.04);
  const wrapped = ((x % 900) + 900) % 900 - 210;
  const y = Math.round(oy);
  ctx.save();
  if (key === 'fintech') {
    // cold moon
    const mx = wrapped;
    const my = 40 + y;
    glowBox(ctx, mx, my, 16, 16, '#9fd8ff', 22, 0.3);
    fr(ctx, mx + 2, my, 12, 16, '#dfeeff');
    fr(ctx, mx, my + 2, 16, 12, '#dfeeff');
    fr(ctx, mx + 3, my + 3, 4, 4, '#b9cfe6');
    fr(ctx, mx + 10, my + 8, 3, 3, '#b9cfe6');
    fr(ctx, mx + 5, my + 11, 2, 2, '#b9cfe6');
  } else if (key === 'salon' || key === 'kl') {
    const sx = wrapped;
    const sy = 100 + y;
    const c = key === 'salon' ? '#ffb3c8' : '#ffcf8a';
    glowBox(ctx, sx, sy, 24, 24, c, 30, 0.34);
    fr(ctx, sx + 3, sy, 18, 24, key === 'salon' ? '#ffd8e2' : '#ffeab0');
    fr(ctx, sx, sy + 3, 24, 18, key === 'salon' ? '#ffd8e2' : '#ffeab0');
    fr(ctx, sx + 4, sy + 4, 16, 16, key === 'salon' ? '#fff0f4' : '#fffbe6');
  } else if (key === 'bristol' || key === 'classroom' || key === 'hospital') {
    const sx = wrapped;
    const sy = 34 + y;
    glowBox(ctx, sx, sy, 20, 20, '#fff3c0', 26, 0.28);
    fr(ctx, sx + 3, sy, 14, 20, '#fff9dc');
    fr(ctx, sx, sy + 3, 20, 14, '#fff9dc');
    fr(ctx, sx + 4, sy + 4, 12, 12, '#ffffff');
  } else {
    // edinburgh — a pale sun behind cloud
    const sx = wrapped;
    const sy = 44 + y;
    glowBox(ctx, sx, sy, 18, 18, '#e8eef6', 20, 0.32);
    ctx.globalAlpha = 0.7;
    fr(ctx, sx + 3, sy, 12, 18, '#dfe7f0');
    fr(ctx, sx, sy + 3, 18, 12, '#dfe7f0');
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Ambient weather / atmosphere
// ---------------------------------------------------------------------------

function drawAmbient(ctx, key, th, camX, camY, t, front) {
  ctx.save();
  if (key === 'edinburgh') {
    const n = front ? 60 : 40;
    ctx.globalAlpha = front ? 0.34 : 0.2;
    ctx.fillStyle = th.particle;
    for (let i = 0; i < n; i++) {
      const sp = 150 + hash(i, 301) * 140;
      const x = ((hash(i, 302) * 900 - camX * (front ? 0.5 : 0.25) + t * 34) % 520 + 520) % 520 - 20;
      const y = ((hash(i, 303) * 400 + t * sp) % 320 + 320) % 320 - 20;
      ctx.fillRect(Math.round(x), Math.round(y), 1, front ? 5 : 3);
    }
  } else if (key === 'salon') {
    const n = front ? 26 : 22;
    for (let i = 0; i < n; i++) {
      const sp = 16 + hash(i, 311) * 22;
      const y = ((hash(i, 312) * 400 + t * sp) % 340 + 340) % 340 - 30;
      const sway = Math.sin(t * (0.7 + hash(i, 313)) + i) * 14;
      const x = ((hash(i, 314) * 900 - camX * (front ? 0.45 : 0.2) + sway) % 540 + 540) % 540 - 30;
      ctx.globalAlpha = front ? 0.85 : 0.5;
      ctx.fillStyle = i % 3 === 0 ? '#ffffff' : th.particle;
      const flip = Math.sin(t * 3 + i) > 0;
      ctx.fillRect(Math.round(x), Math.round(y), flip ? 3 : 2, flip ? 2 : 3);
      ctx.globalAlpha = front ? 0.4 : 0.22;
      ctx.fillRect(Math.round(x) - 1, Math.round(y) + 1, 1, 1);
    }
  } else if (key === 'classroom' || key === 'hospital') {
    const n = 30;
    ctx.fillStyle = th.particle;
    for (let i = 0; i < n; i++) {
      const y = ((hash(i, 321) * 400 - t * (5 + hash(i, 322) * 8)) % 300 + 300) % 300;
      const x = ((hash(i, 323) * 900 - camX * 0.2 + Math.sin(t * 0.5 + i) * 8) % 520 + 520) % 520 - 20;
      ctx.globalAlpha = (front ? 0.32 : 0.2) * (0.4 + 0.6 * Math.abs(Math.sin(t * (0.6 + hash(i, 324)) + i)));
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  } else if (key === 'fintech') {
    const n = front ? 26 : 20;
    for (let i = 0; i < n; i++) {
      const y = ((hash(i, 331) * 400 - t * (24 + hash(i, 332) * 40)) % 320 + 320) % 320;
      const x = ((hash(i, 333) * 900 - camX * 0.3) % 520 + 520) % 520 - 20;
      ctx.globalAlpha = front ? 0.5 : 0.3;
      ctx.fillStyle = i % 4 === 0 ? th.accent : th.particle;
      ctx.fillRect(Math.round(x), Math.round(y), 1, 2);
    }
  } else if (key === 'kl') {
    const n = 24;
    for (let i = 0; i < n; i++) {
      const x = ((hash(i, 341) * 900 - camX * 0.35 + Math.sin(t * 0.6 + i) * 20) % 520 + 520) % 520 - 20;
      const y = 120 + Math.sin(t * (0.4 + hash(i, 342)) + i * 2) * 40 + hash(i, 343) * 90;
      ctx.globalAlpha = 0.25 + 0.5 * Math.abs(Math.sin(t * 2 + i));
      ctx.fillStyle = i % 3 === 0 ? '#fff2b0' : th.particle;
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  } else {
    // bristol — drifting pollen / leaves
    const n = 24;
    for (let i = 0; i < n; i++) {
      const y = ((hash(i, 351) * 400 + t * (10 + hash(i, 352) * 16)) % 320 + 320) % 320 - 20;
      const x = ((hash(i, 353) * 900 - camX * 0.3 + Math.sin(t * 0.8 + i) * 16) % 520 + 520) % 520 - 20;
      ctx.globalAlpha = front ? 0.5 : 0.3;
      ctx.fillStyle = i % 4 === 0 ? '#ffe9a0' : th.particle;
      ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

function charAt(rows, tx, ty) {
  if (ty < 0 || ty >= rows.length) return '.';
  const row = rows[ty];
  if (tx < 0 || tx >= row.length) return '#';
  return row.charAt(tx);
}

function solidChar(c) {
  return c === '#' || c === '?';
}

function drawBlock(ctx, sx, sy, tx, ty, th, key, up, down, left, right) {
  const face = th.block;
  const top = th.blockTop;
  const shade = th.blockShade;
  fr(ctx, sx, sy, TILE, TILE, face);

  // stone/soil speckle so large masses do not read as flat colour
  for (let i = 0; i < 3; i++) {
    const hx = Math.floor(hash(tx * 3 + i, ty * 5 + i) * 13);
    const hy = Math.floor(hash(tx * 7 + i, ty * 11 + i) * 13) + 2;
    fr(ctx, sx + hx, sy + hy, 2, 1, i === 0 ? mix(face, top, 0.28) : mix(face, shade, 0.5));
  }

  // faint interior grid so large solid masses still read as stacked blocks
  ctx.globalAlpha = 0.16;
  if (up) fr(ctx, sx, sy, TILE, 1, shade);
  if (left) fr(ctx, sx, sy, 1, TILE, shade);
  ctx.globalAlpha = 1;

  if (!up) {
    fr(ctx, sx, sy, TILE, 3, top);
    fr(ctx, sx, sy, TILE, 1, lighten(top, 0.32));
    // dithered transition row
    for (let i = 0; i < TILE; i += 2) fr(ctx, sx + i, sy + 3, 1, 1, top);
    for (let i = 1; i < TILE; i += 4) fr(ctx, sx + i, sy + 4, 1, 1, mix(top, face, 0.5));
    if (key === 'bristol') {
      // grass blades over the lip
      for (let i = 0; i < 4; i++) {
        const gx = Math.floor(hash(tx * 13 + i, ty) * 15);
        const gh = 1 + Math.floor(hash(tx + i, ty * 3) * 3);
        fr(ctx, sx + gx, sy - gh, 1, gh, i % 2 ? top : lighten(top, 0.2));
      }
    }
  }
  if (!down) {
    fr(ctx, sx, sy + TILE - 2, TILE, 2, shade);
    for (let i = 0; i < TILE; i += 2) fr(ctx, sx + i, sy + TILE - 3, 1, 1, shade);
  }
  if (!left) {
    fr(ctx, sx, sy + (up ? 0 : 3), 1, TILE - (up ? 0 : 3), mix(face, top, 0.3));
  }
  if (!right) {
    fr(ctx, sx + TILE - 2, sy + (up ? 0 : 3), 2, TILE - (up ? 0 : 3) - (down ? 0 : 2), shade);
  }
}

function drawInfoBlock(ctx, sx, sy, th, t, tx) {
  const face = mix(mix(th.block, th.blockTop, 0.3), th.accent, 0.34);
  fr(ctx, sx, sy, TILE, TILE, darken(th.block, 0.45));
  fr(ctx, sx + 1, sy + 1, TILE - 2, TILE - 2, face);
  fr(ctx, sx + 1, sy + 1, TILE - 2, 1, lighten(face, 0.35));
  fr(ctx, sx + 1, sy + TILE - 2, TILE - 2, 1, darken(face, 0.3));
  // rivets
  fr(ctx, sx + 2, sy + 2, 2, 2, lighten(face, 0.5));
  fr(ctx, sx + TILE - 4, sy + 2, 2, 2, lighten(face, 0.3));
  fr(ctx, sx + 2, sy + TILE - 4, 2, 2, darken(face, 0.2));
  fr(ctx, sx + TILE - 4, sy + TILE - 4, 2, 2, darken(face, 0.2));
  // pulsing diamond marker
  const p = 0.5 + 0.5 * Math.sin(t * 4 + tx);
  const c = mix(th.accent, '#ffffff', p * 0.5);
  const rows = [1, 3, 5, 5, 3, 1];
  for (let i = 0; i < rows.length; i++) {
    fr(ctx, sx + 8 - Math.floor(rows[i] / 2) - (rows[i] % 2 === 0 ? 0 : 0), sy + 5 + i, rows[i], 1, c);
  }
  ctx.globalAlpha = 0.25 * p;
  fr(ctx, sx + 2, sy + 3, 12, 10, th.accent);
  ctx.globalAlpha = 1;
}

function drawSpikes(ctx, sx, sy, th, down) {
  const c = th.hazard;
  const hi = lighten(c, 0.45);
  const sh = darken(c, 0.4);
  // base plate
  if (down) fr(ctx, sx, sy, TILE, 3, sh);
  else fr(ctx, sx, sy + TILE - 3, TILE, 3, sh);
  const widths = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 5];
  for (let s = 0; s < 3; s++) {
    const cx0 = sx + 3 + s * 5;
    for (let i = 0; i < widths.length; i++) {
      const wdt = widths[i];
      const yy = down ? sy + 12 - i : sy + TILE - 13 + i;
      const xx = cx0 - Math.floor(wdt / 2);
      fr(ctx, xx, yy, wdt, 1, c);
      if (wdt > 2) fr(ctx, xx, yy, 1, 1, hi);
      if (wdt > 3) fr(ctx, xx + wdt - 1, yy, 1, 1, sh);
    }
  }
}

function drawPool(ctx, sx, sy, tx, th, t, surface) {
  const c = th.hazard;
  ctx.globalAlpha = 0.82;
  fr(ctx, sx, sy, TILE, TILE, c);
  ctx.globalAlpha = 1;
  fr(ctx, sx, sy + 6, TILE, TILE - 6, darken(c, 0.22));
  // caustic streaks
  for (let i = 0; i < 3; i++) {
    const yy = sy + 6 + i * 4;
    const off = Math.round(Math.sin(t * 1.6 + tx * 0.7 + i) * 3);
    ctx.globalAlpha = 0.25;
    fr(ctx, sx + 2 + off, yy, 5, 1, lighten(c, 0.6));
    ctx.globalAlpha = 1;
  }
  if (surface) {
    for (let i = 0; i < TILE; i++) {
      const wx = tx * TILE + i;
      const wy = Math.round(Math.sin(wx * 0.28 + t * 2.6) * 1.4 + Math.sin(wx * 0.11 - t * 1.7) * 1.1);
      fr(ctx, sx + i, sy + 2 + wy, 1, 2, lighten(c, 0.55));
      fr(ctx, sx + i, sy + 4 + wy, 1, 1, lighten(c, 0.25));
      if ((i + Math.floor(t * 6)) % 7 === 0) fr(ctx, sx + i, sy + 1 + wy, 1, 1, '#ffffff');
    }
  }
}

function drawOneWay(ctx, sx, sy, th) {
  const p = th.platform;
  fr(ctx, sx, sy, TILE, 4, p);
  fr(ctx, sx, sy, TILE, 1, lighten(p, 0.45));
  fr(ctx, sx, sy + 3, TILE, 1, darken(p, 0.42));
  // support nubs
  fr(ctx, sx + 2, sy + 4, 2, 2, darken(p, 0.3));
  fr(ctx, sx + 12, sy + 4, 2, 2, darken(p, 0.3));
  fr(ctx, sx + 7, sy + 1, 2, 1, lighten(p, 0.7));
}

function drawTiles(ctx, level, th, key, camX, camY, t) {
  const rows = level.rows;
  if (!rows || !rows.length) return;
  const h = rows.length;
  const wTiles = rows[0].length;
  const tx0 = Math.max(0, Math.floor(camX / TILE));
  const tx1 = Math.min(wTiles - 1, Math.floor((camX + VIEW_W) / TILE));
  const ty0 = Math.max(0, Math.floor(camY / TILE));
  const ty1 = Math.min(h - 1, Math.floor((camY + VIEW_H) / TILE));

  for (let ty = ty0; ty <= ty1; ty++) {
    const sy = ty * TILE - camY;
    for (let tx = tx0; tx <= tx1; tx++) {
      const ch = charAt(rows, tx, ty);
      if (ch === '.' || ch === 'o' || ch === '*' || ch === 'E' || ch === 'F' ||
        ch === 'H' || ch === 'V' || ch === 'N' || ch === 'C' || ch === 'P' ||
        ch === 'G' || ch === 'B') continue;
      const sx = tx * TILE - camX;
      if (ch === '#') {
        drawBlock(ctx, sx, sy, tx, ty, th, key,
          solidChar(charAt(rows, tx, ty - 1)),
          solidChar(charAt(rows, tx, ty + 1)),
          solidChar(charAt(rows, tx - 1, ty)),
          solidChar(charAt(rows, tx + 1, ty)));
      } else if (ch === '?') {
        drawInfoBlock(ctx, sx, sy, th, t, tx);
      } else if (ch === '=') {
        drawOneWay(ctx, sx, sy, th);
      } else if (ch === '^') {
        drawSpikes(ctx, sx, sy, th, solidChar(charAt(rows, tx, ty - 1)) && !solidChar(charAt(rows, tx, ty + 1)));
      } else if (ch === '~') {
        drawPool(ctx, sx, sy, tx, th, t, charAt(rows, tx, ty - 1) !== '~');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

function each(list, fn) {
  if (!list) return;
  if (typeof list.length !== 'number') return;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e && typeof e === 'object') fn(e, i);
  }
}

function gone(e) {
  return !!(e.dead || e.taken || e.collected || e.picked || e.removed || e.alive === false);
}

function bx(e, dw) {
  return num(e.x, 0) + num(e.w, dw) / 2;
}

function by(e, dh) {
  return num(e.y, 0) + num(e.h, dh) / 2;
}

function isArtifact(c) {
  return c.kind === 'artifact' || c.type === 'artifact' || c.big === true ||
    c.ch === '*' || c.char === '*' || num(c.value, 1) >= 5;
}

function isFlyer(e) {
  const k = e.kind || e.type || e.ch || e.char || '';
  return k === 'flyer' || k === 'F' || e.fly === true;
}

function drawMovingPlatform(ctx, sx, sy, w, h, th, t) {
  const p = th.platform;
  fr(ctx, sx - 1, sy - 1, w + 2, h + 2, darken(p, 0.65));
  fr(ctx, sx, sy, w, h, p);
  fr(ctx, sx, sy, w, 1, lighten(p, 0.5));
  fr(ctx, sx, sy + h - 2, w, 2, darken(p, 0.4));
  for (let i = 3; i < w - 2; i += 8) {
    fr(ctx, sx + i, sy + 2, 2, 2, darken(p, 0.3));
    fr(ctx, sx + i, sy + 2, 1, 1, lighten(p, 0.6));
  }
  // running lights along the underside
  const k = Math.floor(t * 6) % 3;
  for (let i = 2; i < w - 2; i += 6) {
    fr(ctx, sx + i, sy + h, 2, 1, (Math.floor(i / 6) + k) % 3 === 0 ? th.accent : darken(p, 0.5));
  }
}

function drawTicket(ctx, sx, sy, t, i) {
  const f = Math.floor(t * 8 + i) % 4;
  const w = f === 1 || f === 3 ? 4 : 7;
  fr(ctx, sx - 1 + (7 - w) / 2, sy - 1, w + 2, 8, '#1a1024');
  fr(ctx, sx + (7 - w) / 2, sy, w, 6, '#f2f4fa');
  fr(ctx, sx + (7 - w) / 2, sy, w, 2, '#ff6b81');
  if (w > 4) fr(ctx, sx + 1, sy + 3, 3, 1, '#6d7690');
}

function drawEntities(ctx, game, th, camX, camY, t) {
  const ents = game.entities || {};

  // moving platforms first — the player and enemies ride on top of them
  each(ents.platforms, (p, i) => {
    const w = Math.round(num(p.w, TILE * 2));
    const h = Math.round(num(p.h, 8));
    const sx = Math.round(num(p.x, 0) - camX);
    const sy = Math.round(num(p.y, 0) - camY);
    if (sx + w < -16 || sx > VIEW_W + 16) return;
    ctx.save();
    drawMovingPlatform(ctx, sx, sy, w, h, th, t + i * 0.3);
    ctx.restore();
  });

  each(ents.checkpoints, (c, i) => {
    const sx = Math.round(bx(c, TILE) - 6 - camX);
    const sy = Math.round(num(c.y, 0) + num(c.h, TILE * 2) - 28 - camY);
    if (sx < -32 || sx > VIEW_W + 32) return;
    const active = !!(c.active || c.taken || c.reached || c.on);
    drawCheckpoint(ctx, sx, sy, active, t + i * 0.4);
  });

  const door = ents.door;
  if (door && typeof door === 'object') {
    const sx = Math.round(bx(door, TILE) - 12 - camX);
    const sy = Math.round(num(door.y, 0) + num(door.h, TILE * 2) - 32 - camY);
    if (sx > -48 && sx < VIEW_W + 48) {
      const open = !!(door.open || door.unlocked || game.doorOpen ||
        (game.coins !== undefined && door.forceOpen));
      drawDoor(ctx, sx, sy, t, open);
    }
  }

  each(ents.npcs, (n, i) => {
    if (n.hidden) return;
    const sx = Math.round(bx(n, 12) - 6 - camX);
    const sy = Math.round(num(n.y, 0) + num(n.h, 18) - 18 - camY);
    if (sx < -32 || sx > VIEW_W + 32) return;
    drawNpc(ctx, sx, sy, t + i * 0.6, num(n.kind, i));
  });

  each(ents.coins, (c, i) => {
    if (gone(c)) return;
    const art = isArtifact(c);
    const size = art ? 16 : 12;
    const sx = Math.round(bx(c, art ? TILE : 8) - size / 2 - camX);
    const sy = Math.round(by(c, art ? TILE : 8) - size / 2 - camY);
    if (sx < -24 || sx > VIEW_W + 24) return;
    if (art) drawArtifact(ctx, sx, sy, t + i * 0.2);
    else drawCoin(ctx, sx, sy, t + i * 0.35);
  });

  each(ents.enemies, (e, i) => {
    // entities.js keeps stomped enemies in the list with alive:false + deadT,
    // so play a short sink-and-fade rather than popping them out.
    const dying = e.alive === false || e.dead === true;
    const dt2 = num(e.deadT, 0);
    const k = dying ? Math.min(1, dt2 / 0.28) : 0;
    if (dying && k >= 1) return;
    if (!dying && gone(e)) return;
    const fly = isFlyer(e);
    const sw = 14;
    const sh = fly ? 12 : 14;
    const sink = Math.round(k * 7);
    const sx = Math.round(bx(e, fly ? 12 : 14) - sw / 2 - camX);
    const sy = Math.round(num(e.y, 0) + num(e.h, sh) - sh - camY) + sink;
    if (sx < -32 || sx > VIEW_W + 32) return;
    ctx.save();
    if (dying) ctx.globalAlpha = 1 - k;
    else if (e.flash) ctx.globalAlpha = 0.8;
    if (fly) drawFlyer(ctx, sx, Math.round(by(e, 12) - 6 - camY) + sink, t + i * 0.5);
    else drawWalker(ctx, sx, sy, t + i * 0.4, num(e.facing, num(e.dir, num(e.vx, 1) < 0 ? -1 : 1)) < 0 ? -1 : 1);
    ctx.restore();
  });

  const boss = ents.boss;
  let bossProjectiles = null;
  if (boss && typeof boss === 'object' && boss.alive !== false && !boss.dead) {
    bossProjectiles = boss.projectiles || boss.tickets || boss.shots || null;
    const sx = Math.round(bx(boss, 40) - 20 - camX);
    const sy = Math.round(by(boss, 36) - 18 - camY);
    if (sx > -80 && sx < VIEW_W + 80) {
      drawBoss(ctx, sx, sy, t, num(boss.hp, 5), num(boss.maxHp, 5),
        !!(boss.flash || num(boss.hurtT, 0) > 0 || num(boss.invuln, 0) > 0));
    }
    each(bossProjectiles, (p, i) => {
      const psx = Math.round(bx(p, 6) - 3 - camX);
      const psy = Math.round(by(p, 6) - 3 - camY);
      if (psx < -16 || psx > VIEW_W + 16) return;
      ctx.save();
      drawTicket(ctx, psx, psy, t, i);
      ctx.restore();
    });
  }

  // entities.js aliases ents.projectiles to boss.projectiles, so drawing both
  // unconditionally paints every ticket twice (doubled alpha, doubled cost).
  const loose = ents.projectiles || game.projectiles;
  each(loose && loose === bossProjectiles ? null : loose, (p, i) => {
    const psx = Math.round(bx(p, 6) - 3 - camX);
    const psy = Math.round(by(p, 6) - 3 - camY);
    if (psx < -16 || psx > VIEW_W + 16) return;
    ctx.save();
    drawTicket(ctx, psx, psy, t, i);
    ctx.restore();
  });
}

function drawParticles(ctx, game, th, camX, camY) {
  const list = game.particles;
  if (!list || typeof list.length !== 'number') return;
  ctx.save();
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p || typeof p !== 'object') continue;
    const life = num(p.life, num(p.t, 1));
    const max = num(p.maxLife, num(p.life0, num(p.ttl, num(p.max, 0))));
    let a = 1;
    if (max > 0) a = Math.max(0, Math.min(1, life / max));
    else if (life < 1) a = Math.max(0, Math.min(1, life));
    if (a <= 0) continue;
    const s = Math.max(1, Math.round(num(p.size, num(p.r, 2))));
    const sx = Math.round(num(p.x, 0) - camX);
    const sy = Math.round(num(p.y, 0) - camY);
    if (sx < -8 || sx > VIEW_W + 8 || sy < -8 || sy > VIEW_H + 8) continue;
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color || p.c || th.particle;
    ctx.fillRect(sx, sy, s, s);
    if (s > 2 && a > 0.6) {
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx, sy, 1, 1);
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Vignette
// ---------------------------------------------------------------------------

const vigCache = { ctx: null, grad: null };

function drawVignette(ctx) {
  if (vigCache.ctx !== ctx || !vigCache.grad) {
    const g = ctx.createRadialGradient(
      VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.32,
      VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.95
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.65, 'rgba(0,0,0,0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0.42)');
    vigCache.ctx = ctx;
    vigCache.grad = g;
  }
  ctx.save();
  ctx.fillStyle = vigCache.grad;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, 0, VIEW_W, 1);
  ctx.fillRect(0, VIEW_H - 1, VIEW_W, 1);
  ctx.fillRect(0, 0, 1, VIEW_H);
  ctx.fillRect(VIEW_W - 1, 0, 1, VIEW_H);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function renderWorld(ctx, game, cam, alpha) {
  if (!ctx) return;
  const g = game || {};
  const level = g.level || null;
  const key = (level && THEMES[level.theme] ? level.theme : 'bristol');
  const th = THEMES[key];
  const t = clock();

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  drawSky(ctx, key, th);

  if (!level || !level.rows || !level.rows.length) {
    drawVignette(ctx);
    ctx.restore();
    return;
  }

  const c = cam || {};
  // camera.js already bakes its (deterministic) shake offset into cam.x/cam.y,
  // so re-applying it here would double the magnitude. Only shake when the
  // caller hands us a raw camera that has not been through updateCamera().
  const baked = typeof c.baseX === 'number';
  const shakeAmt = baked ? 0 : Math.max(0, num(c.shake, 0));
  const sx0 = shakeAmt > 0 ? Math.round((Math.random() * 2 - 1) * shakeAmt) : 0;
  const sy0 = shakeAmt > 0 ? Math.round((Math.random() * 2 - 1) * shakeAmt) : 0;
  const camX = Math.round(num(c.x, 0)) + sx0;
  const camY = Math.round(num(c.y, 0)) + sy0;

  const oy = -camY * 0.16;
  drawSkyFeature(ctx, key, th, camX, oy, t);

  // three parallax layers, back to front
  blitLayer(ctx, getLayer(key, 0), camX * FACTORS[0] - t * 2.5, oy * 0.5, LIGHT_COLORS[key], t, false);
  blitLayer(ctx, getLayer(key, 1), camX * FACTORS[1], oy * 0.75, LIGHT_COLORS[key], t, key === 'fintech' || key === 'salon');
  drawAmbient(ctx, key, th, camX, camY, t, false);
  blitLayer(ctx, getLayer(key, 2), camX * FACTORS[2], oy, LIGHT_COLORS[key], t, key === 'fintech' || key === 'salon' || key === 'kl');

  // a soft haze band so the terrain separates from the backdrop
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = th.sky[1];
  ctx.fillRect(0, Math.round(150 + oy), VIEW_W, 60);
  ctx.restore();

  drawTiles(ctx, level, th, key, camX, camY, t);
  drawEntities(ctx, g, th, camX, camY, t);
  drawParticles(ctx, g, th, camX, camY);
  drawAmbient(ctx, key, th, camX, camY, t, true);

  // companion drone, if the ability is owned
  const comp = g.companion || (g.entities && g.entities.companion) ||
    (g.player && g.player.companion) || null;
  if (comp && typeof comp === 'object' && (!g.abilities || g.abilities.companion !== false)) {
    // player.js gives the drone a bare {x,y,vx,vy,t} — treat that point as its centre
    const cw = num(comp.w, 0);
    const chh = num(comp.h, 0);
    const csx = Math.round(num(comp.x, 0) + cw / 2 - 5 - camX);
    const csy = Math.round(num(comp.y, 0) + chh / 2 - 5 - camY);
    if (csx > -24 && csx < VIEW_W + 24) drawCompanion(ctx, csx, csy, num(comp.t, t));
  }

  // player
  const p = g.player;
  if (p && typeof p === 'object') {
    const a = Math.max(0, Math.min(1, num(alpha, 0)));
    const ix = num(p.px, num(p.x, 0)) + (num(p.x, 0) - num(p.px, num(p.x, 0))) * a;
    const iy = num(p.py, num(p.y, 0)) + (num(p.y, 0) - num(p.py, num(p.y, 0))) * a;
    const psx = Math.round(ix - camX);
    const psy = Math.round(iy - camY);
    const inv = num(p.invuln, 0);
    const flick = inv > 0 && Math.floor(t * 20) % 2 === 0;
    // contact shadow
    if (!p.dead) {
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = '#000000';
      ctx.fillRect(psx, psy + num(p.h, 14) - 1, num(p.w, 10), 2);
      ctx.restore();
    }
    if (!flick) {
      drawPlayer(ctx, psx, psy, {
        facing: num(p.facing, 1) < 0 ? -1 : 1,
        anim: p.dead ? 'hurt' : (p.anim || 'idle'),
        t: num(p.animT, t),
      });
    }
  }

  drawVignette(ctx);
  ctx.restore();
}
