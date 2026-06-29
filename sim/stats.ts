import type { Attributes, DerivedStats } from '../shared/types';

// Scaled bases — added to an attribute-scaled term:
const HP_BASE = 20;
const ATK_BASE = 5;
const TEMPO_BASE = 10;
// Flat ranges — no attribute scaling yet:
const MOVE_RANGE = 3;
const ATTACK_RANGE = 1;

// Minimal subset of the GDD Part II formulas needed for the melee slice.
export function deriveStats(a: Attributes): DerivedStats {
  return {
    maxHp: HP_BASE + a.str * 5,
    attack: ATK_BASE + a.str * 2 + a.agi,
    tempoRate: TEMPO_BASE + a.agi,
    moveRange: MOVE_RANGE,
    attackRange: ATTACK_RANGE,
  };
}
