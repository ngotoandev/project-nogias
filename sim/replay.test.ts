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
    // width-7 grid: b1(agi=6) starts at x=1 and must traverse right to reach the E edge (x=6).
    // Without retreat b1 would fight a1 normally; with retreat it flees and exits as a retreated survivor.
    const retreatSetup = {
      grid: { width: 7, height: 1, blocked: [] },
      units: [
        { id: 'a1', side: 'A' as const, attrs: { str: 5, agi: 5, int: 1, lck: 1 }, attackKind: 'melee' as const, priority: 5, pos: { x: 0, y: 0 } },
        { id: 'b1', side: 'B' as const, attrs: { str: 3, agi: 6, int: 1, lck: 1 }, attackKind: 'melee' as const, priority: 5, pos: { x: 1, y: 0 } },
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
    // The ordered-to-retreat unit must appear as a retreated survivor.
    // This assertion fails if orderRetreat is ignored: b1 would be a normal survivor or casualty (no retreated flag).
    expect(r.survivors.find(s => s.id === 'b1')?.retreated).toBe(true);
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

  // ---------------------------------------------------------------------------
  // Task 5: End-to-end join + retreat combined scenario
  // ---------------------------------------------------------------------------
  //
  // Scenario: width-8 grid (1 row).
  //   a1 (A, str=5, agi=3): weak attacker, starts at x=0. Stays on-field throughout.
  //   b1 (B, str=15, agi=6): tanky (hp=95), fast (agi=6 → moveRange=3). Starts at x=6.
  //       Ordered to retreat E at activation 6. With moveRange=3 and only 1 cell to x=7,
  //       b1 exits on the first retreat step.
  //   a2 (joiner, A, str=8, agi=5): reinforcement, joins at activation 2 at x=1.
  //
  // Seed choice: seed=9.
  //   - a1 is slow and weak → b1 will survive many activations without being killed.
  //   - By activation 2 a1/b1 will have closed distance (or exchanged 1-2 attacks).
  //   - a2 joins (gauge=0), acts after b1/a1 complete a full turn boundary.
  //   - At activation 6 b1 retreats E: b1 starts at x=6 and moves right (toward x=7, the E edge).
  //     With moveRange=3, b1 reaches x=7 in one step and exits.
  //   - After b1 exits, only A units remain on-field → fight ends.
  //
  // Assertions:
  //   (a) b1 in survivors with retreated===true (exited via retreat order).
  //   (b) a1 and a2 in survivors with no retreated flag (on-field survivors).
  //   (c) a2's id appears in at least one event (participated).
  //   (d) b1 emits ≥1 move event with to.x > from.x (toward E) after the retreat order fires
  //       (activation 6 = 7th step boundary). b1 emits zero attack events after any retreat-direction
  //       move event (once retreating, it never attacks).
  // ---------------------------------------------------------------------------
  it('join then retreat: survivors distinguish on-field vs retreated; joiner participates; retreater never attacks after retreat order', () => {
    const combinedSetup = {
      grid: { width: 8, height: 1, blocked: [] },
      units: [
        { id: 'a1', side: 'A' as const, attrs: { str: 5, agi: 3, int: 1, lck: 1 }, attackKind: 'melee' as const, priority: 5, pos: { x: 0, y: 0 } },
        { id: 'b1', side: 'B' as const, attrs: { str: 15, agi: 6, int: 1, lck: 1 }, attackKind: 'melee' as const, priority: 5, pos: { x: 6, y: 0 } },
      ],
    };
    const a2Spec: UnitSpec = {
      id: 'a2', side: 'A', attrs: { str: 8, agi: 5, int: 1, lck: 1 }, attackKind: 'melee', priority: 5,
      pos: { x: 1, y: 0 },
    };
    const bundle: ScriptedFightBundle = {
      version: 2,
      setup: combinedSetup,
      seed: 9,
      script: [
        { atActivation: 2, kind: 'join', specs: [a2Spec] },
        { atActivation: 6, kind: 'retreat', unitId: 'b1', exitEdge: 'E' },
      ],
    };
    const r = runScriptedFight(bundle);

    // (a) The retreated unit appears in survivors with retreated === true.
    const b1Survivor = r.survivors.find(s => s.id === 'b1');
    expect(b1Survivor).toBeDefined();
    expect(b1Survivor?.retreated).toBe(true);

    // (b) On-field survivors do NOT carry the retreated flag (absent / undefined).
    const onFieldSurvivors = r.survivors.filter(s => s.id !== 'b1');
    for (const s of onFieldSurvivors) {
      expect(s.retreated).toBeUndefined();
    }

    // (c) The joiner (a2) participated: its id must appear in the event stream.
    expect(r.events.some(e => 'id' in e && e.id === 'a2')).toBe(true);

    // (d) Event-stream consistency: once the retreat order fires (atActivation=6, i.e. before the
    //     7th step), b1 must only emit move events toward x=7 (to.x > from.x) — never attack events.
    //
    //     Strategy: find the first move event from b1 where to.x > from.x (the first retreat step).
    //     From that point onward, assert b1 emits zero attack or miss events.
    const firstRetreatMoveIdx = r.events.findIndex(
      e => e.t === 'move' && e.id === 'b1' && e.to.x > e.from.x,
    );
    // The retreat order fires at atActivation=6 so b1 MUST have emitted at least one rightward move.
    expect(firstRetreatMoveIdx).toBeGreaterThanOrEqual(0);

    const eventsAfterRetreatStarts = r.events.slice(firstRetreatMoveIdx);
    const b1AttacksAfterRetreat = eventsAfterRetreatStarts.filter(
      e => (e.t === 'attack' || e.t === 'miss') && 'id' in e && e.id === 'b1',
    );
    expect(b1AttacksAfterRetreat.length).toBe(0);
  });
});
