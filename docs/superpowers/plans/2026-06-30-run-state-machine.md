# Run State Machine + Rest Healing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic `Run` state machine (`sim/run.ts`) wrapping the conquest-map: win on boss-tile capture, lose when forces are spent, `Extract` to bank-and-end, plus Rest-tile HP recovery (the first tile effect).

**Architecture:** A new `sim/run.ts` is the run-loop sub-engine; it imports *from* `conquest-map.ts` (one-way) and wraps `advance` — `conquest-map.ts` and `tile-fight.ts` stay untouched. The scripted driver (`runScriptedRun`) and the version-aware `runReplay` v4 branch live in `replay.ts` (mirroring `runScriptedConquest`), so the goja harness is unchanged. The run layer is RNG-free; `hashRun = fnv1a(hashMap + status)`.

**Tech Stack:** TypeScript (strict, ES2015), Vitest, esbuild bundle, goja parity runner. Sim is pure / integer-only / goja-safe.

## Global Constraints

- **Parity-critical** (`/sim`, `/shared`): integer math only — no floats, no `Math.random`, no `Date`, no Node APIs. The **run layer draws NO RNG** (fights still draw RNG internally, seeded as in Plan 3; run/Rest/win/lose/extract logic draws none).
- **Anchor frozen:** the run layer is purely additive → the canonical fight hash `86e238c1` and **all 16 existing parity fixtures** stay byte-identical. New behavior is locked by NEW v4 fixtures only.
- **Engine direction:** `sim/run.ts` imports from `sim/conquest-map.ts` (`MapState`, `initConquest`, `advance`, `hashMap`); `conquest-map.ts`/`tile-fight.ts` are NOT modified and never import the run layer.
- **`hashRun(run)`** = `fnv1a(\`${hashMap(run.map)}#${run.status}\`)`.
- **Version-aware `runReplay`:** add `v4 → runScriptedRun`; v1/v2/v3 stay byte-identical; the harness (`parity.mjs`/`run-node.mjs`/`main.go`) is UNCHANGED (it calls `Sim.runReplay`).
- **`Extract` is filtered out before `advance`:** `advance` sorts commands by `armyId`; a `{ t:'extract' }` command has no `armyId`, so `runTick` MUST remove extract commands before calling `advance`.
- **Commits:** end every message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

### Standard commands (every task)
- Focused: `npx vitest run sim/run.test.ts`
- Full: `npm test` (currently 186 tests); Types: `npm run typecheck`
- Parity: `export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity` → 16 fixtures green, canonical `86e238c1` (rises to 19 in Task 5).

### Fixture capture (Task 5): add `{name, expectedHash:'PENDING', bundle:{version:4,…}}` → `npm run parity` prints the actual V8 hash → set it → re-run; confirm the 16 existing hashes unchanged.

---

## File Structure

- **Create `sim/run.ts`** — the run-loop sub-engine: `RunState`, `initRun`, `runTick`, `hashRun`, internal `isWon`/`isLost`/`applyRestHealing`. Imports `MapState`/`initConquest`/`advance`/`hashMap` from `./conquest-map`, `deriveStats` from `./stats`, `fnv1a` from `./hash`, types from `../shared/types`.
- **Modify `shared/types.ts`** — `MapCommand` gains `{ t: 'extract' }`; add `RunBundle` (v4).
- **Modify `shared/config.ts`** — `REST_HEAL_PER_TICK`, `RUN_MAX_TICKS`.
- **Modify `sim/replay.ts`** — add `runScriptedRun` (mirrors `runScriptedConquest`); `runReplay` v4 branch; widen the `runReplay` union to include `RunBundle`.
- **Modify `sim/index.ts`** — export `runScriptedRun` (from `./replay`) and `initRun`/`runTick`/`hashRun` (from `./run`).
- **Modify `tools/parity/fixtures.mjs`** — +3 v4 fixtures (Task 5).
- **Create `sim/run.test.ts`** — co-located tests.

---

## Task 1: `RunState` + `initRun` + `hashRun` + config

**Files:** Create `sim/run.ts`, `sim/run.test.ts`; Modify `shared/config.ts`.

**Interfaces — Produces:**
```ts
// sim/run.ts
export interface RunState { map: MapState; status: 'active' | 'won' | 'lost' | 'extracted'; }
export function initRun(setup: MapSetup, seed?: number): RunState;   // { map: initConquest(setup, seed ?? 0), status: 'active' }
export function hashRun(run: RunState): string;                       // fnv1a(`${hashMap(run.map)}#${run.status}`)
// shared/config.ts
export const REST_HEAL_PER_TICK = 5;
export const RUN_MAX_TICKS = 100_000;
```

- [ ] **Step 1: Failing test** (`sim/run.test.ts`)
```ts
import { initRun, hashRun, type RunState } from './run';
import type { MapSetup } from '../shared/types';

// a minimal 1-tile setup: a start tile owned by the player with one army on it
const soloSetup: MapSetup = {
  tiles: [{ id: 't0', type: 'start', owner: 'player', neighbors: {}, garrison: [] }],
  armies: [{ id: 'a1', tile: 't0', units: [
    { id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
  ] }],
};

it('initRun starts active with the conquest map initialized', () => {
  const run = initRun(soloSetup, 1);
  expect(run.status).toBe('active');
  expect(run.map.armies).toHaveLength(1);
  expect(run.map.totalTicks).toBe(0);
});

it('hashRun folds in status — same map, different status ⇒ different hash', () => {
  const a = initRun(soloSetup, 1);
  const b = initRun(soloSetup, 1);
  b.status = 'won';
  expect(hashRun(a)).not.toBe(hashRun(b));
  const c = initRun(soloSetup, 1);
  expect(hashRun(a)).toBe(hashRun(c)); // identical run ⇒ identical hash (deterministic)
});
```

- [ ] **Step 2: Run** → FAIL (`./run` does not exist).

- [ ] **Step 3: Implement** — `shared/config.ts`: add the two consts. `sim/run.ts`:
```ts
import type { MapSetup } from '../shared/types';
import type { MapState } from './conquest-map';
import { initConquest, hashMap } from './conquest-map';
import { fnv1a } from './hash';

export interface RunState { map: MapState; status: 'active' | 'won' | 'lost' | 'extracted'; }

export function initRun(setup: MapSetup, seed = 0): RunState {
  return { map: initConquest(setup, seed), status: 'active' };
}

export function hashRun(run: RunState): string {
  return fnv1a(`${hashMap(run.map)}#${run.status}`);
}
```

- [ ] **Step 4: Run** → PASS. Then `npm test`, `npm run typecheck`, full parity (16 fixtures, `86e238c1`).

- [ ] **Step 5: Commit**
```bash
git add sim/run.ts sim/run.test.ts shared/config.ts
git commit -m "$(printf 'feat(sim): run-loop scaffolding — RunState + initRun + hashRun\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: `runTick` — Extract, advance, win/lose

**Files:** Modify `sim/run.ts`, `shared/types.ts`; Test `sim/run.test.ts`.

**Interfaces:**
- Consumes: `advance` (`./conquest-map`); `RunState` (Task 1).
- Produces: `runTick(run: RunState, commands: MapCommand[]): RunState` (mutates + returns `run`). `MapCommand` gains `{ t: 'extract' }`.

- [ ] **Step 1: Failing tests** (append to `sim/run.test.ts`). Use a 2-tile setup so a dispatch can move + capture an undefended enemy tile (which is the boss), and an armies-empty case for lose:
```ts
import { runTick } from './run';
import type { MapCommand } from '../shared/types';

// t0 (player start) — E — t1 (enemy boss, undefended). Reciprocal neighbors.
const bossSetup: MapSetup = {
  tiles: [
    { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
    { id: 't1', type: 'boss',  owner: 'enemy',  neighbors: { W: 't0' }, garrison: [] },
  ],
  armies: [{ id: 'a1', tile: 't0', units: [
    { id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
  ] }],
};

it('runTick advances the map (a dispatched army leaves its tile)', () => {
  const run = initRun(bossSetup, 1);
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  // dispatched this tick → travelling; subsequent ticks move it (no same-tick move per Plan 2)
  expect(run.map.armies[0].state === 'travelling' || run.map.armies[0].tile !== 't0').toBe(true);
  expect(run.status).toBe('active');
});

it('capturing the (undefended) boss tile wins the run', () => {
  const run = initRun(bossSetup, 1);
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  for (let i = 0; i < 50 && run.status === 'active'; i++) runTick(run, []);
  expect(run.map.tiles.find((t) => t.id === 't1')!.owner).toBe('player');
  expect(run.status).toBe('won');
});

it('extract ends the run as extracted, before any movement', () => {
  const run = initRun(bossSetup, 1);
  runTick(run, [{ t: 'extract' }, { t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  expect(run.status).toBe('extracted');
  expect(run.map.armies[0].tile).toBe('t0'); // dispatch was NOT applied
});

it('a terminal run is a no-op', () => {
  const run = initRun(bossSetup, 1);
  run.status = 'won';
  const before = run.map.totalTicks;
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  expect(run.map.totalTicks).toBe(before);
});

it('losing: no armies left ⇒ lost', () => {
  const run = initRun(bossSetup, 1);
  run.map.armies = []; // simulate all forces ground down
  runTick(run, []);
  expect(run.status).toBe('lost');
});
```

- [ ] **Step 2: Run** → FAIL (`runTick` undefined; `extract` not on `MapCommand`).

- [ ] **Step 3: Implement** — `shared/types.ts`: widen `MapCommand`:
```ts
export type MapCommand =
  | { t: 'dispatch'; armyId: string; toTile: string; gate?: MapEdge }
  | { t: 'retreat'; armyId: string }
  | { t: 'extract' };
```
`sim/run.ts` (add `advance` to the `./conquest-map` import):
```ts
import { initConquest, advance, hashMap } from './conquest-map';
import { deriveStats } from './stats';
import type { MapSetup, MapCommand } from '../shared/types';

function isWon(map: MapState): boolean {
  const bosses = map.tiles.filter((t) => t.type === 'boss');
  return bosses.length > 0 && bosses.every((t) => t.owner === 'player');
}
function isLost(map: MapState): boolean {
  return map.armies.length === 0;
}

export function runTick(run: RunState, commands: MapCommand[]): RunState {
  if (run.status !== 'active') return run;                 // terminal status is sticky
  if (commands.some((c) => c.t === 'extract')) { run.status = 'extracted'; return run; }
  const mapCommands = commands.filter((c) => c.t !== 'extract'); // extract has no armyId → must not reach advance
  advance(run.map, mapCommands);
  // (Rest healing is added in Task 3, between advance and the win/lose check.)
  if (isWon(run.map)) run.status = 'won';
  else if (isLost(run.map)) run.status = 'lost';
  return run;
}
```

- [ ] **Step 4: Run** → PASS. Then `npm test`, typecheck, full parity (16, `86e238c1`).

- [ ] **Step 5: Commit**
```bash
git add sim/run.ts sim/run.test.ts shared/types.ts
git commit -m "$(printf 'feat(sim): runTick — Extract + advance + win/lose\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: Rest healing

**Files:** Modify `sim/run.ts`; Test `sim/run.test.ts`.

**Interfaces:** internal `applyRestHealing(map: MapState): void`, called in `runTick` between `advance` and the win/lose check. Consumes `deriveStats` (`./stats`), `REST_HEAL_PER_TICK` (config).

- [ ] **Step 1: Failing tests** (append). Build a setup where an army is garrisoned on a player-owned `rest` tile, with a wounded unit (`startHp` below `maxHp`):
```ts
import { REST_HEAL_PER_TICK } from '../shared/config';
import { deriveStats } from './stats';

const restSetup: MapSetup = {
  tiles: [{ id: 'r0', type: 'rest', owner: 'player', neighbors: {}, garrison: [] }],
  armies: [{ id: 'a1', tile: 'r0', units: [
    { id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 }, startHp: 3 },
  ] }],
};

it('a wounded unit garrisoned on an owned rest tile heals REST_HEAL_PER_TICK/tick, capped at maxHp', () => {
  const run = initRun(restSetup, 1);
  const u = run.map.armies[0].units[0];
  const maxHp = deriveStats(u.attrs, u.attackKind).maxHp;
  runTick(run, []);
  expect(run.map.armies[0].units[0].startHp).toBe(Math.min(maxHp, 3 + REST_HEAL_PER_TICK));
  // heal to the cap and confirm it never exceeds maxHp
  for (let i = 0; i < 100; i++) runTick(run, []);
  expect(run.map.armies[0].units[0].startHp).toBe(maxHp);
});

it('no healing off a rest tile / on an enemy-owned rest tile / when not garrisoned', () => {
  // enemy-owned rest tile: army present but tile.owner !== 'player' ⇒ no heal
  const enemyRest: MapSetup = {
    tiles: [{ id: 'r0', type: 'rest', owner: 'enemy', neighbors: {}, garrison: [] }],
    armies: [{ id: 'a1', tile: 'r0', units: [
      { id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 }, startHp: 3 },
    ] }],
  };
  const run = initRun(enemyRest, 1);
  runTick(run, []);
  expect(run.map.armies[0].units[0].startHp).toBe(3); // unchanged
});
```
(Note: an army on an enemy-owned tile would normally be `contested`/in transit; for this unit test the army's `state` is `garrisoned` from `initConquest`, and the guard is `tile.owner === 'player'` — so an enemy-owned tile does not heal. This isolates the owner guard.)

- [ ] **Step 2: Run** → FAIL (no healing yet — `startHp` stays 3).

- [ ] **Step 3: Implement** — `sim/run.ts`:
```ts
import { REST_HEAL_PER_TICK } from '../shared/config';

function applyRestHealing(map: MapState): void {
  for (const army of map.armies) {
    if (army.state !== 'garrisoned') continue;
    const tile = map.tiles.find((t) => t.id === army.tile);
    if (!tile || tile.type !== 'rest' || tile.owner !== 'player') continue;
    for (const u of army.units) {
      const maxHp = deriveStats(u.attrs, u.attackKind).maxHp;
      const cur = u.startHp ?? maxHp;
      if (cur < maxHp) u.startHp = Math.min(maxHp, cur + REST_HEAL_PER_TICK);
    }
  }
}
```
And call it in `runTick` immediately after `advance(run.map, mapCommands);` and before the win/lose check.

- [ ] **Step 4: Run** → PASS. Then `npm test`, typecheck, full parity (16, `86e238c1`).

- [ ] **Step 5: Commit**
```bash
git add sim/run.ts sim/run.test.ts
git commit -m "$(printf 'feat(sim): Rest healing — garrisoned units recover HP on owned rest tiles\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: `runScriptedRun` (v4) + `runReplay` dispatch

**Files:** Modify `sim/replay.ts`, `shared/types.ts`, `sim/index.ts`; Test `sim/run.test.ts` (or `sim/replay.test.ts`).

**Interfaces:**
- Consumes: `initRun`/`runTick`/`hashRun` (`./run`); `RunBundle` (shared).
- Produces: `RunBundle` (v4); `runScriptedRun(bundle: RunBundle): { hash: string; status: RunState['status']; ticks: number }`; `runReplay` v4 branch.

```ts
// shared/types.ts
export interface RunBundle { version: 4; setup: MapSetup; seed: number; script: { atTick: number; commands: MapCommand[] }[]; }
```

- [ ] **Step 1: Failing tests** (append, using `bossSetup` from Task 2):
```ts
import { runScriptedRun } from './replay';
import { runReplay } from './replay';

it('runScriptedRun drives a dispatch to a boss capture ⇒ won', () => {
  const r = runScriptedRun({ version: 4, seed: 1, setup: bossSetup,
    script: [{ atTick: 0, commands: [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }] }] });
  expect(r.status).toBe('won');
  expect(typeof r.hash).toBe('string');
});

it('runScriptedRun: an extract command ⇒ extracted', () => {
  const r = runScriptedRun({ version: 4, seed: 1, setup: bossSetup,
    script: [{ atTick: 0, commands: [{ t: 'extract' }] }] });
  expect(r.status).toBe('extracted');
});

it('runReplay routes v4 to runScriptedRun', () => {
  const r = runReplay({ version: 4, seed: 1, setup: bossSetup,
    script: [{ atTick: 0, commands: [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }] }] });
  expect(typeof r.hash).toBe('string');
  expect(r.ticks).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run** → FAIL (`runScriptedRun` undefined; `version: 4` not in the union).

- [ ] **Step 3: Implement** — `shared/types.ts`: add `RunBundle`. `sim/replay.ts` (add imports `import { initRun, runTick, hashRun } from './run'` and `RunBundle` to the type import; `RUN_MAX_TICKS` from config):
```ts
// ── Run replay (v4) ──────────────────────────────────────────────────────────
export function runScriptedRun(bundle: RunBundle): { hash: string; status: RunState['status']; ticks: number } {
  const run = initRun(bundle.setup, bundle.seed);
  const cmdsAt = (t: number) => bundle.script.filter((a) => a.atTick === t).flatMap((a) => a.commands);
  const pending = () =>
    run.map.armies.some((a) => a.state === 'travelling' || a.state === 'retreating') ||
    bundle.script.some((a) => a.atTick >= run.map.totalTicks) ||
    run.map.battles.some((b) => !b.fight.outcome);
  while (run.status === 'active' && pending() && run.map.totalTicks < RUN_MAX_TICKS) {
    runTick(run, cmdsAt(run.map.totalTicks));
  }
  return { hash: hashRun(run), status: run.status, ticks: run.map.totalTicks };
}
```
Add the v4 branch to `runReplay` and widen its parameter union:
```ts
export function runReplay(bundle: ReplayBundle | ScriptedFightBundle | ConquestBundle | RunBundle): ReplayResult {
  if (bundle.version === 4) { const r = runScriptedRun(bundle); return { hash: r.hash, ticks: r.ticks }; }
  if (bundle.version === 3) { const r = runScriptedConquest(bundle); return { hash: r.hash, ticks: r.ticks }; }
  const r = bundle.version === 2 ? runScriptedFight(bundle) : runTileFight(bundle.setup, bundle.seed);
  return { hash: r.hash, winner: r.winner, ticks: r.ticks, endReason: r.endReason };
}
```
(Import `RunState` type for the return annotation, or inline the union `'active'|'won'|'lost'|'extracted'`.) `sim/index.ts`: add `runScriptedRun` to the `./replay` export and `initRun, runTick, hashRun` from `./run`.

- [ ] **Step 4: Run** → PASS. Then `npm test`, typecheck, full parity (16, `86e238c1` — v1/v2/v3 fixtures byte-identical; the new run paths are exercised by unit tests now, parity fixtures in Task 5).

- [ ] **Step 5: Commit**
```bash
git add sim/replay.ts shared/types.ts sim/index.ts sim/run.test.ts
git commit -m "$(printf 'feat(sim): runScriptedRun + version-aware runReplay v4 (harness untouched)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: v4 parity fixtures

**Files:** Modify `tools/parity/fixtures.mjs`; Test `sim/run.test.ts` (pin hashes).

- [ ] **Step 1: Add 3 v4 fixtures** to `tools/parity/fixtures.mjs` (capture procedure — `expectedHash: 'PENDING'` → `npm run parity` prints the V8 hash → set it → re-run):
  - `run-won-seed1` — `bossSetup`-style (player start E→ enemy `boss` tile, lightly garrisoned so a real fight resolves), script dispatches `a1` to the boss tile → expect a `won`-status hash.
  - `run-rest-heal-seed1` — TWO armies start garrisoned on a player-owned `rest` tile `r0`; `a1` has a wounded unit (`startHp` below max). The script dispatches the OTHER army `a2` to an adjacent undefended enemy tile `e1`. While `a2` travels + captures (several *pending* ticks), `a1` heals every tick on `r0`; the run quiesces `active` and the hash reflects `a1`'s accumulated healing (via `hashMap`, which folds `startHp`). **NOTE:** an empty script would make `runScriptedRun` quiesce at tick 0 (garrisoned army, no script, no battle) → zero ticks → no healing — the travelling `a2` is what drives the per-tick heals. (`r0` neighbors `{ E: 'e1' }`; `e1` is enemy, undefended, neighbors `{ W: 'r0' }`.)
  - `run-extract-seed1` — script issues `{ t: 'extract' }` at tick 0 → `extracted`-status hash.
  Each: `{ name, expectedHash, bundle: { version: 4, seed: 1, setup: {...}, script: [...] } }`.

- [ ] **Step 2: Pin matching unit tests** (`sim/run.test.ts`) — assert `runScriptedRun(<each bundle>).hash` equals the captured fixture hash (fails on a no-op/wrong outcome). Mirror the exact bundles used in the fixtures.

- [ ] **Step 3: Verify** — `npm test`; typecheck; full parity **19 fixtures** (16 existing UNCHANGED incl. `86e238c1` + `conquest-capture-seed0`=`356ce892`; +3 new `run-*`), V8===goja. If any existing hash changed, STOP — the run layer must be additive.

- [ ] **Step 4: Commit**
```bash
git add tools/parity/fixtures.mjs sim/run.test.ts
git commit -m "$(printf 'feat(sim): v4 run parity fixtures — won / rest-heal / extract\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** RunState/initRun/hashRun + config (T1) ✓; runTick + Extract + win/lose + `MapCommand` extract (T2) ✓; Rest healing (T3) ✓; runScriptedRun v4 + runReplay dispatch + RunBundle + index exports (T4) ✓; v4 fixtures + anchor-frozen check (T5) ✓.
- **Type consistency:** `RunState`/`initRun(setup, seed?)`/`runTick(run, commands)`/`hashRun(run)`/`runScriptedRun(bundle)` consistent across tasks; `MapCommand` extract variant + `RunBundle` v4 introduced once; `REST_HEAL_PER_TICK`/`RUN_MAX_TICKS` consts. `runScriptedRun` lives in `replay.ts` (mirrors `runScriptedConquest`); `hashRun` in `run.ts`.
- **Placeholders:** fixture hashes are `PENDING` capture sentinels (T5); `REST_HEAL_PER_TICK=5`/`RUN_MAX_TICKS=100_000` are concrete (tunable later). No TBD/TODO logic.
- **Determinism:** run layer RNG-free; `hashRun` reuses parity-proven `hashMap` + status; `extract` filtered before `advance` (no `armyId`); anchor + 16 fixtures frozen (additive); v4 fixtures lock the new behavior. Only `run.ts` (new) + `replay.ts` touch run logic; `conquest-map.ts`/`tile-fight.ts` untouched.
