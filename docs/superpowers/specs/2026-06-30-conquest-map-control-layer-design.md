# Conquest-Map Control Layer — Design

Status: **draft for review** · drafted 2026-06-30 · **Plan 2 of the conquest-map arc** (arc = steppable engine [done] → **conquest-map control layer** → map↔fight integration). Implements the real-time map sub-engine from `2026-06-29-combat-rework-and-architecture-design.md` §3.6/§4.3–4.5 and GDD Part III ("Conquest map").

This is the **control-layer** sub-project: the map mechanics (tiles, armies, travel, commands, commit slots) as a clockless tick. The map↔fight integration (running the steppable fight on a contested tile and applying its outcome) is **Plan 3, out of scope here**.

---

## 1. Context & Goal

Plan 1 made the tile-fight engine steppable + join/leave-capable. The conquest map is the real-time strategy layer (Galcon/Northgard) that *wraps* those fights: a grid of tiles you conquer outward by dispatching armies across owned territory. There is currently **no map code** in the sim — only the fight engine.

**Goal:** build the deterministic, clockless map sub-engine — `advance(state, commands) → state` on a fixed tick — covering tiles + N/S/E/W adjacency + ownership, player armies, real-time per-tile travel across owned territory, the `DispatchArmy`/`Retreat` commands with validation + routing, and the 4-army commit cap. Capturing an **undefended** tile is fight-free (walk in → flip owner). A **defended** tile, on arrival, becomes *contested* and emits an event — the **engagement seam** Plan 3 fills with a real fight. Integer, seeded-RNG-free (the control layer draws no RNG), goja-bit-identical, with its own state hash + parity fixtures.

---

## 2. Scope

### 2.1 In scope
- **Map model** (given, not generated): tiles as a graph (`id`, `owner`, `N/S/E/W` neighbor ids, `type`, static `garrison`), consumed as a `MapSetup` like `FightSetup`.
- **Army model:** player armies (`id`, `units: UnitSpec[]`, `location`, `state`); enemy defenders are the tile's static `garrison` (alpha = **static garrisons**, no enemy map-AI).
- **Clockless tick** `advance(state, commands) → state`: process commands, advance travel, resolve arrivals, emit events. Deterministic, integer, goja-safe.
- **Travel:** discrete per-tile hops along a route of owned tiles, paced by a **travel gauge** fed by the army's slowest unit's tempo (mirrors the initiative gauge).
- **Commands:** `DispatchArmy{armyId, toTile, gate?}` (validate + deterministic BFS route over owned tiles + reserve a commit slot; also covers reinforcement) and `Retreat{armyId}` (recall + free slot).
- **4-army commit cap** per target tile (slot reserved the moment an army is dispatched; travelling counts).
- **Arrival handling:** undefended target ⇒ **capture** (flip owner, free slot, `TileCaptured`); defended target ⇒ **contested seam** (`TileContested` event; no resolution).
- **Determinism:** `hashMap(state)`; a scripted-command parity entry (`ConquestBundle`, dispatched by the version-aware `runReplay`); new parity fixtures; V8≡goja.

### 2.2 Out of scope (later in the arc / other sub-engines)
- **The fight on a contested tile** and applying its outcome (capture-on-win, attrition/survivors, reinforcement-queue rotation, retreat-during-fight) — **Plan 3** (the integration; it reuses the Plan-1 `stepFight`/`joinFight`/`orderRetreat` seam + the capture logic built here).
- **Run-orchestration** (campaign loop, objective/boss, rewards, extract/wipe, banking, Weary, tile *effects* like Rest/Cache) — a separate §4.3 sub-engine. Tiles carry a `type` field but Plan 2 implements no per-type effect.
- **Map generation** (`/meta`), enemy map-AI, command auras, scouting UI, multiplayer.

---

## 3. Approach (decided in brainstorming)

**A clockless, RNG-free, deterministic map state machine with an inert engagement seam.** `advance(state, commands)` is a pure `(state, commands) → state` per fixed tick; the control layer draws **no RNG** (routing is BFS, travel is an integer gauge, commands are validated deterministically). Player armies move; enemy defenders are static tile garrisons (alpha). Arrival at an **undefended** tile captures it fight-free (reusable capture logic); a **defended** tile becomes *contested* and emits an event — Plan 3 plugs the steppable fight into that seam. The map engine is **independent of the fight engine** (it references `UnitSpec` for army/garrison composition but never runs a fight in Plan 2), so the 13 fight fixtures + golden `86e238c1` are untouched. Parity reuses the established pattern: a version-aware `runReplay` gains a conquest branch, so the goja harness stays unchanged.

Rejected: a placeholder fight-resolution (throwaway, deleted in Plan 3 — and the user chose the inert seam); a rectangular-grid-only map (the tile-graph generalizes it); modelling enemy armies as movers (alpha is static garrisons); drawing RNG in the control layer (nothing needs it until the Plan-3 fight).

---

## 4. Data Model (`sim/conquest-map.ts`)

All map types (`MapEdge`/`TileOwner`/`TileType`/`MapTile`/`Army`/`MapSetup`/`MapState`/`MapEvent`/`MapCommand`/`ConquestBundle`) live in **`shared/types.ts`** with the other shared data shapes. Unlike `FightState` (forced into `sim/tile-fight.ts` by its `grid: Grid` field), the map types reference only `UnitSpec` + primitives — no `Grid`, no sim-only type — so they belong beside `FightSetup`/`ReplayBundle` and let `ConquestBundle` sit there too without a `shared→sim` import. The map *logic* (`initConquest`/`advance`/`hashMap`/commands/travel/arrival) lives in `sim/conquest-map.ts`.

```ts
export type TileOwner = 'player' | 'enemy' | 'neutral';
export type MapEdge = 'N' | 'S' | 'E' | 'W';
export type TileType = 'start' | 'enemy' | 'elite' | 'boss' | 'rest' | 'cache' | 'event' | 'recruit' | 'muster' | 'boon' | 'mysterious'; // stored; effects are run-loop (out of scope)

export interface MapTile {
  id: string;
  type: TileType;
  owner: TileOwner;
  neighbors: { N?: string; S?: string; E?: string; W?: string }; // neighbor tile ids
  garrison: UnitSpec[];           // static defenders (empty ⇒ undefended)
}

export type ArmyState = 'garrisoned' | 'travelling' | 'contested' | 'retreating';
export interface Army {
  id: string;
  units: UnitSpec[];
  tile: string;                   // current tile (where it sits / last hop)
  state: ArmyState;
  target?: string;                // commit target tile (set on dispatch)
  route?: string[];               // remaining tiles to hop through (incl. the target as last)
  travelGauge: number;            // accrues slowest-unit tempo each tick; hops at threshold
}

export interface MapSetup {
  tiles: MapTile[];
  armies: { id: string; side: 'player'; units: UnitSpec[]; tile: string }[]; // player armies + starting tiles
}

export interface MapState {
  tiles: MapTile[];               // mutable owners; iteration in id order
  armies: Army[];
  totalTicks: number;
  events: MapEvent[];
}
```

(`MapState` carries `events` accumulated across ticks, like `FightState`.) **Total order:** `tiles` and `armies` are kept sorted by `id`; all iteration/selection ends in an `id` tiebreak.

---

## 5. The Tick — `advance(state, commands)` (`sim/conquest-map.ts`)

```ts
export interface AdvanceResult { state: MapState; } // mutates + returns state
export function initConquest(setup: MapSetup): MapState;
export function advance(state: MapState, commands: MapCommand[]): MapState; // one fixed tick
```

One `advance` tick, in this fixed order (deterministic):
1. **Process commands** (sorted deterministically — see §6) — validate each; apply or emit a rejection event.
2. **Advance travel** — for each travelling/retreating army (id order): `travelGauge += slowestTempo(army)`; while `travelGauge >= TRAVEL_THRESHOLD`, subtract it and **hop** to the next tile in `route` (emit `ArmyHopped`); on consuming the last route entry, the army **arrives** (§7).
3. **Resolve arrivals** (handled inline at the hop that reaches the target).
4. Emit a per-tick boundary as needed.

`runConquest`/the scripted driver advances tick-by-tick (§8). The control layer never draws RNG.

**`slowestTempo(army)`** = the minimum `deriveStats(u.attrs, u.attackKind).tempoRate` over `army.units` (integer; reuses the existing `deriveStats`). `TRAVEL_THRESHOLD` is a `shared/config.ts` constant (tunable). This mirrors the initiative tempo gauge: faster armies (higher AGI) hop more often.

---

## 6. Commands (`sim/conquest-map.ts`)

```ts
export type MapCommand =
  | { t: 'dispatch'; armyId: string; toTile: string; gate?: MapEdge }
  | { t: 'retreat'; armyId: string };
```
Commands in a tick are applied in a **deterministic order** (sorted by a stable key: `t`, then `armyId`) so multi-command ticks are reproducible.

**`dispatch{armyId, toTile, gate?}`** — valid iff ALL hold (else emit `{t:'rejected', armyId, reason}` and ignore):
- the army exists, is the player's, and is `garrisoned` (not already travelling/contested/retreating);
- `toTile` exists and `owner !== 'player'`;
- `toTile` is adjacent to ≥1 **owned** tile (the launch tile); if `gate` is given, the owned neighbor on that edge must exist;
- `toTile`'s committed count `< MAX_COMMIT` (4);
- a path of **owned** tiles exists from the army's tile to the launch tile.

On validation: compute the route via **deterministic BFS** over owned tiles (neighbor expansion in fixed `N,S,E,W` order; shortest path, ties broken by that order) from `army.tile` to the launch tile, then append `toTile` as the final hop. Set `army.state='travelling'`, `army.target=toTile`, `army.route=[...ownedPath(excluding current), toTile]`, `army.travelGauge=0`. **Reserve a commit slot** (the army's `target` IS the reservation; committed count of a tile = number of armies with `target===tile` and state in {travelling, contested}). Emit `ArmyDispatched`. (Dispatching to an already-`contested` tile within the cap is **reinforcement** — same command.)

**`retreat{armyId}`** — for a travelling/contested player army: set `state='retreating'`, clear `target` (frees the slot → may emit `SlotFreed`), set `route` back toward the nearest owned tile (or its origin), travel there, then `garrisoned`. (Mid-fight vulnerable-pullout is the Plan-3 fight's `orderRetreat`; map-level retreat here recalls an army before/without resolution.)

---

## 7. Arrival — Capture vs Contested Seam (`sim/conquest-map.ts`)

When a travelling army consumes the last `route` entry (hops into `toTile`):
- **Undefended** (`toTile.garrison` is empty — there are no enemy armies in alpha): **capture** — `toTile.owner='player'`, the army becomes `garrisoned` on `toTile`, free its slot, emit `{t:'captured', tile, by:armyId}`. Capturing opens new fronts (the tile's neighbors are now attackable from an owned tile). *(This `capture(tile, byArmy)` helper is reused by Plan 3 after a won fight.)*
- **Defended** (`toTile.garrison` non-empty): **contested seam** — `army.state='contested'`, `army.tile=toTile`; emit `{t:'contested', tile, attackers:[armyIds], garrison}`. `advance` does **NOT** resolve it (no fight in Plan 2). The army stays `contested` (holding its slot) indefinitely; reinforcement (more dispatches, ≤cap) adds attackers; retreat pulls one out. Plan 3 replaces this no-op with a `stepFight`-driven resolution.

So Plan 2 delivers a complete fight-free conquest loop for undefended/neutral tiles, plus the deterministic dispatch→travel→commit→contact pipeline for defended tiles — everything up to the moment a fight would start.

---

## 8. Determinism, Hash & Parity (`sim/conquest-map.ts`, `sim/replay.ts`, `tools/parity/fixtures.mjs`)

- **`hashMap(state)`** — hashes the determinism-relevant state: each tile's `id:owner` (in id order) + each army's `id:tile:state:target` (in id order) + `totalTicks`. (Transient `travelGauge`/`route` are NOT hashed — like `gauge`/`mana` in the fight, their effect surfaces in tile/army positions/states. Garrison HP isn't modeled here.)
- **`ConquestBundle`** (envelope `version: 3`) + **`runScriptedConquest(bundle)`**: `{ version:3, setup: MapSetup, seed: number, script: { atTick: number; commands: MapCommand[] }[] }`. The driver `initConquest`s, then for each tick `t` from 0 calls `advance(state, commandsAt(t))` (the script's commands stamped `atTick === t`, else `[]`) until `maxTicks` or a quiescent state (no travelling/retreating armies and no remaining scripted commands); returns `{ hash: hashMap(state), ticks: state.totalTicks }`. (`seed` is carried for Plan 3's fights; the control layer is RNG-free, so Plan 2 hashes don't depend on it.)
- **Version-aware `runReplay`** gains a `version === 3 → runScriptedConquest` branch; `ReplayResult` broadens `winner?`/`endReason?` to optional (a conquest run returns `{hash, ticks}`). The goja parity harness (`parity.mjs`/`run-node.mjs`/`main.go`) is **UNCHANGED** — it calls `Sim.runReplay`, now handling v3. Export `runScriptedConquest` from `sim/index.ts`.
- **New parity fixtures** (v3, captured + V8≡goja): a **travel+undefended-capture** scenario (dispatch an army across owned tiles to an undefended tile → captured) and a **contested-seam** scenario (dispatch to a defended tile → contested, slot reserved, no resolution). The 13 fight fixtures + golden `86e238c1` are untouched (separate engine).
- Integer-only, no `Math.random`/`Date`/floats/Node APIs in `/sim`. Deterministic command ordering + BFS + id-ordered iteration.

---

## 9. Files & Testing (task decomposition)

Each task: TDD, sonnet implementer + sonnet spec/quality reviewer, fix Critical/Important, opus whole-branch review at the end.

1. **Map model + `initConquest` + `hashMap`** — types (`MapTile`/`Army`/`MapSetup`/`MapState`/`MapEdge`/`TileOwner`/`TileType`), `initConquest(setup)`, `hashMap(state)`. Tests: init shapes; hash stable + order-independent of input ordering (sorted by id); a tile-graph helper for tests.
2. **`advance` skeleton + travel** — the tick loop, `slowestTempo`, the travel gauge + hops along a `route`, `ArmyHopped` events. Tests: an army with a pre-set route hops at the right cadence (faster army hops sooner); arrives (route exhausted) → handled by Task 4.
3. **`dispatch` command + BFS routing + commit slots** — validation, deterministic BFS over owned tiles, route construction, slot reservation, `MAX_COMMIT` cap, `ArmyDispatched`/`rejected` events. Tests: valid dispatch routes correctly; rejects (non-adjacent-to-owned / cap-full / no-owned-path / not-your-army / already-busy); cap enforced; BFS is shortest + deterministic.
4. **Arrival: capture vs contested seam** — undefended ⇒ `capture(tile, byArmy)` (owner flip, slot free, `TileCaptured`); defended ⇒ `contested` + `TileContested` (no resolution). Tests: undefended capture flips owner + opens fronts; defended → contested, slot held, unresolved; reinforce a contested tile (≤cap).
5. **`retreat` command** — recall a travelling/contested army, free its slot, travel back, `garrisoned`. Tests: retreat frees the slot + returns the army; `SlotFreed`.
6. **`runScriptedConquest` + version-aware `runReplay` + parity fixtures** — envelope v3, the scripted driver, the `runReplay` v3 branch (harness untouched), `sim/index.ts` export, 2 captured v3 fixtures. Tests: v1/v2 unchanged (golden 86e238c1, 13 fight fixtures); the 2 conquest fixtures V8≡goja.

**Changed:** `shared/types.ts` (all map types: `MapEdge`/`TileOwner`/`TileType`/`MapTile`/`Army`/`MapSetup`/`MapState`/`MapEvent`/`MapCommand`/`ConquestBundle`; `ReplayResult.winner?`/`endReason?` made optional), `sim/conquest-map.ts` (new — `initConquest`/`advance`/`hashMap` + command/travel/arrival logic), `sim/conquest-map.test.ts` (new), `shared/config.ts` (`TRAVEL_THRESHOLD`, `MAX_COMMIT`), `sim/replay.ts` (+`runScriptedConquest`, version-aware `runReplay`), `sim/index.ts` (export `runScriptedConquest`), `tools/parity/fixtures.mjs` (+2 v3 fixtures). Co-located tests.

---

## 10. Risks & Mitigations
- **Non-deterministic command/iteration order across V8/goja** — the central risk. Mitigated by sorting commands by a stable key, keeping `tiles`/`armies` id-sorted, fixed `N,S,E,W` BFS expansion, and id-tiebroken selection everywhere; the conquest parity fixtures assert V8≡goja.
- **BFS tie-breaking divergence** — fixed neighbor-expansion order + a visited set keyed by id; the route is canonical. Tested with a multi-path map.
- **Travel-gauge float/overflow** — integer gauge + threshold (like the initiative gauge); no floats.
- **Engine coupling creep** — the map engine must NOT import the fight engine (it only references `UnitSpec` data); enforced by keeping `sim/conquest-map.ts` free of `tile-fight`/`stepFight` imports. Plan 3 will add the integration in a new seam, not by coupling here.
- **`ReplayResult` broadening** — making `winner`/`endReason` optional must not break v1/v2 consumers; the parity harness reads only `.hash`, and fight runs still populate all fields.

## 11. Open Knobs / Deferred
- `TRAVEL_THRESHOLD` / the tempo→hop mapping (Monte-Carlo balance later).
- Whether `gate` should pick among multiple owned launch neighbors deterministically when omitted (current: BFS-nearest, id-tiebroken) vs always require an explicit gate.
- Neutral-tile semantics beyond undefended-capture (e.g. neutral tiles that still must be "claimed" with a cost) — deferred to run-loop/generation.
- Whether retreat should route to the *origin* tile vs the *nearest* owned tile (current: nearest owned, deterministic).
- Per-tick event granularity for the eventual client IPC stream (Plan 3 / client).
