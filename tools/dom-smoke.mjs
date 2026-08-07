#!/usr/bin/env node
// tools/dom-smoke.mjs — browser-boot smoke test without a browser.
//
// Stubs a minimal DOM (document/window/canvas 2D context/AudioContext/
// localStorage/requestAnimationFrame), imports src/main.js exactly as a
// <script type="module"> would, then drives ~600 simulated frames of input
// through every phase of the game and asserts:
//   * nothing throws
//   * real draw calls are issued each frame
//   * the phase machine actually advances title → play → complete
//   * no ctx.fillText anywhere (CONTRACT §5: the bitmap font owns all text)
//
// This catches the classic "imports fine in Node, throws on line 1 in the
// browser" failure that the DOM-free headless test cannot see.

let failures = 0;
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (cond) {
    console.log('  ok   ' + msg);
  } else {
    failures++;
    console.error('  FAIL ' + msg);
  }
}

/* ------------------------------------------------------------ canvas stub */

const drawCounts = new Map();
function bump(name) {
  drawCounts.set(name, (drawCounts.get(name) || 0) + 1);
}

const CTX_METHODS = [
  'save', 'restore', 'scale', 'rotate', 'translate', 'transform', 'setTransform',
  'resetTransform', 'clearRect', 'fillRect', 'strokeRect', 'beginPath',
  'closePath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arc',
  'arcTo', 'ellipse', 'rect', 'fill', 'stroke', 'clip', 'drawImage',
  'createLinearGradient', 'createRadialGradient', 'createPattern', 'fillText',
  'strokeText', 'measureText', 'setLineDash', 'getLineDash', 'putImageData',
  'getImageData', 'createImageData', 'roundRect',
];

function makeGradient() {
  return { addColorStop() {} };
}

function makeCtx(canvas) {
  const ctx = {
    canvas,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: true,
    shadowBlur: 0,
    shadowColor: 'transparent',
    filter: 'none',
  };
  for (const m of CTX_METHODS) {
    ctx[m] = function stub() {
      bump(m);
      if (m === 'createLinearGradient' || m === 'createRadialGradient') return makeGradient();
      if (m === 'createPattern') return { setTransform() {} };
      if (m === 'measureText') return { width: 0, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 };
      if (m === 'getImageData' || m === 'createImageData') {
        return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
      }
      if (m === 'getLineDash') return [];
      return undefined;
    };
  }
  return ctx;
}

/* --------------------------------------------------------------- DOM stub */

class ElementStub {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.nodeName = this.tagName;
    this.children = [];
    this.childNodes = this.children;
    this.style = {};
    this.dataset = {};
    this.classList = {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    };
    this.attributes = {};
    this.parentElement = null;
    this.clientWidth = 960;
    this.clientHeight = 540;
    this.offsetWidth = 960;
    this.offsetHeight = 540;
    this.textContent = '';
    this.width = 0;
    this.height = 0;
    this._listeners = new Map();
    this._ctx = null;
  }
  getContext(type) {
    if (type !== '2d') return null;
    if (!this._ctx) this._ctx = makeCtx(this);
    return this._ctx;
  }
  appendChild(el) { this.children.push(el); el.parentElement = this; return el; }
  removeChild(el) {
    const i = this.children.indexOf(el);
    if (i >= 0) this.children.splice(i, 1);
    return el;
  }
  insertBefore(el) { return this.appendChild(el); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const a = this._listeners.get(type);
    if (a) {
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    }
  }
  dispatchEvent(ev) { return emit(this, ev); }
  focus() {}
  blur() {}
  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight };
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

function emit(target, ev) {
  const list = target._listeners && target._listeners.get(ev.type);
  if (!list) return true;
  for (const fn of list.slice()) {
    try {
      fn.call(target, ev);
    } catch (err) {
      failures++;
      console.error(`  ✗ listener for "${ev.type}" threw: ${err && err.stack ? err.stack.split('\n')[0] : err}`);
    }
  }
  return true;
}

const byId = new Map();

const documentStub = new ElementStub('document');
documentStub.hidden = false;
documentStub.visibilityState = 'visible';
documentStub.head = new ElementStub('head');
documentStub.body = new ElementStub('body');
documentStub.documentElement = new ElementStub('html');
documentStub.createElement = (tag) => new ElementStub(tag);
documentStub.createElementNS = (_ns, tag) => new ElementStub(tag);
documentStub.createTextNode = (t) => ({ nodeType: 3, textContent: String(t) });
documentStub.getElementById = (id) => byId.get(id) || null;
documentStub.querySelector = (sel) => (sel && sel.startsWith('#') ? byId.get(sel.slice(1)) || null : null);
documentStub.querySelectorAll = () => [];

const canvasEl = new ElementStub('canvas');
canvasEl.id = 'game';
canvasEl.width = 480;
canvasEl.height = 270;
const screenEl = new ElementStub('div');
screenEl.clientWidth = 960;
screenEl.clientHeight = 540;
screenEl.appendChild(canvasEl);
byId.set('game', canvasEl);

const touchMount = new ElementStub('div');
touchMount.id = 'touch-controls';
byId.set('touch-controls', touchMount);
documentStub.body.appendChild(touchMount);

/* ------------------------------------------------------------ window stub */

const rafQueue = [];
let rafSeq = 1;
let clockMs = 0;

const store = new Map();
const localStorageStub = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(String(k), String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};

class AudioParamStub {
  constructor(v) { this.value = v; }
  setValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  setTargetAtTime() { return this; }
  cancelScheduledValues() { return this; }
}
class AudioNodeStub {
  constructor(ctx) { this.context = ctx; }
  connect(n) { return n; }
  disconnect() {}
  start() {}
  stop() {}
  addEventListener() {}
}
class AudioContextStub {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.state = 'running';
    this.destination = new AudioNodeStub(this);
  }
  createGain() {
    const n = new AudioNodeStub(this);
    n.gain = new AudioParamStub(1);
    return n;
  }
  createOscillator() {
    const n = new AudioNodeStub(this);
    n.frequency = new AudioParamStub(440);
    n.detune = new AudioParamStub(0);
    n.type = 'square';
    return n;
  }
  createBiquadFilter() {
    const n = new AudioNodeStub(this);
    n.frequency = new AudioParamStub(1000);
    n.Q = new AudioParamStub(1);
    n.gain = new AudioParamStub(0);
    n.type = 'lowpass';
    return n;
  }
  createDynamicsCompressor() {
    const n = new AudioNodeStub(this);
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new AudioParamStub(0);
    return n;
  }
  createBufferSource() {
    const n = new AudioNodeStub(this);
    n.playbackRate = new AudioParamStub(1);
    n.buffer = null;
    return n;
  }
  createBuffer(ch, len, rate) {
    return { numberOfChannels: ch, length: len, sampleRate: rate, getChannelData: () => new Float32Array(len) };
  }
  createWaveShaper() { const n = new AudioNodeStub(this); n.curve = null; return n; }
  createStereoPanner() { const n = new AudioNodeStub(this); n.pan = new AudioParamStub(0); return n; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

const windowStub = new ElementStub('window');
windowStub.innerWidth = 1280;
windowStub.innerHeight = 800;
windowStub.devicePixelRatio = 2;
windowStub.document = documentStub;
windowStub.localStorage = localStorageStub;
windowStub.matchMedia = (q) => ({
  media: q,
  matches: false,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  onchange: null,
});
windowStub.requestAnimationFrame = (fn) => {
  const id = rafSeq++;
  rafQueue.push({ id, fn });
  return id;
};
windowStub.cancelAnimationFrame = (id) => {
  const i = rafQueue.findIndex((f) => f.id === id);
  if (i >= 0) rafQueue.splice(i, 1);
};
windowStub.getComputedStyle = () => ({ getPropertyValue: () => '' });
windowStub.AudioContext = AudioContextStub;
windowStub.webkitAudioContext = AudioContextStub;
windowStub.visualViewport = null;
windowStub.performance = { now: () => clockMs };
windowStub.navigator = { userAgent: 'node-smoke', maxTouchPoints: 0, language: 'en-GB' };

// Publish the globals a browser module expects, before importing main.js.
globalThis.window = windowStub;
globalThis.document = documentStub;
globalThis.self = windowStub;
globalThis.localStorage = localStorageStub;
if (!globalThis.navigator) {
  try { globalThis.navigator = windowStub.navigator; } catch (_) { /* Node ≥21 defines it read-only */ }
} else {
  windowStub.navigator = globalThis.navigator;
}
globalThis.matchMedia = windowStub.matchMedia;
globalThis.AudioContext = AudioContextStub;
globalThis.webkitAudioContext = AudioContextStub;
globalThis.requestAnimationFrame = windowStub.requestAnimationFrame;
globalThis.cancelAnimationFrame = windowStub.cancelAnimationFrame;
globalThis.HTMLCanvasElement = ElementStub;
globalThis.Image = class { constructor() { this.width = 0; this.height = 0; } };
if (!globalThis.performance || typeof globalThis.performance.now !== 'function') {
  globalThis.performance = windowStub.performance;
}

/* ---------------------------------------------------------------- events */

function makeKeyEvent(type, code, key) {
  return {
    type,
    code,
    key: key || code,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    target: canvasEl,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
  };
}

function keyDown(code, key) { emit(windowStub, makeKeyEvent('keydown', code, key)); }
function keyUp(code, key) { emit(windowStub, makeKeyEvent('keyup', code, key)); }

/* ------------------------------------------------------------------ run */

console.log('dom-smoke: booting src/main.js against a stubbed browser\n');

let mod;
try {
  mod = await import('../src/main.js');
} catch (err) {
  console.error('  ✗ importing src/main.js threw:\n' + (err && err.stack ? err.stack : err));
  console.error('\ndom-smoke: FAILED');
  process.exit(1);
}

const { PAUSE_ITEMS } = await import('../src/game/ui.js');
const PAUSE_LAST = PAUSE_ITEMS.length - 1;

ok(!!mod, 'main.js module loaded');
ok(rafQueue.length > 0, 'startLoop() scheduled an animation frame');
ok(canvasEl.width === 480 && canvasEl.height === 270,
  `canvas sized to the internal resolution (got ${canvasEl.width}x${canvasEl.height})`);
ok(canvasEl.getContext('2d') !== null, 'a 2D context was obtained');

const game = mod.__test && mod.__test.game;
ok(!!game, 'game state was created');
ok(game && game.phase === 'title', `game starts on the title screen (got ${game && game.phase})`);

// Pump the loop.
function pumpFrames(n, ms) {
  for (let i = 0; i < n; i++) {
    clockMs += ms;
    const batch = rafQueue.splice(0, rafQueue.length);
    if (!batch.length) {
      failures++;
      console.error('  ✗ the loop stopped scheduling frames at frame ' + i);
      return false;
    }
    for (const f of batch) {
      try {
        f.fn(clockMs);
      } catch (err) {
        failures++;
        console.error('  ✗ frame ' + i + ' threw: ' + (err && err.stack ? err.stack : err));
        return false;
      }
    }
  }
  return true;
}

const seenPhases = new Set();
function watch() { if (game) seenPhases.add(game.phase); }

// 1) title screen for a few frames
pumpFrames(10, 16.7);
watch();
const drawsAfterTitle = (drawCounts.get('fillRect') || 0);
ok(drawsAfterTitle > 50, `title screen issued draw calls (fillRect ×${drawsAfterTitle})`);

// 1b) the page owns the keyboard until the canvas is focused (WCAG 2.1.1)
{
  const inputMod = await import('../src/engine/input.js');

  const scrollKey = makeKeyEvent('keydown', 'ArrowDown', 'ArrowDown');
  scrollKey.target = documentStub.body;
  emit(windowStub, scrollKey);
  pumpFrames(2, 16.7);
  ok(scrollKey.defaultPrevented === false,
    'arrow keys are not preventDefault-ed while the canvas is unfocused (the page can scroll)');
  const scrollUp = makeKeyEvent('keyup', 'ArrowDown', 'ArrowDown');
  scrollUp.target = documentStub.body;
  emit(windowStub, scrollUp);

  const strayEnter = makeKeyEvent('keydown', 'Enter', 'Enter');
  strayEnter.target = documentStub.body;
  emit(windowStub, strayEnter);
  pumpFrames(3, 16.7);
  ok(game.phase === 'title', `an unfocused Enter does not reach the game (phase=${game.phase})`);
  const strayUp = makeKeyEvent('keyup', 'Enter', 'Enter');
  strayUp.target = documentStub.body;
  emit(windowStub, strayUp);

  // A click on a résumé link is not a request to start the game or its audio.
  inputMod.endInputFrame();
  emit(windowStub, { type: 'pointerdown', target: documentStub.body, pointerId: 91 });
  ok(inputMod.input.anyPressed === false,
    'a pointer press elsewhere on the page is not counted as game input');
  emit(windowStub, { type: 'pointerup', target: documentStub.body, pointerId: 91 });

  // Touch controls belong in the declared in-flow mount, never as a fixed
  // overlay on top of the résumé.
  ok(touchMount.children.length === 1 && touchMount.children[0].id === 'cq-touch',
    'touch controls are injected into #touch-controls');
  ok(!documentStub.body.children.some((c) => c && c.id === 'cq-touch'),
    'no fixed touch overlay is appended straight to <body>');
}

// 2) press Enter to start
keyDown('Enter', 'Enter');
pumpFrames(2, 16.7);
keyUp('Enter', 'Enter');
pumpFrames(4, 16.7);
watch();
ok(game.phase === 'levelIntro' || game.phase === 'playing',
  `Enter started a chapter (phase=${game.phase})`);
ok(!!game.level, 'a level was loaded');
ok(!!game.player, 'a player was created');
ok(!!game.entities, 'entities were spawned');

// 3) hold right + jump for ~600 frames of real play
const startX = game.player.x;
keyDown('ArrowRight', 'ArrowRight');
let jumpDown = false;
for (let i = 0; i < 600; i++) {
  if (i % 34 === 0) { keyDown('Space', ' '); jumpDown = true; }
  if (jumpDown && i % 34 === 12) { keyUp('Space', ' '); jumpDown = false; }
  if (!pumpFrames(1, 16.7)) break;
  watch();
}
keyUp('ArrowRight', 'ArrowRight');
if (jumpDown) keyUp('Space', ' ');

ok(seenPhases.has('playing'), 'the game reached the playing phase');
ok(game.player.x > startX + 100,
  `the player actually moved right (${Math.round(startX)} → ${Math.round(game.player.x)})`);
ok((drawCounts.get('fillRect') || 0) > 5000,
  `the world is being drawn every frame (fillRect ×${drawCounts.get('fillRect') || 0})`);
ok((drawCounts.get('fillText') || 0) === 0,
  `no ctx.fillText was used (CONTRACT §5) — got ${drawCounts.get('fillText') || 0}`);

// 4) pause menu round-trip
keyDown('Escape', 'Escape');
pumpFrames(2, 16.7);
keyUp('Escape', 'Escape');
pumpFrames(2, 16.7);
ok(game.phase === 'paused', `Esc opened the pause menu (phase=${game.phase})`);
keyDown('ArrowDown', 'ArrowDown'); pumpFrames(2, 16.7); keyUp('ArrowDown', 'ArrowDown');
pumpFrames(2, 16.7);
ok(game.pauseSel === 1, `pause selection moved (pauseSel=${game.pauseSel})`);

// ↑/W must move the cursor only. They are also bound to jump/action, so a
// naive "any action press confirms" would fire QUIT TO TITLE on the first Up.
game.pauseSel = 0;
keyDown('ArrowUp', 'ArrowUp'); pumpFrames(2, 16.7); keyUp('ArrowUp', 'ArrowUp');
pumpFrames(2, 16.7);
ok(game.phase === 'paused' && game.pauseSel === PAUSE_LAST,
  `Up wraps the pause cursor without activating it (phase=${game.phase}, pauseSel=${game.pauseSel})`);
keyDown('KeyW', 'w'); pumpFrames(2, 16.7); keyUp('KeyW', 'w');
pumpFrames(2, 16.7);
ok(game.phase === 'paused' && game.pauseSel === PAUSE_LAST - 1,
  `W moves the pause cursor without activating it (phase=${game.phase}, pauseSel=${game.pauseSel})`);
game.pauseSel = 0;

keyDown('Escape', 'Escape'); pumpFrames(2, 16.7); keyUp('Escape', 'Escape');
pumpFrames(2, 16.7);
ok(game.phase === 'playing', `Esc resumed play (phase=${game.phase})`);

// 4b) chapter select: Up navigates, Enter launches
{
  game.save.maxLevel = 3;
  game.selectSel = 0;
  game.selectFrom = 'paused';
  game.phase = 'levelSelect';
  game.phaseT = 0;
  keyDown('ArrowUp', 'ArrowUp'); pumpFrames(2, 16.7); keyUp('ArrowUp', 'ArrowUp');
  pumpFrames(2, 16.7);
  ok(game.phase === 'levelSelect' && game.selectSel === 3,
    `Up moves the chapter cursor without launching (phase=${game.phase}, selectSel=${game.selectSel})`);
  keyDown('Enter', 'Enter'); pumpFrames(2, 16.7); keyUp('Enter', 'Enter');
  pumpFrames(2, 16.7);
  ok(game.phase === 'levelIntro' || game.phase === 'playing',
    `Enter launches the selected chapter (phase=${game.phase})`);
  ok(game.levelIndex === 3, `the launched chapter is the selected one (levelIndex=${game.levelIndex})`);
}

// 5) force each remaining screen through a render pass
const before = failures;
for (const phase of ['levelIntro', 'levelComplete', 'levelSelect', 'ending', 'dialogue', 'paused', 'title']) {
  game.phase = phase;
  game.phaseT = 0.4;
  if (phase === 'dialogue') {
    game.dialogue = { name: 'Engineering Lead', lines: ['Ship it.', 'Then measure it.'], index: 0, t: 0.3 };
  }
  game.toast = { text: 'ABILITY UNLOCKED — Sprint Dash', t: 0.2 };
  if (!pumpFrames(4, 16.7)) break;
}
ok(failures === before, 'every phase renders without throwing');

// 6) resize + visibility events must not throw
emit(windowStub, { type: 'resize' });
documentStub.hidden = true;
emit(documentStub, { type: 'visibilitychange' });
documentStub.hidden = false;
emit(documentStub, { type: 'visibilitychange' });
pumpFrames(3, 16.7);
ok(true, 'resize / visibilitychange handled');

// 7) progress persistence
game.phase = 'playing';
game.save.maxLevel = 2;
game.save.best['bristol'] = { coins: 25, timeMs: 41000 };
const state = await import('../src/game/state.js');
const { saveProgress, loadProgress, SAVE_KEY } = state;
saveProgress(game);
ok(localStorageStub.getItem(SAVE_KEY) !== null, 'progress written to localStorage');
const reread = loadProgress();
ok(reread.maxLevel === 2 && reread.best.bristol && reread.best.bristol.coins === 25,
  'progress round-trips through localStorage');

/* ---------------------------------------------------- chapter progression */
// Drives the real phase machine through a chapter completion for every level,
// so the "finish a level → unlock → next chapter → ending" wiring is exercised
// end to end rather than only by forcing phases.
{
  localStorageStub.clear();
  const g = state.createGame();
  const CTL = {
    left: false, right: false, up: false, down: false,
    jump: false, jumpPressed: false, dash: false, dashPressed: false,
  };
  const DT = 1 / 60;
  let progressionOk = true;
  let unlocksSeen = 0;

  for (let i = 0; i < state.LEVELS.length && progressionOk; i++) {
    state.loadLevel(g, i);
    if (g.levelIndex !== i) { progressionOk = false; break; }

    // Skip the intro card.
    for (let f = 0; f < 200 && g.phase === 'levelIntro'; f++) state.updateGame(g, CTL, DT);
    if (g.phase !== 'playing') { progressionOk = false; break; }

    // Teleport onto the door rather than replaying the whole chapter here —
    // tools/headless-play.mjs already proves the traversal.
    const door = g.entities.door;
    const boss = g.entities.boss;
    if (boss) { boss.alive = false; door.open = true; }
    g.player.x = door.x + 2;
    g.player.y = door.y + 1;
    g.player.vx = 0;
    g.player.vy = 0;

    for (let f = 0; f < 400 && g.phase !== 'levelComplete'; f++) state.updateGame(g, CTL, DT);
    if (g.phase !== 'levelComplete') { progressionOk = false; break; }

    const unlock = state.LEVELS[i].unlocks;
    if (unlock) {
      if (!g.abilities[unlock]) { progressionOk = false; break; }
      unlocksSeen++;
    }

    state.advanceLevel(g);
    const expected = i + 1 >= state.LEVELS.length ? 'ending' : 'levelIntro';
    if (g.phase !== expected) { progressionOk = false; break; }
  }

  // The run timer must advance with simulated time only, and only while playing.
  const g2 = state.createGame();
  state.loadLevel(g2, 0);
  for (let f = 0; f < 200 && g2.phase === 'levelIntro'; f++) state.updateGame(g2, CTL, DT);
  const t0 = g2.timeMs;
  for (let f = 0; f < 180; f++) state.updateGame(g2, CTL, DT);
  const played = g2.timeMs - t0;
  ok(Math.abs(played - 3000) < 40, `run timer tracks simulated time (180 frames → ${Math.round(played)}ms)`);
  state.setPhase(g2, 'paused');
  const tPaused = g2.timeMs;
  for (let f = 0; f < 120; f++) state.updateGame(g2, CTL, DT);
  ok(g2.timeMs === tPaused, 'the run timer is frozen while paused');

  ok(progressionOk, 'every chapter completes and advances through the phase machine');
  ok(unlocksSeen === 4, `all four abilities are granted on completion (got ${unlocksSeen})`);
  ok(g.phase === 'ending', `finishing the last chapter reaches the ending (phase=${g.phase})`);
  ok(g.save.maxLevel === state.LEVELS.length - 1,
    `save.maxLevel advanced to ${state.LEVELS.length - 1} (got ${g.save.maxLevel})`);
  ok(Object.keys(g.save.best).length === state.LEVELS.length,
    `a best run was recorded for all ${state.LEVELS.length} chapters (got ${Object.keys(g.save.best).length})`);
}

/* --------------------------------------------------------------- teardown */
// audio.js runs a setInterval lookahead scheduler and loop.js keeps a rAF
// pending; both would hold the Node event loop open forever.
try {
  const audio = await import('../src/engine/audio.js');
  audio.stopMusic();
} catch (_) { /* no-op */ }
try {
  const loop = await import('../src/engine/loop.js');
  loop.stopLoop();
} catch (_) { /* no-op */ }
rafQueue.length = 0;

console.log(`\ndom-smoke: ${checks} checks, ${failures} failure(s)`);
console.log('dom-smoke: draw calls — '
  + ['fillRect', 'drawImage', 'fill', 'save', 'translate']
    .map((k) => `${k}:${drawCounts.get(k) || 0}`).join('  '));
if (failures) {
  console.error('dom-smoke: FAILED');
  process.exit(1);
}
console.log('dom-smoke: OK');
process.exit(0);
