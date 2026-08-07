// src/main.js — the bootstrap. Wires the DOM shell to the engine, the game
// state machine, the renderer, the UI layer and the audio engine.
//
// Everything below the fold in index.html works without JS; this file only ever
// enhances the <canvas id="game">.

import { VIEW_W, VIEW_H } from './engine/constants.js';
import { input, initInput, endInputFrame } from './engine/input.js';
import { startLoop } from './engine/loop.js';
import {
  initAudio, playSfx, playMusic, stopMusic, setMuted, isMuted,
} from './engine/audio.js';
import { initRenderer, renderWorld, resizeCanvas } from './game/render.js';
import {
  drawHud, drawTitle, drawLevelIntro, drawLevelComplete, drawDialogue,
  drawPause, drawLevelSelect, drawEnding, drawToast, drawText,
  PAUSE_ITEMS, levelCompletePageCount,
} from './game/ui.js';
import {
  createGame, loadLevel, restartLevel, updateGame, saveProgress,
  setPhase, advanceLevel, advanceDialogue, openDialogue, showToast,
  unlockedCount, pushSfx, LEVELS,
} from './game/state.js';

/* ------------------------------------------------------------------ setup */

const canvas = typeof document !== 'undefined' ? document.getElementById('game') : null;
let ctx = null;
let game = null;
let audioReady = false;
let currentMusic = null;

// Edge detection for the directional keys, which input.js exposes as levels
// rather than presses. Menus need presses.
const edges = { up: false, down: false, left: false, right: false };
const edgePressed = { up: false, down: false, left: false, right: false };

function pumpEdges() {
  for (const k of Object.keys(edges)) {
    const now = !!input[k];
    edgePressed[k] = now && !edges[k];
    edges[k] = now;
  }
}

/* ------------------------------------------------------------------ audio */

function unlockAudio() {
  if (audioReady) return;
  audioReady = true;
  try {
    initAudio();
    setMuted(!!(game && game.muted));
  } catch (_) { /* audio must never break gameplay */ }
}

function music(themeKey) {
  if (currentMusic === themeKey) return;
  currentMusic = themeKey;
  try { playMusic(themeKey); } catch (_) { /* no-op */ }
}

function drainSfx() {
  if (!game || !Array.isArray(game.sfxQueue) || !game.sfxQueue.length) return;
  const q = game.sfxQueue;
  for (let i = 0; i < q.length; i++) {
    try { playSfx(q[i]); } catch (_) { /* no-op */ }
  }
  q.length = 0;
}

function toggleMute() {
  if (!game) return;
  const next = !game.muted;
  game.muted = next;
  game.save.muted = next;
  try { setMuted(next); } catch (_) { /* no-op */ }
  saveProgress(game);
  syncMuteButton();
}

/* Visible, always-reachable sound switch in the page shell (WCAG 1.4.2). The
   in-canvas pause menu item stays, but it cannot be the only control. */
let muteBtn = null;

function syncMuteButton() {
  if (!muteBtn || !game) return;
  const on = !game.muted;
  muteBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  muteBtn.textContent = on ? 'Sound on' : 'Sound off';
  muteBtn.setAttribute('title', on ? 'Turn the game sound off' : 'Turn the game sound on');
}

function initMuteButton() {
  muteBtn = typeof document !== 'undefined' ? document.getElementById('sound-toggle') : null;
  if (!muteBtn) return;
  muteBtn.hidden = false;
  muteBtn.addEventListener('click', () => {
    // Pressing the switch is itself a gesture: unmuting must be audible.
    unlockAudio();
    toggleMute();
    if (!game.muted) music(currentMusic || 'title');
  });
  syncMuteButton();
}

/* -------------------------------------------------------------- transitions */

function startChapter(index) {
  loadLevel(game, index);
  music(game.level.theme);
  pushSfx(game, 'select');
}

function toTitle() {
  setPhase(game, 'title');
  game.dialogue = null;
  game.toast = null;
  game.selectFrom = null;
  music('title');
}

/* ------------------------------------------------------------------ input */

function handleInput() {
  if (!game) return;
  const anyStart = input.actionPressed || input.jumpPressed;

  switch (game.phase) {
    /* ------------------------------------------------------------ title */
    case 'title': {
      if (anyStart) {
        const resume = Math.min(game.save.maxLevel, LEVELS.length - 1);
        startChapter(resume);
      } else if (input.pausePressed && game.save.maxLevel > 0) {
        game.selectSel = Math.min(game.save.maxLevel, LEVELS.length - 1);
        game.selectFrom = 'title';
        setPhase(game, 'levelSelect');
        pushSfx(game, 'select');
      }
      break;
    }

    /* ------------------------------------------------------- levelIntro */
    case 'levelIntro':
      if (anyStart || input.pausePressed) setPhase(game, 'playing');
      break;

    /* ---------------------------------------------------------- playing */
    case 'playing': {
      if (input.pausePressed) {
        game.pauseSel = 0;
        setPhase(game, 'paused');
        pushSfx(game, 'select');
        break;
      }
      if (input.actionPressed && game.nearNpc) {
        openDialogue(game, game.nearNpc);
      }
      break;
    }

    /* --------------------------------------------------------- dialogue */
    case 'dialogue':
      if (anyStart) advanceDialogue(game);
      else if (input.pausePressed) {
        game.dialogue = null;
        setPhase(game, 'playing');
      }
      break;

    /* ---------------------------------------------------- levelComplete */
    case 'levelComplete': {
      if (!anyStart) break;
      const pages = Math.max(1, levelCompletePageCount(game));
      if (game.completePage < pages - 1) {
        game.completePage++;
        pushSfx(game, 'select');
      } else {
        game.unlockPending = null;
        advanceLevel(game);
        if (game.phase === 'ending') music('title');
        else music(game.level.theme);
      }
      break;
    }

    /* ------------------------------------------------------------ paused */
    case 'paused': {
      pumpMenu(PAUSE_ITEMS.length, 'pauseSel');
      if (input.pausePressed) {
        setPhase(game, 'playing');
        break;
      }
      // Menus confirm on Enter/Space/Z/E (and the on-screen A button) only.
      // ↑/W move the cursor, so they must never also fire the item.
      if (!input.confirmPressed) break;
      switch (game.pauseSel) {
        case 0:
          setPhase(game, 'playing');
          break;
        case 1:
          restartLevel(game, { phase: 'playing' });
          music(game.level.theme);
          break;
        case 2:
          game.selectSel = game.levelIndex;
          game.selectFrom = 'paused';
          setPhase(game, 'levelSelect');
          break;
        case 3:
          toggleMute();
          break;
        case 4:
          toTitle();
          break;
        default:
          break;
      }
      pushSfx(game, 'select');
      break;
    }

    /* ------------------------------------------------------ levelSelect */
    case 'levelSelect': {
      const n = unlockedCount(game);
      pumpMenu(n, 'selectSel');
      if (input.pausePressed) {
        // Back out to wherever the select screen was opened from — quitting to
        // the title leaves game.level set, so "is a level loaded" is not the
        // same question as "was this opened from the pause menu".
        setPhase(game, game.selectFrom === 'paused' && game.level ? 'paused' : 'title');
        break;
      }
      if (input.confirmPressed) startChapter(Math.min(game.selectSel, n - 1));
      break;
    }

    /* ------------------------------------------------------------ ending */
    case 'ending':
      if (anyStart && game.phaseT > 1.2) toTitle();
      break;

    default:
      break;
  }
}

function pumpMenu(count, key) {
  if (count <= 0) return;
  let sel = game[key] || 0;
  if (edgePressed.up || edgePressed.left) { sel--; pushSfx(game, 'select'); }
  if (edgePressed.down || edgePressed.right) { sel++; pushSfx(game, 'select'); }
  game[key] = ((sel % count) + count) % count;
}

/* ---------------------------------------------------------------- update */

function update(dt) {
  if (!game) return;
  pumpEdges();
  if (input.anyPressed) unlockAudio();

  handleInput();

  // Ability unlock toast, raised the frame the completion card appears.
  if (game.unlockPending && game.phase === 'levelComplete') {
    showToast(game, 'ABILITY UNLOCKED — ' + game.unlockPending, null);
    pushSfx(game, 'unlock');
    game.unlockPending = null;
  }

  const controls = game.phase === 'playing' ? input : NO_CONTROLS;
  updateGame(game, controls, dt);

  drainSfx();
  endInputFrame();
}

const NO_CONTROLS = {
  left: false, right: false, up: false, down: false,
  jump: false, jumpPressed: false, dash: false, dashPressed: false,
};

/* ---------------------------------------------------------------- render */

function render() {
  if (!ctx || !game) return;

  const phase = game.phase;
  const inWorld = phase !== 'title' && phase !== 'ending' && !!game.level;

  if (inWorld) {
    renderWorld(ctx, game, game.cam, 0);
    drawHud(ctx, game);
  } else {
    ctx.fillStyle = '#070a14';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  switch (phase) {
    case 'title':
      drawTitle(ctx, game, game.phaseT);
      break;
    case 'levelIntro':
      drawLevelIntro(ctx, game.level, game.phaseT);
      break;
    case 'dialogue':
      drawDialogue(ctx, game.dialogue, game.phaseT);
      break;
    case 'levelComplete':
      drawLevelComplete(ctx, game, game.phaseT);
      break;
    case 'paused':
      drawPause(ctx, game);
      break;
    case 'levelSelect':
      drawLevelSelect(ctx, game, game.selectSel);
      break;
    case 'ending':
      drawEnding(ctx, game, game.phaseT);
      break;
    default:
      break;
  }

  // Prompts and toasts sit above everything except the menus.
  if (phase === 'playing') {
    if (game.prompt) {
      const cam = game.cam || { x: 0, y: 0 };
      const sx = Math.round(game.prompt.x - cam.x);
      const sy = Math.round(game.prompt.y - cam.y) - 12;
      if (sx > 8 && sx < VIEW_W - 8 && sy > 8 && sy < VIEW_H - 8) {
        drawText(ctx, 'E  ' + game.prompt.text, sx, sy, {
          align: 'center', color: '#63e0cf', shadow: true,
        });
      }
    }
  }
  if (game.toast && phase !== 'levelSelect' && phase !== 'paused') {
    drawToast(ctx, game.toast, game.toast.t || 0);
  }
}

/* ------------------------------------------------------------------ boot */

function boot() {
  if (!canvas) return;

  ctx = initRenderer(canvas);
  if (!ctx) return;

  game = createGame();
  game.muted = isMuted() || !!game.save.muted;
  game.save.muted = game.muted;

  initInput(canvas);
  initMuteButton();

  // Audio only ever starts from a gesture *on the cabinet itself*. A visitor
  // who clicks the "Résumé" nav link or taps a phone number must never be
  // handed a chiptune they did not ask for (WCAG 1.4.2).
  const gesture = () => {
    unlockAudio();
    if (!game || !game.muted) music(currentMusic || 'title');
  };
  canvas.addEventListener('pointerdown', gesture, { passive: true });
  canvas.addEventListener('keydown', gesture);
  // The on-screen D-pad is part of the cabinet, so a touch player who never
  // taps the canvas still gets sound — and still only from a game gesture.
  const touchMount = document.getElementById('touch-controls');
  if (touchMount) touchMount.addEventListener('pointerdown', gesture, { passive: true });

  window.addEventListener('resize', () => resizeCanvas(canvas), { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => resizeCanvas(canvas), { passive: true });
  }

  // Focus the canvas when the player clicks it so keys reach the game.
  canvas.addEventListener('pointerdown', () => {
    try { canvas.focus({ preventScroll: true }); } catch (_) { canvas.focus(); }
  });

  window.addEventListener('pagehide', () => {
    try { saveProgress(game); stopMusic(); } catch (_) { /* no-op */ }
  });

  setPhase(game, 'title');
  startLoop(update, render);
}

boot();

// Exposed for the smoke harness in tools/dom-smoke.mjs.
export const __test = { get game() { return game; }, update, render, boot };
