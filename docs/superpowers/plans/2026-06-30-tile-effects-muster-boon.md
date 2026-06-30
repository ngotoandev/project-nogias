# Tile Effects: Muster + Boon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two sim-pure capture-time tile effects to `sim/run.ts` — Muster (capture → spawn a predefined reserve army) and Boon (capture → flat attribute buff to current player units) — detected by a snapshot-diff in `runTick`.

**Architecture:** Effects mutate RUN STATE only (add an `Army` / buff unit `attrs`); `conquest-map.ts`/`tile-fight.ts`/`replay.ts` stay untouched, so the fight engine sees ordinary specs and the anchor stays frozen. `runTick` snapshots player-owned tiles before `advance`, then `applyCaptureEffects` fires on tiles newly player-owned afterward (once per tile; owners only gain).

**Tech Stack:** TypeScript (strict, ES2015), Vitest, esbuild bundle, goja parity runner. Sim is pure / integer-only / goja-safe.

## Global Constraints

- **Parity-critical** (`/sim`, `/shared`): integer math only — no floats, no `Math.random`, no `Date`, no Node APIs. The **run layer draws NO RNG**.
- **Additive / anchor frozen:** effects are run-state mutations → the canonical fight hash `86e238c1` and **all 19 existing parity fixtures** stay byte-identical. New behavior is locked by 2 NEW v4 fixtures only.
- **Engine direction:** all logic in `sim/run.ts` + types; `conquest-map.ts`/`tile-fight.ts`/`replay.ts` are NOT modified. `hashMap` (in the untouched `conquest-map.ts`) reads only tile `id`/`owner`/`garrison` + army roster — it ignores the new `muster`/`boon` input fields but hashes their consequences (spawned army roster; buffed units' derived HP).
- **Effects fire once per tile** on its capture tick (snapshot-diff; owners only ever gain in alpha).
- **No mutation bleed:** mustered units are deep-copied (`cloneUnitSpec`); Boon mutates already-cloned army `attrs`.
- **Commits:** end every message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

### Standard commands (every task)
- Focused: `npx vitest run sim/run.test.ts`
- Full: `npm test` (currently 201 tests); Types: `npm run typecheck`
- Parity: `export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity` → 19 fixtures green, canonical `86e238c1` (rises to 21 in Task 3).

### Fixture capture (Task 3): add `{name, expectedHash:'PENDING', bundle:{version:4,…}}` → `npm run parity` prints the actual V8 hash → set it → re-run; confirm the 19 existing hashes unchanged.

---

## File Structure

- **Modify `shared/types.ts`** — add `BoonSpec`; `MapTile` gains `muster?: UnitSpec[]` + `boon?: BoonSpec` (static setup data, like `garrison`).
- **Modify `sim/run.ts`** — add `cloneUnitSpec` (deep-copy a `UnitSpec`); `applyCaptureEffects(map, ownedBefore)` (Muster + Boon branches); wire the snapshot + call into `runTick`.
- **Modify `tools/parity/fixtures.mjs`** — +2 v4 fixtures (Task 3).
- **Modify `sim/run.test.ts`** — co-located tests.
- `conquest-map.ts` / `tile-fight.ts` / `replay.ts` — **untouched**.

---

## Task 1: Types + capture detection + Muster

**Files:** Modify `shared/types.ts`, `sim/run.ts`; Test `sim/run.test.ts`.

**Interfaces — Produces:**
```ts
// shared/types.ts
export interface BoonSpec { attr: 'str' | 'agi' | 'int' | 'lck'; amount: number; }
// MapTile gains: muster?: UnitSpec[];  boon?: BoonSpec;
// sim/run.ts
function cloneUnitSpec(u: UnitSpec): UnitSpec;            // deep copy
function applyCaptureEffects(map: MapState, ownedBefore: Set<string>): void; // Muster (Task 1) + Boon (Task 2)
// runTick snapshots ownedBefore before advance and calls applyCaptureEffects after applyRestHealing.
```

- [ ] **Step 1: Write the failing tests** (`sim/run.test.ts`) — use a 2-tile setup: a player `start` tile E-adjacent to an **undefended** enemy `muster` tile carrying reserve units, so a dispatch captures it fight-free.
```ts
import { initRun, runTick } from './run';
import type { MapSetup } from '../shared/types';

const musterSetup: MapSetup = {
  tiles: [
    { id: 't0', type: 'start',  owner: 'player', neighbors: { E: 't1' }, garrison: [] },
    { id: 't1', type: 'muster', owner: 'enemy',  neighbors: { W: 't0' }, garrison: [],
      muster: [
        { id: 'm1', side: 'A', attackKind: 'melee', attrs: { str: 4, agi: 4, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
      ] },
  ],
  armies: [{ id: 'a1', tile: 't0', units: [
    { id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
  ] }],
};

it('capturing a muster tile spawns a garrisoned reserve army (muster-<id>) with the tile units, once', () => {
  const run = initRun(musterSetup, 1);
  expect(run.map.armies.some((a) => a.id === 'muster-t1')).toBe(false); // not before capture
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  for (let i = 0; i < 40 && !run.map.tiles.find((t) => t.id === 't1')!.owner.includes('player'); i++) runTick(run, []);
  const mustered = run.map.armies.find((a) => a.id === 'muster-t1');
  expect(mustered).toBeDefined();
  expect(mustered!.state).toBe('garrisoned');
  expect(mustered!.tile).toBe('t1');
  expect(mustered!.units.map((u) => u.id)).toEqual(['m1']);
  const countAfter = run.map.armies.filter((a) => a.id === 'muster-t1').length;
  for (let i = 0; i < 5; i++) runTick(run, []);
  expect(run.map.armies.filter((a) => a.id === 'muster-t1').length).toBe(countAfter); // fires once
});

it('a non-muster capture spawns no reserve army', () => {
  // same setup but t1.type = 'enemy', no muster field → after capture, no muster-* army exists
  const s = JSON.parse(JSON.stringify(musterSetup)); s.tiles[1].type = 'enemy'; delete s.tiles[1].muster;
  const run = initRun(s, 1);
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  for (let i = 0; i < 40; i++) runTick(run, []);
  expect(run.map.armies.some((a) => a.id.startsWith('muster-'))).toBe(false);
});

it('cloneUnitSpec isolates the mustered army from the setup', () => {
  const run = initRun(musterSetup, 1);
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  for (let i = 0; i < 40 && !run.map.armies.some((a) => a.id === 'muster-t1'); i++) runTick(run, []);
  run.map.armies.find((a) => a.id === 'muster-t1')!.units[0].attrs.str = 999;
  expect(musterSetup.tiles[1].muster![0].attrs.str).toBe(4); // setup untouched
});
```

- [ ] **Step 2: Run** → FAIL (`muster`/`boon` not on `MapTile`; no muster army spawned).

- [ ] **Step 3: Implement** — `shared/types.ts`: add `BoonSpec` and, on `MapTile`, `muster?: UnitSpec[];` and `boon?: BoonSpec;`. `sim/run.ts`:
```ts
function cloneUnitSpec(u: UnitSpec): UnitSpec {
  return { ...u, attrs: { ...u.attrs }, pos: { ...u.pos },
    traits: u.traits ? u.traits.slice() : undefined,
    personality: u.personality ? { ...u.personality } : undefined };
}

function applyCaptureEffects(map: MapState, ownedBefore: Set<string>): void {
  for (const tile of map.tiles) {
    if (tile.owner !== 'player' || ownedBefore.has(tile.id)) continue; // newly captured this tick only
    if (tile.type === 'muster' && tile.muster && tile.muster.length > 0) {
      map.armies.push({ id: `muster-${tile.id}`, units: tile.muster.map(cloneUnitSpec),
        tile: tile.id, state: 'garrisoned', travelGauge: 0 });
    }
    // Boon branch added in Task 2.
  }
}
```
Add `UnitSpec` to the `../shared/types` import in `run.ts`. Then in `runTick`, snapshot before `advance` and call after `applyRestHealing`:
```ts
  if (commands.some((c) => c.t === 'extract')) { run.status = 'extracted'; return run; }
  const ownedBefore = new Set(run.map.tiles.filter((t) => t.owner === 'player').map((t) => t.id));
  const mapCommands = commands.filter((c): c is MapCommand => c.t !== 'extract');
  advance(run.map, mapCommands);
  applyRestHealing(run.map);
  applyCaptureEffects(run.map, ownedBefore);
  if (isWon(run.map)) run.status = 'won';
  else if (isLost(run.map)) run.status = 'lost';
```

- [ ] **Step 4: Run** → PASS. Then `npm test`, `npm run typecheck`, full parity (19 fixtures, `86e238c1` unchanged).

- [ ] **Step 5: Commit**
```bash
git add shared/types.ts sim/run.ts sim/run.test.ts
git commit -m "$(printf 'feat(sim): Muster tiles — capture spawns a predefined reserve army\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Boon

**Files:** Modify `sim/run.ts`; Test `sim/run.test.ts`.

**Interfaces:** Consumes `applyCaptureEffects` + `BoonSpec` (Task 1). Produces: the Boon branch in `applyCaptureEffects`.

- [ ] **Step 1: Write the failing tests** (`sim/run.test.ts`) — a player `start` tile E-adjacent to an undefended enemy `boon` tile carrying a `BoonSpec`:
```ts
import { deriveStats } from './stats';

const boonSetup: MapSetup = {
  tiles: [
    { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
    { id: 't1', type: 'boon',  owner: 'enemy',  neighbors: { W: 't0' }, garrison: [], boon: { attr: 'str', amount: 3 } },
  ],
  armies: [{ id: 'a1', tile: 't0', units: [
    { id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
  ] }],
};

it('capturing a boon tile adds amount to attr on every player unit, raising derived maxHp, once', () => {
  const run = initRun(boonSetup, 1);
  const u = run.map.armies[0].units[0];
  const hpBefore = deriveStats(u.attrs, u.attackKind).maxHp;
  expect(u.attrs.str).toBe(5);
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  for (let i = 0; i < 40 && run.map.tiles.find((t) => t.id === 't1')!.owner !== 'player'; i++) runTick(run, []);
  const after = run.map.armies[0].units[0];
  expect(after.attrs.str).toBe(8);                                   // +3, once
  expect(deriveStats(after.attrs, after.attackKind).maxHp).toBeGreaterThan(hpBefore);
  const strAfterCapture = after.attrs.str;
  for (let i = 0; i < 5; i++) runTick(run, []);
  expect(run.map.armies[0].units[0].attrs.str).toBe(strAfterCapture); // fires once
});

it('a non-boon capture does not buff', () => {
  const s = JSON.parse(JSON.stringify(boonSetup)); s.tiles[1].type = 'enemy'; delete s.tiles[1].boon;
  const run = initRun(s, 1);
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  for (let i = 0; i < 40; i++) runTick(run, []);
  expect(run.map.armies[0].units[0].attrs.str).toBe(5); // unchanged
});

it('boon does not bleed into the setup', () => {
  const run = initRun(boonSetup, 1);
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  for (let i = 0; i < 40; i++) runTick(run, []);
  expect(boonSetup.armies[0].units[0].attrs.str).toBe(5); // setup untouched (army attrs were cloned at initConquest)
});
```

- [ ] **Step 2: Run** → FAIL (no buff applied — `str` stays 5).

- [ ] **Step 3: Implement** — add the Boon branch to `applyCaptureEffects` (inside the newly-captured loop, after the Muster branch). Capture `tile.boon` to a `const` for strict narrowing in the nested loop:
```ts
    if (tile.type === 'boon' && tile.boon) {
      const boon = tile.boon;
      for (const army of map.armies) {
        for (const u of army.units) {
          u.attrs[boon.attr] += boon.amount;
        }
      }
    }
```

- [ ] **Step 4: Run** → PASS. Then `npm test`, typecheck, full parity (19, `86e238c1`).

- [ ] **Step 5: Commit**
```bash
git add sim/run.ts sim/run.test.ts
git commit -m "$(printf 'feat(sim): Boon tiles — capture applies a run-scoped attribute buff\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: v4 parity fixtures

**Files:** Modify `tools/parity/fixtures.mjs`; Test `sim/run.test.ts` (pin hashes).

- [ ] **Step 1: Add 2 v4 fixtures** to `tools/parity/fixtures.mjs` (capture procedure — `expectedHash: 'PENDING'` → `npm run parity` → read the actual V8 hash → set it → re-run):
  - `run-muster-seed1` — `musterSetup`-style: a player `start` tile E-adjacent to an undefended enemy `muster` tile (with `muster` units); script dispatches the start army to the muster tile at tick 0. After capture the run quiesces `active` with the `muster-t1` reserve army present — the hash reflects it. (`run-muster` is NOT a won/lost run: the muster tile is not a `boss`, so the run ends `active` at quiescence.)
  - `run-boon-seed1` — `boonSetup`-style: a player `start` tile E-adjacent to an undefended enemy `boon` tile (`boon: { attr: 'str', amount: 3 }`); script dispatches the start army to capture it at tick 0; the player unit's buffed `str` raises its derived HP, reflected in the hash. Run quiesces `active`.
  Each: `{ name, expectedHash, bundle: { version: 4, seed: 1, setup: {...}, script: [{ atTick: 0, commands: [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }] }] } }`.

- [ ] **Step 2: Pin matching unit tests** (`sim/run.test.ts`) — assert `runScriptedRun(<each bundle>).hash` equals the captured fixture hash AND `.status === 'active'` (fails on a no-op/wrong outcome). Import `runScriptedRun` from `./replay`. Mirror the exact bundles used in the fixtures.

- [ ] **Step 3: Verify** — `npm test`; typecheck; full parity **21 fixtures** (19 existing UNCHANGED incl. `86e238c1` + `conquest-capture-seed0`=`356ce892` + the 3 `run-*` from the prior slice; +2 new `run-muster`/`run-boon`), V8===goja. If any existing hash changed, STOP — the effects must be additive run-state mutations only.

- [ ] **Step 4: Commit**
```bash
git add tools/parity/fixtures.mjs sim/run.test.ts
git commit -m "$(printf 'feat(sim): v4 parity fixtures — muster + boon capture\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** `BoonSpec` + `MapTile.muster?`/`boon?` (T1) ✓; snapshot-diff capture detection + `applyCaptureEffects` wiring (T1) ✓; Muster spawn + `cloneUnitSpec` isolation (T1) ✓; Boon buff + narrowing const (T2) ✓; 2 v4 fixtures + anchor-frozen check (T3) ✓.
- **Type consistency:** `BoonSpec { attr: 'str'|'agi'|'int'|'lck'; amount: number }`, `MapTile.muster?: UnitSpec[]`, `MapTile.boon?: BoonSpec`, `cloneUnitSpec(u): UnitSpec`, `applyCaptureEffects(map, ownedBefore: Set<string>)` consistent across tasks; muster army id `muster-<tileId>`; effect keys off `tile.type` + content presence.
- **Placeholders:** fixture hashes are `PENDING` capture sentinels (T3); `boon.amount`/`muster` units are concrete in the test/fixture setups. No TBD/TODO logic.
- **Determinism:** RNG-free; capture effects fire once (snapshot-diff); `hashRun` reflects consequences via the untouched `hashMap`; anchor + 19 fixtures frozen (additive); only `run.ts` + `shared/types.ts` + fixtures change — `conquest-map.ts`/`tile-fight.ts`/`replay.ts` untouched.
