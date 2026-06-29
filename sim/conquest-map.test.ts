import { describe, it, expect } from 'vitest';
import { initConquest, hashMap, advance } from './conquest-map';
import type { MapSetup } from '../shared/types';

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
