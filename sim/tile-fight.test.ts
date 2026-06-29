import { describe, it, expect } from 'vitest';
import { runTileFight } from './tile-fight';
import type { FightSetup } from '../shared/types';

const baseSetup: FightSetup = {
  grid: { width: 8, height: 8, blocked: [] },
  units: [
    { id: 'a1', side: 'A', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 0, y: 0 } },
    { id: 'b1', side: 'B', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 7, y: 7 } },
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
        { id: 'a1', side: 'A', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, attackKind: 'melee', priority: 0, pos: { x: 0, y: 0 } },
        { id: 'b1', side: 'B', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, attackKind: 'melee', priority: 0, pos: { x: 2, y: 0 } },
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
        { id: 'a1', side: 'A', attrs: { str: 9, agi: 9, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 0, y: 0 } },
        { id: 'b1', side: 'B', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 2, y: 0 } },
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

  it('attack events carry a crit flag and the attacker\'s channel', () => {
    const r = runTileFight(baseSetup, 42);
    const attacks = r.events.filter((e) => e.t === 'attack');
    expect(attacks.length).toBeGreaterThan(0);
    for (const e of attacks) {
      if (e.t !== 'attack') continue;
      expect(typeof e.crit).toBe('boolean');
      expect(e.channel).toBe('physical'); // both baseSetup units are melee
    }
  });

  it('routes magic attackers through the magic channel and melee through physical', () => {
    const mk = (kind: 'melee' | 'magic') => ({
      grid: { width: 2, height: 1, blocked: [] },
      units: [
        // INT 9 -> accuracy high enough that hitBp caps at 10000 vs a min-evasion
        // target, so the first attack always lands; AGI 5 -> acts first.
        { id: 'atk', side: 'A' as const, attrs: { str: 1, agi: 5, int: 9, lck: 1 }, attackKind: kind, priority: 5, pos: { x: 0, y: 0 } },
        { id: 'tgt', side: 'B' as const, attrs: { str: 5, agi: 1, int: 1, lck: 1 }, attackKind: 'melee' as const, priority: 0, pos: { x: 1, y: 0 } },
      ],
    });
    const channelOf = (kind: 'melee' | 'magic') => {
      const r = runTileFight(mk(kind), 3);
      const e = r.events.find((ev) => ev.t === 'attack' && ev.id === 'atk');
      return e && e.t === 'attack' ? e.channel : null;
    };
    expect(channelOf('magic')).toBe('magic');
    expect(channelOf('melee')).toBe('physical');
  });

  it('mitigates more damage against a higher matching defense', () => {
    const mk = (targetInt: number) => ({
      grid: { width: 2, height: 1, blocked: [] },
      units: [
        { id: 'atk', side: 'A' as const, attrs: { str: 1, agi: 5, int: 9, lck: 1 }, attackKind: 'magic' as const, priority: 5, pos: { x: 0, y: 0 } },
        { id: 'tgt', side: 'B' as const, attrs: { str: 5, agi: 1, int: targetInt, lck: 1 }, attackKind: 'melee' as const, priority: 0, pos: { x: 1, y: 0 } },
      ],
    });
    const firstDamage = (targetInt: number) => {
      const r = runTileFight(mk(targetInt), 3);
      const e = r.events.find((ev) => ev.t === 'attack' && ev.id === 'atk');
      return e && e.t === 'attack' ? e.damage : -1;
    };
    // Same attacker + seed -> identical hit/crit rolls; only magicResist differs.
    expect(firstDamage(1)).toBeGreaterThan(firstDamage(9));
  });
});

describe('runTileFight golden hash', () => {
  it('matches the captured baseline hash (regenerate intentionally if logic changes)', () => {
    const r = runTileFight(baseSetup, 42);
    // CAPTURE STEP: run `npm test` once, read the received value from the
    // failure diff, and paste it here. Changing this value is a deliberate
    // act that flags a behavioral change in the engine.
    expect(r.hash).toBe('86e238c1');
  });
});
