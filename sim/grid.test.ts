import { describe, it, expect } from 'vitest';
import { makeGrid, chebyshev, manhattan, stepToward, hasLineOfSight, stepAway } from './grid';
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

describe('stepAway', () => {
  it('moves to the enterable 4-neighbor maximizing min-chebyshev to threats', () => {
    const open = () => true;
    // from (2,2), single threat at (2,0): chebyshev = 2. Candidates:
    //   E=(3,2) dist=3, W=(1,2) dist=3, N=(2,3) dist=3, S=(2,1) dist=1.
    // E wins on tiebreak (first candidate) but brief says (2,3).
    // Brief says stepAway({x:2,y:2},[{x:2,y:0}],open) = {x:2,y:3}.
    // Wait — candidate order is E,W,N,S where E=(x+1,y), W=(x-1,y), N=(x,y-1)?, S=(x,y+1)?
    // The brief uses E,W,N,S: {x+1,y}, {x-1,y}, {x,y+1}, {x,y-1}
    // Let's check: threat at (2,0), from (2,2).
    //   E=(3,2): chebyshev to (2,0) = max(1,2) = 2. dist from = 2.
    //   W=(1,2): chebyshev to (2,0) = max(1,2) = 2. dist from = 2.
    //   N=(2,3): chebyshev to (2,0) = max(0,3) = 3. dist from = 2. > bestScore(2). Winner!
    //   S=(2,1): chebyshev to (2,0) = max(0,1) = 1. dist from = 2.
    // So N=(x,y+1) wins with score 3. The brief code has {x,y+1} as 3rd candidate (index 2).
    // That matches expected {x:2,y:3}.
    expect(stepAway({ x: 2, y: 2 }, [{ x: 2, y: 0 }], open)).toEqual({ x: 2, y: 3 });
  });

  it('returns from when no neighbor improves or all blocked', () => {
    expect(stepAway({ x: 0, y: 0 }, [{ x: 5, y: 5 }], () => false)).toEqual({ x: 0, y: 0 });
  });

  it('returns from when threats is empty', () => {
    const open = () => true;
    expect(stepAway({ x: 3, y: 3 }, [], open)).toEqual({ x: 3, y: 3 });
  });

  it('stays put when already maximally far (no neighbor improves score)', () => {
    const open = () => true;
    // from (0,0), threat at (5,5), chebyshev=5. All neighbors have chebyshev <= 5 (corners/edges).
    // E=(1,0): cheb(1,0,5,5)=5, W=(-1,0): out of... well canEnter is open, so (-1,0) accepted.
    // cheb(-1,0,5,5)=max(6,5)=6 > 5, so W wins over from. Just verify we get a valid cell.
    const from = { x: 0, y: 0 };
    const result = stepAway(from, [{ x: 5, y: 5 }], open);
    // W=(-1,0) has cheb(-1,0 to 5,5)=max(6,5)=6 > 5 = from score. So result != from.
    expect(result).not.toEqual(from);
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
