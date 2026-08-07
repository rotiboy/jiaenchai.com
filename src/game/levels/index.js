// src/game/levels/index.js — level aggregator (CONTRACT §2).
// DOM-free: importable in bare Node.js.

import { level as bristol } from './bristol.js';
import { level as accentureAnalyst } from './accenture-analyst.js';
import { level as accentureConsultant } from './accenture-consultant.js';
import { level as hmi } from './hmi.js';
import { level as excelerate } from './excelerate.js';
import { level as stashaway } from './stashaway.js';
import { level as storehub } from './storehub.js';

/** Levels in `index` order. */
export const LEVELS = [
  bristol,
  accentureAnalyst,
  accentureConsultant,
  hmi,
  excelerate,
  stashaway,
  storehub,
].sort((a, b) => a.index - b.index);

/**
 * Look a level up by numeric index or by string id.
 * Returns undefined when nothing matches.
 */
export function getLevel(idOrIndex) {
  if (typeof idOrIndex === 'number') {
    if (!Number.isFinite(idOrIndex)) return undefined;
    const i = Math.trunc(idOrIndex);
    return LEVELS[i];
  }
  if (typeof idOrIndex === 'string') {
    const byId = LEVELS.find((l) => l.id === idOrIndex);
    if (byId) return byId;
    if (/^\d+$/.test(idOrIndex)) return LEVELS[Number(idOrIndex)];
  }
  return undefined;
}

/** Total number of chapters. */
export const LEVEL_COUNT = LEVELS.length;
