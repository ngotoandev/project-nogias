import { describe, it, expect } from 'vitest';
import { runReplay } from './replay';
import type { ReplayBundle } from '../shared/types';

const canonical: ReplayBundle = {
  version: 1,
  seed: 42,
  setup: {
    grid: { width: 8, height: 8, blocked: [] },
    units: [
      { id: 'a1', side: 'A', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 0, y: 0 } },
      { id: 'b1', side: 'B', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 7, y: 7 } },
    ],
  },
};

describe('runReplay', () => {
  it('reproduces the tile-fight golden hash for the canonical bundle', () => {
    expect(runReplay(canonical).hash).toBe('86e238c1');
  });

  it('round-trips through JSON to an identical result', () => {
    const a = runReplay(canonical);
    const b = runReplay(JSON.parse(JSON.stringify(canonical)) as ReplayBundle);
    expect(b).toEqual(a);
  });

  it('projects winner, ticks and endReason from the fight', () => {
    const r = runReplay(canonical);
    expect(r.winner === 'A' || r.winner === 'B').toBe(true); // canonical fight is decisive
    expect(r.endReason).toBe('decisive');
    expect(r.ticks).toBeGreaterThan(0);
  });
});
