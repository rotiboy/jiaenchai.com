// src/game/ui.js
// HUD, screens and all in-canvas typography for "Career Quest".
//
// Every pixel of text on the canvas goes through drawText() and the 5x7 bitmap
// font in ./font.js. The canvas text API is never used — every character is
// composed from filled 1px rects so the pixel grid stays perfectly crisp.
//
// This module only ever touches the 2D context handed to it — no window,
// document, Image or Audio references — so it imports cleanly in bare Node.

import { VIEW_W, VIEW_H } from '../engine/constants.js';
import { GLYPH_W, GLYPH_H, glyphFor } from './font.js';

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ */

const INK = '#eef2fb';
const SOFT = '#a9b7d2';
const DIM = '#6d7c9c';
const FAINT = '#48557a';
const GOLD = '#ffcb47';
const GOLD_DK = '#b8801c';
const TEAL = '#63e0cf';
const ROSE = '#ff5f7e';
const ROSE_DK = '#4a3350';
const PANEL_FILL = 'rgba(9,13,24,0.93)';
const PANEL_LINE = '#37456b';
const SHADOW = 'rgba(0,0,0,0.7)';

/** Pause menu rows, in order. Exported so the integration layer can bind them. */
export const PAUSE_ITEMS = ['RESUME', 'RESTART CHAPTER', 'CHAPTER SELECT', 'SOUND', 'QUIT TO TITLE'];

/** Verbatim profile summary (CONTRACT §7), shown on the ending card. */
const PROFILE =
  'Senior Product Manager with 9 years across fintech, retail tech and digital ' +
  'transformation. Currently holds a full product function solo — PM, design, delivery ' +
  'mgmt. and analytics for a four-interface SaaS platform serving the Japanese beauty ' +
  "market. Builds AI-native product operations that multiply the team's output and " +
  'merges production code alongside the specs. Background spans cross-system solution ' +
  'design, third-party integrations, and onboarding, billing and compliance initiatives ' +
  'for 18,000+ merchants in SEA.';

const CONTACT = 'Kuala Lumpur, Malaysia · jiaenchai@gmail.com';

/* ------------------------------------------------------------------ *
 * Small utilities
 * ------------------------------------------------------------------ */

function num(v, d) {
  return typeof v === 'number' && isFinite(v) ? v : d;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function ease(p) {
  const t = clamp(p, 0, 1);
  return 1 - (1 - t) * (1 - t) * (1 - t);
}

function charCount(s) {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

function pad2(n) {
  const v = Math.max(0, Math.floor(n));
  return v < 10 ? '0' + v : String(v);
}

function firstNum(obj, keys, def) {
  if (!obj) return def;
  for (let i = 0; i < keys.length; i++) {
    const v = obj[keys[i]];
    if (typeof v === 'number' && isFinite(v)) return v;
  }
  return def;
}

function firstBool(obj, keys) {
  if (!obj) return false;
  for (let i = 0; i < keys.length; i++) {
    const v = obj[keys[i]];
    if (typeof v === 'boolean') return v;
  }
  return false;
}

/** mm:ss.d from milliseconds. */
export function formatTime(ms) {
  const total = Math.max(0, num(ms, 0)) / 1000;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const d = Math.floor((total * 10) % 10);
  return pad2(m) + ':' + pad2(s) + '.' + d;
}

/** mm:ss for long aggregate durations (hours roll into minutes). */
function formatTimeShort(ms) {
  const total = Math.max(0, num(ms, 0)) / 1000;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return pad2(m) + ':' + pad2(s);
}

/** "PROLOGUE" for index 0, otherwise "CHAPTER 03". */
function chapterLabel(level) {
  const i = Math.max(0, num(level && level.index, 0));
  return i === 0 ? 'PROLOGUE' : 'CHAPTER ' + pad2(i);
}

/** Width in device pixels of a single line at a given scale. */
function textWidth(str, scale, letterSpacing) {
  const sp = num(letterSpacing, 1);
  const n = charCount(str === null || str === undefined ? '' : String(str));
  if (n === 0) return 0;
  return n * (GLYPH_W + sp) * scale - sp * scale;
}

function blink(t, period, duty) {
  const p = num(period, 1);
  const d = num(duty, 0.62);
  return (num(t, 0) % p) / p < d;
}

/* ------------------------------------------------------------------ *
 * Primitive drawing
 * ------------------------------------------------------------------ */

/** Blit one line of glyphs. Caller sets ctx.fillStyle. */
function blitLine(ctx, line, x, y, scale, adv) {
  let px = x;
  for (const ch of line) {
    if (ch !== ' ') {
      const g = glyphFor(ch);
      for (let r = 0; r < GLYPH_H; r++) {
        const row = g[r];
        if (!row) continue;
        let c = 0;
        while (c < GLYPH_W) {
          if (row.charCodeAt(c) === 35 /* '#' */) {
            let e = c;
            while (e + 1 < GLYPH_W && row.charCodeAt(e + 1) === 35) e++;
            ctx.fillRect(px + c * scale, y + r * scale, (e - c + 1) * scale, scale);
            c = e + 1;
          } else {
            c++;
          }
        }
      }
    }
    px += adv;
  }
}

/** Draw a small pixel-art sprite from an array of '#'/'.' rows. */
function drawPixels(ctx, rows, x, y, scale, color) {
  ctx.fillStyle = color;
  const s = Math.max(1, Math.round(num(scale, 1)));
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let c = 0;
    while (c < row.length) {
      if (row.charCodeAt(c) === 35) {
        let e = c;
        while (e + 1 < row.length && row.charCodeAt(e + 1) === 35) e++;
        ctx.fillRect(x + c * s, y + r * s, (e - c + 1) * s, s);
        c = e + 1;
      } else {
        c++;
      }
    }
  }
}

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** Full-screen dim. */
function scrim(ctx, alpha) {
  ctx.fillStyle = 'rgba(3,5,12,' + clamp(num(alpha, 0.6), 0, 1).toFixed(3) + ')';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

/** Corner-notched panel with a 1px border — the house UI frame. */
function panel(ctx, x, y, w, h, o) {
  const opt = o || {};
  const fill = opt.fill || PANEL_FILL;
  const line = opt.border || PANEL_LINE;
  const X = Math.round(x);
  const Y = Math.round(y);
  const W = Math.round(w);
  const H = Math.round(h);

  ctx.fillStyle = fill;
  ctx.fillRect(X + 1, Y, W - 2, H);
  ctx.fillRect(X, Y + 1, W, H - 2);

  ctx.fillStyle = line;
  ctx.fillRect(X + 1, Y, W - 2, 1);
  ctx.fillRect(X + 1, Y + H - 1, W - 2, 1);
  ctx.fillRect(X, Y + 1, 1, H - 2);
  ctx.fillRect(X + W - 1, Y + 1, 1, H - 2);

  if (opt.accent) {
    ctx.fillStyle = opt.accent;
    ctx.fillRect(X + 1, Y + 1, 1, 1);
    ctx.fillRect(X + W - 2, Y + 1, 1, 1);
    ctx.fillRect(X + 1, Y + H - 2, 1, 1);
    ctx.fillRect(X + W - 2, Y + H - 2, 1, 1);
    ctx.fillRect(X + 6, Y, 10, 1);
    ctx.fillRect(X + W - 16, Y + H - 1, 10, 1);
  }
}

/** 1px rule with a soft fade at both ends. */
function rule(ctx, x, y, w, color) {
  const W = Math.round(w);
  ctx.fillStyle = color || PANEL_LINE;
  ctx.fillRect(Math.round(x) + 2, Math.round(y), W - 4, 1);
  ctx.globalAlpha = 0.45;
  ctx.fillRect(Math.round(x), Math.round(y), 2, 1);
  ctx.fillRect(Math.round(x) + W - 2, Math.round(y), 2, 1);
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ *
 * Sprites used by the UI layer
 * ------------------------------------------------------------------ */

const HEART_FULL = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
const HEART_EMPTY = ['.##.##.', '#..#..#', '#.....#', '.#...#.', '..#.#..', '...#...'];
const COIN = ['.###.', '##.##', '##.##', '##.##', '.###.'];
const STAR_S = ['..#..', '#####', '.###.', '#...#'];
const LOCK = ['..###..', '.#...#.', '.#...#.', '#######', '##.#.##', '##...##', '#######'];

/** Filled circle, plotted row by row so it stays on the pixel grid. */
function fillCircle(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)));
    ctx.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
  }
}

/* ------------------------------------------------------------------ *
 * Text API (CONTRACT §5)
 * ------------------------------------------------------------------ */

/**
 * Word-wrap a string to at most maxChars characters per line.
 * Explicit newlines are preserved. Over-long words are hard-split.
 * @param {string} str
 * @param {number} maxChars
 * @returns {string[]}
 */
export function wrapText(str, maxChars) {
  const text = str === null || str === undefined ? '' : String(str);
  const limit = Math.max(1, Math.floor(num(maxChars, 1)) || 1);
  const out = [];
  const paras = text.split('\n');

  for (let p = 0; p < paras.length; p++) {
    const words = paras[p].split(/\s+/);
    let line = '';
    for (let i = 0; i < words.length; i++) {
      let w = words[i];
      if (w === '') continue;
      while (w.length > limit) {
        if (line !== '') {
          out.push(line);
          line = '';
        }
        out.push(w.slice(0, limit));
        w = w.slice(limit);
      }
      if (line === '') line = w;
      else if (line.length + 1 + w.length <= limit) line += ' ' + w;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Draw text with the 5x7 bitmap font.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} str
 * @param {number} x anchor x (meaning depends on align)
 * @param {number} y top of the first line
 * @param {object} [opts] {color, align:'left'|'center'|'right', scale, shadow,
 *                         maxWidth, letterSpacing, lineHeight, alpha, maxLines}
 * @returns {{width:number,height:number,lines:number,lineHeight:number}}
 */
export function drawText(ctx, str, x, y, opts) {
  const o = opts || {};
  const scale = Math.max(1, Math.round(num(o.scale, 1)));
  const sp = num(o.letterSpacing, 1);
  const adv = (GLYPH_W + sp) * scale;
  const lead = Math.round(num(o.lineHeight, GLYPH_H + 2) * scale);
  const align = o.align || 'left';
  const text = str === null || str === undefined ? '' : String(str);

  let lines;
  const mw = num(o.maxWidth, 0);
  if (mw > 0) {
    lines = wrapText(text, Math.max(1, Math.floor((mw + sp * scale) / adv)));
  } else {
    lines = text.indexOf('\n') >= 0 ? text.split('\n') : [text];
  }
  const maxLines = num(o.maxLines, 0);
  if (maxLines > 0 && lines.length > maxLines) lines = lines.slice(0, maxLines);

  const widths = new Array(lines.length);
  let maxW = 0;
  for (let i = 0; i < lines.length; i++) {
    const n = charCount(lines[i]);
    const w = n === 0 ? 0 : n * adv - sp * scale;
    widths[i] = w;
    if (w > maxW) maxW = w;
  }

  const alpha = clamp(num(o.alpha, 1), 0, 1);
  const prevAlpha = ctx.globalAlpha;
  if (alpha !== 1) ctx.globalAlpha = prevAlpha * alpha;

  const color = o.color || INK;
  const sh = o.shadow;
  const shColor = typeof sh === 'string' ? sh : SHADOW;
  // shadowOffset is in device pixels; the default is one font pixel.
  const shOff = o.shadowOffset === undefined || o.shadowOffset === null
    ? scale
    : Math.max(1, Math.round(num(o.shadowOffset, 1)));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;
    const lx = Math.round(align === 'center' ? x - widths[i] / 2 : align === 'right' ? x - widths[i] : x);
    const ly = Math.round(y + i * lead);
    if (sh) {
      ctx.fillStyle = shColor;
      blitLine(ctx, line, lx + shOff, ly + shOff, scale, adv);
    }
    ctx.fillStyle = color;
    blitLine(ctx, line, lx, ly, scale, adv);
  }

  ctx.globalAlpha = prevAlpha;
  return {
    width: maxW,
    height: lines.length === 0 ? 0 : (lines.length - 1) * lead + GLYPH_H * scale,
    lines: lines.length,
    lineHeight: lead,
  };
}

/* ------------------------------------------------------------------ *
 * HUD
 * ------------------------------------------------------------------ */

const ABILITY_BADGES = [
  { key: 'dash', letter: 'D' },
  { key: 'doubleJump', letter: 'J' },
  { key: 'glide', letter: 'G' },
  { key: 'companion', letter: 'A' },
];

/**
 * Hearts, collectible counter, chapter chip and timer.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} game
 */
export function drawHud(ctx, game) {
  const g = game || {};
  const level = g.level || {};
  const maxHearts = clamp(Math.round(num(g.maxHearts, 3)), 1, 8);
  const hearts = clamp(Math.round(num(g.hearts, maxHearts)), 0, maxHearts);

  // Top scrim so the HUD stays legible over bright skies.
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = 'rgba(4,6,14,' + (0.4 * (1 - i / 26)).toFixed(3) + ')';
    ctx.fillRect(0, i, VIEW_W, 1);
  }

  // Hearts.
  let hx = 7;
  for (let i = 0; i < maxHearts; i++) {
    drawPixels(ctx, i < hearts ? HEART_FULL : HEART_EMPTY, hx, 6, 1, i < hearts ? ROSE : ROSE_DK);
    hx += 9;
  }
  const lives = num(g.lives, -1);
  if (lives >= 0) drawText(ctx, 'x' + Math.max(0, Math.floor(lives)), hx + 1, 6, { color: DIM });

  // Collectibles.
  const coins = Math.max(0, Math.floor(num(g.coins, 0)));
  const total = Math.max(0, Math.floor(num(g.coinsTotal, 0)));
  drawPixels(ctx, COIN, 7, 17, 1, GOLD);
  const cw = drawText(ctx, coins + '/' + total, 15, 17, { color: GOLD, shadow: true }).width;
  if (level.collectibleName) {
    drawText(ctx, String(level.collectibleName), 15 + cw + 5, 17, { color: DIM });
  }

  // Ability badges (only what has actually been earned).
  const ab = g.abilities || {};
  let bx = 7;
  const player = g.player || {};
  for (let i = 0; i < ABILITY_BADGES.length; i++) {
    const b = ABILITY_BADGES[i];
    if (!ab[b.key]) continue;
    const cooling = b.key === 'dash' && num(player.dashCd, 0) > 0;
    const col = cooling ? FAINT : TEAL;
    rect(ctx, bx, 27, 11, 9, cooling ? 'rgba(109,124,156,0.14)' : 'rgba(99,224,207,0.16)');
    drawText(ctx, b.letter, bx + 3, 28, { color: col });
    bx += 13;
  }

  // Chapter chip + timer, right aligned.
  const company = level.company ? String(level.company).toUpperCase() : '';
  const chip = chapterLabel(level) + (company ? '  ·  ' + company : '');
  drawText(ctx, chip, VIEW_W - 7, 6, { align: 'right', color: SOFT, shadow: true });
  drawText(ctx, formatTime(g.timeMs), VIEW_W - 7, 17, { align: 'right', color: GOLD, shadow: true });
}

/* ------------------------------------------------------------------ *
 * Title screen
 * ------------------------------------------------------------------ */

function mulberry32(a) {
  let s = a >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STARS = (function () {
  const rnd = mulberry32(0x51ce);
  const out = [];
  for (let i = 0; i < 90; i++) {
    out.push({
      x: rnd() * VIEW_W,
      y: rnd() * 178,
      big: rnd() > 0.86,
      phase: rnd() * 6.283,
      speed: 1.2 + rnd() * 3.4,
    });
  }
  return out;
})();

const SKYLINE = (function () {
  const rnd = mulberry32(0x2b17);
  const out = [];
  let x = -20;
  while (x < VIEW_W + 40) {
    const w = 12 + Math.floor(rnd() * 22);
    const h = 18 + Math.floor(rnd() * 58);
    out.push({ x, w, h, spire: rnd() > 0.78, lit: rnd() });
    x += w + 3 + Math.floor(rnd() * 7);
  }
  return out;
})();

function drawStarfield(ctx, t) {
  // Night sky, banded so it keeps the pixel look.
  const bands = 30;
  for (let i = 0; i < bands; i++) {
    const p = i / (bands - 1);
    const r = Math.round(9 + p * 30);
    const gg = Math.round(11 + p * 14);
    const b = Math.round(26 + p * 26);
    ctx.fillStyle = 'rgb(' + r + ',' + gg + ',' + b + ')';
    ctx.fillRect(0, Math.floor((i * VIEW_H) / bands), VIEW_W, Math.ceil(VIEW_H / bands));
  }

  // Stars.
  for (let i = 0; i < STARS.length; i++) {
    const s = STARS[i];
    const tw = 0.55 + 0.45 * Math.sin(t * 1.7 + s.phase);
    const x = (s.x - t * s.speed) % VIEW_W;
    const px = Math.round(x < 0 ? x + VIEW_W : x);
    ctx.fillStyle = 'rgba(226,236,255,' + (tw * (s.big ? 0.95 : 0.6)).toFixed(3) + ')';
    ctx.fillRect(px, Math.round(s.y), 1, 1);
    if (s.big && tw > 0.85) {
      ctx.fillRect(px - 1, Math.round(s.y), 1, 1);
      ctx.fillRect(px + 1, Math.round(s.y), 1, 1);
      ctx.fillRect(px, Math.round(s.y) - 1, 1, 1);
      ctx.fillRect(px, Math.round(s.y) + 1, 1, 1);
    }
  }

  // Moon.
  fillCircle(ctx, 408, 40, 17, 'rgba(255,240,208,0.045)');
  fillCircle(ctx, 408, 40, 12, 'rgba(255,240,208,0.07)');
  drawPixels(
    ctx,
    ['..####..', '.######.', '########', '########', '########', '########', '.######.', '..####..'],
    400,
    32,
    2,
    '#f6ecc8'
  );
  drawPixels(ctx, ['.#.', '###', '.#.'], 408, 44, 2, '#ded2ad');
  drawPixels(ctx, ['##', '##'], 424, 56, 2, '#ded2ad');

  // Far hills.
  ctx.fillStyle = '#171f3a';
  for (let x = 0; x < VIEW_W; x += 2) {
    const h = 26 + Math.sin((x + t * 4) * 0.021) * 9 + Math.sin((x + t * 4) * 0.007) * 7;
    ctx.fillRect(x, VIEW_H - 96 - h, 2, h + 96);
  }

  // Mid skyline.
  const off = (t * 7) % 60;
  ctx.fillStyle = '#0e1530';
  for (let k = -1; k <= 1; k++) {
    for (let i = 0; i < SKYLINE.length; i++) {
      const b = SKYLINE[i];
      const bx = Math.round(b.x - off + k * (VIEW_W + 60));
      if (bx > VIEW_W || bx + b.w < 0) continue;
      const by = VIEW_H - 58 - b.h;
      ctx.fillStyle = '#0e1530';
      ctx.fillRect(bx, by, b.w, b.h + 58);
      if (b.spire) ctx.fillRect(bx + Math.floor(b.w / 2) - 1, by - 10, 2, 10);
      ctx.fillStyle = 'rgba(255,203,71,0.5)';
      for (let wy = by + 5; wy < VIEW_H - 60; wy += 6) {
        for (let wx = bx + 3; wx < bx + b.w - 3; wx += 5) {
          if (((wx * 7 + wy * 13 + i * 31) % 11) / 11 < 0.34 + b.lit * 0.2) ctx.fillRect(wx, wy, 1, 2);
        }
      }
    }
  }

  // Foreground ground band.
  ctx.fillStyle = '#070a16';
  ctx.fillRect(0, VIEW_H - 34, VIEW_W, 34);
  ctx.fillStyle = '#101838';
  ctx.fillRect(0, VIEW_H - 34, VIEW_W, 1);

  // Bottom scrim so the hint block stays readable over the skyline.
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = 'rgba(3,5,12,' + (0.72 * (i / 15)).toFixed(3) + ')';
    ctx.fillRect(0, 178 + i, VIEW_W, 1);
  }
  ctx.fillStyle = 'rgba(3,5,12,0.72)';
  ctx.fillRect(0, 194, VIEW_W, VIEW_H - 194);
}

/**
 * Title screen: name, subtitle, tagline, blinking start prompt, control hints.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} game
 * @param {number} t seconds since the title screen appeared
 */
export function drawTitle(ctx, game, t) {
  const g = game || {};
  const time = num(t, 0);
  drawStarfield(ctx, time);

  const intro = ease(clamp(time / 0.9, 0, 1));
  const cx = VIEW_W / 2;

  // Name.
  const nameY = 46 + (1 - intro) * 8;
  drawText(ctx, 'CHAI JIA EN', cx, nameY, {
    align: 'center',
    scale: 4,
    color: INK,
    letterSpacing: 1,
    shadow: 'rgba(0,0,0,0.75)',
    shadowOffset: 3,
    alpha: intro,
  });

  // Subtitle with flanking rules.
  const subY = 84;
  drawText(ctx, 'CAREER QUEST', cx, subY, {
    align: 'center',
    scale: 2,
    color: GOLD,
    letterSpacing: 3,
    shadow: true,
    alpha: intro,
  });
  const subW = textWidth('CAREER QUEST', 2, 3);
  ctx.globalAlpha = intro;
  rule(ctx, cx - subW / 2 - 42, subY + 6, 34, GOLD_DK);
  rule(ctx, cx + subW / 2 + 8, subY + 6, 34, GOLD_DK);
  ctx.globalAlpha = 1;

  // Tagline.
  const tagA = ease(clamp((time - 0.5) / 0.7, 0, 1));
  drawText(ctx, '9 years, 6 chapters, one product career.', cx, 106, {
    align: 'center',
    color: SOFT,
    shadow: true,
    alpha: tagA,
  });

  // Progress, if there is a save.
  const save = g.save || {};
  const maxLevel = Math.max(0, Math.floor(num(save.maxLevel, 0)));
  const levels = resolveLevels(g);
  if (maxLevel > 0) {
    const totalCh = levels.length || maxLevel + 1;
    drawText(ctx, 'PROGRESS  ' + pad2(Math.min(maxLevel + 1, totalCh)) + ' / ' + pad2(totalCh) + ' CHAPTERS', cx, 124, {
      align: 'center',
      color: TEAL,
      letterSpacing: 2,
      alpha: tagA,
    });
  }

  // Start prompt.
  const promptA = ease(clamp((time - 1.0) / 0.6, 0, 1));
  if (blink(time, 1.15, 0.66)) {
    const label = maxLevel > 0 ? 'PRESS ENTER TO CONTINUE' : 'PRESS ENTER TO START';
    const w = textWidth(label, 2, 2);
    ctx.globalAlpha = promptA;
    rect(ctx, cx - w / 2 - 9, 150, w + 18, 20, 'rgba(255,203,71,0.10)');
    ctx.globalAlpha = 1;
    drawText(ctx, label, cx, 155, {
      align: 'center',
      scale: 2,
      color: GOLD,
      letterSpacing: 2,
      shadow: true,
      alpha: promptA,
    });
  }

  // Control hints.
  const hintA = ease(clamp((time - 1.4) / 0.8, 0, 1));
  ctx.globalAlpha = hintA;
  rule(ctx, cx - 120, 191, 240, '#26314f');
  ctx.globalAlpha = 1;
  drawText(ctx, '← →  MOVE      ↑ / SPACE  JUMP      SHIFT  DASH', cx, 200, {
    align: 'center',
    color: SOFT,
    alpha: hintA,
  });
  drawText(ctx, 'E  TALK      ESC  PAUSE      M  MUTE', cx, 212, {
    align: 'center',
    color: SOFT,
    alpha: hintA,
  });

  drawText(ctx, 'A PLAYABLE CV  ·  JIAENCHAI.COM', cx, 234, {
    align: 'center',
    color: DIM,
    letterSpacing: 2,
    alpha: hintA,
  });
  drawText(ctx, 'SCROLL DOWN FOR THE FULL RESUME ↓', cx, 248, {
    align: 'center',
    color: FAINT,
    alpha: hintA,
  });
}

/* ------------------------------------------------------------------ *
 * Level intro card
 * ------------------------------------------------------------------ */

/** Fit a company name into `inner` px: scale 3, then 2, then 2 over two lines. */
function companyBlock(company, inner) {
  if (textWidth(company, 3, 1) <= inner) return { scale: 3, lines: [company] };
  if (textWidth(company, 2, 1) <= inner) return { scale: 2, lines: [company] };
  const two = wrapText(company, Math.max(1, Math.floor((inner + 2) / 12)));
  if (two.length <= 2) return { scale: 2, lines: two };
  return { scale: 1, lines: wrapText(company, Math.max(1, Math.floor((inner + 1) / 6))).slice(0, 2) };
}

/**
 * Chapter card: chapter number, company, role, location, period, tagline.
 * Wipes in, holds, slides out — total life ~2.5s.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} level
 * @param {number} t seconds since the card appeared
 */
export function drawLevelIntro(ctx, level, t) {
  const lv = level || {};
  const time = clamp(num(t, 0), 0, 999);

  const IN = 0.34;
  const OUT_AT = 2.16;
  const OUT = 0.34;

  let openP = ease(clamp(time / IN, 0, 1));
  let alpha = 1;
  let slide = 0;
  if (time > OUT_AT) {
    const p = clamp((time - OUT_AT) / OUT, 0, 1);
    alpha = 1 - p;
    slide = -p * 14;
    openP = 1;
  }
  if (alpha <= 0.01) return;

  scrim(ctx, 0.55 * alpha);

  const W = 348;
  const H = 150;
  const cx = VIEW_W / 2;
  const y = Math.round((VIEW_H - H) / 2 + slide);
  const w = Math.max(4, Math.round(W * openP));
  const x = Math.round(cx - w / 2);

  const prev = ctx.globalAlpha;
  ctx.globalAlpha = alpha;

  panel(ctx, x, y, w, H, { accent: GOLD_DK });
  // Gold spine on the left edge.
  rect(ctx, x + 1, y + 1, 2, H - 2, GOLD);

  if (openP < 0.98) {
    ctx.globalAlpha = prev;
    return;
  }

  const px = x + 16;
  const inner = W - 32;
  const rev = (delay) => ease(clamp((time - delay) / 0.28, 0, 1));

  // Chapter eyebrow.
  drawText(ctx, chapterLabel(lv), px, y + 15, {
    color: GOLD,
    letterSpacing: 3,
    alpha: alpha * rev(0.3),
  });
  if (lv.unlockLabel) {
    drawText(ctx, 'NEW ABILITY AHEAD', x + W - 16, y + 15, {
      align: 'right',
      color: FAINT,
      letterSpacing: 1,
      alpha: alpha * rev(0.3),
    });
  }

  // Company — as large as it can be, wrapping to two lines before shrinking.
  const company = String(lv.company || 'UNKNOWN').toUpperCase();
  const block = companyBlock(company, inner);
  const blockLead = GLYPH_H * block.scale + 2;
  for (let i = 0; i < block.lines.length; i++) {
    drawText(ctx, block.lines[i], px, y + 30 + i * blockLead, {
      scale: block.scale,
      color: INK,
      shadow: true,
      alpha: alpha * rev(0.42 + i * 0.06),
    });
  }

  const afterCompany = y + 30 + (block.lines.length - 1) * blockLead + GLYPH_H * block.scale + 7;

  // Role.
  drawText(ctx, String(lv.role || ''), px, afterCompany, {
    scale: 1,
    color: TEAL,
    letterSpacing: 1,
    alpha: alpha * rev(0.54),
    maxWidth: inner,
    maxLines: 1,
  });

  // Location · period.
  const meta = [lv.location, lv.period].filter(Boolean).join('   ·   ');
  drawText(ctx, meta, px, afterCompany + 12, {
    color: DIM,
    alpha: alpha * rev(0.62),
    maxWidth: inner,
    maxLines: 1,
  });

  ctx.globalAlpha = alpha * rev(0.7);
  rule(ctx, px, afterCompany + 26, inner, PANEL_LINE);
  ctx.globalAlpha = alpha;

  // Tagline.
  drawText(ctx, String(lv.tagline || ''), px, afterCompany + 34, {
    color: SOFT,
    maxWidth: inner,
    lineHeight: 9,
    maxLines: 3,
    alpha: alpha * rev(0.78),
  });

  // Footer.
  if (lv.collectibleName) {
    drawPixels(ctx, COIN, px, y + H - 15, 1, GOLD);
    drawText(ctx, 'COLLECT  ' + String(lv.collectibleName).toUpperCase(), px + 8, y + H - 15, {
      color: GOLD_DK,
      letterSpacing: 1,
      alpha: alpha * rev(0.86),
    });
  }

  ctx.globalAlpha = prev;
}

/* ------------------------------------------------------------------ *
 * Level complete card
 * ------------------------------------------------------------------ */

const LC_PAD = 16;
const LC_X = 12;
const LC_Y = 8;
const LC_W = VIEW_W - LC_X * 2;
const LC_H = VIEW_H - LC_Y * 2;
const LC_BULLET_INDENT = 11;
const LC_BODY_TOP = LC_Y + 84;
const LC_BODY_BOTTOM = LC_Y + LC_H - 20;
const LC_ROW_H = 9;
const LC_GAP_H = 5;

function bulletMaxChars() {
  const w = LC_W - LC_PAD * 2 - LC_BULLET_INDENT;
  return Math.max(8, Math.floor((w + 1) / 6));
}

function buildBulletRows(bullets) {
  const maxChars = bulletMaxChars();
  const rows = [];
  const list = Array.isArray(bullets) ? bullets : [];
  for (let i = 0; i < list.length; i++) {
    const lines = wrapText(String(list[i]), maxChars);
    for (let j = 0; j < lines.length; j++) rows.push({ text: lines[j], first: j === 0 });
    if (i < list.length - 1) rows.push({ gap: true });
  }
  return rows;
}

function paginateRows(rows, pageH) {
  const pages = [];
  let cur = [];
  let h = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rh = r.gap ? LC_GAP_H : LC_ROW_H;
    if (h + rh > pageH && cur.length) {
      pages.push(cur);
      cur = [];
      h = 0;
      if (r.gap) continue;
    }
    if (!cur.length && r.gap) continue;
    cur.push(r);
    h += rh;
  }
  if (cur.length) pages.push(cur);
  return pages.length ? pages : [[]];
}

/**
 * How many pages the completion card needs for this level's bullets.
 * The integration layer uses this to clamp `game.completePage`.
 * @param {object} game
 * @returns {number}
 */
export function levelCompletePageCount(game) {
  const level = (game && game.level) || {};
  return paginateRows(buildBulletRows(level.bullets), LC_BODY_BOTTOM - LC_BODY_TOP).length;
}

// Per-page reveal clock (reset whenever the page changes).
let _lcPage = -1;
let _lcT0 = 0;

/**
 * Completion card: stats row plus the verbatim résumé bullets, revealed line
 * by line and paginated when they do not fit.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} game
 * @param {number} t seconds since the card appeared
 */
export function drawLevelComplete(ctx, game, t) {
  const g = game || {};
  const level = g.level || {};
  const time = Math.max(0, num(t, 0));

  const rows = buildBulletRows(level.bullets);
  const pages = paginateRows(rows, LC_BODY_BOTTOM - LC_BODY_TOP);
  const wanted = Math.floor(firstNum(g, ['completePage', 'resultPage', 'page', 'uiPage'], 0));
  const page = clamp(wanted, 0, pages.length - 1);

  if (page !== _lcPage || time < _lcT0) {
    _lcPage = page;
    _lcT0 = time;
  }
  const pt = Math.max(0, time - _lcT0);

  scrim(ctx, 0.72);
  panel(ctx, LC_X, LC_Y, LC_W, LC_H, { accent: GOLD_DK });

  const left = LC_X + LC_PAD;
  const right = LC_X + LC_W - LC_PAD;
  const inner = LC_W - LC_PAD * 2;
  const cx = VIEW_W / 2;

  // Header.
  const headA = ease(clamp(time / 0.3, 0, 1));
  drawText(ctx, 'CHAPTER COMPLETE', cx, LC_Y + 12, {
    align: 'center',
    scale: 2,
    color: GOLD,
    letterSpacing: 3,
    shadow: true,
    alpha: headA,
  });
  const sub = [level.company, level.role].filter(Boolean).join('  ·  ');
  drawText(ctx, sub, cx, LC_Y + 30, { align: 'center', color: DIM, alpha: headA, maxWidth: inner, maxLines: 1 });

  ctx.globalAlpha = headA;
  rule(ctx, left, LC_Y + 43, inner, PANEL_LINE);
  ctx.globalAlpha = 1;

  // Stats row: three cells.
  const statA = ease(clamp((time - 0.18) / 0.35, 0, 1));
  const colW = Math.floor(inner / 3);
  const coins = Math.max(0, Math.floor(num(g.coins, 0)));
  const total = Math.max(0, Math.floor(num(g.coinsTotal, 0)));
  const cName = String(level.collectibleName || 'COLLECTED').toUpperCase();

  const c0 = left;
  const c1 = left + colW;
  const c2 = left + colW * 2;

  drawText(ctx, cName, c0, LC_Y + 50, { color: DIM, letterSpacing: 1, alpha: statA, maxWidth: colW - 8, maxLines: 1 });
  drawText(ctx, coins + '/' + total, c0, LC_Y + 60, { scale: 2, color: GOLD, alpha: statA, shadow: true });

  drawText(ctx, 'TIME', c1, LC_Y + 50, { color: DIM, letterSpacing: 1, alpha: statA });
  drawText(ctx, formatTime(g.timeMs), c1, LC_Y + 60, { scale: 2, color: INK, alpha: statA, shadow: true });

  drawText(ctx, 'HEARTS LEFT', c2, LC_Y + 50, { color: DIM, letterSpacing: 1, alpha: statA });
  const maxHearts = clamp(Math.round(num(g.maxHearts, 3)), 1, 8);
  const hearts = clamp(Math.round(num(g.hearts, maxHearts)), 0, maxHearts);
  const prevA = ctx.globalAlpha;
  ctx.globalAlpha = statA;
  for (let i = 0; i < maxHearts; i++) {
    drawPixels(ctx, i < hearts ? HEART_FULL : HEART_EMPTY, c2 + i * 16, LC_Y + 61, 2, i < hearts ? ROSE : ROSE_DK);
  }
  ctx.globalAlpha = prevA;

  ctx.globalAlpha = statA;
  rule(ctx, left, LC_Y + 78, inner, PANEL_LINE);
  ctx.globalAlpha = 1;

  // Bullets.
  const rowsOnPage = pages[page];
  const revealStart = 0.34;
  const revealStep = 0.055;

  // Short chapters get their notes nudged into optical centre so the card never
  // looks bottom-empty.
  let usedH = 0;
  for (let i = 0; i < rowsOnPage.length; i++) usedH += rowsOnPage[i].gap ? LC_GAP_H : LC_ROW_H;
  const slack = Math.max(0, LC_BODY_BOTTOM - LC_BODY_TOP - usedH);

  let y = LC_BODY_TOP + Math.floor(slack * 0.32);
  let shown = 0;

  if (!rowsOnPage.length) {
    drawText(ctx, 'No notes for this chapter.', cx, LC_BODY_TOP + 10, { align: 'center', color: DIM });
  }

  for (let i = 0; i < rowsOnPage.length; i++) {
    const r = rowsOnPage[i];
    if (r.gap) {
      y += LC_GAP_H;
      continue;
    }
    const a = ease(clamp((pt - (revealStart + shown * revealStep)) / 0.16, 0, 1));
    shown++;
    if (a > 0.02) {
      if (r.first) {
        const prevAA = ctx.globalAlpha;
        ctx.globalAlpha = a;
        drawPixels(ctx, ['#...', '##..', '###.', '####', '###.', '##..', '#...'], left + 1, y, 1, GOLD);
        ctx.globalAlpha = prevAA;
      }
      drawText(ctx, r.text, left + LC_BULLET_INDENT, y, {
        color: r.first ? INK : SOFT,
        alpha: a,
        lineHeight: LC_ROW_H,
      });
    }
    y += LC_ROW_H;
  }

  // Footer.
  const allShown = pt > revealStart + shown * revealStep + 0.16;
  const more = page < pages.length - 1;
  if (pages.length > 1) {
    drawText(ctx, 'PAGE ' + (page + 1) + ' / ' + pages.length, left, LC_Y + LC_H - 13, {
      color: FAINT,
      letterSpacing: 1,
    });
  }
  if (allShown && blink(time, 1.05, 0.68)) {
    drawText(ctx, more ? 'PRESS ENTER FOR MORE ▼' : 'PRESS ENTER TO CONTINUE ▶', right, LC_Y + LC_H - 13, {
      align: 'right',
      color: GOLD,
      letterSpacing: 1,
    });
  }
}

/* ------------------------------------------------------------------ *
 * Dialogue
 * ------------------------------------------------------------------ */

const DLG_X = 14;
const DLG_W = VIEW_W - DLG_X * 2;
const DLG_H = 62;
const DLG_Y = VIEW_H - DLG_H - 10;
const DLG_CPS = 46; // characters per second

function initialsOf(name) {
  const parts = String(name || '')
    .split(/[\s\-/]+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  // Skip connectives ("Head of Engineering" → HE, not HO).
  const meaty = parts.filter((p) => p.length > 2);
  const pick = meaty.length >= 2 ? meaty : parts;
  return (pick[0][0] + pick[1][0]).toUpperCase();
}

/**
 * NPC speech box: speaker tab, initials plate, typewriter reveal, ▼ indicator.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} dialogue {name|speaker, lines[], index|line, text?, t?, done?}
 * @param {number} t seconds — used as the reveal clock if the dialogue object
 *                  does not carry its own timer
 */
export function drawDialogue(ctx, dialogue, t) {
  if (!dialogue) return;
  const d = typeof dialogue === 'string' ? { text: dialogue } : dialogue;
  const time = Math.max(0, num(t, 0));

  const name = d.name || d.speaker || d.who || '';
  const lines = Array.isArray(d.lines) ? d.lines : null;
  const idx = clamp(Math.floor(firstNum(d, ['index', 'line', 'lineIndex', 'i'], 0)), 0, lines ? Math.max(0, lines.length - 1) : 0);
  const raw = d.text !== undefined && d.text !== null ? String(d.text) : lines ? String(lines[idx] || '') : '';

  const typeT = firstNum(d, ['t', 'timer', 'lineT', 'charT'], time);
  const revealChars = firstNum(d, ['chars', 'reveal', 'shown'], -1);
  const total = charCount(raw);
  const shown = d.done === true ? total : revealChars >= 0 ? Math.floor(revealChars) : Math.floor(typeT * DLG_CPS);
  const visible = clamp(shown, 0, total);
  const complete = visible >= total;

  // Box.
  panel(ctx, DLG_X, DLG_Y, DLG_W, DLG_H, { accent: TEAL, fill: 'rgba(7,11,22,0.94)' });

  // Speaker tab.
  if (name) {
    const label = String(name).toUpperCase();
    const tw = textWidth(label, 1, 1) + 14;
    panel(ctx, DLG_X + 8, DLG_Y - 10, tw, 13, { fill: '#0c1226', border: TEAL });
    drawText(ctx, label, DLG_X + 15, DLG_Y - 7, { color: TEAL, letterSpacing: 1 });
  }

  // Initials plate.
  const plate = DLG_X + 9;
  rect(ctx, plate, DLG_Y + 13, 34, 34, 'rgba(99,224,207,0.10)');
  ctx.fillStyle = TEAL;
  ctx.fillRect(plate, DLG_Y + 13, 34, 1);
  ctx.fillRect(plate, DLG_Y + 46, 34, 1);
  ctx.fillRect(plate, DLG_Y + 13, 1, 34);
  ctx.fillRect(plate + 33, DLG_Y + 13, 1, 34);
  drawText(ctx, initialsOf(name), plate + 17, DLG_Y + 24, { align: 'center', scale: 2, color: TEAL });

  // Body text.
  const tx = plate + 44;
  const tw2 = DLG_X + DLG_W - 14 - tx;
  const wrapped = wrapText(raw, Math.max(8, Math.floor((tw2 + 1) / 6)));
  let budget = visible;
  const out = [];
  for (let i = 0; i < wrapped.length && budget > 0; i++) {
    const len = charCount(wrapped[i]);
    if (budget >= len) {
      out.push(wrapped[i]);
      budget -= len + 1;
    } else {
      out.push(Array.from(wrapped[i]).slice(0, budget).join(''));
      budget = 0;
    }
  }
  drawText(ctx, out.join('\n'), tx, DLG_Y + 11, { color: INK, lineHeight: 10, maxLines: 4 });

  // Continue indicator.
  if (complete) {
    drawText(ctx, 'E', DLG_X + DLG_W - 24, DLG_Y + DLG_H - 11, { align: 'right', color: FAINT });
    if (blink(time, 0.9, 0.6)) {
      drawText(ctx, '▼', DLG_X + DLG_W - 13, DLG_Y + DLG_H - 11, { align: 'right', color: GOLD });
    }
  }
}

/* ------------------------------------------------------------------ *
 * Pause menu
 * ------------------------------------------------------------------ */

function isMutedFlag(game) {
  const g = game || {};
  if (typeof g.muted === 'boolean') return g.muted;
  if (g.save && typeof g.save.muted === 'boolean') return g.save.muted;
  return firstBool(g, ['isMuted', 'audioMuted']);
}

/**
 * Pause overlay: keyboard-navigable menu with a cursor.
 * Selection is read from game.pauseSel / pauseIndex / menuSel / menuIndex.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} game
 */
export function drawPause(ctx, game) {
  const g = game || {};
  const level = g.level || {};
  const sel = clamp(
    Math.floor(firstNum(g, ['pauseSel', 'pauseIndex', 'menuSel', 'menuIndex', 'sel'], 0)),
    0,
    PAUSE_ITEMS.length - 1
  );

  scrim(ctx, 0.68);

  const W = 264;
  const H = 172;
  const x = Math.round((VIEW_W - W) / 2);
  const y = Math.round((VIEW_H - H) / 2);
  panel(ctx, x, y, W, H, { accent: GOLD_DK });

  const cx = VIEW_W / 2;
  drawText(ctx, 'PAUSED', cx, y + 13, { align: 'center', scale: 2, color: GOLD, letterSpacing: 4, shadow: true });

  const where = chapterLabel(level) + (level.company ? '  ·  ' + String(level.company).toUpperCase() : '');
  drawText(ctx, where, cx, y + 32, { align: 'center', color: DIM, maxWidth: W - 24, maxLines: 1 });
  rule(ctx, x + 14, y + 44, W - 28, PANEL_LINE);

  const itemX = x + 30;
  const itemY = y + 54;
  for (let i = 0; i < PAUSE_ITEMS.length; i++) {
    const on = i === sel;
    let label = PAUSE_ITEMS[i];
    if (label === 'SOUND') label = 'SOUND: ' + (isMutedFlag(g) ? 'OFF' : 'ON');
    const ry = itemY + i * 15;
    if (on) {
      rect(ctx, x + 14, ry - 3, W - 28, 13, 'rgba(255,203,71,0.13)');
      rect(ctx, x + 14, ry - 3, 2, 13, GOLD);
      drawText(ctx, '▶', itemX - 12, ry, { color: GOLD });
    }
    drawText(ctx, label, itemX, ry, { color: on ? INK : DIM, letterSpacing: on ? 1 : 0 });
  }

  // Run stats.
  rule(ctx, x + 14, y + H - 33, W - 28, PANEL_LINE);
  const coins = Math.max(0, Math.floor(num(g.coins, 0)));
  const total = Math.max(0, Math.floor(num(g.coinsTotal, 0)));
  drawPixels(ctx, COIN, x + 15, y + H - 26, 1, GOLD);
  drawText(ctx, coins + '/' + total, x + 23, y + H - 26, { color: GOLD });
  drawText(ctx, formatTime(g.timeMs), x + W - 15, y + H - 26, { align: 'right', color: SOFT });

  drawText(ctx, '↑ ↓ MOVE     ENTER SELECT     ESC RESUME', cx, y + H - 11, {
    align: 'center',
    color: FAINT,
  });
}

/* ------------------------------------------------------------------ *
 * Chapter select
 * ------------------------------------------------------------------ */

function resolveLevels(game) {
  const g = game || {};
  const candidates = [g.levels, g.allLevels, g.levelList, g.LEVELS, g.save && g.save.levels];
  for (let i = 0; i < candidates.length; i++) {
    if (Array.isArray(candidates[i]) && candidates[i].length) return candidates[i];
  }
  return g.level ? [g.level] : [];
}

const LS_ROWS = 7;
const LS_ROW_H = 24;

/**
 * Chapter select: one row per level, locked chapters masked as "???".
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} game
 * @param {number} sel selected index
 */
export function drawLevelSelect(ctx, game, sel) {
  const g = game || {};
  const levels = resolveLevels(g);
  const save = g.save || {};
  const best = save.best || {};
  const maxLevel = Math.max(0, Math.floor(num(save.maxLevel, 0)));
  const n = levels.length;
  const cur = n ? clamp(Math.floor(num(sel, 0)), 0, n - 1) : 0;

  scrim(ctx, 0.78);

  const x = 22;
  const y = 14;
  const W = VIEW_W - x * 2;
  const H = VIEW_H - y * 2;
  panel(ctx, x, y, W, H, { accent: GOLD_DK });

  const cx = VIEW_W / 2;
  drawText(ctx, 'CHAPTER SELECT', cx, y + 11, { align: 'center', scale: 2, color: GOLD, letterSpacing: 3, shadow: true });
  rule(ctx, x + 14, y + 30, W - 28, PANEL_LINE);

  if (!n) {
    drawText(ctx, 'NO CHAPTERS LOADED', cx, y + 90, { align: 'center', color: DIM, letterSpacing: 2 });
    drawText(ctx, 'ESC  BACK', cx, y + H - 14, { align: 'center', color: FAINT });
    return;
  }

  // Visible range.
  let start = 0;
  if (n > LS_ROWS) start = clamp(cur - Math.floor(LS_ROWS / 2), 0, n - LS_ROWS);
  const end = Math.min(n, start + LS_ROWS);

  const rowX = x + 12;
  const rowW = W - 24;
  let ry = y + 38;

  for (let i = start; i < end; i++) {
    const lv = levels[i] || {};
    const locked = i > maxLevel;
    const on = i === cur;

    if (on) {
      rect(ctx, rowX, ry - 2, rowW, LS_ROW_H - 3, locked ? 'rgba(109,124,156,0.12)' : 'rgba(255,203,71,0.13)');
      rect(ctx, rowX, ry - 2, 2, LS_ROW_H - 3, locked ? DIM : GOLD);
      drawText(ctx, '▶', rowX - 9, ry + 4, { color: locked ? DIM : GOLD });
    }

    const numCol = locked ? FAINT : on ? GOLD : DIM;
    drawText(ctx, pad2(num(lv.index, i)), rowX + 8, ry + 4, { color: numCol, scale: 1, letterSpacing: 1 });

    if (locked) {
      drawPixels(ctx, LOCK, rowX + 26, ry + 1, 1, on ? DIM : FAINT);
      drawText(ctx, '???', rowX + 38, ry + 1, { color: on ? DIM : FAINT, letterSpacing: 2 });
      drawText(ctx, 'LOCKED', rowX + 38, ry + 11, { color: FAINT });
    } else {
      const title = String(lv.company || 'CHAPTER ' + i).toUpperCase();
      drawText(ctx, title, rowX + 26, ry + 1, {
        color: on ? INK : SOFT,
        letterSpacing: 1,
        maxWidth: rowW - 130,
        maxLines: 1,
      });
      const meta = [lv.role, lv.period].filter(Boolean).join('  ·  ');
      drawText(ctx, meta, rowX + 26, ry + 11, { color: DIM, maxWidth: rowW - 130, maxLines: 1 });

      const b = best[lv.id];
      if (b) {
        const bc = Math.max(0, Math.floor(num(b.coins, 0)));
        drawPixels(ctx, COIN, rowX + rowW - 96, ry + 1, 1, on ? GOLD : GOLD_DK);
        drawText(ctx, String(bc), rowX + rowW - 87, ry + 1, { color: on ? GOLD : GOLD_DK });
        drawText(ctx, formatTime(b.timeMs), rowX + rowW - 8, ry + 11, { align: 'right', color: DIM });
        drawText(ctx, 'BEST', rowX + rowW - 8, ry + 1, { align: 'right', color: FAINT });
      } else if (i <= maxLevel) {
        drawText(ctx, 'UNPLAYED', rowX + rowW - 8, ry + 6, { align: 'right', color: FAINT });
      }
    }
    ry += LS_ROW_H;
  }

  // Scroll hints.
  if (start > 0) drawText(ctx, '▲', cx, y + 33, { align: 'center', color: FAINT });
  if (end < n) drawText(ctx, '▼', cx, y + H - 26, { align: 'center', color: FAINT });

  rule(ctx, x + 14, y + H - 22, W - 28, PANEL_LINE);
  drawText(ctx, '↑ ↓ SELECT     ENTER PLAY     ESC BACK', cx, y + H - 14, { align: 'center', color: FAINT });
}

/* ------------------------------------------------------------------ *
 * Ending
 * ------------------------------------------------------------------ */

const CONFETTI = (function () {
  const rnd = mulberry32(0x9e37);
  const out = [];
  for (let i = 0; i < 46; i++) {
    out.push({ x: rnd() * VIEW_W, y: rnd() * VIEW_H, sp: 6 + rnd() * 16, sw: rnd() * 6.283, c: Math.floor(rnd() * 3) });
  }
  return out;
})();

const CONFETTI_COLORS = ['rgba(255,203,71,0.55)', 'rgba(99,224,207,0.5)', 'rgba(255,95,126,0.45)'];

/**
 * Ending card: "PRESENT DAY", aggregate stats, profile summary and contact.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} game
 * @param {number} t seconds since the ending appeared
 */
export function drawEnding(ctx, game, t) {
  const g = game || {};
  const time = Math.max(0, num(t, 0));

  // Background.
  const bands = 30;
  for (let i = 0; i < bands; i++) {
    const p = i / (bands - 1);
    ctx.fillStyle = 'rgb(' + Math.round(7 + p * 16) + ',' + Math.round(9 + p * 12) + ',' + Math.round(20 + p * 30) + ')';
    ctx.fillRect(0, Math.floor((i * VIEW_H) / bands), VIEW_W, Math.ceil(VIEW_H / bands));
  }
  for (let i = 0; i < CONFETTI.length; i++) {
    const c = CONFETTI[i];
    const yy = (c.y + time * c.sp) % (VIEW_H + 8);
    const xx = Math.round(c.x + Math.sin(time * 0.9 + c.sw) * 9);
    ctx.fillStyle = CONFETTI_COLORS[c.c];
    ctx.fillRect(((xx % VIEW_W) + VIEW_W) % VIEW_W, Math.round(yy), 1, 2);
  }

  const cx = VIEW_W / 2;
  const rev = (delay, dur) => ease(clamp((time - delay) / num(dur, 0.5), 0, 1));

  // Header.
  drawText(ctx, 'PRESENT DAY', cx, 14, {
    align: 'center',
    scale: 3,
    color: GOLD,
    letterSpacing: 3,
    shadow: 'rgba(0,0,0,0.8)',
    shadowOffset: 2,
    alpha: rev(0, 0.6),
  });

  drawText(ctx, 'CHAI JIA EN  ·  SENIOR PRODUCT MANAGER', cx, 40, {
    align: 'center',
    color: TEAL,
    letterSpacing: 1,
    alpha: rev(0.3, 0.5),
  });
  ctx.globalAlpha = rev(0.4, 0.5);
  rule(ctx, 60, 54, VIEW_W - 120, PANEL_LINE);
  ctx.globalAlpha = 1;

  // Aggregate stats.
  const save = g.save || {};
  const best = save.best || {};
  let totalCoins = 0;
  let totalMs = 0;
  let played = 0;
  for (const k in best) {
    if (!Object.prototype.hasOwnProperty.call(best, k)) continue;
    const b = best[k] || {};
    totalCoins += Math.max(0, Math.floor(num(b.coins, 0)));
    totalMs += Math.max(0, num(b.timeMs, 0));
    played++;
  }
  const levels = resolveLevels(g);
  const chapters = levels.length || played;
  const statA = rev(0.55, 0.5);

  const cells = [
    ['COLLECTED', String(totalCoins)],
    ['TOTAL TIME', formatTimeShort(totalMs)],
    ['CHAPTERS', pad2(Math.max(played, chapters)) + '/' + pad2(chapters || played)],
  ];
  const cellW = 128;
  const startX = Math.round(cx - (cellW * 3) / 2);
  for (let i = 0; i < cells.length; i++) {
    const bx = startX + i * cellW;
    drawText(ctx, cells[i][0], bx + cellW / 2, 62, { align: 'center', color: DIM, letterSpacing: 1, alpha: statA });
    drawText(ctx, cells[i][1], bx + cellW / 2, 72, { align: 'center', scale: 2, color: INK, alpha: statA, shadow: true });
  }

  // Profile — left aligned inside a centred measure, which reads far better
  // than a centred paragraph.
  const pw = VIEW_W - 96;
  drawText(ctx, PROFILE, Math.round((VIEW_W - pw) / 2), 96, {
    color: SOFT,
    maxWidth: pw,
    lineHeight: 9,
    alpha: rev(0.85, 0.8),
  });

  // Contact.
  const contactA = rev(1.35, 0.6);
  ctx.globalAlpha = contactA;
  rule(ctx, 60, 180, VIEW_W - 120, PANEL_LINE);
  ctx.globalAlpha = 1;
  drawText(ctx, CONTACT, cx, 188, { align: 'center', color: TEAL, alpha: contactA });
  drawText(ctx, 'JIAENCHAI.COM', cx, 200, { align: 'center', color: GOLD, letterSpacing: 3, alpha: contactA });

  // Invitations.
  const outroA = rev(1.7, 0.6);
  if (blink(time, 1.3, 0.7)) {
    drawText(ctx, 'SCROLL DOWN FOR THE FULL RESUME ↓', cx, 220, {
      align: 'center',
      color: INK,
      letterSpacing: 1,
      alpha: outroA,
    });
  }
  drawText(ctx, 'ENTER  BACK TO TITLE     THANKS FOR PLAYING', cx, 240, {
    align: 'center',
    color: FAINT,
    alpha: outroA,
  });
}

/* ------------------------------------------------------------------ *
 * Toast
 * ------------------------------------------------------------------ */

const TOAST_SPLIT = /^([A-Z0-9 '!&.\-]{3,28}?)\s*[—–-]\s+(.+)$/;

/**
 * Small banner used for ability unlocks and '?' block sign text.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object|string} toast {text|message, title?, kind?, t?, duration?}
 * @param {number} t seconds — fallback life clock when the toast has none
 */
export function drawToast(ctx, toast, t) {
  if (!toast) return;
  const o = typeof toast === 'string' ? { text: toast } : toast;
  const time = Math.max(0, num(t, 0));

  let body = o.text !== undefined && o.text !== null ? String(o.text) : o.message ? String(o.message) : '';
  let title = o.title || o.label || null;

  // "ABILITY UNLOCKED — Sprint Dash" arrives as one string: split the all-caps
  // lead-in off into a title so it can be typeset as a banner.
  if (!title) {
    const m = TOAST_SPLIT.exec(body);
    if (m && /[A-Z]/.test(m[1]) && m[1] === m[1].toUpperCase()) {
      title = m[1].trim();
      body = m[2].trim();
    }
  }
  const kind = o.kind || o.type || (title ? 'unlock' : 'sign');
  if (!body && !title) return;

  const life = Math.max(0, firstNum(o, ['t', 'timer', 'age', 'elapsed'], time));
  const dur = Math.max(0.6, firstNum(o, ['duration', 'dur', 'life', 'ttl'], 3.2));
  if (life > dur) return;

  const inP = ease(clamp(life / 0.22, 0, 1));
  const outP = clamp((life - (dur - 0.4)) / 0.4, 0, 1);
  const alpha = clamp(inP * (1 - outP), 0, 1);
  if (alpha <= 0.01) return;

  const unlock = kind === 'unlock' || kind === 'ability';
  const accent = unlock ? GOLD : TEAL;

  const maxW = 340;
  const inner = maxW - 20;
  const bodyScale = unlock ? 2 : 1;
  const lines = wrapText(body, Math.max(8, Math.floor((inner + 1) / (6 * bodyScale))));
  const lineH = bodyScale === 2 ? 16 : 10;

  // Second line: state.js / entities.js / player.js all write {text, sub}.
  const subText = o.sub !== undefined && o.sub !== null ? String(o.sub).trim() : '';
  const subLines = subText ? wrapText(subText, Math.max(8, Math.floor((inner + 1) / 6))) : [];
  const subH = subLines.length ? subLines.length * 10 + 3 : 0;

  let contentW = 0;
  for (let i = 0; i < lines.length; i++) contentW = Math.max(contentW, textWidth(lines[i], bodyScale, 1));
  for (let i = 0; i < subLines.length; i++) contentW = Math.max(contentW, textWidth(subLines[i], 1, 1));
  if (title) contentW = Math.max(contentW, textWidth(String(title).toUpperCase(), 1, 3) + (unlock ? 14 : 0));

  const W = clamp(contentW + 24, 96, maxW);
  const H = (title ? 14 : 6) + lines.length * lineH + subH + 8;
  const x = Math.round((VIEW_W - W) / 2);
  const y = Math.round(40 - (1 - inP) * 14);

  const prev = ctx.globalAlpha;
  ctx.globalAlpha = alpha;

  panel(ctx, x, y, W, H, { fill: 'rgba(7,11,22,0.95)', border: accent, accent: accent });
  rect(ctx, x + 1, y + 1, 2, H - 2, accent);

  const cx = x + W / 2;
  let ty = y + 6;
  if (title) {
    const label = String(title).toUpperCase();
    if (unlock) {
      const lw = textWidth(label, 1, 3);
      drawPixels(ctx, STAR_S, Math.round(cx - lw / 2 - 12), ty + 1, 1, GOLD);
      drawPixels(ctx, STAR_S, Math.round(cx + lw / 2 + 7), ty + 1, 1, GOLD);
    }
    drawText(ctx, label, cx, ty, { align: 'center', color: accent, letterSpacing: 3 });
    ty += 14;
  }
  drawText(ctx, lines.join('\n'), cx, ty, {
    align: 'center',
    scale: bodyScale,
    color: INK,
    lineHeight: bodyScale === 2 ? 8 : 10,
    shadow: true,
  });
  if (subLines.length) {
    ty += lines.length * lineH + 3;
    drawText(ctx, subLines.join('\n'), cx, ty, {
      align: 'center',
      color: FAINT,
      lineHeight: 10,
      shadow: true,
    });
  }

  ctx.globalAlpha = prev;
}
