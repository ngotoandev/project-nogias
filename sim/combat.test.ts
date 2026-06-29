import { describe, it, expect } from 'vitest';
import { hitBp, mitigatedDamage, applyCrit } from './combat';

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
