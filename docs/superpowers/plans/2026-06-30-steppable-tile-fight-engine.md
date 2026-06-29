# Steppable Tile-Fight Engine + Join/Leave Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `runTileFight` into a steppable `FightState`/`stepFight` engine and add `joinFight` (deploy mid-fight, act next boundary) + `orderRetreat` (move to exit edge, hittable, exit) hooks — standalone fights byte-identical so golden `86e238c1` + all 11 fixtures stay frozen.

**Architecture:** `FightState` carries what today's `runTileFight` holds in locals (`units/grid/rng/events/totalTicks/outcome`). `stepFight` is exactly one iteration of today's loop (same activation order, same RNG draws). `runTileFight` becomes a `init → while(!outcome) step → fightResult` wrapper. Join/retreat are map-agnostic (cell positions + an edge). A version-aware `runReplay` (v1→`runTileFight`, v2→`runScriptedFight`) keeps the parity harness untouched while a new `runScriptedFight` driver parity-locks the hooks in isolation.

**Tech Stack:** TypeScript (strict, ES2015 target), Vitest, esbuild bundle, goja (Go) parity runner. Sim is pure / integer-only / goja-safe.

## Global Constraints

- **Parity-critical** (`/sim`, `/shared`): integer math only — no floats, no `Math.sqrt`, no `Math.random`, no `Date`, no Node APIs. Seeded RNG via `makeRng` only.
- **Standalone byte-identity is the prime directive.** A fight with NO mid-fight join/retreat MUST produce identical events + hash to today. `canonical-baseSetup-seed42` MUST stay `86e238c1`; all 11 fixtures stay green. Any divergence = the refactor is wrong (fix it, never re-pin).
- The 11 current fixtures: canonical `86e238c1`, ranged-wall `1123ceff`, skill-cast `b621e99d`, reckless-duel `c28a905a`, coward-kite `43d92801`, headstrong-charge `db26f7c9`, stupid-misfire `e7eaf7bb`, luckyfool-retarget `068a1267`, cleave-cluster `57f7a0ff`, cleave-valve `b028690d`, personality-tiebreak `8d2831ec`.
- **Total-order sorts** end in a unique `id` tiebreak. **Transient state unhashed** (`gauge`, `mana`, `kills`, `stallSinceTick`, `fleeingSinceTick`; new `retreating`, `exited` follow the same rule — `hashFight` keeps id/side/pos/hp + ticks unchanged).
- New optional `Unit`/filter fields must be vacuously inert for standalone units: `!u.exited` is `true` when `exited` is undefined, so adding `&& !u.exited` to a filter changes nothing for fights without retreat.
- All balance/behaviour constants stay integers in `shared/config.ts`. Correctness depends on formulas, not values.
- **Go toolchain for full parity:** prepend `export PATH="/c/Program Files/Go/bin:$PATH"` before `npm run parity`.
- **Commits:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

### Standard commands (every task)
- Focused test: `npx vitest run sim/<file>.test.ts`
- Full suite: `npm test` (currently 121 tests / 11 files; grows per task)
- Types: `npm run typecheck`
- Parity (full): `export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity` → expect `PARITY OK (V8 === goja === expected) for N fixture(s).` with `canonical-baseSetup-seed42` = **86e238c1**.

### Fixture capture procedure (Task 4)
1. Add `{ name, expectedHash: 'PENDING', bundle: {...} }` to `tools/parity/fixtures.mjs`.
2. `npm run parity` prints `V8 mismatch [<name>]: <ACTUAL> !== PENDING`.
3. Set `expectedHash` to `<ACTUAL>`; re-run full parity → `PARITY OK`. Confirm the 11 existing hashes are unchanged.

---

## File Structure

- **Modify `shared/types.ts`** — `Edge`; `Unit.retreating?`/`exited?`; `FightResult.survivors[].retreated?`; `ScriptedFightBundle` + `FightScriptAction`; `MoveMode` gains `'retreat'` (in `sim/decide.ts`). (`FightState` lives in `sim/tile-fight.ts`, not here.)
- **Modify `sim/tile-fight.ts`** — `FightState`/`initFight`/`stepFight`/`fightResult`; `runTileFight` wrapper; `joinFight`; `orderRetreat`; retreat-movement + exit detection; exited-unit filters.
- **Modify `sim/decide.ts`** — top-precedence retreat branch in `decideTurn`; `'retreat'` move mode; `&& !u.exited` in enemy filters.
- **Modify `sim/initiative.ts`** — `nextActor` skips `exited` units.
- **Modify `sim/replay.ts`** — `runReplay` version-aware; add `runScriptedFight`.
- **Modify `sim/index.ts`** — export `runScriptedFight` (and the new engine entries if useful).
- **Modify `tools/parity/fixtures.mjs`** — +2 fixtures (join, retreat). (No change to `parity.mjs`/`run-node.mjs`/`main.go` — they call `Sim.runReplay`, now version-aware.)
- Co-located `*.test.ts` throughout.

---

## Task 1: Behavior-preserving step refactor

Extract today's loop into `FightState`/`initFight`/`stepFight`; `runTileFight` becomes a wrapper. NO behavior change.

**Files:**
- Modify: `sim/tile-fight.ts`, `shared/types.ts`
- Test: `sim/tile-fight.test.ts` (add step-equivalence + keep golden), `sim/replay.test.ts` (golden unchanged)

**Interfaces:**
- Consumes: everything `runTileFight` already imports.
- Produces (later tasks rely on these):
  ```ts
  // sim/tile-fight.ts (NOT shared/types.ts — FightState.grid:Grid would force a shared->sim import)
  export interface FightState {
    units: Unit[]; grid: Grid; rng: Rng; events: FightEvent[];
    totalTicks: number; outcome: { winner: Side | 'draw'; endReason: EndReason } | null;
  }
  export function initFight(setup: FightSetup, seed: number): FightState;
  export function stepFight(state: FightState): FightState; // one activation; mutates+returns; sets outcome when decided
  export function fightResult(state: FightState): FightResult;
  export function runTileFight(setup: FightSetup, seed: number): FightResult; // wrapper (unchanged signature)
  ```
  `Grid` is imported from `./grid`; `Rng` from `../shared/rng`. `FightState` imports `Grid` via `import type` (types.ts may type `grid` structurally or re-export — keep `Grid`/`Rng` types where they live; `shared/types.ts` already has no sim imports, so define `FightState` in `sim/tile-fight.ts` instead if a `shared→sim` import would result. **Define `FightState` in `sim/tile-fight.ts`** and export it from there to avoid `shared/types.ts` importing from `/sim`.)

- [ ] **Step 1: Add the step-equivalence test FIRST** (`sim/tile-fight.test.ts`)

```ts
import { initFight, stepFight, fightResult, runTileFight } from './tile-fight';
// Reuse an existing fixture-like setup from this test file (e.g. the canonical 2-melee setup).
it('stepping to completion equals runTileFight (same hash, winner, events)', () => {
  const setup = /* the canonical baseSetup used by the golden test */;
  const direct = runTileFight(setup, 42);
  const s = initFight(setup, 42);
  while (!s.outcome) stepFight(s);
  const stepped = fightResult(s);
  expect(stepped.hash).toBe(direct.hash);
  expect(stepped.winner).toBe(direct.winner);
  expect(stepped.ticks).toBe(direct.ticks);
  expect(stepped.events).toEqual(direct.events);
});
```
(Once the refactor lands, `runTileFight` IS this loop, so this asserts the public API + the wrapper agree — and the golden test below is the real guard.)

- [ ] **Step 2: Run it** — `npx vitest run sim/tile-fight.test.ts` → FAIL (`initFight`/`stepFight`/`fightResult` not exported).

- [ ] **Step 3: Refactor `sim/tile-fight.ts`** — mechanical lift, preserving order/draws exactly.

```ts
export interface FightState {
  units: Unit[]; grid: Grid; rng: Rng; events: FightEvent[];
  totalTicks: number; outcome: { winner: Side | 'draw'; endReason: EndReason } | null;
}

export function initFight(setup: FightSetup, seed: number): FightState {
  const rng = makeRng(seed);
  const grid = makeGrid(setup.grid);
  const units: Unit[] = setup.units.map((u) => { /* …current unit-init verbatim… */ });
  return { units, grid, rng, events: [], totalTicks: 0, outcome: null };
}

export function stepFight(state: FightState): FightState {
  const { units, grid, rng } = state;
  // recreate today's local closures over state (verbatim bodies, units→state.units etc.):
  const occupied = (c, selfId) => units.some(...);
  const inAttackPosition = (actor, target) => ...;
  const addMana = (u, amount) => { u.mana = Math.min(...); };
  const sidesAlive = () => ({ a: units.some(u => u.hp>0 && !u.exited && u.side==='A'), b: ... });
  //  ^ NOTE: keep '&& !u.exited' OUT in Task 1 (no exited yet) OR include it — it's vacuously true.
  //    To minimize Task 3's diff, include '&& !u.exited' now; it does not change standalone behavior.

  // ---- ONE loop iteration (today's body), with `break`→finalize and `continue`→return ----
  const alive = sidesAlive();
  if (!alive.a || !alive.b) { finalize(state, sidesAlive); return state; }
  const na = nextActor(units);
  if (na === null) { finalize(state, sidesAlive); return state; }
  state.totalTicks += na.ticks;
  if (state.totalTicks > MAX_TICKS) { finalize(state, sidesAlive); return state; }
  const actor = na.actor;
  actor.gauge -= TEMPO_THRESHOLD;
  // … flee-clock, ctx, decideTurn, movement, action — ALL copied verbatim from the current loop,
  //   with every `continue;` replaced by `return state;` and `events`→`state.events`,
  //   `totalTicks`→`state.totalTicks`, `ctx = { totalTicks: state.totalTicks, units, grid }`. …
  return state;
}

// finalize: compute winner/endReason from sidesAlive and push the single 'end' event (once).
function finalize(state: FightState, sidesAlive: () => {a:boolean;b:boolean}): void {
  const fin = sidesAlive();
  const winner: Side|'draw' = fin.a && !fin.b ? 'A' : fin.b && !fin.a ? 'B' : 'draw';
  const endReason: EndReason = winner !== 'draw' ? 'decisive' : fin.a && fin.b ? 'timeout' : 'wipe';
  state.outcome = { winner, endReason };
  state.events.push({ t: 'end', winner, ticks: state.totalTicks, endReason });
}

export function fightResult(state: FightState): FightResult {
  return {
    winner: state.outcome!.winner, ticks: state.totalTicks, endReason: state.outcome!.endReason,
    survivors: state.units.filter((u) => u.hp > 0).map((u) => ({ id: u.id, side: u.side, hp: u.hp })),
    events: state.events, hash: hashFight(state.units, state.totalTicks),
  };
}

export function runTileFight(setup: FightSetup, seed: number): FightResult {
  const s = initFight(setup, seed);
  while (!s.outcome) stepFight(s);
  return fightResult(s);
}
```
**Critical:** the activation body (flee-clock → `decideTurn` → movement → action incl. every RNG draw) is copied **verbatim** — do not reorder anything. The only transformations are: locals→`state.*`, `break`→`finalize(...)+return`, `continue`→`return state`. `finalize` pushes the `'end'` event exactly once (when outcome is first set), matching today's single post-loop push.

- [ ] **Step 4: Verify byte-identity** — `npx vitest run sim/tile-fight.test.ts sim/replay.test.ts` (golden `86e238c1` unchanged + step-equivalence passes); `npm test`; `npm run typecheck`; `export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity` → `PARITY OK … for 11 fixture(s)` with canonical **86e238c1**.

- [ ] **Step 5: Commit**
```bash
git add sim/tile-fight.ts shared/types.ts sim/tile-fight.test.ts
git commit -m "$(cat <<'EOF'
refactor(sim): steppable FightState/stepFight engine (behavior-preserving)

runTileFight is now init -> while(!outcome) stepFight -> fightResult. One
activation per step, same order + RNG draws. Golden 86e238c1 + 11 fixtures
unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Join hook

**Files:** Modify `sim/tile-fight.ts`; Test `sim/tile-fight.test.ts`.

**Interfaces:**
- Consumes: `FightState`, `initFight`, `stepFight` (Task 1).
- Produces: `export function joinFight(state: FightState, specs: UnitSpec[]): void;`

- [ ] **Step 1: Failing tests** (`sim/tile-fight.test.ts`)
```ts
it('a joiner deploys at gauge 0 and first acts at the next turn boundary', () => {
  // initFight a 1v1 on a wide grid; step until the lone A unit has acted at least once;
  // joinFight a second A unit at a far cell; continue stepping.
  // Assert: the joiner's id appears in a 'move' or 'attack' event ONLY after a subsequent
  // tempo fill (not on the activation immediately following the join), and it participates
  // in the final outcome (units length increased; joiner can deal damage).
});
it('a fight with no joinFight call is byte-identical to runTileFight', () => {
  const setup = /* small setup */;
  const direct = runTileFight(setup, 7);
  const s = initFight(setup, 7); while (!s.outcome) stepFight(s);
  expect(fightResult(s).hash).toBe(direct.hash);
});
```

- [ ] **Step 2: Run** → FAIL (`joinFight` not exported).

- [ ] **Step 3: Implement** (`sim/tile-fight.ts`)
```ts
export function joinFight(state: FightState, specs: UnitSpec[]): void {
  for (const u of specs) {
    const derived = deriveStats(u.attrs, u.attackKind);
    state.units.push({
      id: u.id, side: u.side, attrs: { ...u.attrs }, priority: u.priority,
      pos: { x: u.pos.x, y: u.pos.y }, hp: derived.maxHp, derived, gauge: 0, mana: 0, skill: u.skill,
      traits: u.traits ?? [], kills: 0, stallSinceTick: -1, fleeingSinceTick: -1,
      temperament: u.personality?.temperament,
    });
  }
}
```
(Identical unit construction to `initFight`'s `.map`. `gauge: 0` ⇒ `nextActor` only selects the joiner once tempo fills ⇒ acts at the next boundary. Factor the shared unit-construction into a `specToUnit(u)` helper used by both `initFight` and `joinFight` to keep them DRY.)

- [ ] **Step 4: Verify + commit** — focused test PASS; `npm test`; typecheck; full parity (11 fixtures, anchor 86e238c1 — no fixtures use join yet).
```bash
git commit -m "feat(sim): joinFight — deploy units mid-fight, act at next boundary …"  # + trailer
```

---

## Task 3: Retreat hook (+ Bloodthirsty suppression)

**Files:** Modify `sim/tile-fight.ts`, `sim/decide.ts`, `sim/initiative.ts`, `shared/types.ts`; Test `sim/tile-fight.test.ts`, `sim/decide.test.ts`.

**Interfaces:**
- Consumes: `FightState`, `hasTrait`, `stepToward`, `chebyshev`, `decideTurn`.
- Produces:
  ```ts
  export type Edge = 'N' | 'S' | 'E' | 'W';                 // shared/types.ts
  // Unit gains: retreating?: Edge; exited?: boolean;
  // FightResult.survivors[] gains: retreated?: boolean;     // present (true) only on exited units
  // MoveMode (sim/decide.ts) gains 'retreat'
  export function orderRetreat(state: FightState, unitId: string, exitEdge: Edge): void; // tile-fight.ts
  ```

- [ ] **Step 1: Types** — `shared/types.ts`: add `Edge`; `Unit.retreating?: Edge`; `Unit.exited?: boolean`; `FightResult.survivors` element gains `retreated?: boolean`. `sim/decide.ts`: `MoveMode = 'engage' | 'flee' | 'retreat'`.

- [ ] **Step 2: Failing tests** (`sim/decide.test.ts` + `sim/tile-fight.test.ts`)
```ts
// decide.test.ts — retreat is top precedence, suppressed by Bloodthirsty:
it('a retreating unit returns move=retreat (no target)', () => {
  const u = unit('a','A',3,3); u.retreating = 'W';
  expect(decideTurn(u, ctx([u, enemy])).move).toBe('retreat');
});
it('Bloodthirsty ignores a retreat order', () => {
  const u = unit('a','A',3,3); u.retreating = 'W'; u.traits = ['bloodthirsty'];
  expect(decideTurn(u, ctx([u, enemy])).move).not.toBe('retreat'); // engages instead
});
// tile-fight.test.ts — retreats to the edge, hittable, exits as a retreated survivor:
it('an ordered unit moves to its exit edge and exits as a retreated survivor', () => {
  // initFight; orderRetreat(state, 'a', 'W'); step to completion;
  // assert unit 'a' reached x===0 then is absent from active play, and
  // fightResult().survivors includes { id:'a', …, retreated: true }.
});
```

- [ ] **Step 3: Implement**
  - `sim/decide.ts` — at the TOP of `decideTurn`, before `cowardFlees`:
    ```ts
    if (actor.retreating && !hasTrait(actor, 'bloodthirsty')) {
      return { targetId: null, move: 'retreat', charge: false };
    }
    ```
    Add `&& !u.exited` to the enemy filters in `chooseTarget`, `nearestEnemy`, `cleaveTargets` (vacuously true for non-exited).
  - `sim/initiative.ts` — `nextActor` alive filter becomes `u.hp > 0 && !u.exited`.
  - `sim/tile-fight.ts`:
    - `sidesAlive`/`occupied`/`inAttackPosition` enemy checks exclude `exited` (`&& !u.exited`).
    - `orderRetreat(state, unitId, exitEdge)`: `const u = state.units.find(x => x.id === unitId); if (u) u.retreating = exitEdge;`
    - In `stepFight`, handle `intent.move === 'retreat'` (mirrors the `'flee'` block): compute the nearest exit cell on `actor.retreating` (`'W'`→`{x:0,y:actor.pos.y}`, `'E'`→`{x:grid.width-1,y}`, `'N'`→`{x,y:0}`, `'S'`→`{x,y:grid.height-1}`), `stepToward` it up to `moveRange` (emit `move` events; no attack); then if the actor is on the exit edge (`x===0` for W, etc.), set `actor.exited = true`. `return state`.
    - `fightResult`: survivors map includes exited units; set `retreated: true` for `u.exited`, omit otherwise:
      `survivors: state.units.filter(u => u.hp > 0).map(u => u.exited ? { id:u.id, side:u.side, hp:u.hp, retreated:true } : { id:u.id, side:u.side, hp:u.hp })`.

- [ ] **Step 4: Verify + commit** — focused tests PASS; `npm test`; typecheck; full parity **11 fixtures unchanged** (no fixture retreats yet; `!u.exited`/retreat branch are inert for them — confirm canonical 86e238c1).
```bash
git commit -m "feat(sim): orderRetreat — exit-edge pullout, hittable, exits; Bloodthirsty ignores …"  # + trailer
```

---

## Task 4: `runScriptedFight` driver + parity fixtures

**Files:** Modify `shared/types.ts`, `sim/replay.ts`, `sim/index.ts`, `tools/parity/fixtures.mjs`; Test `sim/replay.test.ts`.

**Interfaces:**
- Consumes: `initFight`, `stepFight`, `fightResult`, `joinFight`, `orderRetreat` (Tasks 1–3).
- Produces:
  ```ts
  // shared/types.ts
  export interface ScriptedFightBundle { version: 2; setup: FightSetup; seed: number; script: FightScriptAction[]; }
  export type FightScriptAction =
    | { atActivation: number; kind: 'join'; specs: UnitSpec[] }
    | { atActivation: number; kind: 'retreat'; unitId: string; exitEdge: Edge };
  // sim/replay.ts
  export function runScriptedFight(bundle: ScriptedFightBundle): FightResult;
  export function runReplay(bundle: ReplayBundle | ScriptedFightBundle): ReplayResult; // version-aware
  ```

- [ ] **Step 1: Failing test** (`sim/replay.test.ts`)
```ts
it('runReplay routes a v1 bundle exactly as before (golden unchanged)', () => {
  expect(runReplay({ version: 1, setup: canonicalSetup, seed: 42 }).hash).toBe('86e238c1');
});
it('runScriptedFight applies a join at the stamped activation', () => {
  const r = runScriptedFight({ version: 2, setup: smallSetup, seed: 5,
    script: [{ atActivation: 3, kind: 'join', specs: [joinerSpec] }] });
  expect(r.events.some(e => e.id === joinerSpec.id)).toBe(true);
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** (`sim/replay.ts`)
```ts
export function runScriptedFight(bundle: ScriptedFightBundle): FightResult {
  const s = initFight(bundle.setup, bundle.seed);
  let activation = 0;
  const actions = bundle.script; // applied by atActivation; ties broken by array order
  while (!s.outcome) {
    // apply any actions stamped for this activation index, in array order, BEFORE the step
    for (const a of actions) {
      if (a.atActivation !== activation) continue;
      if (a.kind === 'join') joinFight(s, a.specs);
      else orderRetreat(s, a.unitId, a.exitEdge);
    }
    stepFight(s);
    activation++;
  }
  return fightResult(s);
}
export function runReplay(bundle: ReplayBundle | ScriptedFightBundle): ReplayResult {
  const r = bundle.version === 2 ? runScriptedFight(bundle) : runTileFight(bundle.setup, bundle.seed);
  return { hash: r.hash, winner: r.winner, ticks: r.ticks, endReason: r.endReason };
}
```
(Import `initFight`/`stepFight`/`fightResult`/`joinFight`/`orderRetreat` from `./tile-fight`.) Export `runScriptedFight` from `sim/index.ts`. **No change** to `parity.mjs`/`run-node.mjs`/`goja-runner/main.go` — they call `Sim.runReplay`, now version-aware.

- [ ] **Step 4: Add 2 parity fixtures** (`tools/parity/fixtures.mjs`, capture procedure). Both `version: 2` bundles:
  - `scripted-join-seedN`: a 1v1 where an A reinforcement joins at a stamped activation and turns the result; capture hash.
  - `scripted-retreat-seedN`: a unit ordered to retreat that crosses to its edge, takes a hit en route, and exits; capture hash.

- [ ] **Step 5: Verify + commit** — `npm test`; typecheck; full parity **13 fixtures** (11 unchanged incl. anchor 86e238c1, + 2 new), V8 === goja.
```bash
git commit -m "feat(sim): runScriptedFight driver + version-aware runReplay + join/retreat fixtures …"  # + trailer
```

---

## Task 5: End-to-end integration test + cleanup

**Files:** Test `sim/tile-fight.test.ts` (or a new `sim/scripted-fight.test.ts`); minor tidy only.

- [ ] **Step 1: Combined scenario test**
```ts
it('join then retreat: survivors distinguish on-field vs retreated', () => {
  // runScriptedFight with BOTH a join and a later retreat of a different unit.
  const r = runScriptedFight({ version: 2, setup, seed, script: [
    { atActivation: 2, kind: 'join', specs: [reinforcement] },
    { atActivation: 6, kind: 'retreat', unitId: 'someUnit', exitEdge: 'E' },
  ]});
  // assert: the retreated unit appears in survivors with retreated:true (if it exited),
  // on-field survivors have no `retreated` flag, and the event stream is internally consistent
  // (the retreated unit emits move events toward x=width-1 and stops attacking).
});
```

- [ ] **Step 2: Run + full gate** — `npm test`; typecheck; full parity (13 fixtures, anchor 86e238c1).

- [ ] **Step 3: Tidy** — if `specToUnit` wasn't extracted in Task 2, do it now (DRY `initFight`/`joinFight`); ensure no dead code; confirm `sim/index.ts` surface is coherent.

- [ ] **Step 4: Commit**
```bash
git commit -m "test(sim): end-to-end join+retreat scripted scenario; DRY unit construction …"  # + trailer
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** steppable core (T1) ✓; join (T2) ✓; retreat + Bloodthirsty suppression + exited filters + retreated-survivor reporting (T3) ✓; `runScriptedFight` + version-aware `runReplay` + parity fixtures (T4) ✓; end-to-end + DRY (T5) ✓. Anchor-frozen determinism guarded every task ✓.
- **Type consistency:** `FightState`/`Edge`/`ScriptedFightBundle`/`FightScriptAction`/`initFight`/`stepFight`/`fightResult`/`joinFight`/`orderRetreat`/`runScriptedFight` introduced once, reused with the same signatures; `MoveMode` gains `'retreat'` in T3 and is consumed by `stepFight`'s retreat branch; `survivors[].retreated?` defined T3, asserted T3/T5.
- **Placeholder scan:** `expectedHash:'PENDING'` is the intentional capture sentinel (resolved in T4); the verbatim-copy instruction in T1 references the *current* loop body in `sim/tile-fight.ts` (the implementer has the file) rather than re-pasting 160 lines — this is a faithful refactor, not a placeholder.
- **Determinism:** `FightState` lives in `sim/tile-fight.ts` (avoids `shared→sim` import); standalone fights byte-identical (verbatim activation body, `break`→finalize, `continue`→return, single `end` push); `!u.exited`/retreat branch vacuously inert for non-retreat fights; new fixtures are `version:2` and don't touch the 11 existing hashes; the parity gate runs every task.
