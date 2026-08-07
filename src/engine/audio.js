// src/engine/audio.js — WebAudio SFX + chiptune sequencer.
// Zero dependencies. Nothing sounds (and nothing throws) before a user gesture.
// If AudioContext is unavailable every export degrades to a silent no-op.

const MUTE_KEY = 'cjen-muted';

const MASTER_GAIN = 0.25;   // overall ceiling — never blares
const SFX_BUS_GAIN = 1.7;
const MUSIC_BUS_GAIN = 1.0;

const LOOKAHEAD_MS = 25;    // setInterval period for the scheduler
const SCHEDULE_AHEAD = 0.12; // seconds of notes queued on the audio clock
const CROSSFADE = 0.4;      // theme switch crossfade

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let ctx = null;
let master = null;
let comp = null;
let sfxBus = null;
let musicBus = null;
let noiseBuffer = null;

let muted = readMuted();
let started = false;        // initAudio() has run at least once
let unavailable = false;    // no AudioContext in this environment

let tracks = [];            // active music tracks (1, or 2 mid-crossfade)
let timer = null;           // scheduler interval id
let currentTheme = null;
let pendingTheme = null;    // requested before the context existed
let gestureBound = false;
let visibilityBound = false;

function noop() {}

// ---------------------------------------------------------------------------
// Environment helpers (safe in bare Node — no bare window/document references)
// ---------------------------------------------------------------------------

function getWin() {
  return typeof window !== 'undefined' ? window : null;
}

function getDoc() {
  return typeof document !== 'undefined' ? document : null;
}

function AudioCtor() {
  const w = getWin();
  if (!w) return null;
  return w.AudioContext || w.webkitAudioContext || null;
}

function readMuted() {
  try {
    const w = getWin();
    if (!w || !w.localStorage) return false;
    return w.localStorage.getItem(MUTE_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function writeMuted(v) {
  try {
    const w = getWin();
    if (!w || !w.localStorage) return;
    w.localStorage.setItem(MUTE_KEY, v ? '1' : '0');
  } catch (e) {
    /* private mode / disabled storage — ignore */
  }
}

// ---------------------------------------------------------------------------
// Note helpers
// ---------------------------------------------------------------------------

const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// 'C4' -> 60, 'F#3', 'Bb1' also fine.
function midi(name) {
  const m = /^([A-G])([#b]?)(-?\d+)$/.exec(name);
  if (!m) return 69;
  let n = SEMITONE[m[1]];
  if (m[2] === '#') n += 1;
  else if (m[2] === 'b') n -= 1;
  return n + (parseInt(m[3], 10) + 1) * 12;
}

function mtof(n) {
  return 440 * Math.pow(2, (n - 69) / 12);
}

// 'C4 . E4 - .' -> [[60], null, [64], 'tie', null]; chords via 'C4+E4+G4'
function seq(str) {
  return str.trim().split(/\s+/).map((tok) => {
    if (tok === '.') return null;
    if (tok === '-') return 'tie';
    return tok.split('+').map(midi);
  });
}

// 'k..h|s..h' -> ['k','.','.','h','s','.','.','h']
function perc(str) {
  return str.replace(/\|/g, '').split('');
}

// How many steps a note at index i lasts (itself plus following ties).
function noteSteps(arr, i) {
  let n = 1;
  for (let k = 1; k < arr.length; k++) {
    if (arr[(i + k) % arr.length] === 'tie') n++;
    else break;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Patterns — one looping 32-step (2 bar, 16th note) pattern per theme.
// ---------------------------------------------------------------------------

const PATTERNS = {
  // Pastoral, bright, open D major. Rolling triangle melody, brushed hats.
  bristol: {
    bpm: 112, steps: 32, cutoff: 4200,
    bassWave: 'triangle', bassVol: 0.30, bassGate: 0.85,
    leadWave: 'triangle', leadVol: 0.22, leadGate: 0.90,
    percVol: 0.16, vibrato: null,
    bass: seq(`D2 . D3 . D2 . . .  B2 . B3 . B2 . . .
               G2 . G3 . G2 . . .  A2 . A3 . A2 . E3 .`),
    lead: seq(`F#4 . A4 . D5 . - .  F#5 . E5 . D5 . B4 .
               D5 . B4 . G4 . - .   A4 . C#5 . D5 . - .`),
    perc: perc('k..h..h.|s..h..h.|k..h..h.|s..h.h.h'),
  },

  // Minor key, stately, processional. Square lead with dotted phrasing.
  edinburgh: {
    bpm: 88, steps: 32, cutoff: 3000,
    bassWave: 'square', bassVol: 0.24, bassGate: 0.60,
    leadWave: 'square', leadVol: 0.19, leadGate: 0.80,
    percVol: 0.15, vibrato: null,
    bass: seq(`E2 . . . E2 . B2 .   C2 . . . C2 . G2 .
               G2 . . . G2 . D3 .   B1 . . . B2 . F#2 .`),
    lead: seq(`E4 . - . G4 . B4 .   C5 . - . B4 . G4 .
               D5 . - . B4 . G4 .   F#4 . A4 . B4 . - .`),
    perc: perc('k...h...|s...h...|k...h...|s..hk.h.'),
  },

  // Calm, airy, unhurried. Long sine/triangle sustains, almost no percussion.
  hospital: {
    bpm: 74, steps: 32, cutoff: 2400,
    bassWave: 'sine', bassVol: 0.30, bassGate: 0.95,
    leadWave: 'triangle', leadVol: 0.17, leadGate: 0.95,
    percVol: 0.08, vibrato: { rate: 4.5, depth: 5 },
    bass: seq(`C2 . . . - . . .   A1 . . . - . . .
               F1 . . . - . . .   G1 . . . - . . .`),
    lead: seq(`E5 . . . G5 . . .   - . . . A5 . . .
               - . . . F5 . . .   G5 . . . - . . .`),
    perc: perc('....h...|....h...|....h...|....h...'),
  },

  // Bouncy, chirpy, schoolyard G major. Staccato squares, clean backbeat.
  classroom: {
    bpm: 136, steps: 32, cutoff: 4800,
    bassWave: 'square', bassVol: 0.26, bassGate: 0.45,
    leadWave: 'square', leadVol: 0.20, leadGate: 0.42,
    percVol: 0.18, vibrato: null,
    bass: seq(`G2 . G2 . D3 . G2 .   E2 . E2 . B2 . E2 .
               C3 . C3 . G2 . C3 .   D3 . D3 . A2 . D3 .`),
    lead: seq(`B4 . D5 . G5 . D5 .   G4 . B4 . E5 . B4 .
               E5 . G5 . C5 . E5 .   F#5 . A5 . D5 . F#5 .`),
    perc: perc('k..hs..h|k..hs..h|k..hs..h|k.khs.hh'),
  },

  // Tense, driving, arpeggiated D minor. Saw 16ths, relentless kick.
  fintech: {
    bpm: 148, steps: 32, cutoff: 2600,
    bassWave: 'sawtooth', bassVol: 0.22, bassGate: 0.55,
    leadWave: 'sawtooth', leadVol: 0.14, leadGate: 0.90,
    percVol: 0.17, vibrato: null,
    bass: seq(`D2 . D2 . D2 . D2 .    D2 . D2 . A2 . A2 .
               Bb1 . Bb1 . Bb1 . F2 . C2 . C2 . G2 . A2 .`),
    lead: seq(`D4 A4 F5 A4 D5 A4 F5 A4     D4 A4 F5 A4 D5 C5 A4 F4
               Bb3 F4 D5 F4 Bb4 F4 D5 F4   C4 G4 E5 G4 C5 G4 A4 E4`),
    perc: perc('k..hk..h|s..hk.kh|k..hk..h|s..hkkkh'),
  },

  // City-pop: major 7th stabs, walking bass, 16th hats. F–Dm–Gm–C.
  salon: {
    bpm: 116, steps: 32, cutoff: 4400,
    bassWave: 'triangle', bassVol: 0.30, bassGate: 0.70,
    leadWave: 'triangle', leadVol: 0.15, leadGate: 0.75,
    percVol: 0.15, vibrato: { rate: 5.5, depth: 6 },
    bass: seq(`F2 . . C3 . F2 . A2    D2 . . A2 . D2 . F2
               G2 . . D3 . G2 . Bb2   C2 . . G2 . C3 . E3`),
    lead: seq(`A4+C5+E5 . . F5 . E5 . C5      F4+A4+D5 . . A4 . C5 . A4
               Bb4+D5+F5 . . D5 . F5 . G5     E4+G4+C5 . . G4 . E5 . D5`),
    perc: perc('k.hhs.hh|k.hhs.hh|k.hhs.hh|k.hhskhh'),
  },

  // Bright tropical A major — humid, busy, optimistic.
  kl: {
    bpm: 126, steps: 32, cutoff: 4600,
    bassWave: 'triangle', bassVol: 0.28, bassGate: 0.60,
    leadWave: 'square', leadVol: 0.17, leadGate: 0.70,
    percVol: 0.16, vibrato: null,
    bass: seq(`A2 . E3 . A2 . C#3 .   F#2 . C#3 . F#2 . A2 .
               D2 . A2 . D3 . F#2 .   E2 . B2 . E3 . G#2 .`),
    lead: seq(`E5 . C#5 . A4 . B4 .    C#5 . E5 . F#5 . - .
               A5 . F#5 . D5 . E5 .    F#5 . E5 . C#5 . B4 .`),
    perc: perc('k..hs.hh|k..hs.hh|k..hs.hh|k.khs.hh'),
  },

  // Triumphant C major fanfare for the title screen.
  title: {
    bpm: 104, steps: 32, cutoff: 4000,
    bassWave: 'triangle', bassVol: 0.30, bassGate: 0.70,
    leadWave: 'square', leadVol: 0.20, leadGate: 0.88,
    percVol: 0.17, vibrato: null,
    bass: seq(`C2 . . . G2 . C3 .   A2 . . . E3 . A2 .
               F2 . . . C3 . F2 .   G2 . . . D3 . G2 .`),
    lead: seq(`C5 . E5 . G5 . - .   A5 . - . G5 . E5 .
               F5 . A5 . C6 . - .   B5 . - . G5 . - .`),
    perc: perc('k..hk..h|s..hk.kh|k..hk..h|s.khkkhh'),
  },
};

// ---------------------------------------------------------------------------
// Graph setup
// ---------------------------------------------------------------------------

function buildGraph() {
  master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER_GAIN;

  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 12;
  comp.ratio.value = 8;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;

  sfxBus = ctx.createGain();
  sfxBus.gain.value = SFX_BUS_GAIN;

  musicBus = ctx.createGain();
  musicBus.gain.value = MUSIC_BUS_GAIN;

  sfxBus.connect(master);
  musicBus.connect(master);
  master.connect(comp);
  comp.connect(ctx.destination);

  const len = Math.floor(ctx.sampleRate * 2);
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
}

function bindVisibility() {
  const doc = getDoc();
  if (!doc || visibilityBound || !doc.addEventListener) return;
  visibilityBound = true;
  doc.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (doc.hidden) {
      if (ctx.state === 'running' && ctx.suspend) ctx.suspend().catch(noop);
    } else if (started) {
      resumeContext();
    }
  });
}

// Belt and braces: if the integrator forgets to call initAudio(), unlock on the
// first real user gesture. Never produces sound on its own.
function bindGestureUnlock() {
  const doc = getDoc();
  if (!doc || gestureBound || !doc.addEventListener) return;
  gestureBound = true;
  const kick = () => { initAudio(); };
  const opts = { once: true, passive: true };
  doc.addEventListener('pointerdown', kick, opts);
  doc.addEventListener('touchstart', kick, opts);
  doc.addEventListener('keydown', kick, { once: true });
}

function resumeContext() {
  if (!ctx || !ctx.resume) return;
  if (ctx.state === 'running') return;
  const p = ctx.resume();
  if (p && typeof p.then === 'function') p.then(resyncTracks, noop);
  else resyncTracks();
}

function resyncTracks() {
  if (!ctx) return;
  const t = ctx.currentTime + 0.05;
  for (let i = 0; i < tracks.length; i++) {
    if (tracks[i].nextTime < t) tracks[i].nextTime = t;
  }
}

// Returns true when an audio graph is live and usable.
function ready() {
  return !unavailable && ctx !== null && master !== null;
}

// ---------------------------------------------------------------------------
// Voice primitives
// ---------------------------------------------------------------------------

// Register a scheduled source so it can be force-stopped, and tear its little
// sub-graph down once it has finished so nodes never pile up.
function own(owner, node, extra) {
  if (owner) owner.add(node);
  node.onended = () => {
    if (owner) owner.delete(node);
    try { node.disconnect(); } catch (e) { /* already gone */ }
    if (extra) {
      for (let i = 0; i < extra.length; i++) {
        try { extra[i].disconnect(); } catch (e) { /* already gone */ }
      }
    }
  };
}

/**
 * One oscillator voice with an attack/sustain/release envelope.
 * opts: {attack, release, sustain, glide, glideTime, detune, wave2, mix2,
 *        vibrato:{rate,depth}, owner}
 */
function tone(dest, wave, freq, t0, dur, peak, opts) {
  if (!ready()) return null;
  const o = opts || {};
  const atk = o.attack != null ? o.attack : 0.006;
  const rel = o.release != null ? o.release : 0.06;
  const sus = o.sustain != null ? o.sustain : 0.62;
  const body = Math.max(0.02, dur);
  const end = t0 + body + rel;

  const g = ctx.createGain();
  g.connect(dest);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + atk);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * sus), t0 + body);
  g.gain.exponentialRampToValueAtTime(0.0001, end);

  const osc = ctx.createOscillator();
  osc.type = wave;
  osc.frequency.setValueAtTime(Math.max(20, freq), t0);
  if (o.glide) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, o.glide), t0 + (o.glideTime != null ? o.glideTime : body));
  }
  if (o.detune) osc.detune.setValueAtTime(o.detune, t0);
  osc.connect(g);
  osc.start(t0);
  osc.stop(end + 0.02);
  own(o.owner, osc, [g]);

  if (o.wave2) {
    const g2 = ctx.createGain();
    g2.gain.value = o.mix2 != null ? o.mix2 : 0.4;
    g2.connect(g);
    const o2 = ctx.createOscillator();
    o2.type = o.wave2;
    o2.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (o.glide) {
      o2.frequency.exponentialRampToValueAtTime(
        Math.max(20, o.glide), t0 + (o.glideTime != null ? o.glideTime : body));
    }
    o2.detune.setValueAtTime((o.detune || 0) + (o.detune2 != null ? o.detune2 : 7), t0);
    o2.connect(g2);
    o2.start(t0);
    o2.stop(end + 0.02);
    own(o.owner, o2, [g2]);
  }

  if (o.vibrato) {
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = o.vibrato.rate;
    const lg = ctx.createGain();
    lg.gain.value = o.vibrato.depth;
    lfo.connect(lg);
    lg.connect(osc.detune);
    lfo.start(t0);
    lfo.stop(end + 0.02);
    own(o.owner, lfo, [lg]);
  }

  return g;
}

/**
 * Filtered white-noise burst.
 * opts: {filter, freq, freqTo, q, attack, owner, rate}
 */
function noise(dest, t0, dur, peak, opts) {
  if (!ready() || !noiseBuffer) return null;
  const o = opts || {};
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  if (o.rate) src.playbackRate.value = o.rate;

  let node = src;
  let filt = null;
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    filt = f;
    f.type = o.filter;
    f.frequency.setValueAtTime(Math.max(40, o.freq || 2000), t0);
    if (o.freqTo) {
      f.frequency.exponentialRampToValueAtTime(Math.max(40, o.freqTo), t0 + dur);
    }
    f.Q.value = o.q != null ? o.q : 1;
    src.connect(f);
    node = f;
  }

  const g = ctx.createGain();
  const atk = o.attack != null ? o.attack : 0.003;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(dur, atk + 0.02));
  node.connect(g);
  g.connect(dest);

  src.start(t0);
  src.stop(t0 + Math.max(dur, atk + 0.02) + 0.02);
  own(o.owner, src, filt ? [filt, g] : [g]);
  return g;
}

// ---------------------------------------------------------------------------
// SFX
// ---------------------------------------------------------------------------

const SFX = {
  // Fast upward square blip.
  jump(t) {
    tone(sfxBus, 'square', 300, t, 0.09, 0.30,
      { glide: 690, glideTime: 0.085, attack: 0.003, release: 0.04, sustain: 0.5 });
  },

  // Short filtered whoosh + a downward square tail.
  dash(t) {
    noise(sfxBus, t, 0.18, 0.26,
      { filter: 'bandpass', freq: 700, freqTo: 3600, q: 1.2, attack: 0.006 });
    tone(sfxBus, 'square', 620, t, 0.14, 0.14,
      { glide: 210, glideTime: 0.14, attack: 0.004, release: 0.05, sustain: 0.35 });
  },

  // Two-note arpeggio — the classic pickup.
  coin(t) {
    tone(sfxBus, 'square', mtof(midi('B5')), t, 0.055, 0.26,
      { attack: 0.002, release: 0.03, sustain: 0.8 });
    tone(sfxBus, 'square', mtof(midi('E6')), t + 0.055, 0.16, 0.24,
      { attack: 0.002, release: 0.08, sustain: 0.55 });
  },

  // Bright four-note flourish, doubled a fifth up.
  artifact(t) {
    const notes = ['C6', 'E6', 'G6', 'C7'];
    for (let i = 0; i < notes.length; i++) {
      const t0 = t + i * 0.07;
      const d = i === notes.length - 1 ? 0.34 : 0.09;
      tone(sfxBus, 'square', mtof(midi(notes[i])), t0, d, 0.20,
        { attack: 0.002, release: 0.1, sustain: 0.6 });
      tone(sfxBus, 'triangle', mtof(midi(notes[i]) - 12), t0, d, 0.14,
        { attack: 0.003, release: 0.1, sustain: 0.6 });
    }
  },

  // Descending saw + a scrape of noise.
  hurt(t) {
    tone(sfxBus, 'sawtooth', 420, t, 0.28, 0.26,
      { glide: 105, glideTime: 0.28, attack: 0.004, release: 0.08, sustain: 0.45 });
    noise(sfxBus, t, 0.14, 0.16,
      { filter: 'bandpass', freq: 1600, freqTo: 320, q: 0.8 });
  },

  // Squashy thud.
  stomp(t) {
    tone(sfxBus, 'square', 190, t, 0.1, 0.28,
      { glide: 66, glideTime: 0.1, attack: 0.002, release: 0.05, sustain: 0.4 });
    noise(sfxBus, t, 0.09, 0.22,
      { filter: 'lowpass', freq: 1400, freqTo: 300, q: 0.7 });
  },

  // Warm rising two-note chime with a shimmer on top.
  checkpoint(t) {
    tone(sfxBus, 'triangle', mtof(midi('G5')), t, 0.13, 0.24,
      { attack: 0.004, release: 0.08, sustain: 0.6 });
    tone(sfxBus, 'triangle', mtof(midi('C6')), t + 0.11, 0.3, 0.24,
      { attack: 0.004, release: 0.16, sustain: 0.55 });
    tone(sfxBus, 'square', mtof(midi('E6')), t + 0.2, 0.26, 0.09,
      { attack: 0.01, release: 0.18, sustain: 0.5 });
  },

  // Low swell opening into a fifth — a door giving way.
  door(t) {
    tone(sfxBus, 'triangle', mtof(midi('C3')), t, 0.3, 0.24,
      { attack: 0.05, release: 0.14, sustain: 0.7 });
    tone(sfxBus, 'triangle', mtof(midi('G3')), t + 0.06, 0.3, 0.2,
      { attack: 0.05, release: 0.14, sustain: 0.7 });
    tone(sfxBus, 'square', mtof(midi('C5')), t + 0.18, 0.3, 0.13,
      { attack: 0.02, release: 0.2, sustain: 0.5 });
    noise(sfxBus, t, 0.26, 0.08, { filter: 'lowpass', freq: 900, freqTo: 220, q: 0.6 });
  },

  // Tiny menu tick.
  select(t) {
    tone(sfxBus, 'square', mtof(midi('A5')), t, 0.045, 0.22,
      { attack: 0.002, release: 0.03, sustain: 0.5 });
  },

  // Major triad arpeggio with a sparkle — an ability granted.
  unlock(t) {
    const notes = ['C5', 'E5', 'G5', 'C6', 'E6'];
    for (let i = 0; i < notes.length; i++) {
      const t0 = t + i * 0.075;
      const d = i === notes.length - 1 ? 0.42 : 0.12;
      tone(sfxBus, 'square', mtof(midi(notes[i])), t0, d, 0.2,
        { attack: 0.003, release: 0.14, sustain: 0.6 });
    }
    tone(sfxBus, 'triangle', mtof(midi('C4')), t, 0.6, 0.18,
      { attack: 0.02, release: 0.2, sustain: 0.6 });
    noise(sfxBus, t + 0.28, 0.3, 0.05,
      { filter: 'highpass', freq: 4000, freqTo: 8000, q: 0.5, attack: 0.06 });
  },

  // Detuned menacing growl dropping an octave, with rumble.
  boss(t) {
    tone(sfxBus, 'sawtooth', 150, t, 0.7, 0.26, {
      glide: 62, glideTime: 0.7, attack: 0.02, release: 0.2, sustain: 0.75,
      wave2: 'square', mix2: 0.45, detune2: -22,
    });
    tone(sfxBus, 'sawtooth', 226, t + 0.05, 0.62, 0.12,
      { glide: 92, glideTime: 0.62, attack: 0.03, release: 0.2, sustain: 0.6, detune: 14 });
    noise(sfxBus, t, 0.7, 0.16,
      { filter: 'lowpass', freq: 700, freqTo: 140, q: 0.9, attack: 0.05 });
  },

  // Short fanfare, two voices in thirds.
  win(t) {
    const melody = ['C5', 'E5', 'G5', 'C6'];
    const times = [0, 0.11, 0.22, 0.35];
    for (let i = 0; i < melody.length; i++) {
      const t0 = t + times[i];
      const d = i === melody.length - 1 ? 0.75 : 0.13;
      tone(sfxBus, 'square', mtof(midi(melody[i])), t0, d, 0.2,
        { attack: 0.004, release: 0.22, sustain: 0.7 });
      tone(sfxBus, 'triangle', mtof(midi(melody[i]) - 5), t0, d, 0.15,
        { attack: 0.006, release: 0.22, sustain: 0.7 });
    }
    tone(sfxBus, 'triangle', mtof(midi('C3')), t, 1.15, 0.2,
      { attack: 0.02, release: 0.3, sustain: 0.7 });
    noise(sfxBus, t + 0.35, 0.5, 0.06,
      { filter: 'highpass', freq: 3000, freqTo: 7000, q: 0.5, attack: 0.08 });
  },
};

// ---------------------------------------------------------------------------
// Music sequencer — lookahead scheduling on the AudioContext clock
// ---------------------------------------------------------------------------

function createTrack(themeKey, fadeIn) {
  const pattern = PATTERNS[themeKey] || PATTERNS.title;
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = pattern.cutoff;
  filter.Q.value = 0.6;
  gain.connect(filter);
  filter.connect(musicBus);

  const t0 = ctx.currentTime + 0.06;
  gain.gain.setValueAtTime(fadeIn ? 0.0001 : 1, t0);
  if (fadeIn) gain.gain.linearRampToValueAtTime(1, t0 + CROSSFADE);

  return {
    theme: themeKey,
    pattern,
    gain,
    filter,
    nodes: new Set(),
    step: 0,
    stepDur: 60 / pattern.bpm / 4, // 16th notes
    nextTime: t0,
    stopAt: null,
  };
}

function destroyTrack(tr) {
  tr.nodes.forEach((n) => {
    try { n.onended = null; n.stop(); } catch (e) { /* already stopped */ }
    try { n.disconnect(); } catch (e) { /* ignore */ }
  });
  tr.nodes.clear();
  try { tr.gain.disconnect(); } catch (e) { /* ignore */ }
  try { tr.filter.disconnect(); } catch (e) { /* ignore */ }
}

function fadeOutTrack(tr, fade) {
  const t = ctx.currentTime;
  try {
    tr.gain.gain.cancelScheduledValues(t);
    tr.gain.gain.setValueAtTime(tr.gain.gain.value, t);
    tr.gain.gain.linearRampToValueAtTime(0.0001, t + fade);
  } catch (e) { /* ignore */ }
  tr.stopAt = t + fade + 0.02;
}

function scheduleStep(tr, i, t) {
  const p = tr.pattern;

  const b = p.bass[i % p.bass.length];
  if (b && b !== 'tie') {
    const dur = noteSteps(p.bass, i % p.bass.length) * tr.stepDur * p.bassGate;
    for (let k = 0; k < b.length; k++) {
      tone(tr.gain, p.bassWave, mtof(b[k]), t, dur, p.bassVol,
        { attack: 0.008, release: 0.05, sustain: 0.55, owner: tr.nodes });
    }
  }

  const l = p.lead[i % p.lead.length];
  if (l && l !== 'tie') {
    const dur = noteSteps(p.lead, i % p.lead.length) * tr.stepDur * p.leadGate;
    for (let k = 0; k < l.length; k++) {
      tone(tr.gain, p.leadWave, mtof(l[k]), t, dur, p.leadVol / Math.sqrt(l.length), {
        attack: 0.006,
        release: 0.07,
        sustain: 0.5,
        vibrato: p.vibrato,
        owner: tr.nodes,
      });
    }
  }

  const d = p.perc[i % p.perc.length];
  if (d === 'k') {
    tone(tr.gain, 'sine', 155, t, 0.11, p.percVol * 1.5,
      { glide: 46, glideTime: 0.1, attack: 0.002, release: 0.04, sustain: 0.3, owner: tr.nodes });
  } else if (d === 's') {
    noise(tr.gain, t, 0.11, p.percVol,
      { filter: 'highpass', freq: 1200, q: 0.7, attack: 0.002, owner: tr.nodes });
    tone(tr.gain, 'triangle', 220, t, 0.06, p.percVol * 0.5,
      { glide: 160, glideTime: 0.06, attack: 0.002, release: 0.03, sustain: 0.3, owner: tr.nodes });
  } else if (d === 'h') {
    noise(tr.gain, t, 0.035, p.percVol * 0.55,
      { filter: 'highpass', freq: 6500, q: 0.6, attack: 0.001, owner: tr.nodes });
  }
}

function scheduler() {
  if (!ready()) return;
  const now = ctx.currentTime;

  for (let i = tracks.length - 1; i >= 0; i--) {
    const tr = tracks[i];
    if (tr.stopAt !== null && now >= tr.stopAt) {
      destroyTrack(tr);
      tracks.splice(i, 1);
      continue;
    }
    // The clock froze (tab hidden / context suspended) — realign rather than
    // dumping a burst of overdue notes.
    if (tr.nextTime < now - 0.05) tr.nextTime = now + 0.03;

    // Never queue notes past the point where the track gets torn down.
    const horizon = tr.stopAt !== null
      ? Math.min(now + SCHEDULE_AHEAD, tr.stopAt)
      : now + SCHEDULE_AHEAD;

    let guard = 0;
    while (tr.nextTime < horizon && guard < 64) {
      scheduleStep(tr, tr.step, tr.nextTime);
      tr.step = (tr.step + 1) % tr.pattern.steps;
      tr.nextTime += tr.stepDur;
      guard++;
    }
  }

  if (tracks.length === 0) stopScheduler();
}

function startScheduler() {
  if (timer !== null) return;
  const w = getWin();
  const set = w && w.setInterval ? w.setInterval.bind(w) : setInterval;
  timer = set(scheduler, LOOKAHEAD_MS);
  scheduler();
}

function stopScheduler() {
  if (timer === null) return;
  const w = getWin();
  const clear = w && w.clearInterval ? w.clearInterval.bind(w) : clearInterval;
  clear(timer);
  timer = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create or resume the AudioContext. Safe to call repeatedly and safe to call
 * before any user gesture (the context simply stays suspended). No-op when the
 * WebAudio API is unavailable.
 */
export function initAudio() {
  if (unavailable) return;
  bindGestureUnlock();

  if (!ctx) {
    const Ctor = AudioCtor();
    if (!Ctor) {
      unavailable = true;
      return;
    }
    try {
      ctx = new Ctor();
      buildGraph();
    } catch (e) {
      ctx = null;
      unavailable = true;
      return;
    }
    bindVisibility();
  }

  started = true;
  resumeContext();

  if (pendingTheme !== null) {
    const t = pendingTheme;
    pendingTheme = null;
    playMusic(t);
  }
}

/**
 * Fire a one-shot sound effect.
 * name: 'jump','dash','coin','artifact','hurt','stomp','checkpoint','door',
 *       'select','unlock','boss','win'
 */
export function playSfx(name) {
  if (!ready() || muted) return;
  const fn = SFX[name] || SFX.select;
  try {
    fn(ctx.currentTime + 0.005);
  } catch (e) {
    /* never let audio break gameplay */
  }
}

/**
 * Start (or crossfade to) the looping chiptune for a theme key.
 * themeKey: 'bristol','edinburgh','hospital','classroom','fintech','salon','kl','title'
 */
export function playMusic(themeKey) {
  const key = PATTERNS[themeKey] ? themeKey : 'title';
  if (!ready()) {
    if (!unavailable) pendingTheme = key;
    return;
  }
  if (currentTheme === key) {
    // Already playing this theme — make sure it is actually running.
    const live = tracks.some((t) => t.theme === key && t.stopAt === null);
    if (live) {
      startScheduler();
      return;
    }
  }
  currentTheme = key;

  try {
    for (let i = 0; i < tracks.length; i++) {
      if (tracks[i].stopAt === null) fadeOutTrack(tracks[i], CROSSFADE);
    }
    tracks.push(createTrack(key, tracks.length > 0));
    startScheduler();
  } catch (e) {
    /* degrade silently */
  }
}

/** Stop the music and cancel every scheduled note. */
export function stopMusic() {
  currentTheme = null;
  pendingTheme = null;
  if (!ready()) return;
  try {
    // Short fade to avoid a click, then the scheduler force-stops and
    // disconnects every queued note when the track passes its stopAt.
    for (let i = 0; i < tracks.length; i++) fadeOutTrack(tracks[i], 0.08);
    if (tracks.length) startScheduler();
  } catch (e) {
    /* ignore */
  }
}

/** Mute or unmute everything; persisted to localStorage under 'cjen-muted'. */
export function setMuted(v) {
  muted = !!v;
  writeMuted(muted);
  if (!ready()) return;
  try {
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(muted ? 0.0001 : MASTER_GAIN, t + 0.08);
  } catch (e) {
    /* ignore */
  }
}

/** Current mute state (reflects localStorage even before initAudio()). */
export function isMuted() {
  return muted;
}
