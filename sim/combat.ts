import { MITIGATION_K, HIT_MIN_BP, HIT_MAX_BP } from '../shared/config';

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
