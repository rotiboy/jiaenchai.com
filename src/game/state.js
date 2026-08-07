// src/game/state.js — game state, level loading, the phase machine and save
// persistence (CONTRACT §5).
//
// Deliberately free of rendering, audio and input: the only host API it touches
// is localStorage, and that behind a `typeof` guard, so this module imports and
// runs in bare Node.js. main.js owns the DOM, drains `game.sfxQueue` into the
// audio engine and consumes `game.shakeRequest`.

import { TILE, VIEW_W, VIEW_H } from '../engine/constants.js';
import { createCamera, updateCamera, shake } from '../engine/camera.js';
import { createPlayer, updatePlayer, respawnPlayer } from './player.js';
import { spawnEntities, updateEntities, collideEntities } from './entities.js';
import { LEVELS, getLevel } from './levels/index.js';

export const SAVE_KEY = 'cjen-career-quest-v1';

/** How long the level intro card is held before play begins. */
export const INTRO_TIME = 2.5;
/** Delay between touching the door and the completion card appearing. */
export const OUTRO_TIME = 0.8;
/** Toast lifetime, matched to ui.js's default. */
export const TOAST_TIME = 3.2;

const MAX_DT = 1 / 30;
const ABILITY_KEYS = ['dash', 'doubleJump', 'glide', 'companion'];

/* ------------------------------------------------------------------ utils */

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function storage() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    return localStorage;
  } catch (_) {
    return null;   // Safari private mode throws on access
  }
}

function blankAbilities() {
  return { dash: false, doubleJump: false, glide: false, companion: false };
}

/** Union of the unlocks granted by every chapter before `index`. */
export function abilitiesFor(index) {
  const ab = blankAbilities();
  const n = clamp(Math.floor(Number(index) || 0), 0, LEVELS.length);
  for (let i = 0; i < n; i++) {
    const u = LEVELS[i] && LEVELS[i].unlocks;
    if (u && Object.prototype.hasOwnProperty.call(ab, u)) ab[u] = true;
  }
  return ab;
}

/** Total collectible value in a level: 'o' = 1, '*' = 5. */
export function countCollectibles(level) {
  let total = 0;
  const rows = (level && level.rows) || [];
  for (const row of rows) {
    for (const ch of row) {
      if (ch === 'o') total += 1;
      else if (ch === '*') total += 5;
    }
  }
  return total;
}

/* --------------------------------------------------------------- progress */

function blankSave() {
  return { maxLevel: 0, best: {}, muted: false };
}

/** Reads the save blob. Never throws; returns a fresh blob when absent. */
export function loadProgress() {
  const store = storage();
  const save = blankSave();
  if (!store) return save;
  let raw = null;
  try {
    raw = store.getItem(SAVE_KEY);
  } catch (_) {
    return save;
  }
  if (!raw) return save;
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    return save;
  }
  if (!data || typeof data !== 'object') return save;

  save.maxLevel = clamp(Math.floor(Number(data.maxLevel) || 0), 0, LEVELS.length - 1);
  save.muted = !!data.muted;
  if (data.best && typeof data.best === 'object') {
    for (const id of Object.keys(data.best)) {
      const b = data.best[id];
      if (!b || typeof b !== 'object') continue;
      const coins = Number(b.coins);
      const timeMs = Number(b.timeMs);
      save.best[id] = {
        coins: Number.isFinite(coins) ? Math.max(0, Math.floor(coins)) : 0,
        timeMs: Number.isFinite(timeMs) ? Math.max(0, Math.floor(timeMs)) : 0,
      };
    }
  }
  return save;
}

/** Writes `game.save`. Never throws. */
export function saveProgress(game) {
  const store = storage();
  if (!store || !game || !game.save) return false;
  try {
    store.setItem(SAVE_KEY, JSON.stringify({
      maxLevel: game.save.maxLevel,
      best: game.save.best,
      muted: !!game.save.muted,
    }));
    return true;
  } catch (_) {
    return false;
  }
}

/* ----------------------------------------------------------------- create */

export function createGame() {
  const save = loadProgress();
  const game = {
    // world
    level: null,
    levelIndex: 0,
    player: null,
    entities: null,
    particles: [],
    companion: null,
    cam: null,

    // run stats
    abilities: blankAbilities(),
    hearts: 3,
    maxHearts: 3,
    lives: 3,
    coins: 0,
    coinsTotal: 0,
    timeMs: 0,

    // presentation state
    phase: 'title',
    prevPhase: 'title',
    phaseT: 0,
    t: 0,
    dialogue: null,
    toast: null,
    prompt: null,
    nearNpc: null,

    // menus
    pauseSel: 0,
    selectSel: Math.min(save.maxLevel, LEVELS.length - 1),
    selectFrom: null,          // 'title' | 'paused' — where levelSelect was opened from
    completePage: 0,

    // side channels drained by main.js
    sfxQueue: [],
    shakeRequest: 0,

    // flags
    reachedDoor: false,
    requestLevelRestart: false,
    muted: !!save.muted,

    save,
    levels: LEVELS,
  };
  return game;
}

/* ------------------------------------------------------------ level load */

/**
 * Loads chapter `index` and puts the game into the `levelIntro` phase.
 * `opts.phase` overrides the resulting phase (used for silent restarts).
 */
export function loadLevel(game, index, opts) {
  if (!game) return game;
  const o = opts || {};
  const i = clamp(Math.floor(Number(index) || 0), 0, LEVELS.length - 1);
  const level = getLevel(i) || LEVELS[0];

  game.levelIndex = i;
  game.level = level;
  game.abilities = abilitiesFor(i);
  game.player = createPlayer(level);
  game.entities = spawnEntities(level);
  game.particles = [];
  game.companion = null;
  game.coins = 0;
  game.coinsTotal = countCollectibles(level);
  game.timeMs = 0;
  game.hearts = 3;
  game.maxHearts = 3;
  game.lives = 3;
  game.spawnPoint = null;
  game.checkpoint = null;
  game.dialogue = null;
  game.toast = null;
  game.prompt = null;
  game.nearNpc = null;
  game.reachedDoor = false;
  game.requestLevelRestart = false;
  game.completePage = 0;
  game.sfxQueue = [];
  game.shakeRequest = 0;
  game.unlockPending = null;

  game.cam = createCamera(level);
  const p = game.player;
  updateCamera(game.cam, p.x + p.w / 2, p.y + p.h / 2, 0, level);

  setPhase(game, o.phase || 'levelIntro');
  return game;
}

/** Restarts the current chapter from scratch, collectibles included. */
export function restartLevel(game, opts) {
  return loadLevel(game, game ? game.levelIndex : 0, opts);
}

/* ------------------------------------------------------------- phase util */

export function setPhase(game, phase) {
  if (!game) return;
  if (game.phase !== phase) game.prevPhase = game.phase;
  game.phase = phase;
  game.phaseT = 0;
}

/** Number of chapters the player is allowed to pick in the level select. */
export function unlockedCount(game) {
  const max = game && game.save ? game.save.maxLevel : 0;
  return clamp(max + 1, 1, LEVELS.length);
}

/* --------------------------------------------------------------- dialogue */

const TYPE_CPS = 46;

export function openDialogue(game, npc) {
  if (!game || !npc) return;
  const lines = Array.isArray(npc.lines) && npc.lines.length ? npc.lines : ['...'];
  game.dialogue = {
    name: npc.name || 'Colleague',
    speaker: npc.name || 'Colleague',
    lines,
    index: 0,
    t: 0,
    done: false,
    npc,
  };
  npc.talked = true;
  setPhase(game, 'dialogue');
  pushSfx(game, 'select');
}

/** Advances the typewriter / the line / closes the box. Returns true if closed. */
export function advanceDialogue(game) {
  const d = game && game.dialogue;
  if (!d) return true;
  const line = String(d.lines[d.index] || '');
  const revealed = d.t * TYPE_CPS;
  if (!d.done && revealed < line.length) {
    d.done = true;                 // first press: reveal the whole line
    return false;
  }
  d.index += 1;
  d.t = 0;
  d.done = false;
  if (d.index >= d.lines.length) {
    game.dialogue = null;
    setPhase(game, 'playing');
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------- sfx */

export function pushSfx(game, name) {
  if (!game) return;
  if (!Array.isArray(game.sfxQueue)) game.sfxQueue = [];
  game.sfxQueue.push(name);
}

export function showToast(game, text, sub) {
  if (!game) return;
  game.toast = { text, sub, t: 0 };
}

/* ---------------------------------------------------------- level finish */

function finishLevel(game) {
  const level = game.level;
  game.completePage = 0;

  // best-run bookkeeping
  const id = level && level.id;
  if (id) {
    const prev = game.save.best[id];
    const run = { coins: game.coins, timeMs: Math.round(game.timeMs) };
    if (!prev || run.coins > prev.coins || (run.coins === prev.coins && run.timeMs < prev.timeMs)) {
      game.save.best[id] = run;
    }
  }
  const next = game.levelIndex + 1;
  if (next < LEVELS.length && next > game.save.maxLevel) game.save.maxLevel = next;
  saveProgress(game);

  // ability reward
  const unlock = level && level.unlocks;
  if (unlock && Object.prototype.hasOwnProperty.call(game.abilities, unlock)) {
    game.abilities[unlock] = true;
    game.unlockPending = level.unlockLabel || unlock;
  }

  pushSfx(game, 'win');
  setPhase(game, 'levelComplete');
}

/** Moves on from the completion card: next chapter, or the ending. */
export function advanceLevel(game) {
  if (!game) return;
  const next = game.levelIndex + 1;
  if (next >= LEVELS.length) {
    setPhase(game, 'ending');
    return;
  }
  loadLevel(game, next);
}

/* ------------------------------------------------------------ simulation */

/**
 * One fixed simulation step.
 * @param {object} game
 * @param {object} controls {left,right,up,down,jump,jumpPressed,dash,dashPressed}
 * @param {number} dt seconds
 */
export function updateGame(game, controls, dt) {
  if (!game) return;
  const step = clamp(Number(dt) || 0, 0, MAX_DT);
  if (step <= 0) return;
  const c = controls || {};

  game.t += step;
  game.phaseT += step;

  if (game.toast) {
    game.toast.t = (game.toast.t || 0) + step;
    if (game.toast.t > (game.toast.duration || TOAST_TIME)) game.toast = null;
  }

  switch (game.phase) {
    case 'levelIntro':
      if (game.phaseT >= INTRO_TIME) setPhase(game, 'playing');
      break;

    case 'playing':
      simulate(game, c, step);
      break;

    case 'dialogue': {
      const d = game.dialogue;
      if (d) d.t = (d.t || 0) + step;
      // the world keeps breathing, but the player is frozen
      updateEntities(game, step);
      followCamera(game, step);
      break;
    }

    case 'levelOutro':
      followCamera(game, step);
      updateEntities(game, step);
      if (game.phaseT >= OUTRO_TIME) finishLevel(game);
      break;

    case 'paused':
    case 'title':
    case 'levelSelect':
    case 'levelComplete':
    case 'ending':
    default:
      break;
  }
}

function simulate(game, c, step) {
  const level = game.level;
  const p = game.player;
  if (!level || !p) return;

  game.timeMs += step * 1000;

  updatePlayer(p, level, c, step, game);
  updateEntities(game, step);
  collideEntities(game, step);

  // out of lives → clean chapter restart with collectibles reset
  if (game.requestLevelRestart) {
    game.requestLevelRestart = false;
    const keepTime = game.timeMs;
    loadLevel(game, game.levelIndex, { phase: 'playing' });
    game.timeMs = keepTime;
    showToast(game, 'CHAPTER RESTART', 'Out of lives');
    return;
  }

  // reached the door → hold a beat, then show the completion card
  if (game.reachedDoor && game.phase === 'playing') {
    game.reachedDoor = false;
    setPhase(game, 'levelOutro');
  }

  followCamera(game, step);
}

function followCamera(game, step) {
  const cam = game.cam;
  const p = game.player;
  if (!cam || !p) return;
  if (game.shakeRequest > 0) {
    shake(cam, game.shakeRequest);
    game.shakeRequest = 0;
  }
  updateCamera(cam, p.x + p.w / 2, p.y + p.h / 2, step, game.level);
}

/* ---------------------------------------------------------------- exports */

export { LEVELS, getLevel, TILE, VIEW_W, VIEW_H };
