// src/engine/input.js
// Keyboard + on-screen touch input. This module touches the DOM, but only from
// inside functions — importing it never reads `window` or `document`.
//
// Bindings (CONTRACT §3):
//   ←/→/A/D move · ↑/W/Space/Z jump · ↓/S drop · Shift/X dash · E/↑ action · Esc/P pause
// Enter is additionally treated as action+jump so "Press Enter" prompts work.

export const input = {
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  dash: false,
  action: false,
  pause: false,
  // `confirm` is deliberately NOT bound to ↑/W. Those keys double as menu
  // navigation, and a key that both moves the cursor and fires the item it
  // lands on makes upward navigation impossible.
  confirm: false,
  // edge-triggered, cleared by endInputFrame()
  jumpPressed: false,
  dashPressed: false,
  actionPressed: false,
  pausePressed: false,
  confirmPressed: false,
  anyPressed: false,
};

const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'dash', 'action', 'pause', 'confirm'];

const BINDINGS = {
  ArrowLeft: ['left'],
  KeyA: ['left'],
  ArrowRight: ['right'],
  KeyD: ['right'],
  ArrowUp: ['up', 'jump', 'action'],
  KeyW: ['up', 'jump', 'action'],
  ArrowDown: ['down'],
  KeyS: ['down'],
  Space: ['jump', 'confirm'],
  KeyZ: ['jump', 'confirm'],
  ShiftLeft: ['dash'],
  ShiftRight: ['dash'],
  KeyX: ['dash'],
  KeyE: ['action', 'confirm'],
  Enter: ['action', 'jump', 'confirm'],
  NumpadEnter: ['action', 'jump', 'confirm'],
  Escape: ['pause'],
  KeyP: ['pause'],
};

// On-screen buttons carry a single action name; the A button doubles as the
// menu confirm, exactly like Space/Enter on a keyboard.
const TOUCH_EXTRA = { jump: ['confirm'] };

// Fallback for browsers/layouts where KeyboardEvent.code is unavailable.
const KEY_FALLBACK = {
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  a: 'KeyA',
  d: 'KeyD',
  w: 'KeyW',
  s: 'KeyS',
  z: 'KeyZ',
  x: 'KeyX',
  e: 'KeyE',
  p: 'KeyP',
  ' ': 'Space',
  spacebar: 'Space',
  shift: 'ShiftLeft',
  enter: 'Enter',
  escape: 'Escape',
  esc: 'Escape',
};

const PREVENT = { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, Space: 1 };

const keyHeld = new Set();      // key codes currently down
const touchHeld = new Set();    // action names held by on-screen buttons
const pointerAct = new Map();   // pointerId -> action name

let started = false;
let touchRoot = null;
let coarseQuery = null;
let canvasRef = null;

/**
 * Attach listeners and build the on-screen touch controls.
 * Safe to call more than once.
 * @param {HTMLCanvasElement} [canvasEl]
 */
export function initInput(canvasEl) {
  if (started) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  started = true;

  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp, { passive: false });
  window.addEventListener('blur', clearAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearAll();
  });

  // Any pointer press counts as "any input" (used to unlock audio / start).
  window.addEventListener('pointerdown', onGlobalPointerDown, { passive: true });
  window.addEventListener('pointerup', onGlobalPointerUp, { passive: true });
  window.addEventListener('pointercancel', onGlobalPointerUp, { passive: true });

  if (canvasEl) {
    canvasRef = canvasEl;
    if (!canvasEl.hasAttribute('tabindex')) canvasEl.setAttribute('tabindex', '0');
    // NOT `touch-action: none` — that would also kill page scrolling for a
    // finger that happens to start its swipe on the hero canvas. The on-screen
    // buttons set `touch-action: none` on themselves instead.
    canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
    canvasEl.addEventListener('blur', clearAll);
  }

  buildTouchControls();
  refreshTouchVisibility();
}

/** Clears the edge-triggered flags. Call once at the end of every frame. */
export function endInputFrame() {
  input.jumpPressed = false;
  input.dashPressed = false;
  input.actionPressed = false;
  input.pausePressed = false;
  input.confirmPressed = false;
  input.anyPressed = false;
}

// ---------------------------------------------------------------------------
// keyboard
// ---------------------------------------------------------------------------

function codeOf(e) {
  if (e.code && BINDINGS[e.code]) return e.code;
  const k = typeof e.key === 'string' ? e.key.toLowerCase() : '';
  const mapped = KEY_FALLBACK[k];
  if (mapped) return mapped;
  if (e.code === 'ShiftRight') return 'ShiftRight';
  return e.code || '';
}

function isTypingTarget(t) {
  if (!t || !t.tagName) return false;
  const tag = t.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true;
}

/**
 * Keys only reach the game while the canvas is the focused element. Otherwise
 * the page owns the keyboard: a recruiter reading the résumé must be able to
 * scroll with ↓/Space (WCAG 2.1.1), and the hidden game must not react to it.
 * Clicking, tapping or tabbing to the canvas hands the keyboard to the game.
 */
function canvasHasFocus(e) {
  if (!canvasRef) return false;
  if (e && e.target === canvasRef) return true;
  try {
    return typeof document !== 'undefined' && document.activeElement === canvasRef;
  } catch (_) {
    return false;
  }
}

function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTypingTarget(e.target)) return;
  if (!canvasHasFocus(e)) return;

  const code = codeOf(e);
  const acts = BINDINGS[code];

  if (acts && PREVENT[code]) e.preventDefault();
  if (e.repeat) return;

  applyChange(() => {
    input.anyPressed = true;
    if (acts) keyHeld.add(code);
  });
}

function onKeyUp(e) {
  const code = codeOf(e);
  if (!BINDINGS[code]) {
    // A modifier release can strand held keys; be forgiving with Shift.
    if (code === 'ShiftLeft' || code === 'ShiftRight') {
      applyChange(() => { keyHeld.delete('ShiftLeft'); keyHeld.delete('ShiftRight'); });
    }
    return;
  }
  // Releases are always honoured — losing focus mid-press must not strand a
  // held key — but only swallow the default while the canvas owns the keys.
  if (PREVENT[code] && canvasHasFocus(e)) e.preventDefault();
  applyChange(() => { keyHeld.delete(code); });
}

function clearAll() {
  applyChange(() => {
    keyHeld.clear();
    touchHeld.clear();
    pointerAct.clear();
  });
  syncTouchVisuals();
}

// ---------------------------------------------------------------------------
// state assembly
// ---------------------------------------------------------------------------

function applyChange(mutate) {
  const wasJump = input.jump;
  const wasDash = input.dash;
  const wasAction = input.action;
  const wasPause = input.pause;
  const wasConfirm = input.confirm;

  mutate();
  recompute();

  if (!wasJump && input.jump) { input.jumpPressed = true; input.anyPressed = true; }
  if (!wasDash && input.dash) { input.dashPressed = true; input.anyPressed = true; }
  if (!wasAction && input.action) { input.actionPressed = true; input.anyPressed = true; }
  if (!wasPause && input.pause) { input.pausePressed = true; input.anyPressed = true; }
  if (!wasConfirm && input.confirm) { input.confirmPressed = true; input.anyPressed = true; }
}

function recompute() {
  const on = new Set();
  for (const act of touchHeld) {
    on.add(act);
    const extra = TOUCH_EXTRA[act];
    if (extra) for (let i = 0; i < extra.length; i++) on.add(extra[i]);
  }
  for (const code of keyHeld) {
    const acts = BINDINGS[code];
    if (!acts) continue;
    for (let i = 0; i < acts.length; i++) on.add(acts[i]);
  }
  for (let i = 0; i < ACTIONS.length; i++) input[ACTIONS[i]] = on.has(ACTIONS[i]);
}

// ---------------------------------------------------------------------------
// touch controls
// ---------------------------------------------------------------------------

// The controls live *in the page flow*, inside the #touch-controls mount that
// index.html declares directly beneath the cabinet — never as a fixed overlay.
// A fixed overlay would sit on top of the résumé for the whole scroll and
// swallow taps on the contact links underneath it.
const TOUCH_CSS = `
#cq-touch{position:relative;width:100%;box-sizing:border-box;
  padding:42px 0 4px;min-height:196px;pointer-events:none;display:none;
  font:600 16px/1 ui-monospace,SFMono-Regular,Menlo,monospace;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;
  touch-action:none;}
#cq-touch.cq-on{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;}
#cq-touch .cq-pad{flex:none;width:150px;height:150px;
  display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);}
#cq-touch .cq-acts{flex:none;display:flex;align-items:flex-end;gap:14px;}
#cq-touch .cq-btn{pointer-events:auto;-webkit-appearance:none;appearance:none;
  margin:0;padding:0;color:#cfe3ff;background:rgba(16,20,32,.55);
  border:2px solid rgba(150,190,255,.45);border-radius:10px;
  display:flex;align-items:center;justify-content:center;
  backdrop-filter:blur(2px);touch-action:none;transition:background .06s linear;}
#cq-touch .cq-btn.cq-down-state{background:rgba(90,150,255,.65);color:#fff;}
#cq-touch .cq-up{grid-area:1/2/2/3}
#cq-touch .cq-left{grid-area:2/1/3/2}
#cq-touch .cq-right{grid-area:2/3/3/4}
#cq-touch .cq-dn{grid-area:3/2/4/3}
#cq-touch .cq-round{width:66px;height:66px;border-radius:50%;font-size:20px;}
#cq-touch .cq-b{margin-bottom:26px;}
#cq-touch .cq-pause{position:absolute;right:0;top:0;width:44px;height:34px;font-size:13px;}
@media (prefers-reduced-motion:reduce){#cq-touch .cq-btn{transition:none}}
`;

function buildTouchControls() {
  if (touchRoot || !document.body) return;

  if (!document.getElementById('cq-touch-style')) {
    const style = document.createElement('style');
    style.id = 'cq-touch-style';
    style.textContent = TOUCH_CSS;
    document.head.appendChild(style);
  }

  const root = document.createElement('div');
  root.id = 'cq-touch';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Touch controls');

  const pad = document.createElement('div');
  pad.className = 'cq-pad';
  pad.appendChild(mkBtn('up', '▲', 'cq-up', 'Up'));
  pad.appendChild(mkBtn('left', '◀', 'cq-left', 'Left'));
  pad.appendChild(mkBtn('right', '▶', 'cq-right', 'Right'));
  pad.appendChild(mkBtn('down', '▼', 'cq-dn', 'Down'));
  root.appendChild(pad);

  const acts = document.createElement('div');
  acts.className = 'cq-acts';
  acts.appendChild(mkBtn('dash', 'B', 'cq-round cq-b', 'Dash'));
  acts.appendChild(mkBtn('jump', 'A', 'cq-round cq-a', 'Jump'));
  root.appendChild(acts);

  root.appendChild(mkBtn('pause', 'II', 'cq-pause', 'Pause'));

  root.addEventListener('pointerdown', onPadPointerDown);
  root.addEventListener('pointermove', onPadPointerMove);
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  root.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  root.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  const mount = document.getElementById('touch-controls') || document.body;
  mount.appendChild(root);
  touchRoot = root;
}

function mkBtn(act, label, cls, aria) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cq-btn ' + cls;
  b.dataset.act = act;
  b.textContent = label;
  b.setAttribute('aria-label', aria);
  return b;
}

function refreshTouchVisibility() {
  if (!touchRoot) return;
  let coarse = false;
  try {
    if (typeof window.matchMedia === 'function') {
      if (!coarseQuery) {
        coarseQuery = window.matchMedia('(pointer: coarse)');
        const onChange = () => refreshTouchVisibility();
        if (typeof coarseQuery.addEventListener === 'function') {
          coarseQuery.addEventListener('change', onChange);
        } else if (typeof coarseQuery.addListener === 'function') {
          coarseQuery.addListener(onChange);
        }
      }
      coarse = !!coarseQuery.matches;
    }
  } catch (_) {
    coarse = false;
  }
  touchRoot.classList.toggle('cq-on', coarse);
  touchRoot.setAttribute('aria-hidden', coarse ? 'false' : 'true');
  if (!coarse) {
    applyChange(() => { touchHeld.clear(); pointerAct.clear(); });
    syncTouchVisuals();
  }
}

function actAtPoint(x, y) {
  if (!document.elementFromPoint) return null;
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const btn = el.closest ? el.closest('[data-act]') : null;
  if (!btn || !touchRoot || !touchRoot.contains(btn)) return null;
  return btn.dataset.act || null;
}

function onPadPointerDown(e) {
  const target = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
  if (!target) return;
  e.preventDefault();
  const act = target.dataset.act;
  applyChange(() => {
    pointerAct.set(e.pointerId, act);
    rebuildTouchHeld();
    input.anyPressed = true;
  });
  syncTouchVisuals();
}

function onPadPointerMove(e) {
  if (!pointerAct.has(e.pointerId)) return;
  const act = actAtPoint(e.clientX, e.clientY);
  if (act === pointerAct.get(e.pointerId)) return;
  e.preventDefault();
  applyChange(() => {
    if (act) pointerAct.set(e.pointerId, act);
    else pointerAct.delete(e.pointerId);
    rebuildTouchHeld();
  });
  syncTouchVisuals();
}

function onGlobalPointerDown(e) {
  // "Any input" means any input *aimed at the game*. A click on a résumé link
  // is not a request to start the game or its audio.
  const t = e && e.target;
  const onCanvas = !!canvasRef && t === canvasRef;
  const onPad = !!touchRoot && !!t && typeof touchRoot.contains === 'function'
    && touchRoot.contains(t);
  if (onCanvas || onPad) input.anyPressed = true;
}

function onGlobalPointerUp(e) {
  if (!pointerAct.has(e.pointerId)) return;
  applyChange(() => {
    pointerAct.delete(e.pointerId);
    rebuildTouchHeld();
  });
  syncTouchVisuals();
}

function rebuildTouchHeld() {
  touchHeld.clear();
  for (const act of pointerAct.values()) touchHeld.add(act);
}

function syncTouchVisuals() {
  if (!touchRoot) return;
  const btns = touchRoot.querySelectorAll('[data-act]');
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i];
    b.classList.toggle('cq-down-state', touchHeld.has(b.dataset.act));
  }
}
