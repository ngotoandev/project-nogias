# Enemy Map-AI — Territorial Reclaim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic, opt-in enemy behavior in `sim/run.ts` — each garrisoned enemy tile reclaims one adjacent **undefended** player tile per tick (fight-free) — plus the invariant hardening that lets tile effects survive tiles flipping both ways.

**Architecture:** All logic in the run layer (`sim/run.ts`); `conquest-map.ts`/`tile-fight.ts`/`replay.ts` stay untouched. Gated by `MapSetup.enemyReclaims` (default-off → purely additive). The tile-effect detector switches from a snapshot-diff to a once-ever `MapTile.effectClaimed` flag (behavior-identical when the enemy is off).

**Tech Stack:** TypeScript (strict, ES2015), Vitest, esbuild bundle, goja parity runner. Sim is pure / integer-only / goja-safe.

## Global Constraints

- **Parity-critical / integer-only** (`/sim`, `/shared`): no floats, no `Math.random`, no `Date`, no Node APIs. The run layer (incl. the enemy AI) draws **NO RNG**.
- **Additive / opt-in:** `enemyReclaims` defaults `false` → the canonical fight hash `86e238c1` and **all 21 existing parity fixtures** stay byte-identical. The `effectClaimed` swap is behavior-identical when the enemy is off. New behavior is locked only by 2 NEW v4 fixtures.
- **Engine direction:** only `sim/run.ts` + `shared/types.ts` (types) change. `conquest-map.ts`/`tile-fight.ts`/`replay.ts` are NOT modified — the enemy is run-orchestration, not the player-control engine.
- **`applyEnemyAI`:** each enemy-owned tile **with a non-empty garrison** (tile-id order) reclaims its first player-owned **undefended** neighbor (N/S/E/W order) → `owner='enemy'` + `{t:'reclaimed',tile,by}`; one reclaim per enemy tile per tick. "Undefended" = no player army sits on the tile.
- **`effectClaimed`:** a tile's Muster/Boon fires iff `owner==='player' && !effectClaimed`, then sets the flag — at most once ever per tile. `initRun` pre-marks initially-player-owned tiles claimed.
- **`runTick` order:** advance → `applyRestHealing` → `applyCaptureEffects` → `applyEnemyAI` (if `enemyReclaims`) → win/lose.
- **Commits:** end every message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

### Standard commands (every task)
- Focused: `npx vitest run sim/run.test.ts`
- Full: `npm test` (currently 209 tests); Types: `npm run typecheck`
- Parity: `export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity` → 21 fixtures green, canonical `86e238c1` (rises to 23 in Task 3).

### Fixture capture (Task 3): add `{name, expectedHash:'PENDING', bundle:{version:4,…}}` → `npm run parity` prints the actual V8 hash → set it → re-run; confirm the 21 existing hashes unchanged.

---

## File Structure
- **Modify `shared/types.ts`** — `MapTile.effectClaimed?: boolean`; `MapSetup.enemyReclaims?: boolean`; `MapEvent` += `{ t:'reclaimed'; tile: string; by: string }`.
- **Modify `sim/run.ts`** — `RunState.enemyReclaims`; `initRun` (read the flag + pre-mark claimed); `applyCaptureEffects` (claimed-flag, drop `ownedBefore`); `applyEnemyAI`; `runTick` (drop the snapshot, gate `applyEnemyAI`).
- **Modify `tools/parity/fixtures.mjs`** — +2 v4 fixtures (Task 3).
- **Modify `sim/run.test.ts`** — co-located tests.
- `conquest-map.ts` / `tile-fight.ts` / `replay.ts` — **untouched**.

---

## Task 1: Effect-detector hardening (`effectClaimed`)

**Files:** Modify `shared/types.ts`, `sim/run.ts`; Test `sim/run.test.ts`.

**Interfaces — Produces:** `MapTile.effectClaimed?: boolean`; `applyCaptureEffects(map: MapState): void` (no `ownedBefore`); `initRun` pre-marks initially-player-owned tiles `effectClaimed`.

- [ ] **Step 1: Write the failing tests** (`sim/run.test.ts`)
```ts
import { initRun, runTick } from './run';
import type { MapSetup } from '../shared/types';

const u = (id: string, side: 'A'|'B', str: number) => ({ id, side, attackKind: 'melee' as const, attrs: { str, agi: 6, int: 3, lck: 3 }, priority: 5, pos: { x: 0, y: 0 } });
// player start t0 — undefended enemy muster tile t1
const musterMap: MapSetup = {
  tiles: [
    { id: 't0', type: 'start',  owner: 'player', neighbors: { E: 't1' }, garrison: [] },
    { id: 't1', type: 'muster', owner: 'enemy',  neighbors: { W: 't0' }, garrison: [], muster: [u('m1','A',4)] },
  ],
  armies: [{ id: 'a1', tile: 't0', units: [u('a1u','A',9)] }],
};

it('a captured muster tile spawns exactly one reserve, even if re-owned (claimed once ever)', () => {
  const run = initRun(musterMap, 1);
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  for (let i = 0; i < 30 && !run.map.armies.some((a) => a.id === 'muster-t1'); i++) runTick(run, []);
  expect(run.map.armies.filter((a) => a.id === 'muster-t1')).toHaveLength(1);
  // simulate a recapture cycle: flip t1 enemy then back to player, tick again → still ONE muster army
  const t1 = run.map.tiles.find((t) => t.id === 't1')!;
  t1.owner = 'enemy'; runTick(run, []); t1.owner = 'player'; runTick(run, []);
  expect(run.map.armies.filter((a) => a.id === 'muster-t1')).toHaveLength(1);
});

it('a muster tile that STARTS player-owned never fires (you did not capture it)', () => {
  const startOwned: MapSetup = {
    tiles: [{ id: 't0', type: 'muster', owner: 'player', neighbors: {}, garrison: [], muster: [u('m1','A',4)] }],
    armies: [{ id: 'a1', tile: 't0', units: [u('a1u','A',9)] }],
  };
  const run = initRun(startOwned, 1);
  for (let i = 0; i < 5; i++) runTick(run, []);
  expect(run.map.armies.some((a) => a.id.startsWith('muster-'))).toBe(false);
});
```

- [ ] **Step 2: Run** → the recapture test FAILS (the current snapshot-diff re-fires the muster on re-ownership → 2 armies). The start-owned test already PASSES under the snapshot-diff (it never fires a start-owned tile) — it is a regression guard that must STAY green after the swap; the `initRun` pre-mark is what keeps it green.

- [ ] **Step 3: Implement** — `shared/types.ts`: add `effectClaimed?: boolean;` to `MapTile`. `sim/run.ts`:
```ts
export function initRun(setup: MapSetup, seed = 0): RunState {
  const map = initConquest(setup, seed);
  for (const t of map.tiles) if (t.owner === 'player') t.effectClaimed = true; // started-owned ⇒ not captured ⇒ never fires
  return { map, status: 'active' };
}

function applyCaptureEffects(map: MapState): void {
  for (const tile of map.tiles) {
    if (tile.owner !== 'player' || tile.effectClaimed) continue; // fire at most once ever, on first player-ownership
    let fired = false;
    if (tile.type === 'muster' && tile.muster && tile.muster.length > 0) {
      map.armies.push({ id: `muster-${tile.id}`, units: tile.muster.map(cloneUnitSpec), tile: tile.id, state: 'garrisoned', travelGauge: 0 });
      fired = true;
    }
    if (tile.type === 'boon' && tile.boon) {
      const boon = tile.boon;
      for (const army of map.armies) for (const unit of army.units) unit.attrs[boon.attr] += boon.amount;
      fired = true;
    }
    if (fired) tile.effectClaimed = true;
  }
}
```
And in `runTick`, delete the `ownedBefore` line and call `applyCaptureEffects(run.map)`:
```ts
  advance(run.map, mapCommands);
  applyRestHealing(run.map);
  applyCaptureEffects(run.map);          // was applyCaptureEffects(run.map, ownedBefore)
  if (isWon(run.map)) run.status = 'won';
  else if (isLost(run.map)) run.status = 'lost';
```

- [ ] **Step 4: Run** → PASS. Then `npm test`, `npm run typecheck`, full parity (**21 fixtures**, `86e238c1` unchanged — incl. the existing `run-muster`/`run-boon` whose hashes must be identical: the claimed-flag fires on the same capture tick).

- [ ] **Step 5: Commit**
```bash
git add shared/types.ts sim/run.ts sim/run.test.ts
git commit -m "$(printf 'refactor(sim): tile effects fire once-ever via effectClaimed (recapture-safe)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Enemy reclaim (`applyEnemyAI`)

**Files:** Modify `shared/types.ts`, `sim/run.ts`; Test `sim/run.test.ts`.

**Interfaces:**
- Consumes: `applyCaptureEffects` (Task 1), `effectClaimed`.
- Produces: `MapSetup.enemyReclaims?: boolean`; `RunState.enemyReclaims: boolean`; `MapEvent` += `{ t:'reclaimed'; tile: string; by: string }`; `applyEnemyAI(map: MapState): void`.

- [ ] **Step 1: Write the failing tests** (`sim/run.test.ts`) — a garrisoned enemy tile `t1` between a defended player tile `t0` (army a1) and an **undefended** player tile `t2` (no army):
```ts
const reclaimMap = (enemyReclaims: boolean, t1garr = [u('g1','B',4)]): MapSetup => ({
  enemyReclaims,
  tiles: [
    { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
    { id: 't1', type: 'enemy', owner: 'enemy',  neighbors: { W: 't0', E: 't2' }, garrison: t1garr },
    { id: 't2', type: 'rest',  owner: 'player', neighbors: { W: 't1' }, garrison: [] }, // player-owned but undefended
  ],
  armies: [{ id: 'a1', tile: 't0', units: [u('a1u','A',9)] }],
});

it('a garrisoned enemy tile reclaims an undefended adjacent player tile (and fires a reclaimed event)', () => {
  const run = initRun(reclaimMap(true), 1);
  runTick(run, []); // a1 holds t0 (defended); t2 is undefended → t1 reclaims it
  expect(run.map.tiles.find((t) => t.id === 't2')!.owner).toBe('enemy');
  expect(run.map.tiles.find((t) => t.id === 't0')!.owner).toBe('player'); // defended, held
  expect(run.map.events.some((e) => e.t === 'reclaimed' && e.tile === 't2' && e.by === 't1')).toBe(true);
});

it('enemyReclaims=false ⇒ no reclaim', () => {
  const run = initRun(reclaimMap(false), 1);
  runTick(run, []);
  expect(run.map.tiles.find((t) => t.id === 't2')!.owner).toBe('player');
});

it('an un-garrisoned enemy tile does not reclaim', () => {
  const run = initRun(reclaimMap(true, []), 1); // t1 garrison empty
  runTick(run, []);
  expect(run.map.tiles.find((t) => t.id === 't2')!.owner).toBe('player');
});
```

- [ ] **Step 2: Run** → FAIL (`enemyReclaims` not on `MapSetup`/`RunState`; no reclaim; no `reclaimed` event type).

- [ ] **Step 3: Implement** — `shared/types.ts`: add `enemyReclaims?: boolean;` to `MapSetup`; add `| { t: 'reclaimed'; tile: string; by: string }` to the `MapEvent` union. `sim/run.ts`:
```ts
export interface RunState { map: MapState; status: 'active' | 'won' | 'lost' | 'extracted'; enemyReclaims: boolean; }
```
`initRun` returns `{ map, status: 'active', enemyReclaims: !!setup.enemyReclaims }` (keep the Task-1 pre-mark loop). Add:
```ts
function applyEnemyAI(map: MapState): void {
  const defended = new Set(map.armies.map((a) => a.tile)); // a player army on a tile holds it
  for (const tile of map.tiles) {                          // id-ordered by construction
    if (tile.owner !== 'enemy' || tile.garrison.length === 0) continue;
    for (const e of ['N', 'S', 'E', 'W'] as const) {
      const nb = tile.neighbors[e]; if (!nb) continue;
      const nt = map.tiles.find((t) => t.id === nb);
      if (nt && nt.owner === 'player' && !defended.has(nb)) {
        nt.owner = 'enemy';
        map.events.push({ t: 'reclaimed', tile: nb, by: tile.id });
        break; // one reclaim per enemy tile per tick
      }
    }
  }
}
```
In `runTick`, after `applyCaptureEffects(run.map)` and before the win/lose check:
```ts
  if (run.enemyReclaims) applyEnemyAI(run.map);
```

- [ ] **Step 4: Run** → PASS. Then `npm test`, typecheck, full parity (**21 fixtures**, `86e238c1` unchanged — existing fixtures don't set `enemyReclaims`, so `applyEnemyAI` never runs for them).

- [ ] **Step 5: Commit**
```bash
git add shared/types.ts sim/run.ts sim/run.test.ts
git commit -m "$(printf 'feat(sim): enemy map-AI — garrisoned tiles reclaim undefended player tiles (opt-in)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: v4 parity fixtures

**Files:** Modify `tools/parity/fixtures.mjs`; Test `sim/run.test.ts` (pin hashes).

- [ ] **Step 1: Add 2 v4 fixtures** to `tools/parity/fixtures.mjs` (capture procedure — `expectedHash:'PENDING'` → `npm run parity` → read the actual V8 hash → set it → re-run):
  - `run-reclaim-seed1` — `enemyReclaims: true`; a player start `t0` (army `a1`) — garrisoned enemy `t1` — undefended player `t2`. Script dispatches `a1` → `t1` at tick 0 (so the run TICKS while `a1` travels/fights; `t2` and the vacated `t0` get reclaimed by `t1` while it's still enemy-held). Run quiesces; the hash reflects the reclaim(s) + the t1 assault outcome. (Without a pending action the run would quiesce at tick 0 and the enemy never acts — the dispatch is what drives the ticks.)
  - `run-hold-seed1` — same map but a SECOND army `a2` garrisons `t2` (so `t2` is defended). Script dispatches `a1` → `t1`. The enemy reclaims the vacated `t0` but **not** `t2` (held by `a2`) — the hash reflects `t2` surviving.
  Each: `{ name, expectedHash, bundle: { version: 4, seed: 1, setup: { enemyReclaims: true, tiles: [...], armies: [...] }, script: [{ atTick: 0, commands: [{ t:'dispatch', armyId:'a1', toTile:'t1' }] }] } }` (reciprocal neighbors).

- [ ] **Step 2: Pin matching unit tests** (`sim/run.test.ts`) — `runScriptedRun(<each bundle>)` `.hash` equals the captured fixture hash (import `runScriptedRun` from `./replay`); assert the meaningful postcondition too (`run-reclaim`: `t2` owner `enemy`; `run-hold`: `t2` owner `player`). Mirror the exact bundles.

- [ ] **Step 3: Verify** — `npm test`; typecheck; full parity **23 fixtures** (21 existing UNCHANGED incl. `86e238c1` + `conquest-capture-seed0`=`356ce892` + `run-muster`=`205ee9dc` + `run-boon`=`2064aa00`; +2 new `run-reclaim`/`run-hold`), V8===goja. If any existing hash changed, STOP — the slice must be additive (opt-in default-off).

- [ ] **Step 4: Commit**
```bash
git add tools/parity/fixtures.mjs sim/run.test.ts
git commit -m "$(printf 'feat(sim): v4 parity fixtures — enemy reclaim + hold\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** `MapTile.effectClaimed` + `applyCaptureEffects` claimed-flag + `initRun` pre-mark (T1) ✓; `MapSetup.enemyReclaims` + `RunState.enemyReclaims` + `reclaimed` event + `applyEnemyAI` + `runTick` gating (T2) ✓; 2 v4 fixtures + anchor-frozen check (T3) ✓. Out-of-scope (lethal sorties / mobile armies) correctly absent.
- **Type consistency:** `applyCaptureEffects(map)` (one arg, T1) used in `runTick` (T1/T2); `applyEnemyAI(map)` (T2); `RunState.enemyReclaims` set by `initRun` (T2) + read in `runTick` (T2); `effectClaimed` (T1) honored by `applyEnemyAI`'s recapture path (T2). `reclaimed` event shape `{t,tile,by}` consistent.
- **Placeholders:** fixture hashes are `PENDING` capture sentinels (T3); test maps are concrete. No TBD/TODO logic.
- **Determinism:** RNG-free; `applyEnemyAI` id-ordered + fixed edge order; `effectClaimed`/`enemyReclaims` are bookkeeping/config (consequences hashed via `hashMap` tile owners + rosters). Anchor + 21 fixtures frozen (opt-in default-off + behavior-identical claimed swap). Only `sim/run.ts` + `shared/types.ts` + fixtures change — `conquest-map.ts`/`tile-fight.ts`/`replay.ts` untouched.
