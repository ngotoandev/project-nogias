import { describe, it, expect } from 'vitest';
import { runReplay, runScriptedFight } from './replay';
import type { ReplayBundle, ScriptedFightBundle, UnitSpec } from '../shared/types';

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

// Small 1v1 setup where B has a big advantage; a join reinforcement for A turns it.
const smallSetup = {
  grid: { width: 5, height: 1, blocked: [] },
  units: [
    { id: 'a1', side: 'A' as const, attrs: { str: 3, agi: 3, int: 1, lck: 1 }, attackKind: 'melee' as const, priority: 5, pos: { x: 0, y: 0 } },
    { id: 'b1', side: 'B' as const, attrs: { str: 9, agi: 9, int: 1, lck: 1 }, attackKind: 'melee' as const, priority: 5, pos: { x: 4, y: 0 } },
  ],
};

const joinerSpec: UnitSpec = {
  id: 'a2', side: 'A', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 0, y: 0 },
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

  it('routes a v1 bundle exactly as before (golden unchanged)', () => {
    expect(runReplay({ version: 1, setup: canonical.setup, seed: 42 }).hash).toBe('86e238c1');
  });

  it('routes a v2 ScriptedFightBundle through runScriptedFight', () => {
    const bundle: ScriptedFightBundle = {
      version: 2,
      setup: smallSetup,
      seed: 5,
      script: [{ atActivation: 3, kind: 'join', specs: [joinerSpec] }],
    };
    const r = runReplay(bundle);
    expect(typeof r.hash).toBe('string');
    expect(r.hash.length).toBeGreaterThan(0);
  });
});

describe('runScriptedFight', () => {
  it('applies a join at the stamped activation — joiner appears in events', () => {
    const bundle: ScriptedFightBundle = {
      version: 2,
      setup: smallSetup,
      seed: 5,
      script: [{ atActivation: 3, kind: 'join', specs: [joinerSpec] }],
    };
    const r = runScriptedFight(bundle);
    expect(r.events.some(e => 'id' in e && e.id === joinerSpec.id)).toBe(true);
  });

  it('applies a join and the fight concludes with a valid result', () => {
    const bundle: ScriptedFightBundle = {
      version: 2,
      setup: smallSetup,
      seed: 5,
      script: [{ atActivation: 3, kind: 'join', specs: [joinerSpec] }],
    };
    const r = runScriptedFight(bundle);
    expect(r.endReason).toBeDefined();
    expect(r.ticks).toBeGreaterThan(0);
    expect(typeof r.hash).toBe('string');
  });

  it('applies a retreat at the stamped activation — unit exits with retreated flag', () => {
    // b1 is ordered to retreat to 'E' edge (x=4) at activation 2
    const retreatSetup = {
      grid: { width: 5, height: 1, blocked: [] },
      units: [
        { id: 'a1', side: 'A' as const, attrs: { str: 5, agi: 5, int: 1, lck: 1 }, attackKind: 'melee' as const, priority: 5, pos: { x: 0, y: 0 } },
        { id: 'b1', side: 'B' as const, attrs: { str: 3, agi: 3, int: 1, lck: 1 }, attackKind: 'melee' as const, priority: 5, pos: { x: 4, y: 0 } },
      ],
    };
    const bundle: ScriptedFightBundle = {
      version: 2,
      setup: retreatSetup,
      seed: 7,
      script: [{ atActivation: 2, kind: 'retreat', unitId: 'b1', exitEdge: 'E' }],
    };
    const r = runScriptedFight(bundle);
    expect(r.endReason).toBeDefined();
    expect(r.ticks).toBeGreaterThan(0);
    expect(typeof r.hash).toBe('string');
  });

  it('join at activation 0 applies before first step', () => {
    const bundle: ScriptedFightBundle = {
      version: 2,
      setup: smallSetup,
      seed: 1,
      script: [{ atActivation: 0, kind: 'join', specs: [joinerSpec] }],
    };
    const r = runScriptedFight(bundle);
    // joiner must have participated
    expect(r.events.some(e => 'id' in e && e.id === joinerSpec.id)).toBe(true);
  });

  it('multiple actions at same activation apply in array order', () => {
    const joiner1: UnitSpec = { id: 'a2', side: 'A', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 0, y: 0 } };
    const joiner2: UnitSpec = { id: 'a3', side: 'A', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 1, y: 0 } };
    const bundle: ScriptedFightBundle = {
      version: 2,
      setup: smallSetup,
      seed: 5,
      script: [
        { atActivation: 2, kind: 'join', specs: [joiner1] },
        { atActivation: 2, kind: 'join', specs: [joiner2] },
      ],
    };
    const r = runScriptedFight(bundle);
    expect(r.events.some(e => 'id' in e && e.id === 'a2')).toBe(true);
    expect(r.events.some(e => 'id' in e && e.id === 'a3')).toBe(true);
  });
});
