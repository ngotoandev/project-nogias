import { describe, it, expect } from 'vitest';
import { runTileFight } from './tile-fight';
import type { FightSetup } from '../shared/types';

const baseSetup: FightSetup = {
  grid: { width: 8, height: 8, blocked: [] },
  units: [
    { id: 'a1', side: 'A', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
    { id: 'b1', side: 'B', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 7, y: 7 } },
  ],
};

describe('runTileFight', () => {
  it('resolves with an end event and a consistent endReason', () => {
    const r = runTileFight(baseSetup, 42);
    expect(r.events.at(-1)).toMatchObject({ t: 'end' });
    if (r.winner === 'A' || r.winner === 'B') {
      expect(r.endReason).toBe('decisive');
    } else {
      expect(['wipe', 'timeout']).toContain(r.endReason);
    }
  });

  it('reports a timeout (not a wipe) when units cannot reach each other', () => {
    const walled: FightSetup = {
      grid: { width: 3, height: 1, blocked: [{ x: 1, y: 0 }] },
      units: [
        { id: 'a1', side: 'A', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, priority: 0, pos: { x: 0, y: 0 } },
        { id: 'b1', side: 'B', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, priority: 0, pos: { x: 2, y: 0 } },
      ],
    };
    const r = runTileFight(walled, 7);
    expect(r.winner).toBe('draw');
    expect(r.endReason).toBe('timeout');
    expect(r.ticks).toBeGreaterThan(100_000);
    expect(r.events.at(-1)).toMatchObject({ t: 'end', winner: 'draw', endReason: 'timeout' });
  });

  it('a far stronger squad wins', () => {
    const lopsided: FightSetup = {
      grid: { width: 8, height: 8, blocked: [] },
      units: [
        { id: 'a1', side: 'A', attrs: { str: 9, agi: 9, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
        { id: 'b1', side: 'B', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 2, y: 0 } },
      ],
    };
    expect(runTileFight(lopsided, 1).winner).toBe('A');
  });

  it('emits move and attack events before a death', () => {
    const r = runTileFight(baseSetup, 42);
    expect(r.events.some((e) => e.t === 'move')).toBe(true);
    expect(r.events.some((e) => e.t === 'attack')).toBe(true);
    expect(r.events.some((e) => e.t === 'death')).toBe(true);
  });

  it('is deterministic: same seed -> identical events and hash', () => {
    const r1 = runTileFight(baseSetup, 42);
    const r2 = runTileFight(baseSetup, 42);
    expect(r2.events).toEqual(r1.events);
    expect(r2.hash).toBe(r1.hash);
    expect(r2.winner).toBe(r1.winner);
  });

  it('does not mutate the caller setup', () => {
    const snapshot = JSON.stringify(baseSetup);
    runTileFight(baseSetup, 42);
    expect(JSON.stringify(baseSetup)).toBe(snapshot);
  });
});

describe('runTileFight golden hash', () => {
  it('matches the captured baseline hash (regenerate intentionally if logic changes)', () => {
    const r = runTileFight(baseSetup, 42);
    // CAPTURE STEP: run `npm test` once, read the received value from the
    // failure diff, and paste it here. Changing this value is a deliberate
    // act that flags a behavioral change in the engine.
    expect(r.hash).toBe('e9ff47f3');
  });
});
