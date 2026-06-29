import { describe, it, expect } from 'vitest';
import { hitBp, mitigatedDamage, applyCrit, manaGainOnHit, manaGainOnTaken, heavyStrikeDamage } from './combat';

describe('hitBp', () => {
  it('is accuracy minus evasion, clamped to [1000, 10000]', () => {
    expect(hitBp(10300, 1492)).toBe(8808);
    expect(hitBp(10000, 0)).toBe(10000);
    expect(hitBp(10300, 20000)).toBe(1000);  // floor 10%
    expect(hitBp(20000, 0)).toBe(10000);      // accuracy above 100% caps
  });
});

describe('mitigatedDamage', () => {
  it('reduces damage as defense rises: floor(atk*K/(def+K)), min 1', () => {
    expect(mitigatedDamage(17, 0)).toBe(17);
    expect(mitigatedDamage(17, 1)).toBe(16);
    expect(mitigatedDamage(17, 9)).toBe(12);
    expect(mitigatedDamage(17, 24)).toBe(8);  // def == K -> half
    expect(mitigatedDamage(1, 1000)).toBe(1);
  });

  it('is monotonic non-increasing in defense', () => {
    let prev = Infinity;
    for (let def = 0; def <= 100; def++) {
      const d = mitigatedDamage(20, def);
      expect(d).toBeLessThanOrEqual(prev);
      prev = d;
    }
  });
});

describe('applyCrit', () => {
  it('scales damage by the x100 multiplier', () => {
    expect(applyCrit(16, 140)).toBe(22);
    expect(applyCrit(12, 150)).toBe(18);
    expect(applyCrit(10, 100)).toBe(10);
  });
});

describe('manaGainOnHit', () => {
  it('scales the flat M_HIT charge by the INT-derived rate', () => {
    expect(manaGainOnHit(10400)).toBe(14); // INT 1
    expect(manaGainOnHit(12000)).toBe(16); // INT 5
    expect(manaGainOnHit(13600)).toBe(19); // INT 9
  });
});

describe('manaGainOnTaken', () => {
  it('scales to the bite (incoming/maxHp), capped per hit', () => {
    expect(manaGainOnTaken(14, 45, 10400)).toBe(9);
    expect(manaGainOnTaken(24, 45, 10400)).toBe(16);
    expect(manaGainOnTaken(45, 45, 10400)).toBe(22); // cap
    expect(manaGainOnTaken(20, 25, 10400)).toBe(22); // cap
  });
  it('is monotonic non-decreasing in incoming (until the cap)', () => {
    let prev = -1;
    for (let inc = 1; inc <= 20; inc++) {
      const g = manaGainOnTaken(inc, 45, 10400);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });
});

describe('heavyStrikeDamage', () => {
  it('amplifies mitigated damage by the Heavy Strike multiplier', () => {
    expect(heavyStrikeDamage(17, 5)).toBe(25);  // mit(17,5)=14, x1.8 -> 25.2 -> 25
    expect(heavyStrikeDamage(25, 1)).toBe(43);  // mit(25,1)=24, x1.8 -> 43.2 -> 43
  });
});
