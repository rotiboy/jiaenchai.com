// src/engine/loop.js
// Fixed-timestep game loop with an accumulator and interpolation alpha.
// DOM is only touched from inside the functions, never at import time.

import { FIXED_DT, MAX_CATCHUP_STEPS } from './constants.js';

let rafId = 0;
let running = false;
let lastT = -1;
let acc = 0;
let updateFn = null;
let renderFn = null;
let visListener = null;

/**
 * Starts the loop. Any previously running loop is stopped first.
 * @param {(dt:number)=>void} update  called with the fixed step, up to 5x per frame
 * @param {(alpha:number)=>void} render called once per animation frame, alpha in [0,1)
 */
export function startLoop(update, render) {
  stopLoop();
  if (typeof update !== 'function') throw new TypeError('startLoop: update must be a function');
  if (typeof render !== 'function') throw new TypeError('startLoop: render must be a function');

  updateFn = update;
  renderFn = render;
  running = true;
  lastT = -1;
  acc = 0;

  if (typeof document !== 'undefined' && document.addEventListener) {
    visListener = () => { if (!document.hidden) { lastT = -1; acc = 0; } };
    document.addEventListener('visibilitychange', visListener);
  }

  rafId = raf(frame);
}

/** Stops the loop and releases callbacks. */
export function stopLoop() {
  running = false;
  if (rafId) {
    caf(rafId);
    rafId = 0;
  }
  if (visListener && typeof document !== 'undefined' && document.removeEventListener) {
    document.removeEventListener('visibilitychange', visListener);
  }
  visListener = null;
  updateFn = null;
  renderFn = null;
  lastT = -1;
  acc = 0;
}

// ---------------------------------------------------------------------------

function frame(t) {
  if (!running) return;
  rafId = raf(frame);

  const now = (typeof t === 'number' && isFinite(t)) ? t : nowMs();
  if (lastT < 0) lastT = now;
  let dt = (now - lastT) / 1000;
  lastT = now;

  if (!(dt > 0)) dt = 0;
  if (dt > 0.25) dt = 0.25;   // a long stall must not spiral the simulation

  acc += dt;

  let steps = 0;
  while (acc >= FIXED_DT && steps < MAX_CATCHUP_STEPS) {
    updateFn(FIXED_DT);
    acc -= FIXED_DT;
    steps++;
  }
  if (steps === MAX_CATCHUP_STEPS && acc > FIXED_DT) acc = 0; // drop the backlog

  renderFn(acc / FIXED_DT);
}

function nowMs() {
  if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function raf(fn) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
  return setTimeout(() => fn(nowMs()), 16);
}

function caf(id) {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
}
