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
  it('resolves to a single winning side', () => {
    const r = runTileFight(baseSetup, 42);
    expect(['A', 'B', 'draw']).toContain(r.winner);
    expect(r.events.at(-1)).toMatchObject({ t: 'end' });
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
