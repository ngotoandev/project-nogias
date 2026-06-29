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

// True iff no `blocked` cell lies strictly between `from` and `to` on the
// supercover line (every cell the segment passes through). Endpoints are never
// tested; adjacent cells (no intermediate) are always clear. Symmetric under
// endpoint reversal. Integer-only (goja-safe): no Math.sqrt, no floats.
export function hasLineOfSight(from: Cell, to: Cell, isBlocked: (c: Cell) => boolean): boolean {
  const nx = Math.abs(to.x - from.x);
  const ny = Math.abs(to.y - from.y);
  const sx = sign(to.x - from.x);
  const sy = sign(to.y - from.y);
  let x = from.x;
  let y = from.y;
  let ix = 0;
  let iy = 0;
  while (ix < nx || iy < ny) {
    // Symmetric supercover decision; ×2 keeps it integer. ==0 is an exact
    // corner crossing -> step diagonally (visit the corner cell).
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (decision === 0) { x += sx; y += sy; ix++; iy++; }
    else if (decision < 0) { x += sx; ix++; }
    else { y += sy; iy++; }
    if (x === to.x && y === to.y) break; // reached destination; endpoint not tested
    if (isBlocked({ x, y })) return false;
  }
  return true;
}

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
