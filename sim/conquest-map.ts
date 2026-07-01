import type { MapSetup, MapCommand, MapEdge, MapTile, Army, UnitSpec, FightSetup, GridSpec, MapEvent } from '../shared/types';
import type { FightState } from './tile-fight';
import { initFight, stepFight, joinFight, orderRetreat } from './tile-fight';
import { fnv1a, hashFight } from './hash';
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

export interface MapBattle { tile: string; fight: FightState; attackerOwner: 'player' | 'enemy'; attackerGarrison?: UnitSpec[]; }

export interface MapState {
  tiles: MapTile[];
  armies: Army[];
  totalTicks: number;
  events: MapEvent[];
  seed: number;
  battles: MapBattle[];
  enemyArmies: Army[];
}

export function initConquest(setup: MapSetup, seed = 0): MapState {
  const tiles = setup.tiles.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((t) => ({ ...t, neighbors: { ...t.neighbors }, garrison: t.garrison.map(cloneSpec) }));
  const armies: Army[] = setup.armies.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((a) => ({ id: a.id, units: a.units.map(cloneSpec), tile: a.tile, state: 'garrisoned', travelGauge: 0 }));
  const enemyArmies: Army[] = (setup.enemyArmies ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((a) => ({ id: a.id, units: a.units.map(cloneSpec), tile: a.tile, state: 'garrisoned', travelGauge: 0 }));
  return { tiles, armies, totalTicks: 0, events: [], seed, battles: [], enemyArmies };
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

// Build the UnitSpec array for a single army's attacker units.
// Ids are `${army.id}#${unit.id}`, side 'A', startHp carried from the army unit.
// Positions are deployCell(army.gate!, grid, gateIndexStart + k) for the k-th unit.
// gateIndexStart: 0-based offset to use for this army's first unit on its gate.
// NOTE on same-gate stacking for join: a joining army always passes gateIndexStart=0
// (local 0-based per the joining army's own units). Two armies on the same gate may
// initially co-locate — same-gate stacking is a later knob; it is deterministic and
// parity-safe (the common reinforcement case — different gates — never overlaps).
function attackerFightSpecs(army: Army, grid: GridSpec, gateIndexStart = 0): UnitSpec[] {
  const gate = army.gate!;
  const specs: UnitSpec[] = [];
  for (let k = 0; k < army.units.length; k++) {
    const u = army.units[k]!;
    specs.push({
      id: `${army.id}#${u.id}`,
      side: 'A',
      attackKind: u.attackKind,
      attrs: { ...u.attrs },
      skill: u.skill,
      traits: u.traits ? u.traits.slice() : undefined,
      personality: u.personality ? { ...u.personality } : undefined,
      priority: u.priority,
      startHp: u.startHp,
      pos: deployCell(gate, grid, gateIndexStart + k),
    });
  }
  return specs;
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

  // Attacker units: armies sorted by id, units in array order — use shared helper
  for (const army of attackerArmies.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const gate = army.gate!;
    if (gateIndex[gate] === undefined) gateIndex[gate] = 0;
    const start: number = gateIndex[gate] as number;
    for (const spec of attackerFightSpecs(army, grid, start)) {
      units.push(spec);
    }
    gateIndex[gate] = start + army.units.length;
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

  // Task 6: if contested AND an active battle exists at the target tile,
  // order each of the army's active fight units to retreat via their gate.
  // Do NOT free the slot yet — keep army.target so the commit-cap stays correct
  // while the units walk to the exit edge. The post-step exit-check in advance
  // transitions the army once all its fight units are exited||dead.
  if (army.state === 'contested') {
    const battle = state.battles.find((b) => b.tile === army.target);
    if (battle) {
      for (const u of army.units) {
        const fightUnitId = `${army.id}#${u.id}`;
        const fu = battle.fight.units.find((f) => f.id === fightUnitId);
        if (fu && fu.hp > 0 && !fu.exited) {
          // NOTE: Bloodthirsty units ignore orderRetreat (Plan 1 invariant).
          // Such a unit will fight on; the army stays contested until the battle
          // resolves normally. Only when all non-Bloodthirsty units have exited
          // AND Bloodthirsty units have died does the army count as fully pulled out.
          orderRetreat(battle.fight, fightUnitId, army.gate!);
        }
      }
      army.retreatOrdered = true;
      // Slot and route NOT freed here — handled by the post-step exit-check.
      return;
    }
    // Contested but no active battle (defensive edge case — should not occur post-Task-5):
    // fall through to the existing Plan-2 contested behavior below.
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
    // On an enemy tile (contested, no active battle) → hop back to first owned neighbor
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
      // Task 5: continuous reinforcement — join the live fight instead of opening a second battle.
      // DEFAULT_FIGHT_GRID has the same dimensions as the battle's grid (all battles share it).
      joinFight(existing.fight, attackerFightSpecs(army, DEFAULT_FIGHT_GRID));
      state.events.push({ t: 'reinforced', tile: tile.id, armyId: army.id });
    } else {
      // Gather all contested attacker armies targeting this tile (includes just-arrived one)
      const attackerArmies = state.armies.filter(
        (a) => a.target === tile.id && a.state === 'contested',
      );

      const { setup, seed } = buildFightSetup(tile, attackerArmies, state.seed);
      const fight = initFight(setup, seed);

      // Insert battle sorted by tile id
      state.battles.push({ tile: tile.id, fight, attackerOwner: 'player' });
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
  const enemyTravellingBefore = new Set(
    state.enemyArmies.filter((a) => a.state === 'travelling').map((a) => a.id),
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

  // Enemy-army phase: march + assault (no-op when there are no enemy armies).
  advanceEnemyArmies(state, enemyTravellingBefore);

  // Battle-step phase: step each active battle STEPS_PER_MAP_TICK times per map tick.
  // Battles are iterated in tile-id order (state.battles is kept sorted by tile id).
  for (const b of state.battles) {
    for (let k = 0; k < STEPS_PER_MAP_TICK && !b.fight.outcome; k++) {
      stepFight(b.fight);
    }
  }

  // Post-step exit-check (Task 6): for each active battle, check retreat-ordered armies.
  // This runs AFTER the battle-step loop and BEFORE outcome application so that a fully-
  // exited retreating army transitions to 'retreating' before the outcome filter
  // (`target===tile && state==='contested'`) runs — ensuring it is excluded from the
  // outcome's attacker set if it has already left.
  for (const b of state.battles) {
    // Iterate over a snapshot so we can safely remove armies mid-loop.
    for (const army of state.armies.slice()) {
      if (!army.retreatOrdered || army.target !== b.tile || army.state !== 'contested') continue;

      // Check if ALL of this army's fight units are exited or dead.
      // A Bloodthirsty unit ignores orderRetreat and may still be alive+fighting;
      // in that case the army stays contested and the battle resolves normally.
      const allOut = army.units.every((u) => {
        const fu = b.fight.units.find((f) => f.id === `${army.id}#${u.id}`);
        return !fu || fu.exited || fu.hp <= 0;
      });
      if (!allOut) continue;

      // All fight units are out — reconstitute from exited survivors.
      reconcileArmy(army, b.fight);
      const tile = b.tile;
      if (army.units.length === 0) {
        // No survivors — remove army entirely.
        const idx = state.armies.indexOf(army);
        if (idx !== -1) state.armies.splice(idx, 1);
      } else {
        // Route back to first owned neighbor of the contested tile (invariant: always exists).
        const contestedTile = tileById(state, tile)!;
        const back = ownedNeighborIds(state, contestedTile)[0];
        if (!back) throw new Error(`post-step exit-check: army ${army.id} at ${tile} has no owned neighbor to retreat to`);
        army.state = 'retreating';
        army.route = [back];
        army.target = undefined;
        army.gate = undefined;
        army.retreatOrdered = false;
        army.travelGauge = 0;
      }
      state.events.push({ t: 'slotFreed', tile, armyId: army.id });
    }
  }

  // Outcome-application phase: apply resolved battles (those with an outcome set).
  // Collect resolved battles first (avoid mutating state.battles while iterating).
  const resolved = state.battles.filter((b) => b.fight.outcome !== null);
  for (const b of resolved) {
    const tile = tileById(state, b.tile)!;
    const winner = b.fight.outcome!.winner;

    if (b.attackerOwner === 'player') {
      // All contested attacker armies targeting this tile
      const attackers = state.armies.filter((a) => a.target === b.tile && a.state === 'contested');

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
    } else { // attackerOwner === 'enemy' (sortie): playerArmies are the DEFENDERS (side B); attacker = enemy garrison (side A)
      const playerArmies = state.armies.filter((a) => a.target === b.tile && a.state === 'contested');
      if (winner === 'A') {                       // enemy wins — LETHAL
        tile.owner = 'enemy';
        const orig = b.attackerGarrison ?? [];
        const newGarrison: UnitSpec[] = [];
        for (const f of b.fight.units) {           // surviving side-A enemy units → tile's new garrison
          if (f.side !== 'A' || f.hp <= 0) continue;
          const origId = f.id.slice('garrison#'.length);
          const og = orig.find((g) => g.id === origId);
          if (!og) throw new Error(`sortie outcome: no original spec for '${origId}' (fight id '${f.id}')`);
          newGarrison.push({ ...og, startHp: f.hp });
        }
        tile.garrison = newGarrison;
        for (const army of playerArmies) {         // defending armies destroyed
          const idx = state.armies.indexOf(army); if (idx !== -1) state.armies.splice(idx, 1);
        }
        state.events.push({ t: 'captured', tile: b.tile, by: '-' }); // enemy capture (by '-' = enemy/no army)
      } else {                                     // player repels (B win / timeout / draw)
        for (const army of playerArmies) reconcileArmy(army, b.fight);
        for (const army of playerArmies) {
          if (army.units.length === 0) { const idx = state.armies.indexOf(army); if (idx !== -1) state.armies.splice(idx, 1); }
          else { army.state = 'garrisoned'; army.target = undefined; army.gate = undefined; army.route = undefined; }
        }
        state.events.push({ t: 'repelled', tile: b.tile }); // attacker (enemy sortie) discarded; source already empty
      }
    }
  }
  // Remove all resolved battles in one pass.
  state.battles = state.battles.filter((b) => b.fight.outcome === null);

  state.totalTicks++;
  return state;
}

// ── openSortie: enemy-initiated battle against a player tile ─────────────────

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function buildSortieSetup(state: MapState, target: MapTile, source: MapTile,
  defenderArmies: Army[], attackerGarrison: UnitSpec[]): { setup: FightSetup; seed: number } {
  const grid = DEFAULT_FIGHT_GRID;
  const units: UnitSpec[] = [];
  const gate = gateOf(target, source.id);
  for (let k = 0; k < attackerGarrison.length; k++) {           // attacker: enemy garrison, side A, gate edge
    const g = attackerGarrison[k]!;
    units.push({ id: `garrison#${g.id}`, side: 'A', attackKind: g.attackKind, attrs: { ...g.attrs },
      skill: g.skill, traits: g.traits ? g.traits.slice() : undefined,
      personality: g.personality ? { ...g.personality } : undefined, priority: g.priority,
      startHp: g.startHp, pos: deployCell(gate, grid, k) });
  }
  let di = 0;                                                    // defender: player army units, side B, interior
  for (const army of defenderArmies.slice().sort(byId)) {
    for (const u of army.units) {
      units.push({ id: `${army.id}#${u.id}`, side: 'B', attackKind: u.attackKind, attrs: { ...u.attrs },
        skill: u.skill, traits: u.traits ? u.traits.slice() : undefined,
        personality: u.personality ? { ...u.personality } : undefined, priority: u.priority,
        startHp: u.startHp, pos: garrisonCell(grid, di++) });
    }
  }
  return { setup: { grid, units }, seed: fightSeed(state.seed, target.id) };
}

function openEnemyAttack(state: MapState, target: MapTile, sourceTileId: string,
  attackerUnits: UnitSpec[], consume: () => void): void {
  const source = tileById(state, sourceTileId)!;
  const defenderArmies = state.armies.filter((a) => a.tile === target.id);
  const attackerGarrison = attackerUnits.slice();               // stash originals (attackKind lost from fight Unit)
  const { setup, seed } = buildSortieSetup(state, target, source, defenderArmies, attackerGarrison);
  const fight = initFight(setup, seed);
  consume();
  state.battles.push({ tile: target.id, fight, attackerOwner: 'enemy', attackerGarrison });
  state.battles.sort((a, b) => (a.tile < b.tile ? -1 : a.tile > b.tile ? 1 : 0));
  const gate = gateOf(target, source.id);
  for (const army of defenderArmies) { army.state = 'contested'; army.target = target.id; army.gate = gate; }
  state.events.push({ t: 'sortie', tile: target.id, from: sourceTileId });
}

export function openSortie(state: MapState, source: MapTile, target: MapTile): void {
  // defends with ALL armies on the tile; the run-layer only sorties stationary-defended tiles, so no
  // transient passer-by can be caught today — revisit (gate on garrisoned/contested) once enemy mobile armies exist.
  openEnemyAttack(state, target, source.id, source.garrison, () => { source.garrison = []; });
}

// ── advanceEnemyArmies: enemy mobile armies march to the nearest player tile and assault ─────

function removeEnemyArmy(state: MapState, army: Army): void {
  const i = state.enemyArmies.indexOf(army);
  if (i !== -1) state.enemyArmies.splice(i, 1);
}

// BFS from fromId over ENEMY-owned tiles; the nearest enemy tile with a player-owned
// neighbor is the launch tile and that player neighbor is the target. Deterministic
// (N/S/E/W expansion + queue order). Returns { target, route: [...enemy path, target] } or null.
function nearestPlayerAssault(state: MapState, fromId: string): { target: string; route: string[] } | null {
  const start = tileById(state, fromId);
  if (!start || start.owner !== 'enemy') return null;
  const adjPlayer = (tile: MapTile): string | undefined => {
    for (const e of EDGES) { const nb = tile.neighbors[e]; if (nb) { const t = tileById(state, nb); if (t && t.owner === 'player') return nb; } }
    return undefined;
  };
  const here = adjPlayer(start);
  if (here) return { target: here, route: [here] };
  const visited = new Set<string>([fromId]);
  const parent = new Map<string, string>();
  const queue: string[] = [fromId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const tile = tileById(state, cur);
    if (!tile) continue;
    for (const e of EDGES) {
      const nb = tile.neighbors[e];
      if (!nb || visited.has(nb)) continue;
      const nt = tileById(state, nb);
      if (!nt || nt.owner !== 'enemy') continue;
      visited.add(nb); parent.set(nb, cur); queue.push(nb);
      const tgt = adjPlayer(nt);
      if (tgt) {
        const path: string[] = []; let node: string = nb;
        while (node !== fromId) { path.unshift(node); node = parent.get(node)!; }
        path.push(tgt);
        return { target: tgt, route: path };
      }
    }
  }
  return null;
}

// Assault a player tile with the (consumed) enemy army's units.
function enemyArmyAssault(state: MapState, army: Army, targetId: string): void {
  const target = tileById(state, targetId)!;
  const defenders = state.armies.filter((a) => a.tile === targetId);
  if (target.garrison.length === 0 && defenders.length === 0) {
    // undefended → fight-free capture (mirror of the player capturing undefended ground)
    target.owner = 'enemy';
    target.garrison = army.units.map(cloneSpec);
    removeEnemyArmy(state, army);
    state.events.push({ t: 'captured', tile: targetId, by: '-' });
    return;
  }
  openEnemyAttack(state, target, army.tile, army.units, () => removeEnemyArmy(state, army));
}

function advanceEnemyArmies(state: MapState, travellingBefore: Set<string>): void {
  for (const army of state.enemyArmies.slice().sort(byId)) {
    if (army.state === 'garrisoned') {
      const plan = nearestPlayerAssault(state, army.tile);
      if (!plan) continue;                                   // no reachable player tile → stay idle
      army.state = 'travelling';
      army.target = plan.target;
      army.route = plan.route;
      army.travelGauge = 0;
      const launchId = plan.route.length >= 2 ? plan.route[plan.route.length - 2]! : army.tile;
      army.gate = gateOf(tileById(state, plan.target)!, launchId);
      state.events.push({ t: 'dispatched', armyId: army.id, toTile: plan.target });
      continue;                                              // set out this tick ⇒ no accumulation yet
    }
    if (army.state !== 'travelling' || !travellingBefore.has(army.id)) continue;
    army.travelGauge += slowestTempo(army);
    while (army.travelGauge >= TRAVEL_THRESHOLD && army.route && army.route.length > 0) {
      army.travelGauge -= TRAVEL_THRESHOLD;
      if (army.route.length === 1) {                         // last element = player target → assault from launch tile
        const targetId = army.route[0]!;
        const target = tileById(state, targetId);
        if (!target || target.owner !== 'player') {          // target flipped away → disband
          removeEnemyArmy(state, army);
        } else if (state.battles.some((b) => b.tile === targetId)) {
          // a battle is already underway here → wait (retry next accumulation); keep route
        } else {
          army.route = [];
          enemyArmyAssault(state, army, targetId);
        }
        break;
      }
      const from = army.tile;
      const next = army.route.shift()!;
      army.tile = next;                                      // hop onto next enemy tile
      state.events.push({ t: 'hopped', armyId: army.id, from, to: next });
    }
  }
}

// True while there is live in-flight activity: an army marching (travelling) or
// pulling back (retreating), or a battle still resolving. The single source of
// truth for "the world has something to advance" — the replay drivers and the
// interactive client both gate on this (the client also checks run.status).
export function hasPendingActivity(map: MapState): boolean {
  return (
    map.armies.some((a) => a.state === 'travelling' || a.state === 'retreating') ||
    map.enemyArmies.some((a) => a.state === 'travelling') ||
    map.battles.some((b) => !b.fight.outcome)
  );
}

// ── hashMap ──────────────────────────────────────────────────────────────────

export function hashMap(state: MapState): string {
  const tilePart = [...state.tiles].sort(byId).map((t) =>
    `${t.id}:${t.owner}:${t.garrison.map(g => `${g.id}@${g.startHp ?? deriveStats(g.attrs, g.attackKind).maxHp}`).join('/')}`
  ).join(',');
  const armyPart = [...state.armies].sort(byId).map((a) =>
    `${a.id}:${a.tile}:${a.state}:${a.target ?? '-'}:${a.units.map(u => `${u.id}@${u.startHp ?? deriveStats(u.attrs, u.attackKind).maxHp}`).join('/')}`
  ).join(',');
  const battlePart = [...state.battles].sort((x, y) => x.tile < y.tile ? -1 : x.tile > y.tile ? 1 : 0)
    .map((b) => `${b.tile}=${hashFight(b.fight.units, b.fight.totalTicks)}`).join(',');
  const enemyPart = state.enemyArmies.length === 0 ? '' :
    '#E:' + [...state.enemyArmies].sort(byId).map((a) =>
      `${a.id}:${a.tile}:${a.state}:${a.target ?? '-'}:${a.units.map(u => `${u.id}@${u.startHp ?? deriveStats(u.attrs, u.attackKind).maxHp}`).join('/')}`
    ).join(',');
  return fnv1a(`${tilePart}#${armyPart}#${battlePart}#${state.totalTicks}${enemyPart}`);
}
