// src/game/sprites.js
// Procedural 16-bit style sprite drawing. No assets, no text, no DOM queries.
// Every exported draw call is self-contained: it saves and restores the context,
// and draws relative to (x, y) given in world pixels.

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------
// Shape (fixed by CONTRACT §4):
//   { sky:[topColor,bottomColor], far, mid, near, block, blockTop, blockShade,
//     platform, hazard, accent, particle, name }

export const THEMES = {
  bristol: {
    sky: ['#4e9ed6', '#f7dfb2'],
    far: '#a6c5cd',
    mid: '#4f7c5d',
    near: '#22402e',
    block: '#7a5636',
    blockTop: '#5faa46',
    blockShade: '#432f1c',
    platform: '#a8763f',
    hazard: '#b5453a',
    accent: '#f2c14e',
    particle: '#e2f0c4',
    name: 'Somerset Valley',
  },
  edinburgh: {
    sky: ['#2f3d55', '#8e98a6'],
    far: '#616d80',
    mid: '#414c5e',
    near: '#272e3d',
    block: '#5b6070',
    blockTop: '#7b8291',
    blockShade: '#363b47',
    platform: '#8b8272',
    hazard: '#7e3f52',
    accent: '#e6b45c',
    particle: '#c2d5e4',
    name: 'Old Town',
  },
  hospital: {
    sky: ['#a9dce6', '#f3fbfb'],
    far: '#cde9ec',
    mid: '#a6d5dc',
    near: '#7bb8c4',
    block: '#d5e3e8',
    blockTop: '#fbffff',
    blockShade: '#93aab3',
    platform: '#8ac4cd',
    hazard: '#e2685f',
    accent: '#23a396',
    particle: '#a5e4de',
    name: 'Ward Wing',
  },
  classroom: {
    sky: ['#ffe9c0', '#f8d093'],
    far: '#f0dcb2',
    mid: '#e7cf9e',
    near: '#9c6738',
    block: '#b07a45',
    blockTop: '#d69c60',
    blockShade: '#78502e',
    platform: '#c98f52',
    hazard: '#d0553f',
    accent: '#f2c94c',
    particle: '#ffdca6',
    name: 'Studio',
  },
  fintech: {
    sky: ['#050a19', '#182a54'],
    far: '#101c3a',
    mid: '#1b2c55',
    near: '#0a1226',
    block: '#1f2e50',
    blockTop: '#31497c',
    blockShade: '#10182e',
    platform: '#31507f',
    hazard: '#ff4d6d',
    accent: '#00e6a0',
    particle: '#35d6ff',
    name: 'Night Desk',
  },
  salon: {
    sky: ['#241540', '#ef7d8e'],
    far: '#4b2b60',
    mid: '#34204a',
    near: '#190d29',
    block: '#3b2450',
    blockTop: '#5c3873',
    blockShade: '#231331',
    platform: '#6d4180',
    hazard: '#ff3b6b',
    accent: '#ff77c8',
    particle: '#ffc4dd',
    name: 'Tokyo Dusk',
  },
  kl: {
    sky: ['#1b2a63', '#ff9f5e'],
    far: '#3b4079',
    mid: '#282a58',
    near: '#161936',
    block: '#3c3a55',
    blockTop: '#5a5580',
    blockShade: '#242236',
    platform: '#6e5f8a',
    hazard: '#ff5533',
    accent: '#ffd166',
    particle: '#ffb9a2',
    name: 'KL Skyline',
  },
};

// ---------------------------------------------------------------------------
// Tiny pixel helpers
// ---------------------------------------------------------------------------

const OUT = '#120d18'; // universal dark outline

function px(ctx, x, y, w, h, c) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

// Draw a list of [x, y, w, h, color] rects. When `outline` is given, every rect
// is first stamped 1px larger in the outline colour, which yields a clean
// silhouette outline around the union of the shape.
function paint(ctx, rects, outline) {
  if (outline) {
    ctx.fillStyle = outline;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      ctx.fillRect(r[0] - 1, r[1] - 1, r[2] + 2, r[3] + 2);
    }
  }
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    ctx.fillStyle = r[4];
    ctx.fillRect(r[0], r[1], r[2], r[3]);
  }
}

function num(v, d) {
  return typeof v === 'number' && isFinite(v) ? v : d;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
// Nominal box: 10 x 14 (PLAYER_W x PLAYER_H), drawn from (x, y) top-left.
// The 1px outline bleeds one pixel outside the box on every side, by design.

const P_HAIR = '#3a2a33';
const P_HAIR_HI = '#57404c';
const P_SKIN = '#f4c89b';
const P_SKIN_SH = '#d29b6e';
const P_SHIRT = '#e2574c';
const P_SHIRT_SH = '#a8352f';
const P_COLLAR = '#f4f0e6';
const P_PANTS = '#43507c';
const P_PANTS_SH = '#2b3455';
const P_SHOE = '#ece4d4';
const P_BAG = '#2fbfae';
const P_BAG_SH = '#1d8a7e';

// Layout (10 x 14, facing right):
//   rows 0-4  head (7 wide, x2..x8)
//   rows 5-9  torso (6 wide, x2..x7) with arms occupying x0..x1 and x8..x9
//   rows 10-13 legs (3 wide each) with light trainers so the stride reads
const HX = 2;
const TY = 5;
const LY = 10;

// 6-frame run cycle
// [frontLegX, frontLegH, backLegX, backLegH, bob, frontArmY, backArmY]
const RUN_FRAMES = [
  [5, 4, 1, 4, 0, 1, -1],
  [4, 4, 2, 2, 1, 0, -1],
  [3, 4, 4, 3, 1, -1, 0],
  [1, 4, 5, 4, 0, -1, 1],
  [2, 2, 4, 4, 1, -1, 0],
  [4, 3, 3, 4, 1, 0, 1],
];

function pHead(r, hy) {
  r.push([HX + 1, hy + 2, 6, 3, P_SKIN]);       // face
  r.push([HX + 1, hy + 4, 6, 1, P_SKIN_SH]);    // jaw
  r.push([HX + 1, hy, 5, 1, P_HAIR]);           // crown
  r.push([HX, hy + 1, 7, 1, P_HAIR]);
  r.push([HX, hy + 2, 2, 3, P_HAIR]);           // back of the head
  r.push([HX + 5, hy + 2, 2, 1, P_HAIR]);       // fringe swept forward
  r.push([HX + 1, hy, 3, 1, P_HAIR_HI]);        // hair sheen
}

function pFace(ctx, hy, mode) {
  const ex = HX + 4;   // eye sits in the front half of the face
  if (mode === 'shut') {
    px(ctx, ex, hy + 3, 2, 1, '#2f2028');
  } else if (mode === 'hurt') {
    px(ctx, ex, hy + 3, 1, 1, '#2f2028');
    px(ctx, ex + 2, hy + 3, 1, 1, '#2f2028');
    px(ctx, ex + 1, hy + 4, 1, 1, '#2f2028');
  } else if (mode === 'squint') {
    px(ctx, ex, hy + 3, 3, 1, '#2f2028');
  } else {
    px(ctx, ex, hy + 3, 2, 1, '#f7f3ec');
    px(ctx, ex + 1, hy + 3, 1, 1, '#2f2028');
  }
  // brow / cheek shaping keeps the face from reading as a flat band
  px(ctx, HX + 2, hy + 3, 1, 1, P_SKIN_SH);
  if (mode === 'hurt') px(ctx, HX + 4, hy + 5, 2, 1, '#9c4040');
  else px(ctx, HX + 4, hy + 4, 2, 1, P_SKIN_SH);
}

const P_SHIRT_HEM = '#8e2a25';

function pTorso(r, ty, lean) {
  r.push([HX + lean, ty, 6, 5, P_SHIRT]);
  r.push([HX + lean, ty, 2, 5, P_SHIRT_SH]);      // back half in shade
  r.push([HX + lean, ty + 4, 6, 1, P_SHIRT_HEM]);
  r.push([HX + 1 + lean, ty, 3, 1, P_COLLAR]);
}

function pArms(r, ty, front, back, lean) {
  // back arm
  r.push([0, ty + 1 + back, 2, 3, P_SHIRT_SH]);
  r.push([0, ty + 4 + back, 2, 1, P_SKIN_SH]);
  // front arm
  r.push([8 + lean, ty + 1 + front, 2, 3, P_SHIRT]);
  r.push([8 + lean, ty + 4 + front, 2, 1, P_SKIN]);
}

function pLeg(r, lx, h, pants, y) {
  r.push([lx, y, 3, h, pants]);
  // trainer kept flush with the leg so the two feet never merge into one bar
  r.push([lx, y + h - 1, 3, 1, P_SHOE]);
}

export function drawPlayer(ctx, x, y, state) {
  const st = state || {};
  const facing = st.facing === -1 ? -1 : 1;
  const anim = st.anim || 'idle';
  const t = num(st.t, 0);

  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (facing === -1) {
    ctx.translate(10, 0);
    ctx.scale(-1, 1);
  }

  const r = [];
  let eyeMode = 'open';
  let bob = 0;
  let lean = 0;
  let runFrame = 0;

  if (anim === 'run') {
    runFrame = Math.floor(Math.abs(t) * 13) % 6;
    const f = RUN_FRAMES[runFrame];
    bob = f[4];
    r.push([0, TY + bob, 2, 3, P_BAG_SH]);          // satchel on the back
    pLeg(r, f[2], f[3], P_PANTS_SH, LY);
    pLeg(r, f[0], f[1], P_PANTS, LY);
    pArms(r, TY + bob, f[5], f[6], 0);
    pTorso(r, TY + bob, 0);
    pHead(r, bob);
  } else if (anim === 'jump') {
    r.push([0, TY, 2, 3, P_BAG_SH]);
    pLeg(r, 1, 3, P_PANTS_SH, LY);
    pLeg(r, 5, 2, P_PANTS, LY);
    pArms(r, TY, -3, 1, 0);
    pTorso(r, TY, 0);
    pHead(r, 0);
  } else if (anim === 'fall') {
    r.push([0, TY, 2, 3, P_BAG_SH]);
    pLeg(r, 1, 4, P_PANTS_SH, LY);
    pLeg(r, 5, 3, P_PANTS, LY);
    // arms flung out sideways
    r.push([-1, TY + 1, 3, 2, P_SHIRT_SH]);
    r.push([-2, TY, 2, 2, P_SKIN_SH]);
    r.push([8, TY + 1, 3, 2, P_SHIRT]);
    r.push([10, TY, 2, 2, P_SKIN]);
    pTorso(r, TY, 0);
    pHead(r, 0);
    eyeMode = 'squint';
  } else if (anim === 'dash') {
    lean = 1;
    r.push([0, TY + 1, 2, 3, P_BAG_SH]);
    pLeg(r, 0, 3, P_PANTS_SH, LY + 1);
    pLeg(r, 4, 3, P_PANTS, LY + 1);
    r.push([0, TY + 3, 2, 2, P_SHIRT_SH]);
    r.push([9, TY + 1, 3, 2, P_SHIRT]);
    r.push([11, TY + 1, 2, 2, P_SKIN]);
    pTorso(r, TY, 1);
    pHead(r, 0);
    eyeMode = 'squint';
  } else if (anim === 'glide') {
    bob = Math.sin(t * 4) > 0 ? 0 : 1;
    r.push([0, TY + bob, 2, 3, P_BAG_SH]);
    pLeg(r, 2, 4, P_PANTS_SH, LY + bob);
    pLeg(r, 5, 4, P_PANTS, LY + bob);
    r.push([-2, TY + 1 + bob, 4, 2, P_SHIRT_SH]);
    r.push([-3, TY + 1 + bob, 2, 2, P_SKIN_SH]);
    r.push([8, TY + 1 + bob, 4, 2, P_SHIRT]);
    r.push([11, TY + 1 + bob, 2, 2, P_SKIN]);
    pTorso(r, TY + bob, 0);
    pHead(r, bob);
  } else if (anim === 'hurt') {
    bob = 1;
    pLeg(r, 0, 3, P_PANTS_SH, LY);
    pLeg(r, 6, 3, P_PANTS, LY);
    r.push([-1, TY - 1, 2, 3, P_SHIRT_SH]);
    r.push([-1, TY - 3, 2, 2, P_SKIN_SH]);
    r.push([9, TY - 1, 2, 3, P_SHIRT]);
    r.push([9, TY - 3, 2, 2, P_SKIN]);
    pTorso(r, TY + 1, 0);
    pHead(r, 2);
    eyeMode = 'hurt';
  } else {
    // idle — slow breathing bob and an occasional blink
    const cyc = Math.abs(t) % 3.4;
    bob = Math.sin(Math.abs(t) * 2.6) > 0.35 ? 1 : 0;
    eyeMode = cyc < 0.14 ? 'shut' : 'open';
    r.push([0, TY + bob, 2, 3, P_BAG_SH]);
    pLeg(r, 2, 4, P_PANTS_SH, LY);
    pLeg(r, 5, 4, P_PANTS, LY);
    pArms(r, TY + bob, 0, 0, 0);
    pTorso(r, TY + bob, 0);
    pHead(r, bob);
  }

  // dash streaks trail behind the body
  if (anim === 'dash') {
    ctx.globalAlpha = 0.5;
    px(ctx, -9, 4, 6, 1, '#ffffff');
    px(ctx, -7, 8, 5, 1, '#cfe9ff');
    px(ctx, -10, 11, 7, 1, '#ffffff');
    ctx.globalAlpha = 0.22;
    px(ctx, -5, 1, 3, 12, '#bfe6ff');
    ctx.globalAlpha = 1;
  }

  paint(ctx, r, OUT);

  // satchel strap across the chest
  const sy = TY + 1 + (anim === 'hurt' ? 1 : bob);
  px(ctx, HX + 1, sy, 1, 1, P_BAG);
  px(ctx, HX + 2, sy + 1, 1, 1, P_BAG);
  px(ctx, HX + 3, sy + 2, 1, 1, P_BAG);

  pFace(ctx, anim === 'hurt' ? 2 : bob, eyeMode);

  if (anim === 'glide') {
    // "research hover" shimmer arc above the head
    ctx.globalAlpha = 0.8;
    for (let i = 0; i < 5; i++) {
      const a = -0.6 + i * 0.3 + Math.sin(t * 3) * 0.12;
      const gx = 5 + Math.round(Math.cos(a - Math.PI / 2) * 7);
      const gy = -3 + Math.round(Math.sin(a - Math.PI / 2) * 3);
      px(ctx, gx, gy + bob, 1, 1, i % 2 ? '#bff6ff' : '#ffffff');
    }
    ctx.globalAlpha = 0.28;
    px(ctx, 1, 15, 8, 1, '#bff6ff');
    ctx.globalAlpha = 1;
  }

  if (anim === 'run' && (runFrame === 1 || runFrame === 4)) {
    ctx.globalAlpha = 0.4;
    px(ctx, -3, 12, 2, 2, '#ffffff');
    px(ctx, -5, 13, 1, 1, '#ffffff');
    ctx.globalAlpha = 1;
  }

  if (anim === 'hurt') {
    ctx.globalAlpha = 0.16 + 0.14 * Math.sin(t * 30);
    px(ctx, HX, TY + 1, 6, 5, '#ff5a5a');
    ctx.globalAlpha = 0.55;
    px(ctx, -2, 1, 2, 2, '#ffd0d0');
    px(ctx, 10, 3, 2, 2, '#ffd0d0');
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------
// Walker nominal box: 14 x 14, drawn from (x, y) top-left.

export function drawWalker(ctx, x, y, t, facing) {
  const tt = num(t, 0);
  const f = facing === -1 ? -1 : 1;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (f === -1) {
    ctx.translate(14, 0);
    ctx.scale(-1, 1);
  }

  const step = Math.floor(tt * 8) % 4;
  const bob = step === 1 || step === 3 ? 1 : 0;
  const legA = step === 0 || step === 1 ? 0 : 2;
  const legB = step === 0 || step === 1 ? 2 : 0;

  const body = '#b34a3c';
  const bodyHi = '#d96a52';
  const bodySh = '#7d2f2a';
  const belly = '#efa06a';

  const r = [];
  // legs
  r.push([2 + legA, 11, 3, 3, '#3a2028']);
  r.push([9 - legB, 11, 3, 3, '#3a2028']);
  // body
  r.push([1, 3 + bob, 12, 9, body]);
  r.push([2, 2 + bob, 10, 1, bodyHi]);
  r.push([1, 3 + bob, 12, 2, bodyHi]);
  r.push([1, 10 + bob, 12, 2, bodySh]);
  r.push([4, 8 + bob, 7, 4, belly]);
  // spikes along the back
  r.push([3, 0 + bob, 2, 2, bodySh]);
  r.push([7, -1 + bob, 2, 3, bodySh]);
  r.push([11, 0 + bob, 2, 2, bodySh]);

  paint(ctx, r, OUT);

  // angry eyes
  px(ctx, 8, 5 + bob, 3, 3, '#ffffff');
  px(ctx, 4, 5 + bob, 3, 3, '#ffffff');
  px(ctx, 9, 6 + bob, 2, 2, '#231018');
  px(ctx, 5, 6 + bob, 2, 2, '#231018');
  px(ctx, 8, 4 + bob, 3, 1, '#3a1218');
  px(ctx, 4, 4 + bob, 3, 1, '#3a1218');
  // teeth
  px(ctx, 5, 10 + bob, 1, 1, '#ffffff');
  px(ctx, 7, 10 + bob, 1, 1, '#ffffff');
  px(ctx, 9, 10 + bob, 1, 1, '#ffffff');

  ctx.restore();
}

// Flyer nominal box: 14 x 12, drawn from (x, y) top-left.
export function drawFlyer(ctx, x, y, t) {
  const tt = num(t, 0);
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));

  const flap = Math.floor(tt * 14) % 4;
  const wing = flap === 0 ? 0 : flap === 1 || flap === 3 ? 2 : 4;
  const bob = Math.round(Math.sin(tt * 5) * 1);

  const body = '#7b5ad6';
  const hi = '#a288ec';
  const sh = '#4a2f92';

  // wings behind
  ctx.globalAlpha = 0.85;
  px(ctx, -2, 3 + bob + wing, 5, 2, hi);
  px(ctx, 11, 3 + bob + wing, 5, 2, hi);
  px(ctx, -1, 4 + bob + wing, 4, 1, '#d4c6ff');
  px(ctx, 11, 4 + bob + wing, 4, 1, '#d4c6ff');
  ctx.globalAlpha = 1;

  const r = [];
  // diamond body built from stacked rows
  r.push([5, 1 + bob, 4, 1, hi]);
  r.push([4, 2 + bob, 6, 1, hi]);
  r.push([3, 3 + bob, 8, 4, body]);
  r.push([4, 7 + bob, 6, 2, body]);
  r.push([5, 9 + bob, 4, 1, sh]);
  r.push([3, 6 + bob, 8, 1, sh]);
  // tail
  r.push([6, 10 + bob, 2, 2, sh]);

  paint(ctx, r, OUT);

  // single glowing eye
  const blink = Math.abs(tt) % 2.6 < 0.1;
  px(ctx, 5, 4 + bob, 4, blink ? 1 : 3, blink ? '#2a1840' : '#ffffff');
  if (!blink) {
    px(ctx, 6, 5 + bob, 2, 2, '#2a1840');
    px(ctx, 6, 5 + bob, 1, 1, '#8ef2ff');
  }
  ctx.globalAlpha = 0.3;
  px(ctx, 4, 3 + bob, 6, 1, '#d9ccff');
  ctx.globalAlpha = 1;

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Pickups
// ---------------------------------------------------------------------------
// Coin nominal box: 12 x 12. Spins around its vertical axis.

export function drawCoin(ctx, x, y, t) {
  const tt = num(t, 0);
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));

  const spin = Math.cos(tt * 4.5);
  const sw = Math.abs(spin);
  const edge = sw < 0.25;
  const cx = 6;
  const bob = Math.round(Math.sin(tt * 2.4) * 1);

  const gold = edge ? '#e0a021' : '#ffd45e';
  const dark = '#a56b14';
  const hi = '#fff6cf';

  for (let i = 0; i < 10; i++) {
    const dy = i - 4.5;
    const hw = Math.sqrt(Math.max(0, 25 - dy * dy)) * Math.max(0.14, sw);
    const w = Math.max(1, Math.round(hw * 2));
    const xx = cx - Math.round(w / 2);
    px(ctx, xx - 1, 1 + i + bob, w + 2, 1, OUT);
  }
  for (let i = 0; i < 10; i++) {
    const dy = i - 4.5;
    const hw = Math.sqrt(Math.max(0, 25 - dy * dy)) * Math.max(0.14, sw);
    const w = Math.max(1, Math.round(hw * 2));
    const xx = cx - Math.round(w / 2);
    px(ctx, xx, 1 + i + bob, w, 1, i > 6 ? dark : gold);
    if (!edge && w > 4 && i > 1 && i < 6) px(ctx, xx + 1, 1 + i + bob, 1, 1, hi);
  }
  if (!edge && sw > 0.7) {
    px(ctx, cx - 1, 4 + bob, 2, 4, dark);
    px(ctx, cx - 1, 4 + bob, 1, 3, hi);
  }
  // twinkle
  const tw = Math.abs(tt) % 1.6;
  if (tw < 0.3) {
    ctx.globalAlpha = 0.9;
    px(ctx, 10, 2 + bob, 1, 3, '#ffffff');
    px(ctx, 9, 3 + bob, 3, 1, '#ffffff');
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// Artifact nominal box: 16 x 16 — the big "key artifact" worth 5.
export function drawArtifact(ctx, x, y, t) {
  const tt = num(t, 0);
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));

  const bob = Math.round(Math.sin(tt * 2) * 1.4);
  const pulse = 0.5 + 0.5 * Math.sin(tt * 3.2);

  // soft glow
  ctx.globalAlpha = 0.12 + pulse * 0.14;
  px(ctx, 1, 2 + bob, 14, 12, '#7ef3ff');
  ctx.globalAlpha = 0.1 + pulse * 0.1;
  px(ctx, 3, 0 + bob, 10, 16, '#7ef3ff');
  ctx.globalAlpha = 1;

  // gem — rows of a cut diamond
  const rows = [
    [5, 6], [4, 8], [3, 10], [2, 12], [2, 12], [3, 10], [4, 8], [5, 6], [6, 4], [7, 2],
  ];
  const face = '#4fd8e8';
  const faceHi = '#b7f6ff';
  const faceSh = '#1f7f97';
  for (let i = 0; i < rows.length; i++) {
    px(ctx, rows[i][0] - 1, 3 + i + bob - 1, rows[i][1] + 2, 1, OUT);
  }
  px(ctx, 1, 2 + bob, 14, 1, OUT);
  for (let i = 0; i < rows.length; i++) {
    const rx = rows[i][0];
    const rw = rows[i][1];
    px(ctx, rx, 3 + i + bob, rw, 1, face);
    px(ctx, rx, 3 + i + bob, Math.max(1, Math.round(rw * 0.35)), 1, faceHi);
    px(ctx, rx + rw - Math.max(1, Math.round(rw * 0.25)), 3 + i + bob, Math.max(1, Math.round(rw * 0.25)), 1, faceSh);
  }
  // crown facet lines
  px(ctx, 5, 3 + bob, 6, 1, '#e8feff');
  px(ctx, 7, 6 + bob, 2, 6, faceHi);

  // rotating 4-point sparkle
  const a = tt * 2;
  const sx = 8 + Math.round(Math.cos(a) * 7);
  const sy = 8 + Math.round(Math.sin(a) * 6) + bob;
  ctx.globalAlpha = 0.9;
  px(ctx, sx, sy - 1, 1, 3, '#ffffff');
  px(ctx, sx - 1, sy, 3, 1, '#ffffff');
  ctx.globalAlpha = 1;

  ctx.restore();
}

// ---------------------------------------------------------------------------
// NPCs
// ---------------------------------------------------------------------------
// Nominal box: 12 wide x 18 tall, feet at y + 18.

const NPC_KITS = [
  { shirt: '#3f7fd0', shade: '#2a548f', hair: '#2c2028', skin: '#f0c193', prop: 'clipboard' },
  { shirt: '#57a86b', shade: '#376b45', hair: '#5b3a22', skin: '#e8b98a', prop: 'mug' },
  { shirt: '#c96fb0', shade: '#8c4278', hair: '#231a1e', skin: '#c98a5f', prop: 'laptop' },
  { shirt: '#e0a13c', shade: '#a06d20', hair: '#3a2a1c', skin: '#f4d3ae', prop: 'folder' },
  { shirt: '#6a67c9', shade: '#42408c', hair: '#1f1a24', skin: '#a9744c', prop: 'clipboard' },
  { shirt: '#38b3ac', shade: '#217872', hair: '#4a2f24', skin: '#f0c193', prop: 'mug' },
];

export function drawNpc(ctx, x, y, t, kind) {
  const tt = num(t, 0);
  const k = NPC_KITS[Math.abs(Math.floor(num(kind, 0))) % NPC_KITS.length];
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));

  const bob = Math.sin(tt * 1.8 + num(kind, 0)) > 0.3 ? 1 : 0;
  const r = [];
  // legs
  r.push([2, 14, 3, 4, '#2b3145']);
  r.push([7, 14, 3, 4, '#2b3145']);
  r.push([1, 17, 4, 1, '#191c26']);
  r.push([7, 17, 4, 1, '#191c26']);
  // body
  r.push([1, 8 + bob, 10, 7, k.shirt]);
  r.push([7, 8 + bob, 4, 7, k.shade]);
  r.push([4, 8 + bob, 4, 1, '#f2efe6']);
  // arms
  r.push([0, 9 + bob, 2, 5, k.shade]);
  r.push([10, 9 + bob, 2, 5, k.shirt]);
  // head
  r.push([2, 1 + bob, 8, 7, k.skin]);
  r.push([2, 1 + bob, 8, 3, k.hair]);
  r.push([2, 4 + bob, 1, 2, k.hair]);
  r.push([9, 4 + bob, 1, 2, k.hair]);

  paint(ctx, r, OUT);

  // eyes
  const blink = (Math.abs(tt) + num(kind, 0) * 0.7) % 3.1 < 0.11;
  if (blink) {
    px(ctx, 3, 6 + bob, 2, 1, '#2a1e26');
    px(ctx, 7, 6 + bob, 2, 1, '#2a1e26');
  } else {
    px(ctx, 3, 5 + bob, 2, 2, '#ffffff');
    px(ctx, 7, 5 + bob, 2, 2, '#ffffff');
    px(ctx, 4, 6 + bob, 1, 1, '#2a1e26');
    px(ctx, 8, 6 + bob, 1, 1, '#2a1e26');
  }

  // prop in the hand
  if (k.prop === 'clipboard') {
    px(ctx, 10, 10 + bob, 4, 6, OUT);
    px(ctx, 11, 11 + bob, 3, 4, '#e9e2d0');
    px(ctx, 11, 12 + bob, 2, 1, '#9aa2ad');
    px(ctx, 11, 14 + bob, 2, 1, '#9aa2ad');
  } else if (k.prop === 'mug') {
    px(ctx, 10, 11 + bob, 5, 5, OUT);
    px(ctx, 11, 12 + bob, 3, 3, '#f2f2ef');
    px(ctx, 11, 12 + bob, 3, 1, '#8a5a3c');
    px(ctx, 14, 13 + bob, 1, 1, '#f2f2ef');
    ctx.globalAlpha = 0.5;
    px(ctx, 12, 9 + bob + (Math.floor(tt * 3) % 2), 1, 2, '#ffffff');
    ctx.globalAlpha = 1;
  } else if (k.prop === 'laptop') {
    px(ctx, 9, 11 + bob, 6, 5, OUT);
    px(ctx, 10, 12 + bob, 4, 3, '#5a6272');
    px(ctx, 10, 12 + bob, 4, 2, Math.floor(tt * 2) % 2 ? '#8ee6ff' : '#6fd0ef');
  } else {
    px(ctx, 10, 10 + bob, 5, 6, OUT);
    px(ctx, 11, 11 + bob, 3, 4, '#d9b45e');
    px(ctx, 11, 11 + bob, 3, 1, '#b58f38');
  }

  // gentle "talk to me" chevron
  const cb = Math.sin(tt * 4) > 0 ? 0 : 1;
  ctx.globalAlpha = 0.75;
  px(ctx, 5, -5 - cb, 3, 1, '#ffffff');
  px(ctx, 6, -4 - cb, 1, 1, '#ffffff');
  px(ctx, 4, -6 - cb, 1, 1, '#ffffff');
  px(ctx, 8, -6 - cb, 1, 1, '#ffffff');
  ctx.globalAlpha = 1;

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Door / checkpoint
// ---------------------------------------------------------------------------
// Door nominal box: 24 wide x 32 tall, drawn from (x, y) top-left.

export function drawDoor(ctx, x, y, t, open) {
  const tt = num(t, 0);
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));

  const frame = '#6b6272';
  const frameHi = '#948b9c';
  const frameSh = '#3d3746';

  // outer arch
  px(ctx, 0, 4, 24, 28, frameSh);
  px(ctx, 1, 3, 22, 28, frame);
  px(ctx, 1, 3, 22, 2, frameHi);
  px(ctx, 4, 1, 16, 3, frame);
  px(ctx, 4, 1, 16, 1, frameHi);
  px(ctx, 7, 0, 10, 1, frame);
  px(ctx, 2, 5, 2, 26, frameHi);
  px(ctx, 20, 5, 2, 26, frameSh);

  if (open) {
    // glowing portal
    const pulse = 0.6 + 0.4 * Math.sin(tt * 3);
    px(ctx, 5, 6, 14, 25, '#1d1330');
    for (let i = 0; i < 25; i++) {
      const a = 0.16 + (i / 25) * 0.55 * pulse;
      ctx.globalAlpha = a;
      px(ctx, 5, 30 - i, 14, 1, i % 5 === 0 ? '#ffffff' : '#8ef0ff');
    }
    ctx.globalAlpha = 1;
    // rays
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 5; i++) {
      const rx = 6 + ((i * 5 + Math.floor(tt * 9)) % 13);
      px(ctx, rx, 7, 1, 23, '#dffcff');
    }
    ctx.globalAlpha = 0.85;
    for (let i = 0; i < 6; i++) {
      const py = 30 - ((tt * 22 + i * 9) % 26);
      const pxx = 6 + ((i * 7 + Math.floor(tt * 3)) % 12);
      px(ctx, pxx, Math.round(py), 1, 1, '#ffffff');
    }
    ctx.globalAlpha = 1;
    // arch glow
    ctx.globalAlpha = 0.35 * pulse;
    px(ctx, -1, 2, 26, 30, '#7ef3ff');
    ctx.globalAlpha = 1;
  } else {
    const wood = '#7a4f2e';
    const woodHi = '#9c6b41';
    const woodSh = '#54341d';
    px(ctx, 5, 6, 14, 25, wood);
    px(ctx, 5, 6, 14, 1, woodHi);
    px(ctx, 5, 6, 1, 25, woodHi);
    px(ctx, 17, 6, 2, 25, woodSh);
    px(ctx, 7, 9, 4, 8, woodSh);
    px(ctx, 13, 9, 4, 8, woodSh);
    px(ctx, 7, 20, 4, 7, woodSh);
    px(ctx, 13, 20, 4, 7, woodSh);
    px(ctx, 8, 10, 2, 6, woodHi);
    px(ctx, 14, 10, 2, 6, woodHi);
    // handle + lock
    px(ctx, 15, 18, 2, 2, '#d9b45e');
    px(ctx, 10, 17, 4, 4, '#c9c2b4');
    px(ctx, 11, 18, 2, 2, '#4a4438');
    px(ctx, 11, 19, 1, 2, '#4a4438');
  }

  ctx.restore();
}

// Checkpoint nominal box: 12 wide x 28 tall, base at y + 28.
export function drawCheckpoint(ctx, x, y, active, t) {
  const tt = num(t, 0);
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));

  // halo behind everything, so it never washes the flag out
  if (active) {
    const pulse = 0.5 + 0.5 * Math.sin(tt * 3);
    for (let r = 10; r > 0; r -= 2) {
      ctx.globalAlpha = 0.05 * (1 - r / 10) * (0.6 + 0.4 * pulse);
      px(ctx, 2 - r, 2 - r, 12 + r * 2, 24 + r * 2, '#ffd08a');
    }
    ctx.globalAlpha = 1;
  }

  // base
  px(ctx, 0, 25, 12, 3, OUT);
  px(ctx, 1, 25, 10, 2, active ? '#7a6a52' : '#4a4a52');
  px(ctx, 1, 25, 10, 1, active ? '#a2916f' : '#6a6a74');
  // pole
  px(ctx, 4, 0, 3, 26, OUT);
  px(ctx, 5, 1, 2, 24, active ? '#cdbf9a' : '#7c7c88');
  px(ctx, 5, 1, 1, 24, active ? '#eee2bd' : '#9a9aa6');

  if (active) {
    const wave = Math.sin(tt * 4);
    // waving pennant, drawn column by column so the fly end ripples
    for (let c = 0; c < 12; c++) {
      const h = Math.max(2, 9 - Math.floor(c * 0.6));
      const dy = Math.round(Math.sin(tt * 6 - c * 0.55) * (c * 0.16));
      px(ctx, 6 + c, 1 + dy, 1, h + 2, OUT);
      px(ctx, 6 + c, 2 + dy, 1, h, c > 7 ? '#e04a4a' : '#ff6b6b');
      px(ctx, 6 + c, 2 + dy, 1, 1, '#ffd9d9');
      if (c > 3 && c < 8) px(ctx, 6 + c, 4 + dy, 1, 2, '#ffe9e9');
    }
    // sparkle burst
    const s = Math.abs(tt) % 1.4;
    if (s < 0.35) {
      ctx.globalAlpha = 1 - s / 0.35;
      px(ctx, 2, 4 + Math.round(wave), 1, 1, '#ffffff');
      px(ctx, 19, 8 - Math.round(wave), 1, 1, '#ffffff');
      px(ctx, 1, 14, 1, 1, '#ffe9a0');
      ctx.globalAlpha = 1;
    }
  } else {
    // limp grey flag hanging against the pole
    for (let i = 0; i < 8; i++) {
      px(ctx, 6, 3 + i, 5 - Math.floor(i / 3), 1, OUT);
      px(ctx, 7, 3 + i, Math.max(1, 4 - Math.floor(i / 3)), 1, '#6d6d78');
    }
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Boss — "The Backlog"
// ---------------------------------------------------------------------------
// Nominal box: 40 wide x 36 tall, drawn from (x, y) top-left.

export function drawBoss(ctx, x, y, t, hp, maxHp, flash) {
  const tt = num(t, 0);
  const max = Math.max(1, num(maxHp, 5));
  const cur = Math.max(0, Math.min(max, num(hp, max)));
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));

  const hover = Math.round(Math.sin(tt * 2) * 2);
  const damaged = 1 - cur / max;

  // shadow
  ctx.globalAlpha = 0.18;
  px(ctx, 6, 34, 28, 3, '#000000');
  ctx.globalAlpha = 1;

  // stack of ticket cards, each jittering slightly
  const cards = [
    [2, 20, 36, 10, '#3c4a6b'],
    [4, 13, 32, 9, '#48587d'],
    [6, 7, 28, 8, '#57688f'],
    [9, 2, 22, 7, '#66779f'],
  ];
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const jx = Math.round(Math.sin(tt * (3 + i) + i * 1.7) * (1 + damaged * 2));
    const jy = hover + Math.round(Math.cos(tt * (2 + i * 0.5)) * 0.6);
    px(ctx, c[0] + jx - 1, c[1] + jy - 1, c[2] + 2, c[3] + 2, OUT);
    px(ctx, c[0] + jx, c[1] + jy, c[2], c[3], c[4]);
    px(ctx, c[0] + jx, c[1] + jy, c[2], 1, '#8b9cc4');
    px(ctx, c[0] + jx, c[1] + jy + c[3] - 1, c[2], 1, '#26304a');
    // ticket ruling lines (abstract, not text)
    for (let l = 0; l < 3; l++) {
      const ly = c[1] + jy + 2 + l * 2;
      if (ly < c[1] + jy + c[3] - 1) {
        px(ctx, c[0] + jx + 3, ly, Math.max(3, c[2] - 8 - l * 4), 1, '#2f3a58');
      }
    }
    // priority flag dot
    px(ctx, c[0] + jx + c[2] - 5, c[1] + jy + 2, 2, 2, i % 2 ? '#ff6b81' : '#ffd166');
  }

  // eye
  const ex = 20 + Math.round(Math.sin(tt * 1.3) * 3);
  const blink = Math.abs(tt) % 3.4 < 0.14;
  px(ctx, 13, 14 + hover, 14, blink ? 3 : 10, OUT);
  if (!blink) {
    px(ctx, 14, 15 + hover, 12, 8, '#f4f7ff');
    px(ctx, 14, 15 + hover, 12, 2, '#c3ccdf');
    px(ctx, ex - 3, 17 + hover, 6, 5, '#20263c');
    px(ctx, ex - 3, 17 + hover, 3, 2, damaged > 0.5 ? '#ff5a7a' : '#4a90e2');
    px(ctx, ex - 2, 18 + hover, 1, 1, '#ffffff');
  } else {
    px(ctx, 14, 15 + hover, 12, 1, '#20263c');
  }
  // angry brow, angrier as hp drops
  const brow = Math.round(damaged * 2);
  px(ctx, 13, 12 + hover + brow, 6, 2, '#20263c');
  px(ctx, 21, 12 + hover + brow, 6, 2, '#20263c');

  // orbiting sub-tickets
  for (let i = 0; i < 3; i++) {
    const a = tt * 1.6 + (i * Math.PI * 2) / 3;
    const ox = 20 + Math.round(Math.cos(a) * 24);
    const oy = 18 + hover + Math.round(Math.sin(a) * 9);
    px(ctx, ox - 1, oy - 1, 7, 6, OUT);
    px(ctx, ox, oy, 5, 4, '#e8edf7');
    px(ctx, ox, oy, 5, 1, '#ff6b81');
  }

  // hp pips above the stack (pure pixels, no glyphs)
  for (let i = 0; i < max; i++) {
    const bx = 20 - max * 2 + i * 4;
    px(ctx, bx - 1, -6 + hover - 1, 5, 5, OUT);
    px(ctx, bx, -6 + hover, 3, 3, i < cur ? '#ff5a7a' : '#3a3f52');
    if (i < cur) px(ctx, bx, -6 + hover, 1, 1, '#ffc2cc');
  }

  if (flash) {
    ctx.globalAlpha = 0.65;
    px(ctx, 0, -2 + hover, 40, 36, '#ffffff');
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Companion drone
// ---------------------------------------------------------------------------
// Nominal box: 10 x 10.

export function drawCompanion(ctx, x, y, t) {
  const tt = num(t, 0);
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));

  const bob = Math.round(Math.sin(tt * 4) * 1.2);
  const rot = Math.floor(tt * 20) % 2;

  // hover glow beneath
  ctx.globalAlpha = 0.2 + 0.08 * Math.sin(tt * 6);
  px(ctx, 1, 9 + bob, 8, 2, '#7ef3ff');
  px(ctx, 3, 11 + bob, 4, 2, '#7ef3ff');
  ctx.globalAlpha = 1;

  const r = [];
  r.push([1, 2 + bob, 8, 6, '#c9d4e2']);
  r.push([1, 2 + bob, 8, 2, '#eef4fb']);
  r.push([1, 6 + bob, 8, 2, '#8c9bb0']);
  r.push([4, 0 + bob, 2, 2, '#8c9bb0']);
  paint(ctx, r, OUT);

  // rotor
  px(ctx, rot ? 0 : 1, -1 + bob, rot ? 10 : 8, 1, '#f2f6fb');
  // lens
  px(ctx, 5, 4 + bob, 3, 3, '#12324a');
  px(ctx, 6, 5 + bob, 2, 2, Math.floor(tt * 4) % 2 ? '#7ef3ff' : '#4fd0e8');
  px(ctx, 6, 5 + bob, 1, 1, '#ffffff');
  // side light
  px(ctx, 1, 4 + bob, 1, 2, '#ffb35c');

  ctx.restore();
}
