// src/engine/constants.js
// Single source of truth for display + world constants.
// DOM-free: safe to import in bare Node.js.

export const TILE = 16;
export const VIEW_W = 480;      // internal canvas resolution
export const VIEW_H = 270;      // 16:9, 30 x 16.875 tiles
export const GRAVITY = 1200;
export const MAX_FALL = 420;
export const RUN_SPEED = 132;
export const RUN_ACCEL = 1000;
export const RUN_FRICTION = 1400;
export const AIR_ACCEL = 700;
export const JUMP_V = -372;         // ~3.6 tiles of clearance
export const JUMP_CUT = 0.45;       // vy *= this when jump released early
export const COYOTE = 0.10;
export const JUMP_BUFFER = 0.12;
export const DASH_SPEED = 300;
export const DASH_TIME = 0.16;
export const DASH_COOLDOWN = 0.5;
export const GLIDE_FALL = 70;       // max fall speed while gliding
export const PLAYER_W = 10;
export const PLAYER_H = 14;

// ---------------------------------------------------------------------------
// Engine extras (not part of the §1 block, but shared by engine + game code).
// ---------------------------------------------------------------------------

export const FIXED_DT = 1 / 60;     // fixed simulation timestep used by loop.js
export const MAX_DT = 1 / 30;       // dt is never allowed above this
export const MAX_CATCHUP_STEPS = 5; // max simulation steps per rendered frame

// Geometric epsilon. Used to exclude the exclusive right/bottom edge of an AABB
// from tile overlap tests so a body resting exactly on a tile boundary does not
// register as overlapping the tile beyond it.
export const EPS = 1e-4;

// Collision tuning.
export const SUBSTEP_PX = TILE * 0.5; // max displacement resolved in one sweep step
export const ONE_WAY_TOL = 0.25;      // px of tolerance for "previous bottom above platform top"
export const GROUND_PROBE = 0.5;      // px probed below the body to keep onGround stable
export const DROP_TIME = 0.16;        // how long a one-way drop-through stays active

// Tile legend (see CONTRACT §2).
export const T_EMPTY = '.';
export const T_SOLID = '#';
export const T_ONEWAY = '=';
export const T_SPIKE = '^';
export const T_POOL = '~';
export const T_COIN = 'o';
export const T_ARTIFACT = '*';
export const T_WALKER = 'E';
export const T_FLYER = 'F';
export const T_PLAT_H = 'H';
export const T_PLAT_V = 'V';
export const T_NPC = 'N';
export const T_INFO = '?';
export const T_CHECKPOINT = 'C';
export const T_SPAWN = 'P';
export const T_GOAL = 'G';
export const T_BOSS = 'B';

// Level authoring invariants (CONTRACT §2), handy for validators.
export const LEVEL_H = 20;
export const LEVEL_W_MIN = 150;
export const LEVEL_W_MAX = 190;

// Camera tuning.
export const CAM_DEAD_X = 18;
export const CAM_DEAD_Y = 16;
export const CAM_LERP_X = 9;   // exponential follow rate (1/s)
export const CAM_LERP_Y = 7;
export const CAM_LOOK_Y = -6;  // shift the view up slightly so more ground is visible
export const CAM_SHAKE_DECAY = 0.015; // fraction of shake magnitude remaining after 1s
