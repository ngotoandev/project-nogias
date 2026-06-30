import type { MapSetup, MapCommand, MapEdge, MapTile, Army, UnitSpec, FightSetup, GridSpec, MapEvent } from '../shared/types';
import type { FightState } from './tile-fight';
import { initFight, stepFight } from './tile-fight';
import { fnv1a } from './hash';
import { deriveStats } from './stats';
import { MAX_COMMIT, TRAVEL_THRESHOLD, DEFAULT_FIGHT_GRID, STEPS_PER_MAP_TICK } from '../shared/config';

const cloneSpec = (u: UnitSpec): UnitSpec => ({
  ...u,
  attrs: { ...u.attrs },
  pos: { ...u.pos },
  traits: u.traits ? u.traits.slice() : undefined,
  personality: u.personality ? { ...u.personality } : undefined,
});

// ── MapState (relocated from shared/types.ts; now holds FightStates) ─────────

export interface MapBattle { tile: string; fight: FightState; }

export interface MapState {
  tiles: MapTile[];
  armies: Army[];
  totalTicks: number;
  events: MapEvent[];
  seed: number;
  battles: MapBattle[];
}

export function initConquest(setup: MapSetup, seed = 0): MapState {
  const tiles = setup.tiles.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((t) => ({ ...t, neighbors: { ...t.neighbors }, garrison: t.garrison.map(cloneSpec) }));
  const armies: Army[] = setup.armies.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((a) => ({ id: a.id, units: a.units.map(cloneSpec), tile: a.tile, state: 'garrisoned', travelGauge: 0 }));
  return { tiles, armies, totalTicks: 0, events: [], seed, battles: [] };
}

// ── Conquest helpers ─────────────────────────────────────────────────────────

const EDGES: MapEdge[] = ['N', 'S', 'E', 'W'];

export function slowestTempo(army: Army): number {
  let m = Infinity;
  for (const u of army.units) {
    const t = deriveStats(u.attrs, u.attackKind).tempoRate;
    if (t < m) m = t;
  }
  return m;
}

function tileById(state: MapState, id: string): MapTile | undefined {
  return state.tiles.find((t) => t.id === id);
}

export function committedCount(state: MapState, tileId: string): number {
  return state.armies.filter(
    (a) => a.target === tileId && (a.state === 'travelling' || a.state === 'contested'),
  ).length;
}

// Deterministic BFS over OWNED tiles from fromId to a launch tile (owned, adjacent to toTile).
// Expands neighbors in N, S, E, W order; visited set keyed by tile id.
// Returns [...ownedPath excluding fromId, toTile.id], or null if no path found.
function bfsRoute(state: MapState, fromId: string, toTile: MapTile, gate?: MapEdge): string[] | null {
  const isLaunch = (id: string): boolean => {
    const t = tileById(state, id);
    if (!t || t.owner !== 'player') return false;
    if (gate) return toTile.neighbors[gate] === id;
    return EDGES.some((e) => toTile.neighbors[e] === id);
  };

  // If the starting tile is itself a launch tile, route is just [toTile.id]
  if (isLaunch(fromId)) return [toTile.id];

  const visited = new Set<string>([fromId]);
  const parent = new Map<string, string>();
  const queue: string[] = [fromId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const tile = tileById(state, current);
    if (!tile) continue;

    for (const edge of EDGES) {
      const neighborId = tile.neighbors[edge];
      if (!neighborId || visited.has(neighborId)) continue;
      const neighborTile = tileById(state, neighborId);
      if (!neighborTile || neighborTile.owner !== 'player') continue;

      visited.add(neighborId);
      parent.set(neighborId, current);
      queue.push(neighborId);

      if (isLaunch(neighborId)) {
        // Reconstruct path from fromId to neighborId
        const path: string[] = [];
        let node: string = neighborId;
        while (node !== fromId) {
          path.unshift(node);
          node = parent.get(node)!;
        }
        // path is the owned-tile chain EXCLUDING fromId; append toTile.id
        path.push(toTile.id);
        return path;
      }
    }
  }

  return null;
}

function ownedNeighborIds(state: MapState, tile: MapTile): string[] {
  const result: string[] = [];
  for (const edge of EDGES) {
    const neighborId = tile.neighbors[edge];
    if (!neighborId) continue;
    const neighbor = tileById(state, neighborId);
    if (neighbor && neighbor.owner === 'player') result.push(neighborId);
  }
  return result;
}

// ── Outcome helpers ───────────────────────────────────────────────────────────

// Reconcile an army's units against fight survivors:
// For each unit in army.units, find its fight unit (id `${army.id}#${u.id}`).
// If alive (hp > 0), keep { ...original spec, startHp: fight hp }. Otherwise DROP it.
// Mutates army.units in-place.
export function reconcileArmy(army: Army, fight: FightState): void {
  const survivors: UnitSpec[] = [];
  for (const u of army.units) {
    const fu = fight.units.find((f) => f.id === `${army.id}#${u.id}`);
    if (fu && fu.hp > 0) survivors.push({ ...u, startHp: fu.hp });
    // else: fu absent or dead — drop the unit
  }
  army.units = survivors;
}

// ── Battle helpers ────────────────────────────────────────────────────────────

// Given a target tile and the id of the launch tile (owned tile adjacent to it),
// return the edge of the target tile that faces the launch tile.
function gateOf(tile: MapTile, launchId: string): MapEdge {
  for (const e of EDGES) if (tile.neighbors[e] === launchId) return e;
  throw new Error(`gateOf: ${launchId} is not a neighbor of ${tile.id}`);
}

// Deterministic integer seed derived from map seed + tile id (integer math only, goja-safe).
function fightSeed(seed: number, tileId: string): number {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  for (let i = 0; i < tileId.length; i++) h = Math.imul(h ^ tileId.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

// Returns the deploy cell for the k-th unit (0-based) on a gate edge of the grid.
// k+1 skips the corner so different gates never collide at (0,0) etc.
// Valid positions are i in [1, limit-1]; throws if the gate is over-capacity.
function deployCell(edge: MapEdge, grid: GridSpec, k: number): { x: number; y: number } {
  const i = k + 1;
  const limit = (edge === 'N' || edge === 'S') ? grid.width : grid.height;
  if (i >= limit) throw new Error(`deployCell: gate ${edge} overflow (index ${i} >= ${limit}); too many units on one gate`);
  if (edge === 'W') return { x: 0, y: i };
  if (edge === 'E') return { x: grid.width - 1, y: i };
  if (edge === 'N') return { x: i, y: 0 };
  /* S */ return { x: i, y: grid.height - 1 };
}

// Returns the garrison cell for the k-th garrison unit (0-based), interior center column.
// Throws if the column is over-capacity (y would exceed grid height).
function garrisonCell(grid: GridSpec, k: number): { x: number; y: number } {
  const y = k + 1;
  if (y >= grid.height) throw new Error(`garrisonCell: overflow (index ${y} >= ${grid.height}); too many garrison units`);
  return { x: (grid.width / 2) | 0, y };
}

// Build the FightSetup for a battle at a defended tile.
// attackerArmies: all contesting armies targeting this tile (sorted by id).
// bundleSeed: the map's seed (for fightSeed derivation).
function buildFightSetup(
  tile: MapTile,
  attackerArmies: Army[],
  bundleSeed: number,
): { setup: FightSetup; seed: number } {
  const grid = DEFAULT_FIGHT_GRID;
  const units: UnitSpec[] = [];

  // Per-gate running index (tracks how many units have been placed on each gate edge)
  const gateIndex: Record<string, number> = {};

  // Attacker units: armies sorted by id, units in array order
  for (const army of attackerArmies.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const gate = army.gate!;
    if (gateIndex[gate] === undefined) gateIndex[gate] = 0;
    for (const u of army.units) {
      const k: number = gateIndex[gate] as number;
      gateIndex[gate] = k + 1;
      units.push({
        id: `${army.id}#${u.id}`,
        side: 'A',
        attackKind: u.attackKind,
        attrs: { ...u.attrs },
        skill: u.skill,
        traits: u.traits ? u.traits.slice() : undefined,
        personality: u.personality ? { ...u.personality } : undefined,
        priority: u.priority,
        startHp: u.startHp,
        pos: deployCell(gate, grid, k),
      });
    }
  }

  // Garrison units: interior center column, distinct rows
  for (let k = 0; k < tile.garrison.length; k++) {
    const g = tile.garrison[k]!;
    units.push({
      id: `garrison#${g.id}`,
      side: 'B',
      attackKind: g.attackKind,
      attrs: { ...g.attrs },
      skill: g.skill,
      traits: g.traits ? g.traits.slice() : undefined,
      personality: g.personality ? { ...g.personality } : undefined,
      priority: g.priority,
      startHp: g.startHp,
      pos: garrisonCell(grid, k),
    });
  }

  const seed = fightSeed(bundleSeed, tile.id);
  return { setup: { grid, units }, seed };
}

function applyRetreat(state: MapState, armyId: string): void {
  const army = state.armies.find((a) => a.id === armyId);
  if (!army || (army.state !== 'travelling' && army.state !== 'contested')) {
    state.events.push({ t: 'rejected', armyId, reason: 'not-recallable' });
    return;
  }
  const wasTarget = army.target;
  army.target = undefined; // free the slot immediately
  if (wasTarget) state.events.push({ t: 'slotFreed', tile: wasTarget, armyId });
  const cur = tileById(state, army.tile)!;
  if (cur.owner === 'player') {
    // Already on owned soil → settle immediately
    army.state = 'garrisoned';
    army.route = undefined;
    army.travelGauge = 0;
    state.events.push({ t: 'retreated', armyId, to: cur.id });
  } else {
    // On an enemy tile (contested) → hop back to first owned neighbor (N,S,E,W order)
    const back = ownedNeighborIds(state, cur)[0];
    if (!back) throw new Error(`applyRetreat: contested army ${armyId} at ${cur.id} has no owned neighbor`);
    army.state = 'retreating';
    army.route = [back];
    army.travelGauge = 0;
  }
}

function resolveArrival(state: MapState, army: Army): void {
  if (army.state === 'retreating') {
    army.state = 'garrisoned';
    army.target = undefined;
    army.route = undefined;
    state.events.push({ t: 'retreated', armyId: army.id, to: army.tile });
    return;
  }
  const tile = tileById(state, army.tile)!;
  if (tile.owner === 'player' || tile.garrison.length === 0) {
    // undefended (or already ours): capture / settle — fight-free
    if (tile.owner !== 'player') {
      tile.owner = 'player';
      state.events.push({ t: 'captured', tile: tile.id, by: army.id });
    }
    army.state = 'garrisoned';
    army.target = undefined;
  } else {
    // defended: set army contested first so it's included in the attacker list
    army.state = 'contested';

    // Check if a battle is already active for this tile
    const existing = state.battles.find(b => b.tile === tile.id);
    if (existing) {
      // Task 5: joinFight — for now just mark contested, don't open a second battle
    } else {
      // Gather all contested attacker armies targeting this tile (includes just-arrived one)
      const attackerArmies = state.armies.filter(
        (a) => a.target === tile.id && a.state === 'contested',
      );

      const { setup, seed } = buildFightSetup(tile, attackerArmies, state.seed);
      const fight = initFight(setup, seed);

      // Insert battle sorted by tile id
      state.battles.push({ tile: tile.id, fight });
      state.battles.sort((a, b) => (a.tile < b.tile ? -1 : a.tile > b.tile ? 1 : 0));

      const attackers = attackerArmies.map(a => a.id).sort();
      state.events.push({ t: 'battleOpened', tile: tile.id, attackers });
    }
  }
}

function idOf(c: MapCommand): string {
  return c.armyId;
}

function applyDispatch(
  state: MapState,
  c: { armyId: string; toTile: string; gate?: MapEdge },
): void {
  const reject = (reason: string): void => {
    state.events.push({ t: 'rejected', armyId: c.armyId, reason });
  };

  const army = state.armies.find((a) => a.id === c.armyId);
  if (!army) return reject('no-army');
  if (army.state !== 'garrisoned') return reject('busy');

  const toTile = tileById(state, c.toTile);
  if (!toTile || toTile.owner === 'player') return reject('bad-target');

  if (committedCount(state, c.toTile) >= MAX_COMMIT) return reject('cap-full');

  const route = bfsRoute(state, army.tile, toTile, c.gate);
  if (!route) return reject('no-owned-path');

  army.state = 'travelling';
  army.target = c.toTile;
  army.route = route;
  army.travelGauge = 0;

  // Record the gate: the edge of the target tile facing the launch tile.
  // launch tile is the last owned tile in the route (second-to-last element, or army.tile if route=[toTile]).
  const launchId = route.length >= 2 ? route[route.length - 2]! : army.tile;
  army.gate = gateOf(toTile, launchId);

  state.events.push({ t: 'dispatched', armyId: army.id, toTile: c.toTile });
}

export function advance(state: MapState, commands: MapCommand[]): MapState {
  // Snapshot which armies are already travelling/retreating BEFORE commands run.
  // Newly dispatched armies this tick do NOT accumulate gauge until next tick.
  const travellingBefore = new Set(
    state.armies.filter((a) => a.state === 'travelling' || a.state === 'retreating').map((a) => a.id),
  );

  const sorted = commands.slice().sort((a, b) => {
    if (a.t < b.t) return -1;
    if (a.t > b.t) return 1;
    const ia = idOf(a);
    const ib = idOf(b);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });

  for (const c of sorted) {
    if (c.t === 'dispatch') applyDispatch(state, c);
    if (c.t === 'retreat') applyRetreat(state, c.armyId);
  }

  // Travel phase: only armies that were already travelling/retreating BEFORE this tick's commands.
  for (const army of state.armies.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (!travellingBefore.has(army.id)) continue;
    army.travelGauge += slowestTempo(army);
    while (army.travelGauge >= TRAVEL_THRESHOLD && army.route && army.route.length > 0) {
      army.travelGauge -= TRAVEL_THRESHOLD;
      const from = army.tile;
      const next = army.route.shift()!;
      army.tile = next;
      state.events.push({ t: 'hopped', armyId: army.id, from, to: next });
      if (army.route.length === 0) {
        resolveArrival(state, army);
        break; // reached destination
      }
    }
  }

  // Battle-step phase: step each active battle STEPS_PER_MAP_TICK times per map tick.
  // Battles are iterated in tile-id order (state.battles is kept sorted by tile id).
  for (const b of state.battles) {
    for (let k = 0; k < STEPS_PER_MAP_TICK && !b.fight.outcome; k++) {
      stepFight(b.fight);
    }
  }

  // Outcome-application phase: apply resolved battles (those with an outcome set).
  // Collect resolved battles first (avoid mutating state.battles while iterating).
  const resolved = state.battles.filter((b) => b.fight.outcome !== null);
  for (const b of resolved) {
    const tile = tileById(state, b.tile)!;
    // All contested attacker armies targeting this tile
    const attackers = state.armies.filter((a) => a.target === b.tile && a.state === 'contested');
    const winner = b.fight.outcome!.winner;

    if (winner === 'A') {
      // Attacker wins: capture the tile.
      // Reconcile each attacker army — write surviving units' HP back, drop dead units.
      for (const army of attackers) {
        reconcileArmy(army, b.fight);
      }
      tile.owner = 'player';
      tile.garrison = []; // garrison wiped
      // Garrison-surviving armies onto the tile; remove zero-survivor armies.
      for (const army of attackers) {
        if (army.units.length === 0) {
          // All units died — remove army from state.armies
          const idx = state.armies.indexOf(army);
          if (idx !== -1) state.armies.splice(idx, 1);
        } else {
          army.state = 'garrisoned';
          army.tile = b.tile;
          army.target = undefined;
          army.gate = undefined;
          army.route = undefined;
        }
      }
      // Use first surviving attacker army (winner==='A' guarantees at least one)
      const firstSurvivor = attackers.find((a) => a.units.length > 0);
      state.events.push({ t: 'captured', tile: b.tile, by: firstSurvivor?.id ?? '-' });
    } else {
      // Defender wins (winner==='B') OR timeout/draw.
      // A stalemated attacker is treated as repelled and its units are lost — acceptable for alpha.
      // Remove all attacking armies.
      for (const army of attackers) {
        const idx = state.armies.indexOf(army);
        if (idx !== -1) state.armies.splice(idx, 1);
      }
      // Rebuild garrison from surviving side-B fight units, matched against original garrison specs.
      const origGarrison = tile.garrison.slice(); // capture originals before overwriting
      const newGarrison: UnitSpec[] = [];
      for (const f of b.fight.units) {
        if (f.side !== 'B' || f.hp <= 0) continue;
        const origId = f.id.slice('garrison#'.length);
        const orig = origGarrison.find((g) => g.id === origId);
        if (!orig) throw new Error(`reconcileGarrison: no original spec found for garrison unit id '${origId}' (fight id '${f.id}')`);
        newGarrison.push({ ...orig, startHp: f.hp });
      }
      tile.garrison = newGarrison;
      state.events.push({ t: 'repelled', tile: b.tile });
    }
  }
  // Remove all resolved battles in one pass.
  state.battles = state.battles.filter((b) => b.fight.outcome === null);

  state.totalTicks++;
  return state;
}

// ── hashMap ──────────────────────────────────────────────────────────────────

export function hashMap(state: MapState): string {
  const tilePart = state.tiles.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((t) => `${t.id}:${t.owner}`).join(',');
  const armyPart = state.armies.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((a) => `${a.id}:${a.tile}:${a.state}:${a.target ?? '-'}`).join(',');
  return fnv1a(`${tilePart}#${armyPart}#${state.totalTicks}`);
}
