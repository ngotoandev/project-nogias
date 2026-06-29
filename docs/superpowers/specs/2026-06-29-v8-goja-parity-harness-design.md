# V8↔goja Parity Harness (Plan 2) — Design

Status: **draft for review** · drafted 2026-06-29 · implements the determinism critical path from `docs/superpowers/specs/2026-06-29-combat-rework-and-architecture-design.md` §4.6–§4.7, pulling forward roadmap item 7 of `docs/superpowers/plans/2026-06-29-tile-fight-engine.md`.

This is the design for **Plan 2**. Plan 1 (the deterministic tile-fight engine) is complete and merged; `runTileFight(setup, seed): FightResult` resolves a fight to a winner with an FNV-1a state hash, golden-pinned at `e9ff47f3`.

---

## 1. Context & Goal

The architecture names **V8↔goja parity** as the project's determinism critical path (spec §4.1, §4.6, §4.7): the one TypeScript `/sim` runs in **V8** (the solo Node sidecar) and later in **goja** (the Nakama server's JS runtime), and everything the design sells — replay, daily seed, telemetry margins, bank-time re-sim, co-op lockstep — rests on the sim being **bit-identical across both runtimes**.

Today that property is **written-for but only asserted, never executed**: `/sim` and `/shared` are authored to be goja-safe (integer math, `Math.imul`/`>>>`, seeded RNG, deterministic sort order, no Node APIs), but no test has ever run the sim inside goja. The golden hash `e9ff47f3` pins V8 determinism only.

**Goal of Plan 2:** turn goja-safety from *asserted* into *executed and enforced* — prove that the same `(setup, seed)` produces hash `e9ff47f3` in **both V8 and goja**, gate it in CI, and fold in the parity-adjacent backlog carried forward from Plan 1's reviews. Do this now, while the sim is six small modules and one melee channel, so the gate exists *before* the parity-fragile code (two-channel damage, line-of-sight, skill formulas) arrives in later plans.

### Why this shape (approach)

For the cross-runtime half there is only one *faithful* option: bundle the sim and run it in **goja itself** (`github.com/dop251/goja`), because goja is the actual Nakama runtime. Testing against a different JS engine (QuickJS, a second V8) would prove nothing about the runtime we will actually deploy to. So the approach question is not "which engine" but "how thin can the harness be" — and the answer is *very thin*, because `runTileFight(setup, seed)` is already the pure, replayable function. The harness wraps it, serializes its inputs, and compares its hash across runtimes.

---

## 2. Scope

Plan 2 = **A1** (replay harness + backlog, no new toolchain) + **A2** (cross-runtime parity, adds Go + esbuild + first CI). A1 lands first and is independently valuable; A2 layers the goja runner and CI gate on top.

### 2.1 In scope
- A serializable replay bundle and a thin `runReplay` driver (the single entry both runtimes call).
- A `timeout`-vs-`draw` outcome distinction for the conquest layer (`endReason`), plus the missing stalemate/`MAX_TICKS` test.
- The parity-adjacent backlog: direct `fnv1a` golden pin, `tempoRate` AGI-monotonicity test, the test/sim `tsconfig` split, and small cosmetics.
- An esbuild bundle of `/sim`+`/shared` to a single goja-loadable script.
- A Go + goja runner and a three-way parity assertion (`hashV8 === hashGoja === e9ff47f3`).
- A first GitHub Actions workflow enforcing typecheck + tests + parity on push.

### 2.2 Out of scope (forward-looking, named so they are not mistaken for gaps)
- The per-tick **command / input-log** stream: no commands exist until the conquest map (Plan 4). The bundle envelope reserves a `version` field so the format grows without breaking.
- Any **combat-depth** work (two-channel damage, ranged/LoS, skills/Mana, traits) — that is the deferred Plan B / roadmap item "Full combat depth".
- Single-binary sidecar packaging, the lockstep relay, and the Godot client/bridge (later roadmap items).
- The `padStart(8,'0')` cosmetic from the backlog is **declined** (§4.3) — the ES5-safe form is already correct and avoids adding an ES2017 parity surface for no benefit.

---

## 3. Architecture fit

```
/shared   types (+ ReplayBundle)                         parity-critical, in the bundle
/sim      stat-resolve • grid • initiative • hash
          • tile-fight • replay (runReplay)              parity-critical, in the bundle
          • index.ts (esbuild entry barrel)
/tools    parity/  parity.mjs • run-node helper          dev-only harness (NOT in the bundle)
          parity/goja-runner/  go.mod • main.go          dev-only goja host
/.github  workflows/ci.yml                               enforcing gate (push)
dist/     sim-bundle.js                                  git-ignored build artifact
```

`runReplay` lives in `/sim` (not `/tools`) because it is the entry the goja runner executes, so it must be inside the parity-critical bundle. The harness *driver* (`tools/parity/*`) is dev-only and never bundled or cross-runtime-replayed.

---

## 4. A1 — Replay harness + backlog (zero new toolchain)

### 4.1 Replay bundle + driver

A versioned, JSON-serializable envelope and a thin driver that both runtimes call identically:

```ts
// shared/types.ts
export interface ReplayBundle {
  version: 1;          // envelope version; future plans add a `commands` field
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

```ts
// sim/replay.ts
export function runReplay(bundle: ReplayBundle): ReplayResult;
```

`runReplay` calls `runTileFight(bundle.setup, bundle.seed)` and projects the `FightResult` to the small, stable `ReplayResult` (hash + winner + ticks + endReason). It is pure and goja-safe. It is the **single entry both V8 and goja invoke**, so the comparison is apples-to-apples and the `version` envelope is where the future command stream lands without breaking the wire format.

**Tests (`sim/replay.test.ts`):** serialize→`JSON.parse`→`runReplay` round-trips to an identical hash; a canonical bundle (`baseSetup`, seed 42) pins `e9ff47f3` (the same value `runTileFight` already pins, proving the projection is faithful).

### 4.2 Outcome semantics — `endReason` (`timeout` vs `draw`)

Today, a true mutual wipe and a `MAX_TICKS` stalemate both surface as `winner: 'draw'`, which the conquest layer cannot tell apart — a stalemate where a defender holds the tile is not mutual annihilation. We add a reason without disturbing existing consumers:

```ts
export type EndReason = 'decisive' | 'wipe' | 'timeout';
// 'decisive' — one side eliminated, the other survives (winner is 'A' | 'B')
// 'wipe'     — both sides eliminated in the same resolution (winner 'draw')
// 'timeout'  — MAX_TICKS hit with both sides still alive (winner 'draw')
```

- `winner: Side | 'draw'` is **unchanged**, so no existing test or consumer breaks.
- `FightResult` gains `endReason: EndReason`; the `end` event gains `endReason`.
- `runTileFight` sets it: decisive when exactly one side survives; on the `MAX_TICKS` break path `timeout`; otherwise (both sides empty) `wipe`.

**Stalemate test (`sim/tile-fight.test.ts`):** a setup with the two units walled apart by blocked cells so neither can path to the other → the loop advances ticks until `totalTicks > MAX_TICKS` → asserts `winner: 'draw'`, `endReason: 'timeout'`, and `ticks` at the cap boundary. This is the currently-missing `MAX_TICKS` coverage.

### 4.3 Folded-in backlog (from Plan 1 reviews)

- **Direct `fnv1a` golden pin** (`sim/hash.test.ts`): assert `fnv1a('<fixed string>')` equals a captured literal (today `fnv1a` is pinned only transitively through `e9ff47f3`). Include at least one input whose hash has a **leading zero**, so the zero-padding branch is pinned directly.
- **`tempoRate` AGI-monotonicity** (`sim/stats.test.ts`): strictly increasing in AGI (mirrors the existing STR→hp/attack monotonicity test).
- **`tsconfig` split:** the shippable config (read by the bundler and `npm run typecheck`) excludes `**/*.test.ts`; a `tsconfig.test.json` extends it and adds the test files back so they are still typechecked. Closes the Plan-1 gap *and* keeps tests out of the goja bundle. `npm run typecheck` runs both.
- **Cosmetics:** drop the vacuous `expect(['A','B','draw']).toContain(r.winner)` (line 16 of `sim/tile-fight.test.ts` — `winner` is already that union by type); tidy `stats.ts` constant naming (`MOVE_BASE`/`ATTACK_RANGE` → consistent `*_BASE` / clearly-named range constant).
- **Declined:** `hash.ts` `padStart(8,'0')` — the existing `('0000000' + h.toString(16)).slice(-8)` is correct and ES5-safe; switching to an ES2017 method adds a parity surface for zero benefit. (The direct `fnv1a` pin above already covers the padding behavior.)

### 4.4 The golden hash as a three-way pin

After A1, `e9ff47f3` pins **V8 determinism** (vitest on the TS source). After A2, the *same* number additionally pins **goja determinism** and **V8↔goja parity** — one golden value, three guarantees. Any future engine change that moves the hash is a single, deliberate re-capture that must hold in both runtimes at once.

---

## 5. A2 — Cross-runtime parity (Go + esbuild + first CI)

### 5.1 Bundle (esbuild)

- Add `esbuild` as a devDependency.
- Entry: `sim/index.ts`, a barrel re-exporting `runReplay` (and `runTileFight`).
- Build: `esbuild sim/index.ts --bundle --format=iife --global-name=Sim --target=es2015 --outfile=dist/sim-bundle.js` — **no minification** (avoid any transform surprise; keep it boring and readable). Output is git-ignored (`dist/` already is) and rebuilt on demand.
- IIFE + `--global-name=Sim` means both hosts call `Sim.runReplay(...)`; no ESM (goja has no module loader) and no `globalThis` juggling.
- **Smoke test:** Node loads `dist/sim-bundle.js` via `node:vm` (not `import` — it is an IIFE) and reproduces `e9ff47f3`, proving the bundling step did not alter behavior.

### 5.2 goja runner (Go)

- `tools/parity/goja-runner/` with `go.mod` (pinned `github.com/dop251/goja` version, for harness reproducibility) and `main.go`.
- `main.go`: read `dist/sim-bundle.js` and a bundle JSON (stdin or path); `vm.RunString(bundleJs)` to define `Sim`; pass the bundle as a string and run `JSON.stringify(Sim.runReplay(JSON.parse(__bundle)))`; print the resulting JSON. Using a JSON round-trip across the Go↔goja boundary avoids manual value marshaling and keeps integers exact.

### 5.3 Compare + enforce

- `tools/parity/parity.mjs` orchestrates: ensure the bundle is built; for each fixture compute `hashV8` by running the **same bundle** under `node:vm`, compute `hashGoja` via the Go runner, and assert `hashV8 === hashGoja === expectedHash`. Non-zero exit on any mismatch.
- **Fixtures** (`tools/parity/fixtures.mjs`): at minimum `{ baseSetup, seed 42 } → e9ff47f3`; plus 2–3 more `(setup, seed)` pairs (e.g. the lopsided setup, extra seeds) whose V8 hashes are captured and then required to hold in goja, broadening coverage beyond one path.
- Comparing the **same bundle** under both `node:vm` and goja makes the assertion chain: golden (vitest/TS-on-V8) == bundle-on-V8 == bundle-on-goja.

### 5.4 Local vs CI behavior

- **CI is the enforcing home** (spec §4.6 "CI hash-replay test"). `.github/workflows/ci.yml` triggers `on: [push]` (the project uses branches, not PRs): checkout → `setup-node` → `npm ci` → `npm run typecheck` → `npm test` → `npm run bundle` → `setup-go` → `npm run parity`. Go is free in CI via `actions/setup-go`.
- **Locally, the harness degrades gracefully:** `npm run parity` detects whether `go` is on `PATH`; if absent it prints "Go absent — CI enforces parity" and exits 0, so this machine stays lean and ordinary `npm test` never needs Go.
- **For development in-session,** Go is installed locally so the goja runner can be built and TDD'd (a self-contained install; no native build chain). The committed harness does not *require* it.

---

## 6. Files (new / changed)

**Changed:** `shared/types.ts` (add `ReplayBundle`, `ReplayResult`, `EndReason`; add `endReason` to `FightResult` + `end` event) · `sim/tile-fight.ts` (set `endReason`) · `sim/stats.ts` (constant naming) · `sim/stats.test.ts` (tempoRate monotonicity) · `sim/hash.test.ts` (direct `fnv1a` pin) · `sim/tile-fight.test.ts` (stalemate/timeout test; drop vacuous assertion) · `tsconfig.json` (exclude tests) · `package.json` (esbuild devDep; `bundle`/`parity` scripts; `typecheck` runs both configs).

**New:** `sim/replay.ts` · `sim/replay.test.ts` · `sim/index.ts` (bundle entry) · `tsconfig.test.json` · `tools/parity/parity.mjs` · `tools/parity/fixtures.mjs` · `tools/parity/goja-runner/go.mod` · `tools/parity/goja-runner/main.go` · `.github/workflows/ci.yml`.

---

## 7. Determinism & goja-safety constraints (carried from Plan 1)

- `/sim` and `/shared` stay pure: no wall-clock, no `Date.now()`, no `Math.random()`, no I/O, no Node-only APIs. Integer math only; RNG seeded and threaded explicitly; deterministic iteration/sort order ending in a unique id.
- `runReplay` and everything it transitively imports must be in the bundle and goja-loadable: ES2015 target, IIFE, no ESM, no `globalThis` reliance.
- The harness driver in `/tools` is the *only* new code allowed Node APIs (`node:vm`, `node:fs`, `node:child_process`); it is dev-only and never bundled.

---

## 8. Risks & mitigations

- **A goja divergence already exists in today's code.** That is exactly what this plan exists to find — better against six modules than after combat depth. The three-way pin localizes it to a single hash mismatch on a known fixture.
- **goja feature gaps** (e.g. `Math.imul`, `String.prototype` methods, sort stability). The sim already restricts itself to a goja-safe subset; the smoke test + parity fixtures execute that subset in goja and will surface any gap concretely. `Math.imul`, `charCodeAt`, `toString(16)`, `Array.prototype.sort`, and `JSON` are all goja-supported.
- **esbuild transform altering behavior.** Mitigated by no-minify + the Node `node:vm` smoke test that requires the bundle to reproduce `e9ff47f3` before goja is even consulted.
- **Go/goja as a new toolchain.** Bounded: self-contained install, pinned goja version, dev-optional locally (graceful skip), free in CI. No native build chain (the constraint that shaped the client spike does not apply to Go).
- **CI flakiness from network fetch of goja.** Pin the version and rely on Go module caching in the workflow.

---

## 9. Open knobs (tune during implementation, not gaps)

- Number and shape of parity fixtures beyond the canonical one (more seeds vs more setups).
- `go.mod` goja version pin.
- Node version matrix in CI (single LTS now; widen later).
- Whether `runReplay` returns `survivors` too (kept out for now — hash + winner + ticks + endReason is the minimal parity surface).
