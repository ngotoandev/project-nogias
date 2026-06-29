import { describe, it, expect } from 'vitest';
import { isqrt, sqrtFP } from './math';

describe('isqrt', () => {
  it('returns the floor of the square root', () => {
    expect(isqrt(0)).toBe(0);
    expect(isqrt(1)).toBe(1);
    expect(isqrt(2)).toBe(1);
    expect(isqrt(3)).toBe(1);
    expect(isqrt(4)).toBe(2);
    expect(isqrt(8)).toBe(2);
    expect(isqrt(9)).toBe(3);
    expect(isqrt(15)).toBe(3);
    expect(isqrt(16)).toBe(4);
    expect(isqrt(1_000_000)).toBe(1000);
  });

  it('treats non-positive input as 0', () => {
    expect(isqrt(0)).toBe(0);
    expect(isqrt(-5)).toBe(0);
  });

  it('is exact and monotonic over a range (floor property + tightness)', () => {
    let prev = 0;
    for (let n = 0; n <= 5000; n++) {
      const r = isqrt(n);
      expect(r).toBeGreaterThanOrEqual(prev);
      expect(r * r).toBeLessThanOrEqual(n);
      expect((r + 1) * (r + 1)).toBeGreaterThan(n);
      prev = r;
    }
  });
});

describe('sqrtFP', () => {
  it('returns floor(sqrt(x) * 1000)', () => {
    expect(sqrtFP(0)).toBe(0);
    expect(sqrtFP(1)).toBe(1000);
    expect(sqrtFP(2)).toBe(1414);
    expect(sqrtFP(4)).toBe(2000);
    expect(sqrtFP(9)).toBe(3000);
  });
});
