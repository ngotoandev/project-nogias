# Steppable Tile-Fight Engine + Join/Leave Hooks — Design

Status: **draft for review** · drafted 2026-06-30 · **Plan 1 of the conquest-map arc** (arc = steppable engine → conquest-map control layer → integration). Builds the fight-engine foundation the real-time conquest map's *continuous mid-fight reinforcement/retreat* will drive (`2026-06-29-combat-rework-and-architecture-design.md` §3.6, §4.3–4.4).

This is the **steppable-engine** sub-project. The conquest-map control layer (Plan 2) and the map↔fight integration (Plan 3) are out of scope here.

---

## 1. Context & Goal

The combat-depth arc (Plans 3–6) produced a deep, deterministic, parity-locked tile-fight: `runTileFight(setup, seed) → FightResult` runs a **self-contained battle start-to-finish** from a fixed setup. The next subsystem — the real-time conquest map — needs reinforcement and retreat to interact with a fight *as it happens*: the master spec's intent is that a newly-arrived army "deploys at its gate edge and is inserted into the tempo order at the next turn boundary," and a retreating army "spends its turns moving to its gate and exits, remaining hittable while pulling out." A monolithic run-to-completion fight can't express that.

**Goal:** refactor the engine so a fight can be **advanced one activation at a time** (`FightState` + `stepFight`) and units can **join** (deploy mid-fight, act at the next turn boundary) and **leave** (retreat to an exit edge, hittable, then exit) — *without changing standalone-fight behavior*. A fight with no mid-fight injections must remain **byte-identical** to today, so the golden `86e238c1` and all 11 parity fixtures stay frozen. The hooks are exercised and parity-locked in isolation (no map yet) via a small scripted-fight driver.

---

## 2. Scope

### 2.1 In scope
- **Steppable core:** `FightState`, `initFight(setup, seed)`, `stepFight(state)` (one activation), and `runTileFight(setup, seed)` re-expressed as a step-to-completion wrapper — behavior-preserving.
- **Join hook:** `joinFight(state, specs)` — derive + insert units at given deploy positions with `gauge = 0`; they act at the next turn boundary.
- **Retreat hook:** `orderRetreat(state, unitId, exitEdge)` — a highest-precedence `decideTurn` branch moving the unit to its exit edge (no attack), hittable en route, `exited` on arrival (reported as a retreated survivor). **Bloodthirsty ignores the order** (reuses the Plan 6 suppression).
- **Scripted-fight driver:** `runScriptedFight(bundle)` — an extended replay envelope with an optional `script` of activation-stamped join/retreat actions, producing a `FightResult` + hash. The parity/fixture vehicle for the hooks in isolation; the seam Plan 3's map will drive.
- New parity fixtures (a mid-fight join, a retreat-exit) locking the hooks **V8 ≡ goja**.

### 2.2 Out of scope (later in the arc)
- **The conquest map** — tiles, adjacency, ownership, army model, travel, the 4-army commit cap, Dispatch/Reinforce/Retreat *map* commands, the clockless map `advance` tick (Plan 2).
- **Map↔fight integration** — translating a map approach into gate→cell deploy positions, the per-map-tick step budget/pacing, building a fight from committed armies, and applying outcomes back to the map (Plan 3).
- **Map generation** (`/meta`), run-orchestration (separate §4.3 sub-engine), multiplayer.

---

## 3. Approach (decided in brainstorming)

**Behavior-preserving step extraction + map-agnostic hooks + a scripted driver for parity.** `stepFight` is exactly one iteration of today's `runTileFight` loop, so stepping to completion reproduces the same activation order and RNG draw sequence ⇒ a standalone fight is byte-identical and the anchor stays frozen (the same discipline as the Plan 6 decision-pipeline refactor). The join/retreat hooks are **map-agnostic** — they take explicit cell positions and an edge, not map "gates" — so the engine stays decoupled from the (unbuilt) map; Plan 3 supplies gate→cell mappings. The new hooks are proven cross-runtime *now* via `runScriptedFight` (a deterministic, bundle-level scenario) rather than waiting for the map, so join/leave determinism is locked before anything depends on it.

Rejected: rewriting the loop into a fundamentally new structure (risks RNG-order drift and a forced anchor re-pin); modelling gates/armies in the engine (couples it to the map — that's Plan 2/3); deferring join/leave parity to the integration plan (leaves the riskiest determinism unproven longest).

---

## 4. The Steppable Core (`sim/tile-fight.ts`, `shared/types.ts`)

```ts
export interface FightState {
  units: Unit[];
  grid: Grid;                 // runtime grid (from makeGrid)
  rng: Rng;                   // seeded; threads through — carries draw position
  events: FightEvent[];       // accumulated
  totalTicks: number;
  outcome: { winner: Side | 'draw'; endReason: EndReason } | null; // null = ongoing
}

export function initFight(setup: FightSetup, seed: number): FightState;
export function stepFight(state: FightState): FightState; // advances ONE activation; mutates + returns; sets outcome when decided
export function runTileFight(setup: FightSetup, seed: number): FightResult; // wrapper: init, while(!outcome) step, build result
```

`stepFight` performs exactly one iteration of today's loop, in the same order: (1) `sidesAlive` → set `outcome` if decided; (2) `nextActor` → set `outcome` (timeout/wipe) if null; (3) `totalTicks += ticks`, MAX_TICKS cap; (4) the activation (`gauge -= TEMPO_THRESHOLD`, `decideTurn`, move, act, the existing hit/crit/Mana/RNG draws). `runTileFight` loops `stepFight` until `outcome`, then builds the `FightResult` (`hashFight` over the same id/side/pos/hp subset). **No standalone behavior changes** ⇒ golden `86e238c1` and the 11 fixtures are unchanged.

---

## 5. Join Hook (`sim/tile-fight.ts`)

```ts
export function joinFight(state: FightState, specs: UnitSpec[]): void;
```
Derives each spec into a `Unit` exactly as `initFight` does (`deriveStats`, full HP, `gauge = 0`, `mana = 0`, trait/personality fields, `kills/stallSinceTick/fleeingSinceTick` defaults), at the spec's given `pos`, and appends to `state.units`. With `gauge = 0`, `nextActor` only selects a joiner once its tempo fills — so it **deploys then acts at the next turn boundary**, never mid-activation. Joiners participate in `sidesAlive`, targeting, and the outcome from that point. Called between `stepFight` calls. Multiple joiners in one call are appended in input order; all sorts that consume `units` already end in a unique `id` tiebreak, so ordering stays deterministic.

---

## 6. Retreat Hook (`sim/tile-fight.ts`, `sim/decide.ts`, `shared/types.ts`)

```ts
export type Edge = 'N' | 'S' | 'E' | 'W';   // grid edges: N=y0, S=y(h-1), W=x0, E=x(w-1)
export function orderRetreat(state: FightState, unitId: string, exitEdge: Edge): void; // sets unit.retreating = exitEdge
// Unit gains: retreating?: Edge;  exited?: boolean;   (both transient, not hashed beyond their pos/hp effects)
```

A **retreat branch evaluated at the very top of `decideTurn`** (before the trait → targeting → AI flow): if `actor.retreating` is set **and the unit is not Bloodthirsty** (predicate `retreating && !hasTrait('bloodthirsty')` — see below), the intent is to move toward the **nearest cell on that edge** (reuse `stepToward` toward the closest exit cell; no attack that turn). The unit **remains a valid target** for enemies while pulling out (it stays in `units` with `hp > 0`), so the GDD's "vulnerable pullout" holds. On reaching the exit edge, it is flagged `exited = true` and thereafter excluded from `sidesAlive`/targeting/activation (it has left the field). `fightResult` reports `exited` units as **retreated survivors** (distinct from on-field survivors), so the map (Plan 3) can recover them.

**Bloodthirsty ignores the retreat order** — "won't retreat / ignores pull-out orders" (GDD). The check reuses the exact Plan 6 suppression already applied to Coward's flee: a `bloodthirsty` unit's `retreating` flag never produces a flee/exit intent (it keeps fighting). This makes Bloodthirsty's downside observable for the first time.

(If a fight ends while a unit is mid-retreat but not yet `exited`, it is an on-field survivor as today — no special-casing.)

---

## 7. Scripted-Fight Driver & Parity (`sim/replay.ts`, `sim/index.ts`, `tools/parity/fixtures.mjs`)

The hooks must be proven **V8 ≡ goja** without the map. Extend the replay envelope and add a driver:

```ts
export interface ScriptedFightBundle {
  version: 2;                 // envelope bump; v1 (plain replay) still supported
  setup: FightSetup;
  seed: number;
  script: FightScriptAction[];
}
export type FightScriptAction =
  | { atActivation: number; kind: 'join'; specs: UnitSpec[] }
  | { atActivation: number; kind: 'retreat'; unitId: string; exitEdge: Edge };
export function runScriptedFight(bundle: ScriptedFightBundle): FightResult;
```
`runScriptedFight` runs `initFight`, then a `stepFight` loop counting activations; **before** the activation whose index matches an action's `atActivation`, it applies that action (`joinFight` / `orderRetreat`) — deterministic ordering when several share an index (apply in array order). It stops at `outcome` (or a script-bounded safety cap) and returns the `FightResult`. Added to `sim/index.ts` (the goja surface). `runReplay` (v1) is unchanged.

New `tools/parity/fixtures.mjs` entries (each captured + V8≡goja-verified): a **join** scenario (a unit deploys at a far edge mid-fight and changes the outcome) and a **retreat** scenario (a unit is ordered out, is hit en route, and exits as a retreated survivor) — plus, ideally, a **Bloodthirsty-ignores-retreat** assertion at unit-test level.

---

## 8. Determinism, Golden & Parity

- **Anchor `86e238c1` + all 11 fixtures frozen.** Standalone fights are byte-identical (same activation sequence, same RNG order); join/retreat only occur in new `runScriptedFight` scenarios. `sim/tile-fight.test.ts` / `sim/replay.test.ts` keep `86e238c1`; `npm run parity` re-verifies all existing fixtures every task.
- **New state is integer/goja-safe:** `retreating: Edge`, `exited: boolean`, deploy positions; `rng` threads through `FightState` (same object, same draw order). No floats / `Math.sqrt` / `Math.random` / `Date` / Node APIs.
- **New parity fixtures** (join, retreat) get fresh captured hashes via the existing capture procedure; `runScriptedFight` is exercised in both V8 and goja.
- The byte-identity of the refactor is the one real risk — guarded by the unchanged fixtures + the parity gate on every task.

---

## 9. Files & Testing (task decomposition)

Each task: TDD, sonnet implementer + sonnet spec/quality reviewer, fix Critical/Important, opus whole-branch review at the end.

1. **Behavior-preserving step refactor** — `FightState` + `initFight`/`stepFight`; `runTileFight` becomes the wrapper. Tests: standalone results/events/hash identical; golden `86e238c1` held; full parity green (the guardrail). No new behavior.
2. **Join hook** — `joinFight`; tests: a joiner deploys at `gauge 0`, first acts at the next boundary, participates in targeting/outcome; a no-join fight is unchanged.
3. **Retreat hook** — `Edge`, `Unit.retreating?/exited?`, the `decideTurn` highest-precedence retreat branch, exit detection, retreated-survivor reporting, **Bloodthirsty suppression**. Tests: ordered unit moves to its edge, is hittable en route, exits as retreated; Bloodthirsty ignores the order; flee/Coward behavior unchanged.
4. **`runScriptedFight` + fixtures** — envelope v2 + driver; add the join & retreat parity fixtures (captured hashes); `runReplay` v1 untouched; full parity green incl. the anchor.
5. **Integration test + cleanup** — an end-to-end scripted scenario combining join + retreat; confirm `FightResult` reports on-field vs retreated survivors correctly; tidy.

**Changed:** `shared/types.ts` (`FightState`, `Edge`, `Unit.retreating?/exited?`, `ScriptedFightBundle`/`FightScriptAction`, retreated-survivor shape), `sim/tile-fight.ts` (init/step/wrapper + join/retreat resolution + exit handling), `sim/decide.ts` (retreat precedence + Bloodthirsty suppression), `sim/replay.ts` + `sim/index.ts` (`runScriptedFight`), `tools/parity/fixtures.mjs` (+2 fixtures), co-located `*.test.ts`. `Unit` test helpers gain the new optional fields (optional ⇒ minimal churn).

---

## 10. Risks & Mitigations
- **Refactor drifts standalone behavior / RNG order** — the primary risk. Mitigated by keeping `stepFight` a literal one-iteration extraction (no reordering of draws), and by the 11 fixtures + golden test + parity gate failing loudly on any divergence (Task 1 is the guard).
- **Joiner inserted at the wrong moment** (mid-activation vs boundary) — `gauge = 0` + the existing `nextActor` tempo gate enforces "next boundary"; tested explicitly.
- **Retreat never reaching the edge** (blocked) — bounded by the existing MAX_TICKS cap; a stuck retreater simply remains an on-field survivor at fight end. Documented.
- **Envelope v2 vs v1 confusion** — `version` discriminates; `runReplay` stays v1-only, `runScriptedFight` v2; tests cover both.

## 11. Open Knobs / Deferred
- Per-map-tick **step budget** (how many `stepFight` calls per map tick) — a Plan 3 concern; here the wrapper runs to completion and `runScriptedFight` steps activation-by-activation.
- Gate→cell **deploy-position** computation and entry "stack-then-disperse" — Plan 3 (map approach → edge cells).
- Whether retreated survivors carry partial state (HP, Weary) into the run — run-orchestration, not here.
- Whether a future continuous fight should expose per-activation events to the map incrementally (vs the accumulated `events` list) — revisit in Plan 3 if the IPC stream needs it.
