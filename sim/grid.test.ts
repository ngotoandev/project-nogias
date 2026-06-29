import { describe, it, expect } from 'vitest';
import { makeGrid, chebyshev, manhattan, stepToward, hasLineOfSight } from './grid';
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

describe('hasLineOfSight', () => {
  const blocked = (...cells: Cell[]) => (c: Cell) => cells.some((b) => b.x === c.x && b.y === c.y);
  const open = () => false;

  it('is clear along an open horizontal line', () => {
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 4, y: 0 }, open)).toBe(true);
  });

  it('is blocked by a wall strictly on the line', () => {
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 4, y: 0 }, blocked({ x: 2, y: 0 }))).toBe(false);
  });

  it('treats adjacent cells as always clear (no intermediate cells)', () => {
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 1, y: 0 }, open)).toBe(true);
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 1, y: 1 }, open)).toBe(true);
  });

  it('never tests the endpoints themselves', () => {
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 4, y: 0 }, blocked({ x: 4, y: 0 }))).toBe(true);
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 4, y: 0 }, blocked({ x: 0, y: 0 }))).toBe(true);
  });

  it('handles diagonals, clear and blocked', () => {
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 3, y: 3 }, open)).toBe(true);
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 3, y: 3 }, blocked({ x: 2, y: 2 }))).toBe(false);
  });

  it('is symmetric under endpoint reversal', () => {
    const cases: Array<[Cell, Cell, (c: Cell) => boolean]> = [
      [{ x: 0, y: 0 }, { x: 4, y: 0 }, blocked({ x: 2, y: 0 })],
      [{ x: 0, y: 0 }, { x: 3, y: 3 }, blocked({ x: 2, y: 2 })],
      [{ x: 1, y: 0 }, { x: 4, y: 2 }, blocked({ x: 3, y: 1 })],
      [{ x: 0, y: 2 }, { x: 5, y: 0 }, open],
    ];
    for (const [a, b, blk] of cases) {
      expect(hasLineOfSight(a, b, blk)).toBe(hasLineOfSight(b, a, blk));
    }
  });
});
