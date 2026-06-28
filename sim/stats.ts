import type { Attributes, DerivedStats } from '../shared/types';

const HP_BASE = 20;
const ATK_BASE = 5;
const TEMPO_BASE = 10;
const MOVE_BASE = 3;
const ATTACK_RANGE = 1;

// Minimal subset of the GDD Part II formulas needed for the Plan 1 melee slice.
export function deriveStats(a: Attributes): DerivedStats {
  return {
    maxHp: HP_BASE + a.str * 5,
    attack: ATK_BASE + a.str * 2 + a.agi,
    tempoRate: TEMPO_BASE + a.agi,
    moveRange: MOVE_BASE,
    attackRange: ATTACK_RANGE,
  };
}
