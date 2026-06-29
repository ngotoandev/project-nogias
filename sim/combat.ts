import { MITIGATION_K, HIT_MIN_BP, HIT_MAX_BP, M_HIT, M_TAKEN, M_TAKEN_CAP, HEAVY_STRIKE_MULT, CLEAVE_MULT, MANA_BASE_BP } from '../shared/config';

// Hit chance in basis points: accuracy minus evasion, clamped.
export function hitBp(accuracyBp: number, evasionBp: number): number {
  return Math.min(HIT_MAX_BP, Math.max(HIT_MIN_BP, accuracyBp - evasionBp));
}

// Integer damage after channel-matched mitigation: floor(atk * K / (def + K)), min 1.
export function mitigatedDamage(atk: number, def: number): number {
  return Math.max(1, Math.floor((atk * MITIGATION_K) / (def + MITIGATION_K)));
}

// Apply a crit multiplier (x100) to a damage value.
export function applyCrit(damage: number, critMultX100: number): number {
  return Math.floor((damage * critMultX100) / 100);
}

// Mana gained when a basic attack lands (charges the attacker).
export function manaGainOnHit(manaChargeBp: number): number {
  return Math.floor((M_HIT * manaChargeBp) / MANA_BASE_BP);
}

// Mana gained when a unit takes `incoming` damage (charges the victim), capped per hit.
export function manaGainOnTaken(incoming: number, maxHp: number, manaChargeBp: number): number {
  return Math.min(M_TAKEN_CAP, Math.floor((M_TAKEN * incoming * manaChargeBp) / (maxHp * MANA_BASE_BP)));
}

// Damage of a Heavy Strike: amplified mitigated damage (before the crit roll).
export function heavyStrikeDamage(atk: number, def: number): number {
  return Math.floor((mitigatedDamage(atk, def) * HEAVY_STRIKE_MULT) / 100);
}

// Damage of a Cleave hit to one target: x1.20 mitigated damage (before the crit roll).
export function cleaveDamage(atk: number, def: number): number {
  return Math.floor((mitigatedDamage(atk, def) * CLEAVE_MULT) / 100);
}
