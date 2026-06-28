import { describe, it, expect } from 'vitest';
import { makeGrid, chebyshev, manhattan, stepToward } from './grid';
import type { Cell } from '../shared/types';

describe('grid', () => {
  it('reports bounds and blocked cells', () => {
    const g = makeGrid({ width: 4, height: 4, blocked: [{ x: 1, y: 1 }] });
    expect(g.inBounds({ x: 0, y: 0 })).toBe(true);
    expect(g.inBounds({ x: 4, y: 0 })).toBe(false);
    expect(g.isBlocked({ x: 1, y: 1 })).toBe(true);
    expect(g.isBlocked({ x: 0, y: 0 })).toBe(false);
  });

  it('computes chebyshev and manhattan distance', () => {
    expect(chebyshev({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(3);
    expect(manhattan({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(4);
  });

  it('steps one cell toward the target along the greater axis', () => {
    const open = () => true;
    expect(stepToward({ x: 0, y: 0 }, { x: 5, y: 1 }, open)).toEqual({ x: 1, y: 0 });
  });

  it('prefers x-axis on equal-distance tie', () => {
    const open = () => true;
    expect(stepToward({ x: 0, y: 0 }, { x: 1, y: 1 }, open)).toEqual({ x: 1, y: 0 });
  });

  it('routes around a blocked primary cell', () => {
    const blockedAt = (c: Cell) => !(c.x === 1 && c.y === 0);
    expect(stepToward({ x: 0, y: 0 }, { x: 5, y: 2 }, blockedAt)).toEqual({ x: 0, y: 1 });
  });

  it('returns the origin when fully stuck', () => {
    const closed = () => false;
    expect(stepToward({ x: 0, y: 0 }, { x: 5, y: 5 }, closed)).toEqual({ x: 0, y: 0 });
  });
});
