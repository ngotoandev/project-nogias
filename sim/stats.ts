import type { Attributes, AttackKind, DamageChannel, DerivedStats } from '../shared/types';
import { sqrtFP } from '../shared/math';
import {
  HP_BASE, HP_PER_STR, WEAPON_BASE, FOCUS_BASE, ARMOR_BASE, RESIST_BASE,
  SQRT_SCALE, ACC_BASE_BP, ACC_COEF, EVA_COEF, EVA_CAP_BP,
  CRIT_COEF, CRIT_CAP_BP, CRITMULT_BASE_X100, CRITMULT_COEF,
  TEMPO_BASE, MOVE_RANGE, ATTACK_RANGE,
} from '../shared/config';

function atkFor(a: Attributes, kind: AttackKind): number {
  if (kind === 'melee') return WEAPON_BASE + a.str * 2 + a.agi;
  if (kind === 'ranged') return WEAPON_BASE + a.agi * 2 + a.str;
  return FOCUS_BASE + a.int * 2 + a.lck; // magic
}

// GDD Part II derived stats, ported to integer / basis-point / fixed-point math.
export function deriveStats(a: Attributes, attackKind: AttackKind): DerivedStats {
  const channel: DamageChannel = attackKind === 'magic' ? 'magic' : 'physical';
  return {
    maxHp: HP_BASE + a.str * HP_PER_STR,
    atk: atkFor(a, attackKind),
    channel,
    physDef: ARMOR_BASE + a.str,
    magicResist: RESIST_BASE + a.int,
    accuracyBp: ACC_BASE_BP + Math.floor((ACC_COEF * sqrtFP(a.int)) / SQRT_SCALE),
    evasionBp: Math.min(EVA_CAP_BP, Math.floor((EVA_COEF * sqrtFP(2 * a.agi + a.lck)) / SQRT_SCALE)),
    critChanceBp: Math.min(CRIT_CAP_BP, Math.floor((CRIT_COEF * sqrtFP(a.lck)) / SQRT_SCALE)),
    critMultX100: CRITMULT_BASE_X100 + Math.floor((CRITMULT_COEF * sqrtFP(a.lck)) / SQRT_SCALE),
    tempoRate: TEMPO_BASE + a.agi,
    moveRange: MOVE_RANGE,
    attackRange: ATTACK_RANGE,
  };
}
