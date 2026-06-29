# Conquest-Map Control Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic, clockless conquest-map sub-engine — `advance(state, commands)` on a fixed tick — with a tile graph + ownership, player armies, per-tile travel across owned territory, `DispatchArmy`/`Retreat` commands + BFS routing + a 4-army commit cap, undefended-tile capture, and an inert "contested" engagement seam for defended tiles (the fight is Plan 3).

**Architecture:** A new `sim/conquest-map.ts` holds the logic; all map data types go in `shared/types.ts` (they reference only `UnitSpec` + primitives — no `Grid` — so no `shared→sim` import, unlike `FightState`). The engine is RNG-free and never imports the fight engine. Parity reuses the established pattern: a version-aware `runReplay` gains a v3 (conquest) branch driven by `runScriptedConquest`, so the goja harness is unchanged.

**Tech Stack:** TypeScript (strict, ES2015), Vitest, esbuild bundle, goja (Go) parity runner. Sim is pure / integer-only / goja-safe.

## Global Constraints

- **Parity-critical** (`/sim`, `/shared`): integer math only — no floats, no `Math.sqrt`, no `Math.random`, no `Date`, no Node APIs. The control layer draws **no RNG at all** (routing is BFS, travel is an integer gauge, commands are deterministic).
- **The map engine must NOT import the fight engine** (`tile-fight`/`decide`/`stepFight`). It references `UnitSpec` data only. (`deriveStats` from `sim/stats.ts` is allowed — it's a pure stat helper, used for army travel speed.)
- **The 13 fight fixtures + golden `86e238c1` are a separate engine and must stay untouched** — `npm run parity` keeps them green. New conquest fixtures are `version: 3`.
- **Determinism:** `tiles` and `armies` kept sorted by `id`; all iteration/selection ends in an `id` tiebreak; commands within a tick processed in a stable sorted order; BFS expands neighbors in fixed `N,S,E,W` order with an id-keyed visited set.
- **Transient state unhashed:** `Army.travelGauge` and `Army.route` are NOT in `hashMap` (their effect surfaces in `tile`/`state`/`owner`), mirroring `gauge`/`mana` in the fight.
- **`ReplayResult.winner`/`endReason` become optional** (a conquest run returns `{hash, ticks}`); v1/v2 fight runs still populate all fields; the parity harness reads only `.hash`.
- **Commits:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

### Standard commands (every task)
- Focused test: `npx vitest run sim/conquest-map.test.ts`
- Full suite: `npm test` (currently 146 tests; grows per task)
- Types: `npm run typecheck`
- Parity (full): `export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity` → expect `PARITY OK (V8 === goja === expected) for N fixture(s).`; the 13 fight fixtures stay green (canonical `86e238c1`).

### Fixture capture procedure (Task 5)
1. Add the new `{ name, expectedHash: 'PENDING', bundle: {version:3, …} }` to `tools/parity/fixtures.mjs`.
2. `npm run parity` prints `V8 mismatch [<name>]: <ACTUAL> !== PENDING`.
3. Set `expectedHash` to `<ACTUAL>`; re-run full parity → `PARITY OK`. Confirm the 13 fight hashes are unchanged.

---

## File Structure

- **Modify `shared/types.ts`** — add all map data types: `MapEdge`, `TileOwner`, `TileType`, `MapTile`, `ArmyState`, `Army`, `MapSetup`, `MapEvent`, `MapCommand`, `MapState`, `ConquestBundle`; make `ReplayResult.winner?`/`endReason?` optional.
- **Modify `shared/config.ts`** — `TRAVEL_THRESHOLD`, `MAX_COMMIT`.
- **Create `sim/conquest-map.ts`** — `initConquest`, `hashMap`, `advance` (command processing + travel + arrival), `slowestTempo`, BFS routing, capture/contested helpers. Co-located `sim/conquest-map.test.ts`.
- **Modify `sim/replay.ts`** — `runScriptedConquest`; version-aware `runReplay` (v3 branch).
- **Modify `sim/index.ts`** — export `runScriptedConquest`.
- **Modify `tools/parity/fixtures.mjs`** — +2 v3 fixtures. (No change to `parity.mjs`/`run-node.mjs`/`goja-runner/main.go` — they call `Sim.runReplay`, now v3-aware.)

---

## Task 1: Map model + `initConquest` + `hashMap`

**Files:** Modify `shared/types.ts`, `shared/config.ts`; Create `sim/conquest-map.ts`, `sim/conquest-map.test.ts`.

**Interfaces — Produces (later tasks rely on these):**
```ts
// shared/types.ts
export type MapEdge = 'N' | 'S' | 'E' | 'W';
export type TileOwner = 'player' | 'enemy' | 'neutral';
export type TileType = 'start'|'enemy'|'elite'|'boss'|'rest'|'cache'|'event'|'recruit'|'muster'|'boon'|'mysterious';
export interface MapTile { id: string; type: TileType; owner: TileOwner; neighbors: { N?: string; S?: string; E?: string; W?: string }; garrison: UnitSpec[]; }
export type ArmyState = 'garrisoned' | 'travelling' | 'contested' | 'retreating';
export interface Army { id: string; units: UnitSpec[]; tile: string; state: ArmyState; target?: string; route?: string[]; travelGauge: number; }
export interface MapSetup { tiles: MapTile[]; armies: { id: string; units: UnitSpec[]; tile: string }[]; } // armies are the player's
export type MapEvent =
  | { t: 'dispatched'; armyId: string; toTile: string }
  | { t: 'hopped'; armyId: string; from: string; to: string }
  | { t: 'captured'; tile: string; by: string }
  | { t: 'contested'; tile: string; attackers: string[] }
  | { t: 'retreated'; armyId: string; to: string }
  | { t: 'slotFreed'; tile: string; armyId: string }
  | { t: 'rejected'; armyId: string; reason: string };
export type MapCommand = { t: 'dispatch'; armyId: string; toTile: string; gate?: MapEdge } | { t: 'retreat'; armyId: string };
export interface MapState { tiles: MapTile[]; armies: Army[]; totalTicks: number; events: MapEvent[]; }
export interface ConquestBundle { version: 3; setup: MapSetup; seed: number; script: { atTick: number; commands: MapCommand[] }[]; }
// sim/conquest-map.ts
export function initConquest(setup: MapSetup): MapState;
export function hashMap(state: MapState): string;
```
- Consumes: `UnitSpec` (shared), `fnv1a` (`sim/hash.ts`).

- [ ] **Step 1: Types + config.** Add the types above to `shared/types.ts`; make `ReplayResult` `winner?`/`endReason?` optional. Add to `shared/config.ts`: `export const TRAVEL_THRESHOLD = 100;` and `export const MAX_COMMIT = 4;`

- [ ] **Step 2: Failing tests** (`sim/conquest-map.test.ts`)
```ts
import { describe, it, expect } from 'vitest';
import { initConquest, hashMap } from './conquest-map';
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
```

- [ ] **Step 3: Implement** (`sim/conquest-map.ts`)
```ts
import type { MapSetup, MapState, Army } from '../shared/types';
import { fnv1a } from './hash';

export function initConquest(setup: MapSetup): MapState {
  const tiles = setup.tiles.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((t) => ({ ...t, neighbors: { ...t.neighbors }, garrison: t.garrison.map((u) => ({ ...u })) }));
  const armies: Army[] = setup.armies.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((a) => ({ id: a.id, units: a.units.map((u) => ({ ...u })), tile: a.tile, state: 'garrisoned', travelGauge: 0 }));
  return { tiles, armies, totalTicks: 0, events: [] };
}

export function hashMap(state: MapState): string {
  const tilePart = state.tiles.slice().sort((a, b) => (a.id < b.id ? -1 : 1)).map((t) => `${t.id}:${t.owner}`).join(',');
  const armyPart = state.armies.slice().sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((a) => `${a.id}:${a.tile}:${a.state}:${a.target ?? '-'}`).join(',');
  return fnv1a(`${tilePart}#${armyPart}#${state.totalTicks}`);
}
```
(Sorting in `init` keeps `tiles`/`armies` id-ordered; `hashMap` sorts defensively too. `garrison`/`units` are deep-copied so the setup isn't mutated.)

- [ ] **Step 4: Verify + commit** — focused test PASS; `npm test`; `npm run typecheck`; full parity (13 fight fixtures unchanged).
```bash
git add shared/types.ts shared/config.ts sim/conquest-map.ts sim/conquest-map.test.ts
git commit -m "$(cat <<'EOF'
feat(sim): conquest-map model + initConquest + hashMap
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `advance` + `DispatchArmy` command (validation, BFS routing, commit slots)

**Files:** Modify `sim/conquest-map.ts`, `sim/conquest-map.test.ts`.

**Interfaces:**
- Consumes: Task 1 types/`initConquest`; `deriveStats` (`sim/stats.ts`).
- Produces: `export function advance(state: MapState, commands: MapCommand[]): MapState;` (this task: processes commands; travel is Task 3). Helpers: `slowestTempo(army)`, `committedCount(state, tileId)`, BFS routing.

- [ ] **Step 1: Failing tests** — dispatch sets a travelling army with a route + reserves a slot; rejects invalid dispatches; cap enforced.
```ts
import { advance } from './conquest-map';
// valid dispatch a1: t0(player) → t2(enemy). Launch tile = t1? t1 is NEUTRAL not owned, so the only owned
// tile is t0; t0 is adjacent to t1 (not t2). So t2 is NOT adjacent to an owned tile → dispatch to t2 REJECTS.
// Use a map where the target is adjacent to an owned tile. Adjust the helper: make t1 'player'-owned.
it('dispatch to an enemy tile adjacent to owned territory: army travels, slot reserved', () => {
  const s = initConquest(setupWithT1Owned()); // t0,t1 player; t2 enemy (t1 adjacent to t2)
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }]);
  const a = s.armies.find(x => x.id === 'a1')!;
  expect(a.state).toBe('travelling');
  expect(a.target).toBe('t2');
  expect(a.route).toEqual(['t1', 't2']); // from t0: hop to t1 (owned launch), then into t2
  expect(s.events.some(e => e.t === 'dispatched' && e.armyId === 'a1')).toBe(true);
});
it('rejects dispatch when target is not adjacent to any owned tile', () => {
  const s = initConquest(setup()); // t1 neutral → t2 only reachable via neutral t1, t2 not adjacent to owned
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }]);
  expect(s.armies.find(x => x.id === 'a1')!.state).toBe('garrisoned');
  expect(s.events.some(e => e.t === 'rejected' && e.armyId === 'a1')).toBe(true);
});
it('rejects dispatch when target is already at MAX_COMMIT', () => { /* 4 armies committed to t2 → 5th rejects */ });
it('rejects dispatch of a non-garrisoned army / not-your tile', () => { /* … */ });
```

- [ ] **Step 2: Run** → FAIL (`advance` not exported).

- [ ] **Step 3: Implement** `advance` (command phase) + helpers (`sim/conquest-map.ts`)
```ts
import { deriveStats } from './stats';
import { TRAVEL_THRESHOLD, MAX_COMMIT } from '../shared/config';
import type { MapCommand, MapEdge } from '../shared/types';

const EDGES: MapEdge[] = ['N', 'S', 'E', 'W'];
export function slowestTempo(army: Army): number {
  let m = Infinity; for (const u of army.units) { const t = deriveStats(u.attrs, u.attackKind).tempoRate; if (t < m) m = t; } return m;
}
function tileById(state: MapState, id: string) { return state.tiles.find((t) => t.id === id); }
function ownedNeighborIds(tile: MapTile): string[] { /* neighbor ids in N,S,E,W order (filter to existing) */ }
function committedCount(state: MapState, tileId: string): number {
  return state.armies.filter((a) => a.target === tileId && (a.state === 'travelling' || a.state === 'contested')).length;
}
// Deterministic BFS over OWNED tiles from `fromId` to a launch tile (owned, adjacent to toTile).
// Returns [...ownedPath excluding fromId, toTile.id], or null if unreachable.
function bfsRoute(state: MapState, fromId: string, toTile: MapTile, gate?: MapEdge): string[] | null {
  const isLaunch = (id: string): boolean => {
    const t = tileById(state, id); if (!t || t.owner !== 'player') return false;
    if (gate) return toTile.neighbors[gate] === id;            // gate: the owned tile on that edge of toTile
    return EDGES.some((e) => t.neighbors[e] === toTile.id);    // any owned tile adjacent to toTile
  };
  // BFS: queue of ids, visited Set by id, parent map. Expand neighbors in N,S,E,W order, owned-only.
  // First id satisfying isLaunch → shortest path; reconstruct fromId→launch, drop fromId, append toTile.id.
  // (If fromId itself isLaunch → return [toTile.id].) No path → null.
}

export function advance(state: MapState, commands: MapCommand[]): MapState {
  const sorted = commands.slice().sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0) || (idOf(a) < idOf(b) ? -1 : 1));
  for (const c of sorted) {
    if (c.t === 'dispatch') applyDispatch(state, c);
    // retreat → Task 4
  }
  // travel phase → Task 3
  state.totalTicks++;
  return state;
}
function applyDispatch(state: MapState, c: { armyId: string; toTile: string; gate?: MapEdge }) {
  const army = state.armies.find((a) => a.id === c.armyId);
  const reject = (reason: string) => state.events.push({ t: 'rejected', armyId: c.armyId, reason });
  if (!army) return reject('no-army');
  if (army.state !== 'garrisoned') return reject('busy');
  const toTile = tileById(state, c.toTile);
  if (!toTile || toTile.owner === 'player') return reject('bad-target');
  if (committedCount(state, c.toTile) >= MAX_COMMIT) return reject('cap-full');
  const route = bfsRoute(state, army.tile, toTile, c.gate);
  if (!route) return reject('no-owned-path');
  army.state = 'travelling'; army.target = c.toTile; army.route = route; army.travelGauge = 0;
  state.events.push({ t: 'dispatched', armyId: army.id, toTile: c.toTile });
}
```
(`idOf` extracts `armyId` for the command sort tiebreak. `EDGES` order makes BFS + neighbor iteration deterministic. `committedCount` counts travelling+contested armies targeting the tile — the reservation.)

- [ ] **Step 4: Verify + commit** — focused tests PASS; `npm test`; typecheck; full parity (13 unchanged).
```bash
git commit -m "feat(sim): conquest advance + DispatchArmy with BFS routing + commit slots …"  # + trailer
```

---

## Task 3: Travel (tempo gauge + hops) + arrival (capture / contested seam)

**Files:** Modify `sim/conquest-map.ts`, `sim/conquest-map.test.ts`.

**Interfaces:**
- Consumes: Task 2 `advance`/`slowestTempo`/dispatch; `TRAVEL_THRESHOLD`.
- Produces: the travel phase inside `advance`; `resolveArrival(state, army)`.

- [ ] **Step 1: Failing tests**
```ts
// Travel cadence: build a1 with a unit of agi=10 → tempoRate = TEMPO_BASE(10)+10 = 20 → hops every 5
// ticks (20*5=100), a clean divisor of TRAVEL_THRESHOLD. (Use a setup variant whose a1 unit is agi=10;
// the agi=5 helpers give tempo 15 → ~every 7 ticks, which is harder to assert exactly.)
it('a travelling army hops every THRESHOLD/slowestTempo ticks (agi=10, tempo 20 → every 5)', () => {
  const s = initConquest(setupT1OwnedFastArmy()); // t0,t1 player; t2 enemy; a1 unit agi=10
  advance(s, [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }]); // route ['t1','t2']; counts as tick 0
  const a = () => s.armies.find(x => x.id === 'a1')!;
  for (let i = 0; i < 4; i++) advance(s, []);  // ticks 1..4: gauge 20→80, no hop yet
  expect(a().tile).toBe('t0');
  advance(s, []); // tick 5: gauge reaches 100 → hop to t1
  expect(a().tile).toBe('t1');
});
it('arriving at an UNDEFENDED tile captures it (owner→player, garrisoned, slot freed, captured event)', () => {
  // dispatch to a neutral/undefended tile adjacent to owned; advance until arrival; assert owner flip.
});
it('arriving at a DEFENDED tile becomes contested (no resolution, slot held, contested event)', () => {
  // dispatch to t2 (garrisoned); advance until arrival; assert state==='contested', owner still 'enemy',
  // a 'contested' event fired, and committedCount(t2) still 1 (slot held).
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** travel + arrival in `advance` (`sim/conquest-map.ts`)
```ts
// In advance(), AFTER the command phase, BEFORE totalTicks++:
for (const army of state.armies.slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
  if (army.state !== 'travelling' && army.state !== 'retreating') continue;
  army.travelGauge += slowestTempo(army);
  while (army.travelGauge >= TRAVEL_THRESHOLD && army.route && army.route.length > 0) {
    army.travelGauge -= TRAVEL_THRESHOLD;
    const from = army.tile;
    const next = army.route.shift()!;
    army.tile = next;
    state.events.push({ t: 'hopped', armyId: army.id, from, to: next });
    if (army.route.length === 0) { resolveArrival(state, army); break; } // reached destination
  }
}

function resolveArrival(state: MapState, army: Army): void {
  if (army.state === 'retreating') { army.state = 'garrisoned'; army.target = undefined; return; } // Task 4 path
  const tile = tileById(state, army.tile)!;
  if (tile.owner === 'player' || tile.garrison.length === 0) {
    // undefended (or already ours): capture / settle — fight-free
    if (tile.owner !== 'player') { tile.owner = 'player'; state.events.push({ t: 'captured', tile: tile.id, by: army.id }); }
    army.state = 'garrisoned'; army.target = undefined;
  } else {
    // defended: inert engagement seam (Plan 3 resolves)
    army.state = 'contested';
    const attackers = state.armies.filter((a) => a.target === tile.id && a.state === 'contested').map((a) => a.id).sort();
    state.events.push({ t: 'contested', tile: tile.id, attackers });
  }
}
```
(Capturing frees the slot — `target` cleared. A contested army keeps `target` (holds its slot). An army arriving at a tile that became player-owned mid-travel just garrisons, no capture event.)

- [ ] **Step 4: Verify + commit** — focused tests PASS; `npm test`; typecheck; full parity (13 unchanged).
```bash
git commit -m "feat(sim): conquest travel (tempo gauge) + arrival capture/contested seam …"  # + trailer
```

---

## Task 4: `Retreat` command

**Files:** Modify `sim/conquest-map.ts`, `sim/conquest-map.test.ts`.

**Interfaces:** Consumes Task 2/3. Produces: retreat handling in `advance`'s command phase.

- [ ] **Step 1: Failing tests**
```ts
it('retreat a contested army: frees its slot and returns it to owned territory, then garrisoned', () => {
  // dispatch a1 to defended t2; advance to contested; retreat; advance until it returns; assert:
  // state ends 'garrisoned' on an owned tile, target cleared, committedCount(t2) === 0, slotFreed + retreated events.
});
it('retreat a travelling army: frees slot, settles on its current owned tile', () => { /* … */ });
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** retreat in `advance`'s command phase (`sim/conquest-map.ts`)
```ts
// in the command loop:
if (c.t === 'retreat') applyRetreat(state, c.armyId);

function applyRetreat(state: MapState, armyId: string): void {
  const army = state.armies.find((a) => a.id === armyId);
  if (!army || (army.state !== 'travelling' && army.state !== 'contested')) {
    state.events.push({ t: 'rejected', armyId, reason: 'not-recallable' }); return;
  }
  const wasTarget = army.target;
  army.target = undefined;                         // free the slot immediately
  if (wasTarget) state.events.push({ t: 'slotFreed', tile: wasTarget, armyId });
  const cur = tileById(state, army.tile)!;
  if (cur.owner === 'player') {                     // already on owned soil → settle here
    army.state = 'garrisoned'; army.route = undefined; army.travelGauge = 0;
    state.events.push({ t: 'retreated', armyId, to: cur.id });
  } else {                                          // on an enemy tile (contested) → hop back to an owned neighbor
    const back = ownedNeighborIds(cur)[0];          // deterministic (N,S,E,W order); guaranteed to exist (it was the launch side)
    army.state = 'retreating'; army.route = back ? [back] : []; army.travelGauge = 0;
    // resolveArrival (Task 3) sets it 'garrisoned' when it lands on `back`; emit retreated there.
  }
}
```
(For a contested army, retreat routes one hop back onto the owned launch tile, then `resolveArrival`'s retreating-branch garrisons it. Emit `retreated` when it settles — adjust `resolveArrival`'s retreating branch to push the `retreated` event.)

- [ ] **Step 4: Verify + commit** (suite/typecheck/parity — 13 unchanged).
```bash
git commit -m "feat(sim): conquest Retreat command — recall army + free slot …"  # + trailer
```

---

## Task 5: `runScriptedConquest` + version-aware `runReplay` + parity fixtures

**Files:** Modify `sim/replay.ts`, `sim/index.ts`, `tools/parity/fixtures.mjs`, `sim/replay.test.ts`.

**Interfaces:**
- Consumes: `initConquest`/`advance`/`hashMap` (Task 1–4); `ConquestBundle` (shared types).
- Produces: `runScriptedConquest(bundle): { hash: string; ticks: number }`; `runReplay` v3 branch.

- [ ] **Step 1: Failing tests** (`sim/replay.test.ts`)
```ts
it('runReplay still routes v1/v2 unchanged (golden 86e238c1)', () => {
  expect(runReplay({ version: 1, setup: canonicalSetup, seed: 42 }).hash).toBe('86e238c1');
});
it('runScriptedConquest runs a dispatch→travel→capture scenario deterministically', () => {
  const r = runScriptedConquest({ version: 3, setup: mapWithUndefendedTarget, seed: 0,
    script: [{ atTick: 0, commands: [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }] }] });
  expect(typeof r.hash).toBe('string'); expect(r.ticks).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** (`sim/replay.ts`)
```ts
import { initConquest, advance, hashMap } from './conquest-map';
import type { ConquestBundle } from '../shared/types';

const CONQUEST_MAX_TICKS = 100_000;
export function runScriptedConquest(bundle: ConquestBundle): { hash: string; ticks: number } {
  const s = initConquest(bundle.setup);
  const cmdsAt = (t: number) => bundle.script.filter((a) => a.atTick === t).flatMap((a) => a.commands);
  const pending = () => s.armies.some((a) => a.state === 'travelling' || a.state === 'retreating')
    || bundle.script.some((a) => a.atTick >= s.totalTicks);
  while (pending() && s.totalTicks < CONQUEST_MAX_TICKS) advance(s, cmdsAt(s.totalTicks));
  return { hash: hashMap(s), ticks: s.totalTicks };
}
export function runReplay(bundle: ReplayBundle | ScriptedFightBundle | ConquestBundle): ReplayResult {
  if (bundle.version === 3) { const r = runScriptedConquest(bundle); return { hash: r.hash, ticks: r.ticks }; }
  const r = bundle.version === 2 ? runScriptedFight(bundle) : runTileFight(bundle.setup, bundle.seed);
  return { hash: r.hash, winner: r.winner, ticks: r.ticks, endReason: r.endReason };
}
```
Export `runScriptedConquest` from `sim/index.ts`. (Quiescence: stop once no army is travelling/retreating and no scripted command remains at or beyond the current tick.) **No change** to `parity.mjs`/`run-node.mjs`/`main.go`.

- [ ] **Step 4: Add 2 v3 parity fixtures** (`tools/parity/fixtures.mjs`, capture procedure): `conquest-capture-seedN` (dispatch → travel across owned tiles → capture an undefended tile) and `conquest-contested-seedN` (dispatch → travel → contested at a defended tile, unresolved). Capture hashes; confirm the 13 fight hashes unchanged.

- [ ] **Step 5: Verify + commit** — `npm test`; typecheck; full parity **15 fixtures** (13 fight unchanged incl. `86e238c1`, +2 conquest), V8===goja.
```bash
git commit -m "feat(sim): runScriptedConquest + v3 runReplay + conquest parity fixtures …"  # + trailer
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** map model + init + hashMap (T1) ✓; advance + dispatch + BFS + commit slots (T2) ✓; travel (tempo gauge) + arrival capture/contested seam (T3) ✓; retreat (T4) ✓; runScriptedConquest + v3 runReplay + parity (T5) ✓. RNG-free, integer, id-ordered determinism (every task) ✓; engine doesn't import the fight (only `deriveStats`) ✓.
- **Type consistency:** `MapTile`/`Army`/`MapSetup`/`MapState`/`MapCommand`/`MapEvent`/`ConquestBundle` defined once in T1 and reused; `advance`/`slowestTempo`/`committedCount`/`bfsRoute`/`resolveArrival`/`runScriptedConquest` signatures stable across tasks; `ReplayResult.winner?`/`endReason?` optional (T1) and the v3 branch returns `{hash, ticks}` (T5).
- **Placeholders:** none — `bfsRoute`/`ownedNeighborIds` bodies are described precisely (BFS over owned tiles, fixed `N,S,E,W` expansion, id-keyed visited, reconstruct path) rather than pasted line-by-line; `expectedHash:'PENDING'` is the capture sentinel (T5). Test helpers (`setup`/`setupWithT1Owned`/`mapWithUndefendedTarget`) are described with their tile topology.
- **Determinism:** no RNG anywhere in the control layer; `tiles`/`armies` id-sorted; commands sorted (`t`, then `armyId`); BFS deterministic; `travelGauge`/`route` unhashed; the 13 fight fixtures live in a separate engine and stay green; the 2 new fixtures are `version:3` and don't touch them.
