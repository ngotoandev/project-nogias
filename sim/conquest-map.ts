import type { MapSetup, MapState, MapCommand, MapEdge, MapTile, Army, UnitSpec } from '../shared/types';
import { fnv1a } from './hash';
import { deriveStats } from './stats';
import { MAX_COMMIT, TRAVEL_THRESHOLD } from '../shared/config';

const cloneSpec = (u: UnitSpec): UnitSpec => ({
  ...u,
  attrs: { ...u.attrs },
  pos: { ...u.pos },
  traits: u.traits ? u.traits.slice() : undefined,
  personality: u.personality ? { ...u.personality } : undefined,
});

export function initConquest(setup: MapSetup): MapState {
  const tiles = setup.tiles.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((t) => ({ ...t, neighbors: { ...t.neighbors }, garrison: t.garrison.map(cloneSpec) }));
  const armies: Army[] = setup.armies.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((a) => ({ id: a.id, units: a.units.map(cloneSpec), tile: a.tile, state: 'garrisoned', travelGauge: 0 }));
  return { tiles, armies, totalTicks: 0, events: [] };
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

function resolveArrival(state: MapState, army: Army): void {
  if (army.state === 'retreating') {
    army.state = 'garrisoned';
    army.target = undefined;
    return; // Task 4 handles retreat command; here just land
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
    // defended: inert engagement seam (Plan 3 resolves)
    army.state = 'contested';
    const attackers = state.armies
      .filter((a) => a.target === tile.id && a.state === 'contested')
      .map((a) => a.id)
      .sort();
    state.events.push({ t: 'contested', tile: tile.id, attackers });
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
    // retreat → Task 4
  }

  // Travel phase: only armies that were already travelling/retreating BEFORE this tick's commands.
  for (const army of state.armies.slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
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
