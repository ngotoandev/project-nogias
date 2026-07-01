# Seeded Map Generation (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A seeded `/meta` generator `generateMap(seed, size)` that produces a deterministic, structurally valid, playable `MapSetup` — a column-banded W×H grid from a player start band to a boss, with recovery tiles spread toward the later columns and garrisons scaling by column.

**Architecture:** New `/meta` module (`meta/mapgen.ts`), seeded via `shared/rng.ts`'s `makeRng` (Mulberry32, integer-only), OUTSIDE the V8↔goja parity gate (per the master architecture, `/meta` generation is never cross-runtime-replayed). Output is a plain `MapSetup` the unchanged sim consumes. An esbuild `Meta` bundle exposes it to the browser viz + node smoke.

**Tech Stack:** TypeScript (goja-safe, integer-only), vitest, esbuild IIFE bundle, vanilla-JS canvas viz, Node vm smoke.

## Global Constraints

- **Zero `/sim` + zero fixture impact:** this slice touches NO `sim/` code and NO `tools/parity/fixtures.mjs`. Anchor `86e238c1` + all 29 fixtures stay frozen by construction (running `npm run parity` should still report `29 fixture(s)` unchanged as a sanity check, but map-gen is not parity-tested).
- **Deterministic + integer-only:** `generateMap` is pure, driven solely by `makeRng(seed)`, fixed roll order; same `(seed,size)` ⇒ byte-identical `MapSetup`. No `Date.now()`/`Math.random()`. (`Math.floor`/bit-ops on integers are fine.)
- **v1 = static garrisons:** generated setups use `enemyReclaims: false` and NO `enemyArmies` (no enemy AI). Only sim-implemented tile types: `start`/`enemy`/`boss`/`rest`/`muster`/`boon`.
- **Playable, not tuned:** v1 guarantees structural validity + playability, NOT a target win-rate (balance deferred).
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- `meta/mapgen.ts` — the generator + constants + `MapSize`.
- `meta/index.ts` — bundle barrel (`export { generateMap, MapSize }`).
- `meta/mapgen.test.ts` — determinism + structural tests.
- `tsconfig.json` / `tsconfig.test.json` — add `"meta"` to `include`.
- `package.json` — `bundle:meta` script.
- `tools/viz/{index.html,viz.js}` — Generate control; `tools/viz/smoke.mjs` — generate-and-play assertion.

---

### Task 1: The seeded generator (`meta/mapgen.ts`)

**Files:** Create `meta/mapgen.ts`, `meta/index.ts`, `meta/mapgen.test.ts`; Modify `tsconfig.json`, `tsconfig.test.json`.

**Interfaces:**
- Produces: `export type MapSize = 'small' | 'medium' | 'large'`; `export function generateMap(seed: number, size?: MapSize): MapSetup`.
- Consumes: `MapSetup`, `MapTile`, `UnitSpec`, `TileType`, `BoonSpec` (`shared/types`); `makeRng` (`shared/rng`).

- [ ] **Step 1: Add `meta` to the TS project.** In `tsconfig.json` change `"include": ["shared", "sim"]` → `"include": ["shared", "sim", "meta"]`. In `tsconfig.test.json` change `"include": ["shared", "sim"]` → `"include": ["shared", "sim", "meta"]`.

- [ ] **Step 2: Write the failing tests** — `meta/mapgen.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { generateMap } from './mapgen';
import type { MapSetup } from '../shared/types';

const colOf = (id: string): number => parseInt(id.slice(1, id.indexOf('r')), 10);
const RECOVERY = new Set(['rest', 'muster', 'boon']);

function connectedCount(setup: MapSetup): number {
  const byId = new Map(setup.tiles.map((t) => [t.id, t]));
  const seen = new Set<string>([setup.tiles[0]!.id]);
  const q = [setup.tiles[0]!.id];
  while (q.length) {
    const t = byId.get(q.shift()!)!;
    for (const e of ['N', 'S', 'E', 'W'] as const) {
      const nb = t.neighbors[e];
      if (nb && !seen.has(nb)) { seen.add(nb); q.push(nb); }
    }
  }
  return seen.size;
}

describe('generateMap', () => {
  it('is deterministic: same (seed,size) ⇒ deep-equal, different seed ⇒ differs', () => {
    expect(generateMap(42, 'medium')).toEqual(generateMap(42, 'medium'));
    expect(generateMap(42, 'medium')).not.toEqual(generateMap(43, 'medium'));
  });

  it('builds a W×H grid with reciprocal, in-bounds neighbors and is fully connected', () => {
    const m = generateMap(1, 'medium');                 // 5×3
    expect(m.tiles.length).toBe(15);
    const byId = new Map(m.tiles.map((t) => [t.id, t]));
    for (const t of m.tiles) {
      for (const e of ['N', 'S', 'E', 'W'] as const) {
        const nb = t.neighbors[e]; if (!nb) continue;
        expect(byId.has(nb)).toBe(true);
        const opp = { N: 'S', S: 'N', E: 'W', W: 'E' } as const;
        expect(byId.get(nb)!.neighbors[opp[e]]).toBe(t.id);
      }
    }
    expect(connectedCount(m)).toBe(15);
  });

  it('starts the player in column 0 with one army on the start tile; one enemy boss at the far column', () => {
    const m = generateMap(1, 'medium');                 // 5×3, mid row = 1
    expect(m.tiles.filter((t) => colOf(t.id) === 0).every((t) => t.owner === 'player')).toBe(true);
    expect(m.armies.length).toBe(1);
    expect(m.armies[0]!.tile).toBe('c0r1');
    const bosses = m.tiles.filter((t) => t.type === 'boss');
    expect(bosses.length).toBe(1);
    expect(bosses[0]!.id).toBe('c4r1');
    expect(bosses[0]!.owner).toBe('enemy');
    expect(m.enemyReclaims).toBe(false);
    expect(m.tiles.every((t) => ['start', 'enemy', 'boss', 'rest', 'muster', 'boon'].includes(t.type))).toBe(true);
  });

  it('spreads recovery toward later columns: ≥1 recovery tile in the final third', () => {
    const m = generateMap(1, 'large');                  // 6×4
    const w = 6, lastThird = w - Math.max(1, Math.floor(w / 3)); // = 4
    const lateRecovery = m.tiles.filter((t) => t.type !== 'boss' && colOf(t.id) >= lastThird && RECOVERY.has(t.type));
    expect(lateRecovery.length).toBeGreaterThanOrEqual(1);
    expect(m.tiles.some((t) => RECOVERY.has(t.type))).toBe(true);
  });

  it('scales plain-enemy garrison strength non-decreasingly by column', () => {
    const m = generateMap(1, 'large');
    const strByCol = m.tiles.filter((t) => t.type === 'enemy')
      .map((t) => ({ c: colOf(t.id), str: t.garrison[0]!.attrs.str }))
      .sort((a, b) => a.c - b.c);
    for (let i = 1; i < strByCol.length; i++) expect(strByCol[i]!.str).toBeGreaterThanOrEqual(strByCol[i - 1]!.str);
  });
});
```

- [ ] **Step 3: Run** → FAIL (`./mapgen` not found).

- [ ] **Step 4: Implement** `meta/mapgen.ts`:
```ts
import type { MapSetup, MapTile, UnitSpec, TileType, BoonSpec, MapEdge } from '../shared/types';
import { makeRng } from '../shared/rng';

export type MapSize = 'small' | 'medium' | 'large';

const DIMS: Record<MapSize, { w: number; h: number }> = {
  small: { w: 4, h: 3 }, medium: { w: 5, h: 3 }, large: { w: 6, h: 4 },
};

// Generation tunables (meta-only; NOT combat config).
const RECOVERY_BASE_BP = 1500;    // 15% baseline chance an enemy tile is recovery
const RECOVERY_SLOPE_BP = 4000;   // + up to +40% by the last column
const GARRISON_STR_BASE = 3;      // plain-enemy garrison str at column 1
const GARRISON_STR_STEP = 3;      // + per column toward the boss
const BOSS_STR_BONUS = 6;         // boss garrison extra str
const RECOVERY_TYPES: TileType[] = ['rest', 'muster', 'boon'];

const tid = (c: number, r: number): string => `c${c}r${r}`;
const colOf = (id: string): number => parseInt(id.slice(1, id.indexOf('r')), 10);
const isRecovery = (t: TileType): boolean => t === 'rest' || t === 'muster' || t === 'boon';

function unit(id: string, side: 'A' | 'B', str: number): UnitSpec {
  return { id, side, attackKind: 'melee', attrs: { str, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } };
}

export function generateMap(seed: number, size: MapSize = 'medium'): MapSetup {
  const rng = makeRng(seed);
  const { w, h } = DIMS[size];
  const mid = h >> 1;
  const startId = tid(0, mid);
  const bossId = tid(w - 1, mid);
  const tiles: MapTile[] = [];

  for (let c = 0; c < w; c++) {
    for (let r = 0; r < h; r++) {
      const id = tid(c, r);
      const neighbors: MapTile['neighbors'] = {};
      if (r > 0) neighbors.N = tid(c, r - 1);
      if (r < h - 1) neighbors.S = tid(c, r + 1);
      if (c > 0) neighbors.W = tid(c - 1, r);
      if (c < w - 1) neighbors.E = tid(c + 1, r);
      const owner: MapTile['owner'] = c === 0 ? 'player' : 'enemy';

      let type: TileType = 'enemy';
      let garrison: UnitSpec[] = [];
      let muster: UnitSpec[] | undefined;
      let boon: BoonSpec | undefined;

      if (id === bossId) {
        type = 'boss';
        garrison = [unit(`g_${id}`, 'B', GARRISON_STR_BASE + (w - 1) * GARRISON_STR_STEP + BOSS_STR_BONUS)];
      } else if (owner === 'player') {
        type = 'start';
      } else {
        const p = RECOVERY_BASE_BP + Math.floor((RECOVERY_SLOPE_BP * c) / (w - 1));
        if (rng.intInRange(0, 9999) < p) {
          type = RECOVERY_TYPES[rng.intInRange(0, RECOVERY_TYPES.length - 1)]!;
          if (type === 'muster') muster = [unit(`m_${id}`, 'A', 4)];
          if (type === 'boon') boon = { attr: 'str', amount: 2 };
          // recovery tiles are un-garrisoned — sustain must be reachable
        } else {
          garrison = [unit(`g_${id}`, 'B', GARRISON_STR_BASE + c * GARRISON_STR_STEP)];
        }
      }
      const tile: MapTile = { id, type, owner, neighbors, garrison };
      if (muster) tile.muster = muster;
      if (boon) tile.boon = boon;
      tiles.push(tile);
    }
  }

  // Guarantee ≥1 recovery tile in the final third of columns (the spread principle).
  const lastThird = w - Math.max(1, Math.floor(w / 3));
  if (!tiles.some((t) => t.id !== bossId && colOf(t.id) >= lastThird && isRecovery(t.type))) {
    const cand = tiles.find((t) => t.owner === 'enemy' && t.type === 'enemy' && colOf(t.id) >= lastThird);
    if (cand) { cand.type = 'rest'; cand.garrison = []; }
  }

  const armies = [{ id: 'p1', tile: startId, units: [unit('p1u1', 'A', 6), unit('p1u2', 'A', 6), unit('p1u3', 'A', 6)] }];
  return { tiles, armies, enemyReclaims: false };
}
```
Note: `MapEdge` import is only needed if referenced; if unused, drop it to satisfy `noUnusedLocals` (the codebase is `strict`). Keep imports to what's used.

- [ ] **Step 5: Create the barrel** `meta/index.ts`:
```ts
export { generateMap } from './mapgen';
export type { MapSize } from './mapgen';
```

- [ ] **Step 6: Run + verify** — `npx vitest run meta/mapgen.test.ts` (all pass); `npm test` (full suite, +5); `npm run typecheck` (compiles the new `meta/` module cleanly). Sanity: `export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity` → still `29 fixture(s)` (map-gen doesn't touch the sim).

- [ ] **Step 7: Commit**
```bash
git add meta/mapgen.ts meta/index.ts meta/mapgen.test.ts tsconfig.json tsconfig.test.json
git commit -m "$(printf 'feat(meta): seeded column-banded map generator\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: `Meta` bundle + generate-and-play smoke

**Files:** Modify `package.json`, `tools/viz/smoke.mjs`.

**Interfaces:** Consumes `generateMap` (Task 1) via the bundle global `Meta`; `Sim.initRun`/`runTick`.

- [ ] **Step 1: Add the bundle script.** In `package.json` `scripts`, after `"bundle"`, add:
```json
    "bundle:meta": "esbuild meta/index.ts --bundle --format=iife --global-name=Meta --target=es2015 --outfile=dist/meta-bundle.js",
```

- [ ] **Step 2: Build it** — `npm run bundle:meta` → writes `dist/meta-bundle.js` (exposes `Meta.generateMap`). (`dist/` is gitignored.)

- [ ] **Step 3: Add a generate-and-play assertion to `tools/viz/smoke.mjs`.** Load the meta bundle into the same vm sandbox (after the existing sim-bundle + setups loads, ~line 18):
```js
vm.runInContext(readFileSync(join(root, 'dist', 'meta-bundle.js'), 'utf8'), sandbox); // → sandbox.Meta
```
Update the destructure (`const { Sim, SETUPS } = sandbox;`) → `const { Sim, SETUPS, Meta } = sandbox;`. Then, after the existing assertions (before the final `SMOKE OK`), add:
```js
// (F) seeded map generation → valid + playable through the real sim
if (typeof Meta?.generateMap !== 'function') fail('Meta.generateMap missing from meta-bundle');
const colOfF = (id) => parseInt(id.slice(1, id.indexOf('r')), 10);
const genA = Meta.generateMap(7, 'medium');
const genB = Meta.generateMap(7, 'medium');
if (JSON.stringify(genA) !== JSON.stringify(genB)) fail('F: generateMap not deterministic for the same seed');
const rF = Sim.initRun(JSON.parse(JSON.stringify(genA)), 7);
let gI = 0;
for (; gI < 600 && rF.status === 'active'; gI++) Sim.runTick(rF, autopilot(rF.map));
if (rF.status === 'active') fail('F: generated map did not reach a terminal state in 600 ticks');
if (!rF.map.tiles.some((t) => t.owner === 'player' && colOfF(t.id) >= 1)) fail('F: player captured no enemy tile on the generated map');
console.log('map-gen         : OK (F generate → play → terminal: ' + rF.status + ' in ' + gI + ' ticks)');
```
(The existing `autopilot(m)` helper already dispatches each garrisoned army to its first non-owned neighbor — it works on any map.)

- [ ] **Step 4: Run** — `npm run bundle && npm run bundle:meta && node tools/viz/smoke.mjs` → prints the existing lines, then `map-gen         : OK (...)`, then `SMOKE OK` (exit 0). If F trips, diagnose honestly: a `deterministic` failure is a generator bug (fix in Task 1 territory — escalate); a `no capture`/`not terminal` failure means the generated map isn't playable — adjust the generation tunables (garrison strength) so a fresh army can at least take early tiles, but do NOT weaken the assertion.

- [ ] **Step 5: Commit**
```bash
git add package.json tools/viz/smoke.mjs
git commit -m "$(printf 'feat(meta+viz): Meta bundle + generate-and-play smoke\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: Viz "Generate" control

**Files:** Modify `tools/viz/index.html`, `tools/viz/viz.js`.

**Interfaces:** Consumes `Meta.generateMap` (Task 2 bundle) + the existing viz `start`/`render`/`computeLayout`/`stopResolve`.

- [ ] **Step 1: Load the meta bundle + add controls** in `tools/viz/index.html`. Before `<script src="setups.js"></script>` (line ~52) add:
```html
  <script src="../../dist/meta-bundle.js"></script>
```
In the header (after the `#seed` label, ~line 35) add a size select + Generate button:
```html
    <label>size <select id="size"><option value="small">small</option><option value="medium" selected>medium</option><option value="large">large</option></select></label>
    <button id="gen">Generate ⚲</button>
```

- [ ] **Step 2: Wire it in `tools/viz/viz.js`.** Add a `startGenerated` function next to `start()` (~line 31):
```js
  function startGenerated() {
    const Meta = globalThis.Meta;
    if (!Meta || !Meta.generateMap) { alert('dist/meta-bundle.js not loaded — run `npm run bundle:meta`'); return; }
    const seed = parseInt($('seed').value, 10) || 0;
    const size = $('size').value;
    run = Sim.initRun(Meta.generateMap(seed, size), seed);
    layout = computeLayout(run.map.tiles);
    selected = null; stopResolve(); render();
  }
```
And register the button next to the other listeners (~line 212):
```js
  $('gen').addEventListener('click', startGenerated);
```

- [ ] **Step 3: Verify** — `npm run bundle && npm run bundle:meta`; `node --check tools/viz/viz.js` (syntax OK). Manual browser check (open `tools/viz/index.html`, click Generate) is not headlessly reproducible — the Task-2 smoke already proves the generate-and-play logic; this task adds the visible control by construction. Confirm no dangling references and that `startGenerated` mirrors `start()` (both do `Sim.initRun(...)` → `computeLayout` → `render`).

- [ ] **Step 4: Commit**
```bash
git add tools/viz/index.html tools/viz/viz.js
git commit -m "$(printf 'feat(viz): Generate control drives Meta.generateMap live\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** `/meta` module + `generateMap(seed,size)` seeded via `makeRng` (spec §Architecture) → T1 ✓; column-banded grid + dims/ownership/boss/recovery-spread+final-third-guarantee/garrison-scaling/start-army (spec §Approach/§Placement/§Player-army) → T1 ✓; determinism + structural + garrison-scaling tests (spec §Testing) → T1 ✓; play-through smoke (spec §Testing) → T2 ✓; `Meta` bundle + viz Generate control (spec §Client) → T2/T3 ✓; zero sim/fixture impact + 29 frozen sanity (spec §Architecture) → T1 Step 6 ✓. Deferred items (tiers, inert tile types, mobile-army seeding, hero rosters, win-rate balance) absent.
- **Type consistency:** `MapSize`/`generateMap` signature consistent T1↔T2↔T3; tile ids `c{col}r{row}` + `colOf` parser identical in generator, tests, and smoke; `enemyReclaims:false`, no `enemyArmies`; only sim-implemented tile types; `UnitSpec`/`BoonSpec`/`MapTile` from `shared/types` match their definitions.
- **Placeholder scan:** no TBD/TODO; all constants have concrete values; the `MapEdge` import note prevents a `noUnusedLocals` slip.
- **Determinism/isolation:** single `makeRng(seed)`, fixed (c,r) roll order, integer-only; no `/sim` or fixture change ⇒ parity untouched; the smoke double-generates to assert determinism through the bundle.
