import { describe, it, expect } from 'vitest';
import { deriveStats } from './stats';

describe('deriveStats', () => {
  it('derives stats from attributes using GDD formulas', () => {
    const d = deriveStats({ str: 5, agi: 5, int: 1, lck: 1 });
    expect(d.maxHp).toBe(45);       // 20 + STR*5
    expect(d.attack).toBe(20);      // 5 + STR*2 + AGI
    expect(d.tempoRate).toBe(15);   // 10 + AGI
    expect(d.moveRange).toBe(3);
    expect(d.attackRange).toBe(1);
  });

  it('is monotonic in STR for hp and attack', () => {
    const lo = deriveStats({ str: 1, agi: 1, int: 1, lck: 1 });
    const hi = deriveStats({ str: 9, agi: 1, int: 1, lck: 1 });
    expect(hi.maxHp).toBeGreaterThan(lo.maxHp);
    expect(hi.attack).toBeGreaterThan(lo.attack);
  });
});
