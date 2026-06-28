import type { Cell, GridSpec } from '../shared/types';

export interface Grid {
  width: number;
  height: number;
  inBounds(c: Cell): boolean;
  isBlocked(c: Cell): boolean;
}

function key(c: Cell): string { return c.x + ',' + c.y; }

export function makeGrid(spec: GridSpec): Grid {
  const blocked = new Set(spec.blocked.map(key));
  return {
    width: spec.width,
    height: spec.height,
    inBounds(c) { return c.x >= 0 && c.y >= 0 && c.x < spec.width && c.y < spec.height; },
    isBlocked(c) { return blocked.has(key(c)); },
  };
}

export function chebyshev(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function sign(n: number): number { return n > 0 ? 1 : n < 0 ? -1 : 0; }

// One 4-directional step toward target: greater axis first, tie -> x.
// Tries primary then secondary; returns `from` if neither is enterable.
export function stepToward(from: Cell, target: Cell, canEnter: (c: Cell) => boolean): Cell {
  const dx = sign(target.x - from.x);
  const dy = sign(target.y - from.y);
  if (dx === 0 && dy === 0) return from;
  const ax = Math.abs(target.x - from.x);
  const ay = Math.abs(target.y - from.y);
  const primary: Cell = ax >= ay ? { x: from.x + dx, y: from.y } : { x: from.x, y: from.y + dy };
  const secondary: Cell = ax >= ay ? { x: from.x, y: from.y + dy } : { x: from.x + dx, y: from.y };
  if ((primary.x !== from.x || primary.y !== from.y) && canEnter(primary)) return primary;
  if ((secondary.x !== from.x || secondary.y !== from.y) && canEnter(secondary)) return secondary;
  return from;
}
