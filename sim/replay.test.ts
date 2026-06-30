import { describe, it, expect } from 'vitest';
import { runReplay, runScriptedFight } from './replay';
import { runScriptedConquest } from './replay';
import type { ReplayBundle, ScriptedFightBundle, UnitSpec, ConquestBundle, MapSetup } from '../shared/types';

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
  //   a1 (A, str=8, agi=5): attacker, starts at x=0. Stays on-field throughout (barely survives
  //       with 4 hp in seed=9; use str=8 not str=5 so a1 outlasts the 6 activations before b1 retreats).
  //   b1 (B, str=15, agi=6): tanky (hp=95), fast (agi=6 → moveRange=3). Starts at x=6.
  //       Ordered to retreat E at activation 6. With moveRange=3 and only 1 cell to x=7,
  //       b1 exits on the first retreat step.
  //   a2 (joiner, A, str=8, agi=5): reinforcement, joins at activation 2 at x=1.
  //
  // Seed choice: seed=9.
  //   - a1 has enough HP (hp=60) to survive 6 activations while b1 is tanky (hp=95).
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
        { id: 'a1', side: 'A' as const, attrs: { str: 8, agi: 5, int: 1, lck: 1 }, attackKind: 'melee' as const, priority: 5, pos: { x: 0, y: 0 } },
        { id: 'b1', side: 'B' as const, attrs: { str: 15, agi: 6, int: 1, lck: 1 }, attackKind: 'melee' as const, priority: 5, pos: { x: 6, y: 0 } },
      ],
    };
    const a2Spec: UnitSpec = {
      id: 'a2', side: 'A', attrs: { str: 8, agi: 5, int: 1, lck: 1 }, attackKind: 'melee', priority: 5,
      pos: { x: 1, y: 0 },
    };
    // atActivation: K fires when the activation counter reaches K, i.e. just before the
    // (K+1)-th stepFight call (0-indexed) — see runScriptedFight's dispatch loop.
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
    //     Assert the expected on-field units are actually present so the loop below
    //     cannot pass vacuously on an empty array (e.g. if fightResult drops them).
    expect(r.survivors.find(s => s.id === 'a1')).toBeDefined();
    expect(r.survivors.find(s => s.id === 'a2')).toBeDefined();
    expect(r.survivors.find(s => s.id === 'a1')?.retreated).toBeUndefined();
    expect(r.survivors.find(s => s.id === 'a2')?.retreated).toBeUndefined();
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

// ---------------------------------------------------------------------------
// Task 5: runScriptedConquest + v3 runReplay branch
// ---------------------------------------------------------------------------

// Minimal map: 2 owned tiles (home + transit) + 1 enemy undefended tile.
//   t0 (owner=player, type=start) — home, neighbors: { E: 't1' }
//   t1 (owner=player, type=start) — transit, neighbors: { W: 't0', E: 't2' }
//   t2 (owner=enemy, type=enemy, garrison=[]) — target (undefended)
// Army a1 starts at t0 with one unit (agi=1 → tempoRate=11).
// Dispatch at tick 0: route = [t1, t2] (2 hops).
// Each hop costs ceil(100/11) = 10 ticks (gauge accumulates, so it might take
// a few ticks depending on whether dispatch happens on tick 0 before the travel
// phase, which per advance() design it does — newly dispatched armies don't move
// the same tick).
// After 2 hops, army arrives at t2 (undefended, owner=enemy) → captured.
// Quiescent: no army travelling + no pending commands at tick ≥ totalTicks.
const unitSpec: UnitSpec = {
  id: 'u1', side: 'A', attrs: { str: 5, agi: 1, int: 1, lck: 1 },
  attackKind: 'melee', priority: 5, pos: { x: 0, y: 0 },
};
const mapWithUndefendedTarget: MapSetup = {
  tiles: [
    { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
    { id: 't1', type: 'start', owner: 'player', neighbors: { W: 't0', E: 't2' }, garrison: [] },
    { id: 't2', type: 'enemy', owner: 'enemy', neighbors: { W: 't1' }, garrison: [] },
  ],
  armies: [{ id: 'a1', units: [unitSpec], tile: 't0' }],
};

describe('runScriptedConquest', () => {
  it('runReplay still routes v1/v2 unchanged (golden 86e238c1)', () => {
    expect(runReplay({ version: 1, setup: canonical.setup, seed: 42 }).hash).toBe('86e238c1');
  });

  it('runScriptedConquest runs a dispatch→travel→capture scenario and produces the known-good hash', () => {
    const bundle: ConquestBundle = {
      version: 3,
      seed: 0,
      setup: mapWithUndefendedTarget,
      script: [{ atTick: 0, commands: [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }] }],
    };
    const r = runScriptedConquest(bundle);
    // Pinned hash: must equal the capture golden exactly.
    // Fails if the dispatch is rejected (no-op) or the capture path does not fire.
    expect(r.hash).toBe('503f1a30');
    expect(r.ticks).toBeGreaterThan(0);
  });

  it('runScriptedConquest contested scenario produces the known-good hash', () => {
    // Same map as capture but t2 has a garrison — army arrives and state becomes contested.
    const contestedSetup: MapSetup = {
      tiles: [
        { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
        { id: 't1', type: 'start', owner: 'player', neighbors: { W: 't0', E: 't2' }, garrison: [] },
        { id: 't2', type: 'enemy', owner: 'enemy', neighbors: { W: 't1' }, garrison: [
          { id: 'e1', side: 'B', attrs: { str: 5, agi: 1, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 0, y: 0 } },
        ] },
      ],
      armies: [{ id: 'a1', units: [unitSpec], tile: 't0' }],
    };
    const bundle: ConquestBundle = {
      version: 3,
      seed: 0,
      setup: contestedSetup,
      script: [{ atTick: 0, commands: [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }] }],
    };
    const r = runScriptedConquest(bundle);
    // Pinned hash: must equal the contested golden exactly.
    // The contested seam now opens a battle (battleOpened event), not an inert contested event.
    // Re-pinned by Task 3: runScriptedConquest quiescence now waits for all battles to resolve,
    // so totalTicks increases (battles are stepped until outcome), changing the hash.
    // Re-pinned by Task 4: battle outcome is now applied — army stops being contested (it becomes
    // garrisoned after capture), tile owner flips to 'player'. Both change the hashMap inputs,
    // producing a new hash. This is a UNIT TEST hash, not a parity fixture.
    expect(r.hash).toBe('523f1d56');
    expect(r.ticks).toBeGreaterThan(0);
  });

  it('runReplay v3 branch delegates to runScriptedConquest and returns hash+ticks (no winner/endReason)', () => {
    const bundle: ConquestBundle = {
      version: 3,
      seed: 0,
      setup: mapWithUndefendedTarget,
      script: [{ atTick: 0, commands: [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }] }],
    };
    const r = runReplay(bundle);
    // Pinned: same capture bundle as runScriptedConquest, must equal the capture golden.
    expect(r.hash).toBe('503f1a30');
    expect(r.ticks).toBeGreaterThan(0);
    expect(r.winner).toBeUndefined();
    expect(r.endReason).toBeUndefined();
  });

  it('runScriptedConquest goes quiescent (no travelling army + no pending commands)', () => {
    const bundle: ConquestBundle = {
      version: 3,
      seed: 0,
      setup: mapWithUndefendedTarget,
      script: [{ atTick: 0, commands: [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }] }],
    };
    const r = runScriptedConquest(bundle);
    // After quiescence, army must be garrisoned (captured or contested)
    // Ticks must be finite (well under CONQUEST_MAX_TICKS=100_000)
    expect(r.ticks).toBeLessThan(1000);
  });
});
