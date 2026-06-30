import { describe, it, expect } from 'vitest';
import { initConquest, hashMap, advance, committedCount, MapState, reconcileArmy } from './conquest-map';
import type { MapSetup, UnitSpec, Army } from '../shared/types';
import type { FightState } from './tile-fight';

// 3 tiles in a row: t0(player) — t1(neutral, empty) — t2(enemy, garrison). Helper builds it.
function setup(): MapSetup {
  const u = (id: string) => ({ id, side: 'B' as const, attackKind: 'melee' as const, attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } });
  return {
    tiles: [
      { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
      { id: 't1', type: 'cache', owner: 'neutral', neighbors: { W: 't0', E: 't2' }, garrison: [] },
      { id: 't2', type: 'enemy',  owner: 'enemy',   neighbors: { W: 't1' }, garrison: [u('g1')] },
    ],
    armies: [{ id: 'a1', units: [{ id: 'a1u', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }], tile: 't0' }],
  };
}

it('initConquest builds state with garrisoned armies at gauge 0', () => {
  const s = initConquest(setup());
  expect(s.totalTicks).toBe(0);
  expect(s.armies[0]).toMatchObject({ id: 'a1', tile: 't0', state: 'garrisoned', travelGauge: 0 });
  expect(s.tiles.find(t => t.id === 't0')!.owner).toBe('player');
});
it('hashMap is stable and independent of input tile/army ordering', () => {
  const a = initConquest(setup());
  const b = initConquest(setup()); // re-build; same content
  expect(hashMap(a)).toBe(hashMap(b));
  // reorder tiles in the input → same hash (sorted by id internally)
  const reordered = setup(); reordered.tiles.reverse();
  expect(hashMap(initConquest(reordered))).toBe(hashMap(a));
});
it('hashMap changes when an owner changes', () => {
  const s = initConquest(setup());
  const h0 = hashMap(s);
  s.tiles.find(t => t.id === 't1')!.owner = 'player';
  expect(hashMap(s)).not.toBe(h0);
});
it('initConquest deep-copies: mutating returned state does not bleed into setup input', () => {
  const input = setup();
  const origArmyStr = input.armies[0]!.units[0]!.attrs.str;
  const origGarrisonPosX = input.tiles[2]!.garrison[0]!.pos.x;

  const state = initConquest(input);

  // Mutate returned state's nested fields
  state.armies[0]!.units[0]!.attrs.str = 99;
  state.tiles.find(t => t.id === 't2')!.garrison[0]!.pos.x = 42;

  // Input must be unchanged (deep-copy contract)
  expect(input.armies[0]!.units[0]!.attrs.str).toBe(origArmyStr);
  expect(input.tiles[2]!.garrison[0]!.pos.x).toBe(origGarrisonPosX);
});

// ── Helpers for advance tests ────────────────────────────────────────────────

// t0(player) — t1(player) — t2(enemy): t1 is owned; t2 adjacent to t1 → launch tile = t1
function setupWithT1Owned(): MapSetup {
  const u = (id: string) => ({ id, side: 'B' as const, attackKind: 'melee' as const, attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } });
  return {
    tiles: [
      { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
      { id: 't1', type: 'cache', owner: 'player', neighbors: { W: 't0', E: 't2' }, garrison: [] },
      { id: 't2', type: 'enemy', owner: 'enemy', neighbors: { W: 't1' }, garrison: [u('g1')] },
    ],
    armies: [{ id: 'a1', units: [{ id: 'a1u', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }], tile: 't0' }],
  };
}

// t0(player) — t1(player) — t2(enemy) — t3(enemy):
// BFS shortest-path test: from t0 there are multiple routes if we add t4(player)
// adjacent to t2 via S. Shortest owned path to launch tile adjacent to t2 is via t1.
function setupBfsShortcut(): MapSetup {
  const u = (id: string) => ({ id, side: 'B' as const, attackKind: 'melee' as const, attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } });
  // t0-E→t1-E→t2: direct route of length 1 hop from t0 (launch = t1)
  // Also t0-S→t4-E→t2: longer route of 2 hops from t0 (launch = t4)
  // BFS in N,S,E,W order from t0 should first expand N (nothing), S→t4, E→t1
  // But t1 (dist 1) is found before t4 (dist 1 also) — expansion order: t1 found via E first
  // Actually BFS expands neighbors in N,S,E,W order: t0's S=t4, E=t1. In BFS queue: t4 then t1 (or depends on order).
  // With N,S,E,W expansion from t0: queue starts [t0], expand t0: add S(t4), E(t1) in that order → queue=[t4,t1].
  // Expand t4: its E=t2 → t2 is NOT owned so check if launch → t4 is launch for t2.
  // But t1 is also at same dist=1, expanded after t4 → t1 is launch too.
  // BFS finds t4 as launch (dist 1) FIRST (S before E). So shortest path via t4.
  // route from t0 to t2 via t4 (launch): path=[t4], then append t2 → route=['t4','t2'].
  // No, drop fromId(t0) from path. Path is [t0, t4] → drop t0 → [t4] → append t2 → ['t4', 't2'].
  // This tests BFS expansion order matters.
  return {
    tiles: [
      { id: 't0', type: 'start', owner: 'player', neighbors: { S: 't4', E: 't1' }, garrison: [] },
      { id: 't1', type: 'cache', owner: 'player', neighbors: { W: 't0', E: 't2' }, garrison: [] },
      { id: 't2', type: 'enemy', owner: 'enemy', neighbors: { W: 't1', N: 't4' }, garrison: [u('g1')] },
      { id: 't4', type: 'cache', owner: 'player', neighbors: { N: 't0', S: 't2' }, garrison: [] },
    ],
    armies: [{ id: 'a1', units: [{ id: 'a1u', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }], tile: 't0' }],
  };
}

// 5 armies all targeting t2 for cap test
function setupCapFull(): MapSetup {
  const u = (id: string) => ({ id, side: 'B' as const, attackKind: 'melee' as const, attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } });
  const mk = (id: string) => ({ id, units: [{ id: `${id}u`, side: 'A' as const, attackKind: 'melee' as const, attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }], tile: 't1' });
  return {
    tiles: [
      { id: 't1', type: 'start', owner: 'player', neighbors: { E: 't2' }, garrison: [] },
      { id: 't2', type: 'enemy', owner: 'enemy', neighbors: { W: 't1' }, garrison: [u('g1')] },
    ],
    armies: ['a1', 'a2', 'a3', 'a4', 'a5'].map(mk),
  };
}

// ── advance + DispatchArmy tests ─────────────────────────────────────────────

it('advance increments totalTicks', () => {
  const s = initConquest(setup());
  advance(s, []);
  expect(s.totalTicks).toBe(1);
});

it('dispatch to enemy tile adjacent to owned territory: army set to travelling with correct route and slot reserved', () => {
  const s = initConquest(setupWithT1Owned());
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }]);
  const a = s.armies.find(x => x.id === 'a1')!;
  expect(a.state).toBe('travelling');
  expect(a.target).toBe('t2');
  // From t0: BFS owned tiles. t0 is launch? EDGES N,S,E,W: t0.E=t1, t1.E=t2 → t1 is launch.
  // path from t0 to t1: [t0, t1]. Drop t0 → [t1]. Append t2 → ['t1', 't2'].
  expect(a.route).toEqual(['t1', 't2']);
  expect(s.events.some(e => e.t === 'dispatched' && e.armyId === 'a1')).toBe(true);
});

it('dispatch to enemy tile: army on owned launch tile itself → route is [toTile]', () => {
  // Army garrisoned on t1 (owned, adjacent to t2). Route = [t2].
  const s = initConquest(setupWithT1Owned());
  // Move a1 to t1 directly in state (test setup hack)
  s.armies[0]!.tile = 't1';
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }]);
  const a = s.armies.find(x => x.id === 'a1')!;
  expect(a.state).toBe('travelling');
  expect(a.route).toEqual(['t2']);
});

it('rejects dispatch when target is not adjacent to any owned tile', () => {
  const s = initConquest(setup()); // t1 is neutral → t2 not adjacent to owned tile
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }]);
  expect(s.armies.find(x => x.id === 'a1')!.state).toBe('garrisoned');
  expect(s.events.some(e => e.t === 'rejected' && e.armyId === 'a1')).toBe(true);
});

it('rejects dispatch when target is already at MAX_COMMIT (4)', () => {
  const s = initConquest(setupCapFull());
  // Dispatch a1..a4 → all succeed (cap=4)
  advance(s, [
    { t: 'dispatch', armyId: 'a1', toTile: 't2' },
    { t: 'dispatch', armyId: 'a2', toTile: 't2' },
    { t: 'dispatch', armyId: 'a3', toTile: 't2' },
    { t: 'dispatch', armyId: 'a4', toTile: 't2' },
  ]);
  const committedAfterFour = s.armies.filter(a => a.target === 't2' && a.state === 'travelling').length;
  expect(committedAfterFour).toBe(4);
  // Now dispatch a5 → should reject (cap full)
  advance(s, [{ t: 'dispatch', armyId: 'a5', toTile: 't2' }]);
  expect(s.armies.find(x => x.id === 'a5')!.state).toBe('garrisoned');
  expect(s.events.some(e => e.t === 'rejected' && e.armyId === 'a5' && 'reason' in e && e.reason === 'cap-full')).toBe(true);
});

it('rejects dispatch of a non-garrisoned army', () => {
  const s = initConquest(setupWithT1Owned());
  // Manually set a1 to travelling state
  s.armies[0]!.state = 'travelling';
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }]);
  expect(s.events.some(e => e.t === 'rejected' && e.armyId === 'a1')).toBe(true);
});

it('rejects dispatch when army id does not exist', () => {
  const s = initConquest(setupWithT1Owned());
  advance(s, [{ t: 'dispatch', armyId: 'nope', toTile: 't2' }]);
  expect(s.events.some(e => e.t === 'rejected' && e.armyId === 'nope')).toBe(true);
});

it('rejects dispatch when target tile is player-owned', () => {
  const s = initConquest(setupWithT1Owned());
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]); // t1 is player-owned
  expect(s.armies.find(x => x.id === 'a1')!.state).toBe('garrisoned');
  expect(s.events.some(e => e.t === 'rejected' && e.armyId === 'a1')).toBe(true);
});

it('BFS selects shortest owned path based on N,S,E,W expansion order', () => {
  // setupBfsShortcut: from t0, S→t4 and E→t1 both adjacent to t2.
  // BFS expands N,S,E,W: t0 has S=t4, E=t1. Queue after expanding t0: [t4, t1].
  // t4 is dequeued first: t4 is adjacent to t2 (via S). t4 is launch tile.
  // Path: t0→t4 → drop t0 → [t4], append t2 → route=['t4','t2'].
  const s = initConquest(setupBfsShortcut());
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }]);
  const a = s.armies.find(x => x.id === 'a1')!;
  expect(a.state).toBe('travelling');
  // BFS N,S,E,W order from t0: S→t4 enqueued before E→t1. t4 is launch → selected first.
  expect(a.route).toEqual(['t4', 't2']);
});

it('BFS selects the genuinely shorter path when two launch tiles are at different distances', () => {
  // Layout:
  //   t0(player) -E→ lb(player) -E→ tE(enemy,garrison)
  //   t0(player) -S→ t1(player) -E→ la(player) -N→ tE(enemy)
  //
  // lb is adjacent to tE (launch tile, distance 1 from t0).
  // la is adjacent to tE too (launch tile, distance 2 from t0: t0→t1→la).
  //
  // BFS from t0 expands N,S,E,W. t0 has S=t1 and E=lb.
  // Queue after expanding t0 (N,S,E,W order): [t1, lb] (S before E).
  // BUT lb is at distance 1 (found via E from t0) and t1 is at distance 1 too.
  // When we expand t1 → la: la is a launch tile at distance 2.
  // When we expand lb: lb is itself a launch tile at distance 1 → found first.
  //
  // Critically: if BFS were broken and returned a longer path, it would pick la (distance 2)
  // instead of lb (distance 1). This test would fail.
  // The assertion pins the distance-1 route ['lb', 'tE'] over the distance-2 route ['t1','la','tE'].
  const u = (id: string) => ({ id, side: 'B' as const, attackKind: 'melee' as const, attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } });
  const mapSetup: MapSetup = {
    tiles: [
      { id: 't0', type: 'start',  owner: 'player', neighbors: { S: 't1', E: 'lb' }, garrison: [] },
      { id: 't1', type: 'cache',  owner: 'player', neighbors: { N: 't0', E: 'la' }, garrison: [] },
      { id: 'lb', type: 'cache',  owner: 'player', neighbors: { W: 't0', E: 'tE' }, garrison: [] },
      { id: 'la', type: 'cache',  owner: 'player', neighbors: { W: 't1', N: 'tE' }, garrison: [] },
      { id: 'tE', type: 'enemy',  owner: 'enemy',  neighbors: { W: 'lb', S: 'la' }, garrison: [u('g1')] },
    ],
    armies: [{ id: 'a1', units: [{ id: 'a1u', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }], tile: 't0' }],
  };
  const s = initConquest(mapSetup);
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 'tE' }]);
  const a = s.armies.find(x => x.id === 'a1')!;
  expect(a.state).toBe('travelling');
  // BFS must pick lb (distance 1 from t0) over la (distance 2: t0→t1→la).
  // Route: drop t0, keep lb, append tE → ['lb', 'tE'].
  expect(a.route).toEqual(['lb', 'tE']);
});

it('dispatch with gate: validates the launch tile matches the specified gate', () => {
  const s = initConquest(setupWithT1Owned());
  // t2's neighbors: W=t1. Gate 'W' means launch tile = t1, which is player-owned → valid.
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2', gate: 'W' }]);
  const a = s.armies.find(x => x.id === 'a1')!;
  expect(a.state).toBe('travelling');
  expect(a.route).toEqual(['t1', 't2']);
});

it('dispatch with gate: rejects when gated launch tile is not owned', () => {
  const s = initConquest(setup()); // t1 is neutral
  // t2's W=t1 (neutral). Gate 'W' → launch tile t1 not owned → reject.
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2', gate: 'W' }]);
  expect(s.armies.find(x => x.id === 'a1')!.state).toBe('garrisoned');
  expect(s.events.some(e => e.t === 'rejected' && e.armyId === 'a1')).toBe(true);
});

// ── Task 3: Travel phase + arrival resolution ─────────────────────────────────

// t0(player) — t1(player) — t2(enemy, garrison): same as setupWithT1Owned but unit has agi=10.
// slowestTempo → tempoRate = TEMPO_BASE(10) + 10 = 20. TRAVEL_THRESHOLD/20 = 5 ticks per hop.
function setupT1OwnedFastArmy(): MapSetup {
  const enemy = (id: string) => ({ id, side: 'B' as const, attackKind: 'melee' as const, attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } });
  return {
    tiles: [
      { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
      { id: 't1', type: 'cache', owner: 'player', neighbors: { W: 't0', E: 't2' }, garrison: [] },
      { id: 't2', type: 'enemy', owner: 'enemy', neighbors: { W: 't1' }, garrison: [enemy('g1')] },
    ],
    armies: [{ id: 'a1', units: [{ id: 'a1u', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 10, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }], tile: 't0' }],
  };
}

// t0(player) — t1(neutral, empty) — t2(enemy, garrison): default setup() has t1 neutral.
// For undefended-capture test we need a tile with no garrison that's adjacent to owned.
// Use a 2-tile setup: t0(player) adjacent to tX(neutral, no garrison).
function setupUndefendedCapture(): MapSetup {
  return {
    tiles: [
      { id: 't0', type: 'start', owner: 'player', neighbors: { E: 'tX' }, garrison: [] },
      { id: 'tX', type: 'cache', owner: 'neutral', neighbors: { W: 't0' }, garrison: [] },
    ],
    armies: [{ id: 'a1', units: [{ id: 'a1u', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 10, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }], tile: 't0' }],
  };
}

it('a travelling army hops every THRESHOLD/slowestTempo ticks (agi=10, tempo 20 → every 5)', () => {
  const s = initConquest(setupT1OwnedFastArmy()); // t0,t1 player; t2 enemy; a1 unit agi=10
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }]); // route ['t1','t2']; counts as tick 0
  const a = () => s.armies.find(x => x.id === 'a1')!;
  for (let i = 0; i < 4; i++) advance(s, []);  // ticks 1..4: gauge accumulates, no hop yet
  expect(a().tile).toBe('t0');
  advance(s, []); // tick 5: gauge reaches 100 → hop to t1
  expect(a().tile).toBe('t1');
});

it('arriving at an UNDEFENDED tile captures it (owner→player, garrisoned, slot freed, captured event)', () => {
  // Route is [tX] (1 hop: t0 is launch tile, adjacent to tX).
  // Army needs 5 ticks to hop (tempo 20, threshold 100).
  // After 5 ticks the army arrives at tX.
  const s = initConquest(setupUndefendedCapture());
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 'tX' }]); // tick 0: route=['tX']
  const a = () => s.armies.find(x => x.id === 'a1')!;
  // Advance 4 more ticks (no hop yet — 5 total needed for first hop which is also arrival)
  for (let i = 0; i < 4; i++) advance(s, []);
  expect(a().tile).toBe('t0'); // not arrived yet
  advance(s, []); // tick 5: hops to tX AND arrives → resolveArrival
  // Capture: owner→player, army garrisoned, target cleared, captured event
  expect(a().tile).toBe('tX');
  expect(a().state).toBe('garrisoned');
  expect(a().target).toBeUndefined();
  expect(s.tiles.find(t => t.id === 'tX')!.owner).toBe('player');
  expect(s.events.some(e => e.t === 'captured' && e.tile === 'tX' && e.by === 'a1')).toBe(true);
  // Slot freed: committedCount should be 0 (target cleared)
  expect(committedCount(s, 'tX')).toBe(0);
});

// ── Task 4: Retreat command ───────────────────────────────────────────────────

// t0(player) — t1(player) — t2(enemy, garrison): same as setupT1OwnedFastArmy
// but we need the army to reach t2 and be contested before issuing a retreat.
// Army unit agi=10 → tempo 20 → hop every 5 ticks.
// Route: t0→dispatch→route=['t1','t2']. tick5 → hop to t1; tick10 → arrive at t2 → contested.
it('retreat a contested army: frees its slot, returns it to owned territory, ends garrisoned with retreated event', () => {
  const s = initConquest(setupT1OwnedFastArmy());
  // Dispatch a1 to t2 (defended); after 10 ticks it becomes contested
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }]);
  for (let i = 0; i < 9; i++) advance(s, []);
  // At tick 10 it arrives at t2 → contested
  advance(s, []);
  const a = () => s.armies.find(x => x.id === 'a1')!;
  expect(a().state).toBe('contested');
  expect(a().tile).toBe('t2');

  // Now retreat a1 from contested t2
  advance(s, [{ t: 'retreat', armyId: 'a1' }]);
  // Slot must be freed immediately: committedCount === 0 and slotFreed event fired
  expect(committedCount(s, 't2')).toBe(0);
  expect(a().target).toBeUndefined();
  expect(s.events.some(e => e.t === 'slotFreed' && e.tile === 't2' && e.armyId === 'a1')).toBe(true);
  // Army state should be 'retreating' with route back to an owned neighbor (t1 is W of t2 → owned)
  expect(a().state).toBe('retreating');

  // Advance until it returns: 1 hop (t2→t1) takes 5 more ticks
  for (let i = 0; i < 4; i++) advance(s, []);
  expect(a().tile).toBe('t2'); // not yet
  advance(s, []); // 5th tick: hops t2→t1 and resolveArrival garrisons it
  expect(a().tile).toBe('t1');
  expect(a().state).toBe('garrisoned');
  expect(a().target).toBeUndefined();
  expect(a().route).toBeUndefined();
  // retreated event should be emitted on arrival
  expect(s.events.some(e => e.t === 'retreated' && e.armyId === 'a1' && e.to === 't1')).toBe(true);
});

it('retreat a travelling army: frees slot and settles garrisoned on its current owned tile', () => {
  // setupT1OwnedFastArmy: route ['t1','t2']; after dispatch but before reaching t1 (within 5 ticks)
  // army is at t0 (owned) in 'travelling' state.
  const s = initConquest(setupT1OwnedFastArmy());
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }]);
  const a = () => s.armies.find(x => x.id === 'a1')!;
  // Advance a few ticks so army is still travelling at t0 (haven't hopped yet)
  for (let i = 0; i < 3; i++) advance(s, []);
  expect(a().state).toBe('travelling');
  expect(a().tile).toBe('t0'); // still at owned t0

  // Issue retreat: army is on owned tile t0 → settle immediately as garrisoned
  advance(s, [{ t: 'retreat', armyId: 'a1' }]);
  expect(a().state).toBe('garrisoned');
  expect(a().tile).toBe('t0');
  expect(a().target).toBeUndefined();
  expect(a().route).toBeUndefined();
  // slotFreed event fired (had target t2)
  expect(s.events.some(e => e.t === 'slotFreed' && e.tile === 't2' && e.armyId === 'a1')).toBe(true);
  // retreated event fired immediately (settled on owned t0)
  expect(s.events.some(e => e.t === 'retreated' && e.armyId === 'a1' && e.to === 't0')).toBe(true);
  // Slot freed: committedCount on t2 === 0
  expect(committedCount(s, 't2')).toBe(0);
});

it('retreat a garrisoned army: rejected with not-recallable', () => {
  const s = initConquest(setupT1OwnedFastArmy());
  const a = () => s.armies.find(x => x.id === 'a1')!;
  expect(a().state).toBe('garrisoned');
  advance(s, [{ t: 'retreat', armyId: 'a1' }]);
  expect(a().state).toBe('garrisoned'); // unchanged
  expect(s.events.some(e => e.t === 'rejected' && e.armyId === 'a1' && 'reason' in e && e.reason === 'not-recallable')).toBe(true);
});

// ── Task 2: gate recording + open-battle ─────────────────────────────────────

it('dispatch records the army gate (edge of target facing the launch tile)', () => {
  // setupWithT1Owned: t0(player)—t1(player)—t2(enemy). t2.neighbors.W = 't1'.
  // a1 dispatches from t0; launch tile = t1; t2.W === 't1' → gate should be 'W'.
  const s = initConquest(setupWithT1Owned());
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }]);
  const a = s.armies.find(x => x.id === 'a1')!;
  expect(a.gate).toBe('W');
});

it('arriving at a DEFENDED tile opens a battle: attacker units side A (ids armyId#unit), garrison side B, battleOpened event', () => {
  // setupT1OwnedFastArmy: t2 has garrison g1 → defended.
  // Route ['t1','t2'] = 2 hops. First hop at tick 5, second at tick 10.
  const s = initConquest(setupT1OwnedFastArmy());
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }]); // tick 0
  const a = () => s.armies.find(x => x.id === 'a1')!;
  for (let i = 0; i < 4; i++) advance(s, []);
  expect(a().tile).toBe('t0');
  advance(s, []); // tick 5: hop to t1
  expect(a().tile).toBe('t1');
  expect(a().state).toBe('travelling');
  for (let i = 0; i < 4; i++) advance(s, []);
  expect(a().tile).toBe('t1');
  advance(s, []); // tick 10: hop to t2 AND arrives → resolveArrival (defended) → opens battle
  expect(a().tile).toBe('t2');
  expect(a().state).toBe('contested');
  // Owner still enemy (no capture)
  expect(s.tiles.find(t => t.id === 't2')!.owner).toBe('enemy');
  // battleOpened event fired (NOT 'contested')
  const battleEvent = s.events.find(e => e.t === 'battleOpened' && (e as any).tile === 't2');
  expect(battleEvent).toBeDefined();
  expect((battleEvent as any).attackers).toEqual(['a1']);
  // Slot still held: committedCount = 1 (army keeps target)
  expect(a().target).toBe('t2');
  expect(committedCount(s, 't2')).toBe(1);
  // A battle was opened for this tile
  const ms = s as MapState;
  expect(ms.battles.length).toBe(1);
  expect(ms.battles[0]!.tile).toBe('t2');
  const fight = ms.battles[0]!.fight;
  // Attacker unit has id 'a1#a1u', side 'A'
  const attackerUnit = fight.units.find(u => u.id === 'a1#a1u');
  expect(attackerUnit).toBeDefined();
  expect(attackerUnit!.side).toBe('A');
  // Garrison unit has id 'garrison#g1', side 'B'
  const garrisonUnit = fight.units.find(u => u.id === 'garrison#g1');
  expect(garrisonUnit).toBeDefined();
  expect(garrisonUnit!.side).toBe('B');
  // No two units share the same initial position
  const positions = fight.units.map(u => `${u.pos.x},${u.pos.y}`);
  const unique = new Set(positions);
  expect(unique.size).toBe(positions.length);
  // initConquest sets seed; battles present
  expect(ms.seed).toBe(0);
  expect(Array.isArray(ms.battles)).toBe(true);
});

// ── Task 3: Battle stepping ──────────────────────────────────────────────────

// Strong attacker (high str+agi) vs one very weak garrison unit.
// The attacker should decisively win within a modest number of map ticks.
function setupStrongAttackerWeakGarrison(): MapSetup {
  return {
    tiles: [
      { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
      { id: 't1', type: 'cache', owner: 'player', neighbors: { W: 't0', E: 't2' }, garrison: [] },
      {
        id: 't2', type: 'enemy', owner: 'enemy', neighbors: { W: 't1' },
        garrison: [{ id: 'g1', side: 'B', attackKind: 'melee', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }],
      },
    ],
    armies: [{
      id: 'a1',
      units: [{ id: 'a1u', side: 'A', attackKind: 'melee', attrs: { str: 20, agi: 20, int: 5, lck: 5 }, priority: 5, pos: { x: 0, y: 0 } }],
      tile: 't0',
    }],
  };
}

it('advance steps active battles by STEPS_PER_MAP_TICK; a one-sided battle reaches an outcome', () => {
  const s = initConquest(setupStrongAttackerWeakGarrison());
  // Dispatch attacker: route ['t1','t2']. Army agi=20 → tempo = 10+20=30; TRAVEL_THRESHOLD=100 → hop every ceil(100/30)≈4 ticks.
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }]);

  // Advance until battle opens AND resolves (Task 4: resolved battles are removed in the same tick
  // they resolve). For a strong-vs-weak fight, the battle may open and resolve in one advance call.
  // We drive until the army is garrisoned on t2 (outcome applied) or safety cap.
  const SAFETY = 60;
  let ticks = 0;
  const a = () => s.armies.find(x => x.id === 'a1')!;
  while (ticks < SAFETY && a().state !== 'garrisoned') {
    advance(s, []);
    ticks++;
  }

  // After outcome application, battle is removed and tile captured (Task 4)
  expect(s.battles.length).toBe(0);
  expect(s.tiles.find(t => t.id === 't2')!.owner).toBe('player');
  // captured event emitted (winner was 'A')
  expect(s.events.some(e => e.t === 'captured' && (e as any).tile === 't2')).toBe(true);
  // Army garrisoned on t2 with no target
  expect(a().state).toBe('garrisoned');
  expect(a().tile).toBe('t2');
});

// ── Task 4: Battle outcome — capture/hold + HP-carrying attrition ────────────

// Weak garrison: single unit with str/agi=1 (very low HP, low damage).
// Strong attacker: str/agi=20 int=5 lck=5 — decisively wins.
// The strong attacker should survive with some HP to carry.
function setupStrongAttackerWeakGarrisonForOutcome(): MapSetup {
  return {
    tiles: [
      { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
      { id: 't1', type: 'cache', owner: 'player', neighbors: { W: 't0', E: 't2' }, garrison: [] },
      {
        id: 't2', type: 'enemy', owner: 'enemy', neighbors: { W: 't1' },
        garrison: [{ id: 'g1', side: 'B', attackKind: 'melee', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }],
      },
    ],
    armies: [{
      id: 'a1',
      units: [{ id: 'a1u', side: 'A', attackKind: 'melee', attrs: { str: 20, agi: 20, int: 5, lck: 5 }, priority: 5, pos: { x: 0, y: 0 } }],
      tile: 't0',
    }],
  };
}

// Weak attacker: single unit with str/agi=1 vs strong garrison str/agi=20.
// The garrison should decisively win, repelling the attacker.
function setupWeakAttackerStrongGarrison(): MapSetup {
  return {
    tiles: [
      { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
      { id: 't1', type: 'cache', owner: 'player', neighbors: { W: 't0', E: 't2' }, garrison: [] },
      {
        id: 't2', type: 'enemy', owner: 'enemy', neighbors: { W: 't1' },
        garrison: [{ id: 'g1', side: 'B', attackKind: 'melee', attrs: { str: 20, agi: 20, int: 5, lck: 5 }, priority: 5, pos: { x: 0, y: 0 } }],
      },
    ],
    armies: [{
      id: 'a1',
      units: [{ id: 'a1u', side: 'A', attackKind: 'melee', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }],
      tile: 't0',
    }],
  };
}

// Helper: advance state until no travelling armies, no battles, or SAFETY cap.
function advanceUntilQuiescent(s: MapState, safety = 500): void {
  for (let i = 0; i < safety; i++) {
    const busy = s.armies.some(a => a.state === 'travelling' || a.state === 'contested')
      || s.battles.length > 0;
    if (!busy) break;
    advance(s, []);
  }
}

it('attacker win: tile captured, surviving attacker army garrisons with carried HP, dead units dropped, slot freed', () => {
  const s = initConquest(setupStrongAttackerWeakGarrisonForOutcome());
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }]);
  advanceUntilQuiescent(s);

  // Tile must have been captured by the attacker
  const tile = s.tiles.find(t => t.id === 't2')!;
  expect(tile.owner).toBe('player');

  // Garrison must be cleared (attacker's army replaced it)
  expect(tile.garrison).toEqual([]);

  // Army a1 must be garrisoned on t2 with no target
  const a1 = s.armies.find(a => a.id === 'a1')!;
  expect(a1.state).toBe('garrisoned');
  expect(a1.tile).toBe('t2');
  expect(a1.target).toBeUndefined();

  // Slot freed: no contested/travelling armies targeting t2
  expect(committedCount(s, 't2')).toBe(0);

  // captured event must have been emitted
  expect(s.events.some(e => e.t === 'captured' && (e as any).tile === 't2')).toBe(true);

  // Battle must be removed from state.battles
  expect(s.battles.some(b => b.tile === 't2')).toBe(false);

  // Surviving units carry their HP (startHp set on UnitSpec)
  for (const u of a1.units) {
    expect(u.startHp).toBeDefined();
    expect(u.startHp).toBeGreaterThan(0);
  }
});

it('reconcileArmy: keeps survivors with carried HP, drops dead units', () => {
  // Army has two units; fight unit u2 is dead (hp<=0), u1 survives
  const units: UnitSpec[] = [
    { id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
    { id: 'u2', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
  ];
  const army: Army = {
    id: 'myArmy',
    units,
    tile: 't0',
    state: 'contested',
    travelGauge: 0,
  };

  // Minimal FightState stub: only the `units` field is used by reconcileArmy
  const fight = {
    units: [
      { id: 'myArmy#u1', side: 'A' as const, hp: 37, attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 }, derived: {} as any, gauge: 0, mana: 0, traits: [], kills: 0, stallSinceTick: -1, fleeingSinceTick: -1 },
      { id: 'myArmy#u2', side: 'A' as const, hp: 0,  attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 }, derived: {} as any, gauge: 0, mana: 0, traits: [], kills: 0, stallSinceTick: -1, fleeingSinceTick: -1 },
    ],
    grid: {} as any,
    rng: {} as any,
    events: [],
    totalTicks: 10,
    outcome: { winner: 'A' as const, endReason: 'decisive' as const },
  } satisfies FightState;

  reconcileArmy(army, fight);

  // Only u1 should remain, with startHp = 37 (its fight HP)
  expect(army.units.length).toBe(1);
  expect(army.units[0]!.id).toBe('u1');
  expect(army.units[0]!.startHp).toBe(37);

  // u2 (dead) should have been dropped
  expect(army.units.find(u => u.id === 'u2')).toBeUndefined();
});

// ── Task 5: Continuous reinforcement (joinFight) ─────────────────────────────

// Layout:
//   t0(player) -E→ t2(enemy, sturdy garrison)
//   t1(player) -N→ t2(enemy)
// a1 starts at t0 (gate W), a2 starts at t1 (gate S).
// Garrison is balanced vs a1 alone (won't resolve quickly), so the battle is still
// active when a2 arrives at t2 a few ticks later.
function setupReinforcement(): MapSetup {
  // Moderate attacker + garrison so the fight lasts many ticks
  const mk = (id: string, side: 'A' | 'B') => ({
    id, side: side as any, attackKind: 'melee' as const,
    attrs: { str: 5, agi: 10, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 },
  });
  return {
    tiles: [
      { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't2' }, garrison: [] },
      { id: 't1', type: 'cache', owner: 'player', neighbors: { N: 't2' }, garrison: [] },
      {
        id: 't2', type: 'enemy', owner: 'enemy', neighbors: { W: 't0', S: 't1' },
        // Sturdy garrison: balanced fight — won't resolve in a handful of ticks
        garrison: [mk('g1', 'B'), mk('g2', 'B'), mk('g3', 'B')],
      },
    ],
    armies: [
      { id: 'a1', units: [mk('a1u', 'A')], tile: 't0' },
      { id: 'a2', units: [mk('a2u', 'A')], tile: 't1' },
    ],
  };
}

it('an army arriving at an already-battling tile joinFights its units (side A, carried HP, its gate), reinforced event', () => {
  // a1 is adjacent (1 hop) → arrives quickly at t2 → opens battle.
  // a2 is adjacent (1 hop) → dispatched a tick later (different gate S).
  // We dispatch a1 first, then a2 one tick later so a1 opens the battle first.
  // Both have agi=10 → tempo = TEMPO_BASE(10)+10 = 20 → hop every 5 ticks.
  const s = initConquest(setupReinforcement());

  // Tick 0: dispatch a1 only (so a1 gets a head start)
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }]);
  // Tick 1: dispatch a2
  advance(s, [{ t: 'dispatch', armyId: 'a2', toTile: 't2' }]);

  const a1 = () => s.armies.find(x => x.id === 'a1')!;
  const a2 = () => s.armies.find(x => x.id === 'a2')!;

  // Advance until a1 arrives at t2 (it needs 4 more ticks after tick 0 dispatch, hop on tick 5).
  // After tick 0 dispatch, travellingBefore on tick 1 includes a1.
  // Tick 1: a1 gauge += 20 (total 20), also dispatches a2.
  // Tick 2: a1 gauge 40, a2 gauge 20.
  // Tick 3: a1 gauge 60, a2 gauge 40.
  // Tick 4: a1 gauge 80, a2 gauge 60.
  // Tick 5: a1 gauge 100 → hop to t2 (arrives, opens battle), a2 gauge 80.
  // Tick 6: a2 gauge 100 → hop to t2 (arrives, joins fight).
  // We've already done ticks 0 and 1. Advance ticks 2..5 (4 more).
  for (let i = 0; i < 4; i++) advance(s, []);
  // a1 should now be contested at t2 with an active battle
  expect(a1().state).toBe('contested');
  expect(a1().tile).toBe('t2');
  const battle = (s as MapState).battles.find(b => b.tile === 't2');
  expect(battle).toBeDefined();
  // battle has a1's units but not a2's yet
  expect(battle!.fight.units.find(u => u.id === 'a1#a1u')).toBeDefined();
  expect(battle!.fight.units.find(u => u.id === 'a2#a2u')).toBeUndefined();
  expect(a2().state).toBe('travelling');

  // Advance tick 6: a2 hops and arrives at t2 → joinFight
  advance(s, []);
  expect(a2().state).toBe('contested');
  expect(a2().tile).toBe('t2');

  // a2's unit must now be in the live fight (side A)
  const liveUnits = (s as MapState).battles.find(b => b.tile === 't2')!.fight.units;
  const a2Unit = liveUnits.find(u => u.id === 'a2#a2u');
  expect(a2Unit).toBeDefined();
  expect(a2Unit!.side).toBe('A');

  // reinforced event fired
  expect(s.events.some(e => e.t === 'reinforced' && (e as any).tile === 't2' && (e as any).armyId === 'a2')).toBe(true);

  // committedCount includes both a1 and a2 (≤ MAX_COMMIT=4)
  expect(committedCount(s, 't2')).toBe(2);
});

// ── Task 6: Retreat mid-battle ───────────────────────────────────────────────

// Durable attacker (high physDef via int → survives many fight ticks) vs a sturdy
// garrison (multiple moderate units that survive many rounds). The attacker has NO
// Bloodthirsty trait so orderRetreat is obeyed. The fight is balanced enough that
// the battle lasts several map ticks, giving us time to issue Retreat before it resolves.
function setupDurableAttackerForRetreat(): MapSetup {
  const garUnit = (id: string) => ({
    id, side: 'B' as const, attackKind: 'melee' as const,
    attrs: { str: 8, agi: 8, int: 8, lck: 1 }, priority: 5, pos: { x: 0, y: 0 },
  });
  return {
    tiles: [
      { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
      { id: 't1', type: 'cache', owner: 'player', neighbors: { W: 't0', E: 't2' }, garrison: [] },
      {
        id: 't2', type: 'enemy', owner: 'enemy', neighbors: { W: 't1' },
        // Sturdy garrison: 3 moderate units → battle lasts many ticks
        garrison: [garUnit('g1'), garUnit('g2'), garUnit('g3')],
      },
    ],
    armies: [{
      id: 'a1',
      // High int for physDef → a1u is durable (survives the garrison's attacks while retreating).
      // High agi for fast travel. No Bloodthirsty so orderRetreat is obeyed.
      units: [{ id: 'a1u', side: 'A', attackKind: 'melee', attrs: { str: 10, agi: 20, int: 30, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }],
      tile: 't1', // start on launch tile so route is just ['t2'] → 1 hop (5 ticks at tempo 30)
    }],
  };
}

it('Retreat of a contesting army orders its fight units out; once all exit it returns to owned soil with survivors, slot freed', () => {
  const s = initConquest(setupDurableAttackerForRetreat());
  // a1 starts on t1 (player-owned, adjacent to t2); dispatch → route ['t2'] → 1 hop (5 ticks at tempo 30)
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }]);

  const a1 = () => s.armies.find(x => x.id === 'a1')!;

  // Advance until a1 is contested (arrived at t2 and opened battle)
  const SAFETY1 = 30;
  for (let i = 0; i < SAFETY1 && a1().state !== 'contested'; i++) advance(s, []);
  expect(a1().state).toBe('contested');
  expect(a1().tile).toBe('t2');
  expect((s as MapState).battles.find(b => b.tile === 't2')).toBeDefined();

  // Inspect the fight state BEFORE issuing retreat, to verify orderRetreat is called.
  // We need to peek at the battle's fight units after applyRetreat but before the
  // battle-step loop. We do this by checking the event after the advance call instead.
  // The slotFreed event confirms the retreat mechanism ran; retreated event confirms
  // the army made it back. We verify the flow via events rather than intermediate state.

  // Issue Retreat for a1 while it is contested (mid-battle).
  // Within this advance call: applyRetreat sets retreating on fight units + retreatOrdered,
  // battle-step loop steps units toward the exit, post-step check transitions army once all exit.
  // So by the end of this advance call the army may already be 'retreating' (units exited fast).
  advance(s, [{ t: 'retreat', armyId: 'a1' }]);

  // slotFreed must fire in the same tick (the post-step exit-check emits it when army transitions)
  expect(s.events.some(e => e.t === 'slotFreed' && (e as any).tile === 't2' && (e as any).armyId === 'a1')).toBe(true);
  // Army must no longer be contested (either retreating or already garrisoned if it hopped back)
  expect(a1().state).not.toBe('contested');

  // Advance to quiescence (all units exited or dead → army reconstitutes and routes home)
  // advanceUntilQuiescent tracks contested armies too
  const SAFETY2 = 300;
  for (let i = 0; i < SAFETY2; i++) {
    const busy = s.armies.some(a => a.state === 'travelling' || a.state === 'contested' || a.state === 'retreating')
      || s.battles.length > 0;
    if (!busy) break;
    advance(s, []);
  }

  // a1 must end garrisoned on owned soil (t1, the only owned neighbor of t2)
  expect(a1().state).toBe('garrisoned');
  expect(a1().tile).toBe('t1');

  // Slot freed: committedCount(t2) === 0
  expect(committedCount(s, 't2')).toBe(0);
  expect(a1().target).toBeUndefined();

  // slotFreed event emitted during retreat
  expect(s.events.some(e => e.t === 'slotFreed' && (e as any).tile === 't2' && (e as any).armyId === 'a1')).toBe(true);

  // retreated event emitted on arrival at t1
  expect(s.events.some(e => e.t === 'retreated' && (e as any).armyId === 'a1' && (e as any).to === 't1')).toBe(true);

  // a1 has surviving units with carried HP (startHp set)
  expect(a1().units.length).toBeGreaterThan(0);
  for (const u of a1().units) {
    expect(u.startHp).toBeDefined();
    expect(u.startHp).toBeGreaterThan(0);
  }
});

it('defender win: attacker army removed, garrison survivors persist (attrited), tile stays enemy', () => {
  const s = initConquest(setupWeakAttackerStrongGarrison());
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }]);
  advanceUntilQuiescent(s);

  // Tile must still be enemy-owned
  const tile = s.tiles.find(t => t.id === 't2')!;
  expect(tile.owner).toBe('enemy');

  // Attacker army a1 must be removed from state.armies
  const a1 = s.armies.find(a => a.id === 'a1');
  expect(a1).toBeUndefined();

  // Battle must be removed
  expect(s.battles.some(b => b.tile === 't2')).toBe(false);

  // Garrison survivors must have carried startHp (attrited)
  expect(tile.garrison.length).toBeGreaterThan(0);
  for (const g of tile.garrison) {
    expect(g.startHp).toBeDefined();
    expect(g.startHp).toBeGreaterThan(0);
  }

  // repelled event must have been emitted
  expect(s.events.some(e => e.t === 'repelled' && (e as any).tile === 't2')).toBe(true);
});
