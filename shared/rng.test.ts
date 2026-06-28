import { describe, it, expect } from 'vitest';
import { makeRng } from './rng';

describe('makeRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = makeRng(123);
    const b = makeRng(123);
    expect([a.nextUint32(), a.nextUint32(), a.nextUint32()])
      .toEqual([b.nextUint32(), b.nextUint32(), b.nextUint32()]);
  });

  it('produces different sequences for different seeds', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(a.nextUint32()).not.toBe(b.nextUint32());
  });

  it('intInRange stays within inclusive bounds', () => {
    const r = makeRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = r.intInRange(90, 110);
      expect(v).toBeGreaterThanOrEqual(90);
      expect(v).toBeLessThanOrEqual(110);
    }
  });

  it('returns unsigned 32-bit integers', () => {
    const r = makeRng(7);
    const v = r.nextUint32();
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(0xffffffff);
  });
});
