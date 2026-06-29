# V8↔goja Parity Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the deterministic sim produces an identical state hash in **both V8 and goja** for the same `(setup, seed)`, enforce it in CI, and fold in the parity-adjacent backlog carried forward from Plan 1.

**Architecture:** A1 adds a versioned replay bundle + a thin `runReplay` driver (the single entry both runtimes call), distinguishes a `timeout` from a `draw`, and pins existing primitives directly — all pure TypeScript, no new toolchain. A2 bundles `/sim`+`/shared` with esbuild into one goja-loadable script, runs it under both `node:vm` (V8) and a tiny Go+goja runner, and asserts `hashV8 === hashGoja === e9ff47f3` from a first GitHub Actions workflow.

**Tech Stack:** TypeScript (strict), Vitest, Node 20+, esbuild (bundler), Go 1.22+ with `github.com/dop251/goja` (dev/CI only), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-06-29-v8-goja-parity-harness-design.md`.

## Global Constraints

- **Determinism:** `/sim` and `/shared` are pure — no wall-clock, no `Date.now()`, no `Math.random()`, no I/O, no Node-only APIs. Deterministic iteration/sort order everywhere; RNG seeded and threaded explicitly.
- **goja-safety:** everything `runReplay` transitively imports must run unchanged in goja. Plain ECMAScript + integer ops (`Math.imul`, `>>> 0`, `| 0`). No ESM at the goja boundary (the bundle is an IIFE). Do **not** introduce ES2017+ builtins into `/sim` or `/shared` (this is why `padStart` is declined — keep the ES5-safe `('0000000'+h.toString(16)).slice(-8)` in `hash.ts`).
- **Integer math:** all sim quantities are integers; no float arithmetic in sim logic.
- **TypeScript strict mode** with `noUncheckedIndexedAccess`.
- **Golden invariant:** the tile-fight golden hash is `e9ff47f3` (`baseSetup`, seed 42). It must NOT change in this plan — every task runs the full suite and keeps it green. If a task ever moves it, stop: that signals an unintended behavioral change.
- **Node APIs are allowed only in `/tools`** (the dev-only harness: `node:vm`, `node:fs`, `node:child_process`). Never in `/sim` or `/shared`.
- **Bundle settings:** `esbuild sim/index.ts --bundle --format=iife --global-name=Sim --target=es2015 --outfile=dist/sim-bundle.js`, **no minification**. `dist/` is git-ignored.
- **Prerequisite for Tasks 6–7:** a Go toolchain on `PATH`. The committed harness skips the goja half gracefully when `go` is absent, but implementing/verifying Tasks 6–7 requires it. Install Go before starting Task 6.

---

### Task 1: Distinguish `timeout` from `draw` (`endReason`)

**Files:**
- Modify: `shared/types.ts`
- Modify: `sim/tile-fight.ts`
- Test: `sim/tile-fight.test.ts`

**Interfaces:**
- Consumes: existing `Side`, `FightEvent`, `FightResult`, `FightSetup`, `Unit`, `runTileFight`.
- Produces: `type EndReason = 'decisive' | 'wipe' | 'timeout'`; `FightResult.endReason: EndReason`; the `end` event gains `endReason: EndReason`. `winner: Side | 'draw'` is unchanged.

- [ ] **Step 1: Write the failing tests**

In `sim/tile-fight.test.ts`, replace the first test (`'resolves to a single winning side'`, lines 14–18) with the version below (drops the vacuous `toContain` and asserts `endReason`), and append the stalemate test:

```ts
  it('resolves with an end event and a consistent endReason', () => {
    const r = runTileFight(baseSetup, 42);
    expect(r.events.at(-1)).toMatchObject({ t: 'end' });
    if (r.winner === 'A' || r.winner === 'B') {
      expect(r.endReason).toBe('decisive');
    } else {
      expect(['wipe', 'timeout']).toContain(r.endReason);
    }
  });

  it('reports a timeout (not a wipe) when units cannot reach each other', () => {
    const walled: FightSetup = {
      grid: { width: 3, height: 1, blocked: [{ x: 1, y: 0 }] },
      units: [
        { id: 'a1', side: 'A', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, priority: 0, pos: { x: 0, y: 0 } },
        { id: 'b1', side: 'B', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, priority: 0, pos: { x: 2, y: 0 } },
      ],
    };
    const r = runTileFight(walled, 7);
    expect(r.winner).toBe('draw');
    expect(r.endReason).toBe('timeout');
    expect(r.ticks).toBeGreaterThan(100_000);
    expect(r.events.at(-1)).toMatchObject({ t: 'end', winner: 'draw', endReason: 'timeout' });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- sim/tile-fight.test.ts`
Expected: FAIL — `endReason` is `undefined` (property does not exist yet) and the type does not compile.

- [ ] **Step 3: Add the types**

In `shared/types.ts`, add the `EndReason` type just above `FightEvent`:

```ts
export type EndReason = 'decisive' | 'wipe' | 'timeout';
```

Change the `end` variant of `FightEvent` from:

```ts
  | { t: 'end'; winner: Side | 'draw'; ticks: number };
```

to:

```ts
  | { t: 'end'; winner: Side | 'draw'; ticks: number; endReason: EndReason };
```

Add `endReason` to `FightResult` (after `ticks`):

```ts
export interface FightResult {
  winner: Side | 'draw';
  ticks: number;
  endReason: EndReason;
  survivors: { id: string; side: Side; hp: number }[];
  events: FightEvent[];
  hash: string;
}
```

- [ ] **Step 4: Set `endReason` in the engine**

In `sim/tile-fight.ts`, add `EndReason` to the type import on line 1:

```ts
import type { Cell, EndReason, FightEvent, FightResult, FightSetup, Side, Unit } from '../shared/types';
```

Add a `timedOut` flag next to `totalTicks` (replace `let totalTicks = 0;`):

```ts
  let totalTicks = 0;
  let timedOut = false;
```

Set the flag on the cap break (replace `if (totalTicks > MAX_TICKS) break;`):

```ts
    if (totalTicks > MAX_TICKS) { timedOut = true; break; }
```

Finally, replace the end-of-function block (from `const fin = sidesAlive();` through the `return { ... };`) with:

```ts
  const fin = sidesAlive();
  const winner: Side | 'draw' = fin.a && !fin.b ? 'A' : fin.b && !fin.a ? 'B' : 'draw';
  const endReason: EndReason = winner !== 'draw' ? 'decisive' : timedOut ? 'timeout' : 'wipe';
  events.push({ t: 'end', winner, ticks: totalTicks, endReason });

  return {
    winner,
    ticks: totalTicks,
    endReason,
    survivors: units.filter((u) => u.hp > 0).map((u) => ({ id: u.id, side: u.side, hp: u.hp })),
    events,
    hash: hashFight(units, totalTicks),
  };
```

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests PASS (including the unchanged golden `e9ff47f3` and determinism tests); `tsc` clean. The `endReason` addition does not touch `hashFight` inputs, so the golden is unaffected.

- [ ] **Step 6: Commit**

```bash
git add shared/types.ts sim/tile-fight.ts sim/tile-fight.test.ts
git commit -m "feat(sim): distinguish timeout from draw via endReason"
```

---

### Task 2: Replay bundle + `runReplay` driver

**Files:**
- Modify: `shared/types.ts`
- Create: `sim/replay.ts`
- Test: `sim/replay.test.ts`

**Interfaces:**
- Consumes: `runTileFight` (`sim/tile-fight`); `FightSetup`, `Side`, `EndReason` (`shared/types`).
- Produces:
  - `interface ReplayBundle { version: 1; setup: FightSetup; seed: number }`
  - `interface ReplayResult { hash: string; winner: Side | 'draw'; ticks: number; endReason: EndReason }`
  - `function runReplay(bundle: ReplayBundle): ReplayResult`

- [ ] **Step 1: Write the failing test**

Create `sim/replay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runReplay } from './replay';
import type { ReplayBundle } from '../shared/types';

const canonical: ReplayBundle = {
  version: 1,
  seed: 42,
  setup: {
    grid: { width: 8, height: 8, blocked: [] },
    units: [
      { id: 'a1', side: 'A', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
      { id: 'b1', side: 'B', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 7, y: 7 } },
    ],
  },
};

describe('runReplay', () => {
  it('reproduces the tile-fight golden hash for the canonical bundle', () => {
    expect(runReplay(canonical).hash).toBe('e9ff47f3');
  });

  it('round-trips through JSON to an identical result', () => {
    const a = runReplay(canonical);
    const b = runReplay(JSON.parse(JSON.stringify(canonical)) as ReplayBundle);
    expect(b).toEqual(a);
  });

  it('projects winner, ticks and endReason from the fight', () => {
    const r = runReplay(canonical);
    expect(r.winner === 'A' || r.winner === 'B').toBe(true); // canonical fight is decisive
    expect(r.endReason).toBe('decisive');
    expect(r.ticks).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sim/replay.test.ts`
Expected: FAIL — cannot resolve `./replay`.

- [ ] **Step 3: Add the bundle types**

In `shared/types.ts`, append:

```ts
export interface ReplayBundle {
  version: 1;          // envelope version; later plans add a `commands` stream
  setup: FightSetup;
  seed: number;
}

export interface ReplayResult {
  hash: string;        // hashFight of the final state — the parity target
  winner: Side | 'draw';
  ticks: number;
  endReason: EndReason;
}
```

- [ ] **Step 4: Write the driver**

Create `sim/replay.ts`:

```ts
import type { ReplayBundle, ReplayResult } from '../shared/types';
import { runTileFight } from './tile-fight';

// The single entry both runtimes (V8 sidecar, goja server) invoke for parity.
// Pure and goja-safe: delegates to runTileFight and projects the result to the
// minimal cross-runtime surface (hash + outcome). The `version` envelope lets
// later plans add a command/input-log stream without breaking the wire format.
export function runReplay(bundle: ReplayBundle): ReplayResult {
  const r = runTileFight(bundle.setup, bundle.seed);
  return { hash: r.hash, winner: r.winner, ticks: r.ticks, endReason: r.endReason };
}
```

- [ ] **Step 5: Run test + full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS; golden `e9ff47f3` still green; `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add shared/types.ts sim/replay.ts sim/replay.test.ts
git commit -m "feat(sim): versioned replay bundle + runReplay driver"
```

---

### Task 3: Direct primitive pins + naming cosmetics

**Files:**
- Modify: `sim/hash.test.ts`
- Modify: `sim/stats.test.ts`
- Modify: `sim/stats.ts`

**Interfaces:**
- Consumes: `fnv1a` (`sim/hash`), `deriveStats` (`sim/stats`).
- Produces: no new exports. Adds characterization pins (lock current values so goja must reproduce them) and renames internal constants in `stats.ts`.

These are pinning/refactor steps: the new assertions pass immediately against current code and lock the values; the rename keeps tests green. The `fnv1a` literals below were computed in V8 and become the cross-runtime parity anchors once goja runs.

- [ ] **Step 1: Pin `fnv1a` golden values**

Append to `sim/hash.test.ts`:

```ts
describe('fnv1a golden values', () => {
  it('pins exact hashes (must hold identically in goja — parity anchor)', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('hello')).toBe('4f9f2cab');
    expect(fnv1a('nogias')).toBe('35e9a4e6');
    expect(fnv1a('project-nogias')).toBe('d6e652d2');
  });

  it('zero-pads to 8 hex chars (leading-zero branch pinned)', () => {
    expect(fnv1a('68')).toBe('0de8d5a3'); // this hash begins with 0
    for (let i = 0; i < 2000; i++) {
      expect(fnv1a(String(i))).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});
```

- [ ] **Step 2: Add the `tempoRate` AGI-monotonicity test**

Append inside the existing `describe('deriveStats', ...)` block in `sim/stats.test.ts` (before its closing `});`):

```ts
  it('is monotonic in AGI for tempoRate', () => {
    let prev = -1;
    for (let agi = 1; agi <= 9; agi++) {
      const d = deriveStats({ str: 1, agi, int: 1, lck: 1 });
      expect(d.tempoRate).toBeGreaterThan(prev);
      prev = d.tempoRate;
    }
  });
```

- [ ] **Step 3: Run the new tests to verify they pass**

Run: `npm test -- sim/hash.test.ts sim/stats.test.ts`
Expected: PASS — the pins match current behavior.

- [ ] **Step 4: Tidy `stats.ts` constant naming**

The scaled bases (`*_BASE`) are added to an attribute term; the ranges are flat constants. Rename the misnamed `MOVE_BASE` to the parallel flat name `MOVE_RANGE`. Replace the whole body of `sim/stats.ts` with:

```ts
import type { Attributes, DerivedStats } from '../shared/types';

// Scaled bases — added to an attribute-scaled term:
const HP_BASE = 20;
const ATK_BASE = 5;
const TEMPO_BASE = 10;
// Flat ranges — no attribute scaling yet:
const MOVE_RANGE = 3;
const ATTACK_RANGE = 1;

// Minimal subset of the GDD Part II formulas needed for the melee slice.
export function deriveStats(a: Attributes): DerivedStats {
  return {
    maxHp: HP_BASE + a.str * 5,
    attack: ATK_BASE + a.str * 2 + a.agi,
    tempoRate: TEMPO_BASE + a.agi,
    moveRange: MOVE_RANGE,
    attackRange: ATTACK_RANGE,
  };
}
```

- [ ] **Step 5: Run full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS (values unchanged by the rename); golden `e9ff47f3` green; `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add sim/hash.test.ts sim/stats.test.ts sim/stats.ts
git commit -m "test(sim): pin fnv1a goldens + tempoRate monotonicity; tidy stats naming"
```

---

### Task 4: Split typecheck — exclude tests from the shippable config

**Files:**
- Modify: `tsconfig.json`
- Create: `tsconfig.test.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `tsconfig.json` typechecks the shippable sim only (no `*.test.ts`); `tsconfig.test.json` typechecks the test files; `npm run typecheck` runs both. This both closes the Plan-1 gap (tests now typechecked under a config that knows about them) and keeps tests out of the bundle path in Task 5.

- [ ] **Step 1: Exclude tests from the production config**

Replace `tsconfig.json` with (adds the `exclude` line; compiler options unchanged):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["shared", "sim"],
  "exclude": ["**/*.test.ts"]
}
```

- [ ] **Step 2: Create the test config**

Create `tsconfig.test.json`. It extends the base but **clears** the inherited `exclude` so the test files are typechecked:

```json
{
  "extends": "./tsconfig.json",
  "include": ["shared", "sim"],
  "exclude": []
}
```

- [ ] **Step 3: Point `typecheck` at both configs**

In `package.json`, change the `typecheck` script from `"tsc --noEmit"` to:

```json
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.test.json",
```

- [ ] **Step 4: Verify the split**

Run: `npm run typecheck`
Expected: both invocations clean (exit 0).

Run: `npx tsc -p tsconfig.json --listFiles | grep -c "\.test\.ts"`
Expected: `0` (the production config sees no test files).

Run: `npx tsc -p tsconfig.test.json --listFiles | grep -c "\.test\.ts"`
Expected: a non-zero count (the test config sees them).

- [ ] **Step 5: Commit**

```bash
git add tsconfig.json tsconfig.test.json package.json
git commit -m "build: split typecheck so tests are checked but excluded from the shippable config"
```

---

### Task 5: esbuild bundle + V8 (node:vm) runner + canonical fixture

**Files:**
- Create: `sim/index.ts`
- Create: `tools/parity/fixtures.mjs`
- Create: `tools/parity/run-node.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `runReplay`, `runTileFight` (`sim/*`).
- Produces:
  - `dist/sim-bundle.js` (git-ignored) — IIFE exposing global `Sim` with `Sim.runReplay(bundle)`.
  - `FIXTURES` (`tools/parity/fixtures.mjs`): `Array<{ name: string; expectedHash: string; bundle: ReplayBundle }>`.
  - `hashInV8(bundleSource: string, bundle: object): string` (`tools/parity/run-node.mjs`).
  - npm script `bundle`.

- [ ] **Step 1: Install esbuild (dev dependency)**

Run: `npm install --save-dev esbuild`
Expected: `esbuild` added to `devDependencies`; `package-lock.json` updated.

- [ ] **Step 2: Create the bundle entry barrel**

Create `sim/index.ts`:

```ts
// esbuild entry: the sim's public surface, bundled to a single goja-loadable
// IIFE (global `Sim`). Keep this free of Node APIs — it ships into goja.
export { runReplay } from './replay';
export { runTileFight } from './tile-fight';
```

- [ ] **Step 3: Add the `bundle` script**

In `package.json`, add to `scripts`:

```json
    "bundle": "esbuild sim/index.ts --bundle --format=iife --global-name=Sim --target=es2015 --outfile=dist/sim-bundle.js",
```

- [ ] **Step 4: Build the bundle**

Run: `npm run bundle`
Expected: `dist/sim-bundle.js` created. Confirm it defines the global:

Run: `node -e "const s=require('node:fs').readFileSync('dist/sim-bundle.js','utf8'); console.log(/var Sim\s*=/.test(s) ? 'OK Sim global' : 'MISSING Sim global')"`
Expected: `OK Sim global`.

- [ ] **Step 5: Create the canonical fixture**

Create `tools/parity/fixtures.mjs`:

```js
// Canonical replay fixture. expectedHash is the V8 golden (sim/tile-fight
// golden e9ff47f3); the parity harness requires goja to reproduce it exactly.
// Add more {name, expectedHash, bundle} entries here to broaden coverage.
export const FIXTURES = [
  {
    name: 'canonical-baseSetup-seed42',
    expectedHash: 'e9ff47f3',
    bundle: {
      version: 1,
      seed: 42,
      setup: {
        grid: { width: 8, height: 8, blocked: [] },
        units: [
          { id: 'a1', side: 'A', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
          { id: 'b1', side: 'B', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 7, y: 7 } },
        ],
      },
    },
  },
];
```

- [ ] **Step 6: Create the V8 bundle runner**

Create `tools/parity/run-node.mjs`:

```js
import vm from 'node:vm';

// Run the bundled sim under Node's V8 and return the replay hash. The bundle is
// an IIFE (not an ES module), so we evaluate it in a fresh vm context and read
// back the global `Sim`. This mirrors the goja runner exactly: same bundle,
// same JSON-in / JSON-out call shape.
export function hashInV8(bundleSource, bundle) {
  const sandbox = { __bundleJson: JSON.stringify(bundle) };
  const context = vm.createContext(sandbox);
  vm.runInContext(bundleSource, context); // defines global `Sim`
  const out = vm.runInContext(
    'JSON.stringify(Sim.runReplay(JSON.parse(__bundleJson)))',
    context,
  );
  return JSON.parse(out).hash;
}
```

- [ ] **Step 7: Verify V8-through-bundle reproduces the golden**

Run:

```bash
npm run bundle && node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { hashInV8 } from './tools/parity/run-node.mjs';
import { FIXTURES } from './tools/parity/fixtures.mjs';
const src = readFileSync('dist/sim-bundle.js', 'utf8');
for (const f of FIXTURES) {
  const h = hashInV8(src, f.bundle);
  if (h !== f.expectedHash) { console.error('FAIL', f.name, h, '!=', f.expectedHash); process.exit(1); }
  console.log('OK', f.name, h);
}
"
```

Expected: `OK canonical-baseSetup-seed42 e9ff47f3` — the esbuild bundle did not alter behavior under V8.

- [ ] **Step 8: Commit**

```bash
git add sim/index.ts tools/parity/fixtures.mjs tools/parity/run-node.mjs package.json package-lock.json
git commit -m "build(parity): esbuild bundle + V8 node:vm runner + canonical fixture"
```

---

### Task 6: Go + goja runner

**Prerequisite:** Go 1.22+ on `PATH` (`go version` succeeds). Network access on first build to fetch goja.

**Files:**
- Create: `tools/parity/goja-runner/go.mod` (+ `go.sum`, generated)
- Create: `tools/parity/goja-runner/main.go`

**Interfaces:**
- Consumes: `dist/sim-bundle.js` (arg 1); a `ReplayBundle` JSON on stdin.
- Produces: a CLI that prints the `ReplayResult` JSON (`{"hash":...,"winner":...,"ticks":...,"endReason":...}`) to stdout — the goja-side hash for the parity comparison.

- [ ] **Step 1: Initialize the Go module**

Run:

```bash
cd tools/parity/goja-runner && go mod init nogias/parity-goja-runner
```

Expected: `go.mod` created with `module nogias/parity-goja-runner`.

- [ ] **Step 2: Write the runner**

Create `tools/parity/goja-runner/main.go`:

```go
// Runs the bundled TS sim inside goja (the Nakama JS runtime) and prints the
// ReplayResult JSON. Same bundle + same JSON-in/JSON-out shape as the V8 runner,
// so a hash difference is a real cross-runtime divergence.
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/dop251/goja"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: goja-runner <bundle.js>  (ReplayBundle JSON on stdin)")
		os.Exit(2)
	}
	bundleSrc, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "read bundle:", err)
		os.Exit(1)
	}
	bundleJSON, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintln(os.Stderr, "read stdin:", err)
		os.Exit(1)
	}

	vm := goja.New()
	if _, err := vm.RunString(string(bundleSrc)); err != nil {
		fmt.Fprintln(os.Stderr, "load bundle:", err)
		os.Exit(1)
	}
	if err := vm.Set("__bundleJson", string(bundleJSON)); err != nil {
		fmt.Fprintln(os.Stderr, "set input:", err)
		os.Exit(1)
	}
	v, err := vm.RunString("JSON.stringify(Sim.runReplay(JSON.parse(__bundleJson)))")
	if err != nil {
		fmt.Fprintln(os.Stderr, "run replay:", err)
		os.Exit(1)
	}
	fmt.Print(v.String())
}
```

- [ ] **Step 3: Fetch the pinned goja dependency**

Run (from `tools/parity/goja-runner`):

```bash
go get github.com/dop251/goja@latest && go mod tidy
```

Expected: `go.mod` gains a pinned `require github.com/dop251/goja v0.0.0-...`; `go.sum` is written. (Committing both pins the harness.)

- [ ] **Step 4: Verify goja reproduces the golden**

From the repo root:

```bash
npm run bundle && node --input-type=module -e "
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { FIXTURES } from './tools/parity/fixtures.mjs';
const out = execFileSync('go', ['run', '.', resolve('dist/sim-bundle.js')], {
  cwd: resolve('tools/parity/goja-runner'),
  input: JSON.stringify(FIXTURES[0].bundle),
  encoding: 'utf8',
});
console.log(out.trim());
"
```

Expected: a JSON line whose `hash` is `e9ff47f3`, e.g. `{"hash":"e9ff47f3","winner":"A","ticks":...,"endReason":"decisive"}`. **This is the moment goja-safety stops being an assertion** — the sim has now run in goja and matched V8.

If goja errors instead (e.g. an unsupported builtin), that is a real parity bug: stop and debug the offending sim code with systematic-debugging — do not work around it in `/tools`.

- [ ] **Step 5: Commit**

```bash
git add tools/parity/goja-runner/go.mod tools/parity/goja-runner/go.sum tools/parity/goja-runner/main.go
git commit -m "feat(parity): Go+goja runner for the bundled sim"
```

---

### Task 7: Parity orchestrator + graceful skip

**Files:**
- Create: `tools/parity/parity.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `hashInV8` (`./run-node.mjs`), `FIXTURES` (`./fixtures.mjs`), the Go runner (`tools/parity/goja-runner`), `dist/sim-bundle.js`.
- Produces: npm script `parity` that asserts `hashV8 === hashGoja === expectedHash` for every fixture; exits non-zero on mismatch; skips the goja half (exit 0) when `go` is absent.

- [ ] **Step 1: Write the orchestrator**

Create `tools/parity/parity.mjs`:

```js
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { hashInV8 } from './run-node.mjs';
import { FIXTURES } from './fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const bundlePath = resolve(root, 'dist', 'sim-bundle.js');
const runnerDir = resolve(root, 'tools', 'parity', 'goja-runner');

// Ensure the bundle exists (build on demand).
if (!existsSync(bundlePath)) {
  execFileSync('npm', ['run', 'bundle'], { cwd: root, stdio: 'inherit', shell: true });
}
const bundleSource = readFileSync(bundlePath, 'utf8');

let failed = false;

// V8 side: the bundle must reproduce each fixture's expected hash.
for (const f of FIXTURES) {
  const v8 = hashInV8(bundleSource, f.bundle);
  if (v8 !== f.expectedHash) {
    console.error(`V8 mismatch [${f.name}]: ${v8} !== ${f.expectedHash}`);
    failed = true;
  }
}

// goja side: skip gracefully when Go is not installed (CI enforces it).
const goProbe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['go']);
if (goProbe.status !== 0) {
  console.log('Go absent — skipping goja parity (CI enforces it).');
} else {
  for (const f of FIXTURES) {
    const out = execFileSync('go', ['run', '.', bundlePath], {
      cwd: runnerDir,
      input: JSON.stringify(f.bundle),
      encoding: 'utf8',
    });
    const goja = JSON.parse(out).hash;
    if (goja !== f.expectedHash) {
      console.error(`goja mismatch [${f.name}]: ${goja} !== ${f.expectedHash}`);
      failed = true;
    }
  }
  console.log('goja parity checked.');
}

if (failed) {
  console.error('PARITY FAILED');
  process.exit(1);
}
console.log('PARITY OK (V8 === goja === expected) for', FIXTURES.length, 'fixture(s).');
```

- [ ] **Step 2: Add the `parity` script**

In `package.json`, add to `scripts`:

```json
    "parity": "node tools/parity/parity.mjs",
```

- [ ] **Step 3: Run the full parity gate (Go installed)**

Run: `npm run parity`
Expected: `goja parity checked.` then `PARITY OK (V8 === goja === expected) for 1 fixture(s).`, exit 0.

- [ ] **Step 4: Verify the graceful skip**

Run (temporarily hide Go from PATH to simulate a Go-free machine):

```bash
PATH="/usr/bin:/bin" npm run parity
```

Expected: prints `Go absent — skipping goja parity (CI enforces it).` and `PARITY OK ...`, exit 0. (On Windows, instead run from a shell where `go` is not on `PATH`; the assertion is that a missing `go` yields a clean skip, not a failure.)

- [ ] **Step 5: Commit**

```bash
git add tools/parity/parity.mjs package.json
git commit -m "feat(parity): three-way V8/goja/golden assertion with graceful skip"
```

---

### Task 8: CI workflow — enforce parity on push

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `npm ci`, `npm run typecheck`, `npm test`, `npm run bundle`, `npm run parity`; `actions/setup-go`.
- Produces: a push-triggered workflow that fails the build on any typecheck, test, or parity divergence.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: ci
on: [push]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test

      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - run: npm run bundle
      - run: npm run parity
```

- [ ] **Step 2: Validate the workflow locally (mirror the CI steps)**

Run: `npm ci && npm run typecheck && npm test && npm run bundle && npm run parity`
Expected: every step green; final line `PARITY OK ...`. (This is the exact sequence CI runs, with Go present.)

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: enforce typecheck + tests + V8/goja parity on push"
git push
```

- [ ] **Step 4: Confirm the run is green**

Check the Actions tab for `origin/plan-2-parity-harness` (or `gh run list --branch plan-2-parity-harness`). Expected: the `ci / verify` run succeeds, including the `npm run parity` step asserting goja parity in a clean CI environment.

---

## Self-Review

**1. Spec coverage** (spec §2.1 in-scope items → tasks):
- Replay bundle + `runReplay` driver → Task 2 ✓
- `timeout`-vs-`draw` (`endReason`) + stalemate/`MAX_TICKS` test → Task 1 ✓
- Direct `fnv1a` golden pin (incl. leading-zero) → Task 3 ✓
- `tempoRate` AGI-monotonicity → Task 3 ✓
- `tsconfig` test/sim split → Task 4 ✓
- Cosmetics (drop vacuous `toContain`, stats naming) → Tasks 1 + 3 ✓; `padStart` declined per Global Constraints ✓
- esbuild bundle of `/sim`+`/shared` → Task 5 ✓
- Go+goja runner → Task 6 ✓
- Three-way parity assertion (`hashV8 === hashGoja === e9ff47f3`) → Tasks 5 (V8) + 7 (full) ✓
- First GitHub Actions workflow enforcing on push → Task 8 ✓
- Out-of-scope (command stream, combat depth, padStart) → reserved via `version` / explicitly excluded ✓

**2. Placeholder scan:** No "TBD/TODO/handle edge cases". `fnv1a` literals are real V8-computed values; `e9ff47f3` is the established golden. The goja `go.mod` pseudo-version is intentionally resolved by `go get` (Task 6 Step 3) rather than hardcoded, since it cannot be known ahead of the fetch — this is a generated-and-committed pin, not a placeholder.

**3. Type consistency:** `EndReason` defined once (Task 1), consumed by `FightResult`/`end` event (Task 1) and `ReplayResult` (Task 2). `ReplayBundle`/`ReplayResult` defined in Task 2, consumed by `runReplay` (Task 2), `fixtures.mjs` (Task 5, as plain JSON matching the shape), and both runners. `Sim.runReplay` (the bundle global) is produced in Task 5 and called identically by `hashInV8` (Task 5) and `main.go` (Task 6). `hashInV8(bundleSource, bundle)` and `FIXTURES` signatures match their consumers in `parity.mjs` (Task 7). The golden `e9ff47f3` is the single value referenced by Tasks 1, 2, 5, 6, 7, 8.
