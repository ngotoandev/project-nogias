import type { Attributes, AttackKind, DamageChannel, DerivedStats, Unit } from '../shared/types';
import type { FightCtx } from './decide';
import { sqrtFP } from '../shared/math';
import {
  HP_BASE, HP_PER_STR, WEAPON_BASE, FOCUS_BASE, ARMOR_BASE, RESIST_BASE,
  SQRT_SCALE, ACC_BASE_BP, ACC_COEF, EVA_COEF, EVA_CAP_BP,
  CRIT_COEF, CRIT_CAP_BP, CRITMULT_BASE_X100, CRITMULT_COEF,
  TEMPO_BASE, MOVE_RANGE, MELEE_RANGE, RANGED_RANGE, MAGIC_RANGE,
  MANA_MAX, MANA_BASE_BP, MANA_INT_COEF,
  RECKLESS_ATK_BP, RECKLESS_DEF_BP, SLOW_STARTER_RAMP_TICKS, SLOW_STARTER_EARLY_BP,
  SLOW_STARTER_LATE_BP, BLOODTHIRSTY_ATK_PER_KILL, LEADER_RADIUS, LOYAL_FAR_RADIUS,
  LOYAL_NEAR_BP, LOYAL_FAR_BP,
} from '../shared/config';
import { chebyshev } from './grid';
import { proxyLeader, hasTrait } from './decide';

function atkFor(a: Attributes, kind: AttackKind): number {
  if (kind === 'melee') return WEAPON_BASE + a.str * 2 + a.agi;
  if (kind === 'ranged') return WEAPON_BASE + a.agi * 2 + a.str;
  return FOCUS_BASE + a.int * 2 + a.lck; // magic
}

function rangeFor(kind: AttackKind): number {
  if (kind === 'melee') return MELEE_RANGE;
  if (kind === 'ranged') return RANGED_RANGE;
  return MAGIC_RANGE; // magic
}

const DYNAMIC_TRAITS: ReadonlyArray<Unit['traits'][number]> = ['reckless', 'slowStarter', 'bloodthirsty', 'loyal'];

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
    attackRange: rangeFor(attackKind),
    maxMana: MANA_MAX,
    manaChargeBp: MANA_BASE_BP + MANA_INT_COEF * a.int,
  };
}

export function effectiveDerived(unit: Unit, ctx: FightCtx): DerivedStats {
  if (!unit.traits.some((t) => DYNAMIC_TRAITS.includes(t))) return unit.derived; // identity fast-path
  const d = unit.derived;
  let atk = d.atk, physDef = d.physDef, magicResist = d.magicResist;

  if (hasTrait(unit, 'reckless')) {
    const missingBp = Math.floor((d.maxHp - unit.hp) * 10000 / d.maxHp);
    atk += Math.floor(atk * RECKLESS_ATK_BP * missingBp / (10000 * 10000));
    physDef = Math.floor(physDef * (10000 - RECKLESS_DEF_BP) / 10000);
  }
  if (hasTrait(unit, 'slowStarter')) {
    const rampBp = Math.min(10000, Math.floor(ctx.totalTicks * 10000 / SLOW_STARTER_RAMP_TICKS));
    const factorBp = (10000 - SLOW_STARTER_EARLY_BP) + Math.floor((SLOW_STARTER_EARLY_BP + SLOW_STARTER_LATE_BP) * rampBp / 10000);
    atk = Math.floor(atk * factorBp / 10000);
    physDef = Math.floor(physDef * factorBp / 10000);
    magicResist = Math.floor(magicResist * factorBp / 10000);
  }
  if (hasTrait(unit, 'bloodthirsty')) {
    atk += unit.kills * BLOODTHIRSTY_ATK_PER_KILL;
  }
  if (hasTrait(unit, 'loyal')) {
    const leader = proxyLeader(unit, ctx.units);
    if (leader) {
      const dist = chebyshev(unit.pos, leader.pos);
      const f = dist <= LEADER_RADIUS ? 10000 + LOYAL_NEAR_BP : dist >= LOYAL_FAR_RADIUS ? 10000 - LOYAL_FAR_BP : 10000;
      atk = Math.floor(atk * f / 10000);
      physDef = Math.floor(physDef * f / 10000);
      magicResist = Math.floor(magicResist * f / 10000);
    }
  }
  return { ...d, atk, physDef, magicResist };
}
