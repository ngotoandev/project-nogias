# Seeded Map Generation (v1) — Design

**Date:** 2026-07-02
**Status:** Approved (brainstorm) → ready for planning
**Arc:** `/meta` layer — first generation feature (procedural campaign maps)

## Goal

Replace hand-authored campaign maps with a **seeded generator** that produces a structurally valid, playable `MapSetup` — a rectangular tile grid the player conquers from a start band toward a boss, with **recovery tiles spread toward the later columns** so sustain keeps pace with attrition (not front-loaded). This is the first `/meta` generation feature and the biggest "feels like a real game" lever: everything already built (enemy AI, tile effects, run loop) now runs on varied procedural terrain.

## Architecture & placement

- **New `/meta` module** — `meta/mapgen.ts`. Per the master architecture (`2026-06-29-combat-rework-and-architecture-design.md` §`/meta`): generation is **server-authoritative, seeded, and NOT cross-runtime-replayed** — kept out of `/sim` precisely because it never needs V8↔goja parity.
- **Contract:** `generateMap(seed: number, size?: MapSize): MapSetup` — pure, deterministic, integer-only, driven by the shared `makeRng(seed)` (Mulberry32, `shared/rng.ts`). Output is a plain `MapSetup` (`shared/types.ts`) the sim consumes **unchanged**.
- **Zero `/sim` / fixture impact:** this slice touches no `/sim` code and no parity fixtures — the anchor `86e238c1` and all 29 fixtures are untouched by construction. Map-gen is verified by its own determinism + structural tests + a play-through smoke, not by the parity harness.

## Generation approach — column-banded grid

A `W×H` grid where **column index = progression/difficulty** (left = start, right = boss). Chosen over graph/maze/BSP (organic but can't cheaply guarantee winnability + the recovery-spread principle) and template+jitter (insufficiently procedural). The banded grid is connected by construction (grid adjacency ⇒ boss always reachable), trivially deterministic, and directly serves the one hard principle: recovery spread toward later columns.

- **Dimensions by size:** `MapSize = 'small' | 'medium' | 'large'` → `small 4×3`, `medium 5×3`, `large 6×4` (default `medium`). Size is the length/difficulty lever. (Numeric tiers deferred.)
- **Tile ids:** `c{col}r{row}`, `col ∈ [0,W)`, `row ∈ [0,H)`.
- **Neighbors (grid adjacency):** for `(col,row)` — `N = c{col}r{row-1}` (row>0), `S = c{col}r{row+1}` (row<H-1), `W = c{col-1}r{row}` (col>0), `E = c{col+1}r{row}` (col<W-1). Reciprocal by construction.

## Placement rules (all seeded, fixed roll order)

- **Ownership:** column 0 = **player-owned** (start band); columns `1..W-1` = **enemy-owned**. Win-condition = capture the boss.
- **Start:** `c0r{mid}` (`mid = floor(H/2)`) holds the player army (below).
- **Boss:** `c{W-1}r{mid}`, `type: 'boss'`, the heaviest garrison.
- **Recovery tiles (the principle):** each enemy tile in columns `1..W-1` (excluding the boss tile) becomes a recovery tile with probability **weighted toward later columns** — `p(col) = RECOVERY_BASE_BP + RECOVERY_SLOPE_BP · col/(W-1)` (basis points; `rng.intInRange(0,9999) < p`). The recovery **type** is chosen by RNG among `rest` / `muster` / `boon` (the only tile effects the sim implements today). **Guarantee:** if no recovery tile landed in the final third of columns, deterministically convert one enemy tile there — so the "spread toward later" property is firm and testable. Recovery tiles are **lightly- or un-garrisoned** (sustain must be reachable, not a hard fight).
- **Plain enemy tiles:** every other non-start, non-boss tile — `type: 'enemy'` with a garrison.
- **Garrison scaling:** garrison strength rises with column index (`garrisonStr(col) = GARRISON_STR_BASE + col · GARRISON_STR_STEP`); soft near the start, hard near the boss; the boss garrison is the strongest. Recovery-tile garrisons are light/empty.
- **`muster`/`boon` payloads:** a generated `muster` tile carries a small reserve `UnitSpec[]`; a `boon` tile carries a `BoonSpec` (`{attr, amount}`) — both seeded.

## Player starting army

A small **fixed** starting roster (v1): one army (`id: 'p1'`) of 3 melee `UnitSpec`s (moderate stats, e.g. `str 6, agi 5, int 1, lck 1`) on the start tile. Rolled/hero-generated rosters are a separate `/meta` hero-gen concern — deferred.

## Determinism & balance honesty

- Same `(seed, size)` ⇒ **byte-identical `MapSetup`** (single `makeRng(seed)`, fixed roll order, integer-only).
- v1 guarantees a **structurally valid, playable** map (connected, boss reachable, recovery genuinely spread, ownership/army correct). It does **NOT** guarantee a tuned win-rate — balancing garrison/recovery/roster numbers so the map is *fairly* winnable needs a balance harness (deferred). The smoke proves **playability** (a run progresses through the real sim to a terminal state without error), not a target win-rate.

## Client integration (visible payoff)

- **`dist/meta-bundle.js`** — an esbuild IIFE (`--global-name=Meta`, `meta/index.ts`), sibling to the sim bundle, so both the browser viz and the node smoke can call `Meta.generateMap`.
- **Viz "Generate" control:** a seed input + size select → `Meta.generateMap(seed, size)` → `Sim.initRun(setup)` → the generated campaign plays live in the existing canvas. Procedural maps, visible.

## Testing

- **`meta/mapgen.test.ts`:** same-`(seed,size)` determinism (deep-equal `MapSetup`); different seeds differ; structural asserts — correct `W×H` tile count; ids/neighbors reciprocal + in-bounds; connected (BFS reaches all tiles); column 0 player-owned + exactly one army on the start tile; exactly one `boss` at `c{W-1}r{mid}`, enemy-owned; recovery tiles exist and the **final third has ≥1** (and recovery skews later, not front-loaded); garrison strength non-decreasing by column; all tile `type`s are sim-implemented (`start`/`enemy`/`boss`/`rest`/`muster`/`boon`).
- **Play-through smoke** (node, via `Meta` + `Sim` bundles): `generateMap` → greedy autopilot through `Sim.runTick` to a terminal state; assert the run progresses (captures happen) and terminates cleanly (no throw). Proves the generated setup is valid + playable end-to-end.

## Scope

**In:** `meta/mapgen.ts` (`generateMap`) + `meta/index.ts`; the column-banded seeded generator (dims/ownership/boss/recovery-spread/garrison-scaling/start-army); `meta/mapgen.test.ts`; `dist/meta-bundle.js` (`bundle:meta`); viz Generate control + smoke.

**Out (deferred):** difficulty *tiers* / numeric progression scaling; the inert tile types (`elite`/`cache`/`event`/`recruit`/`mysterious` — no sim effect yet); biomes / branching / irregular topology; seeding **enemy mobile armies** or enabling `enemyReclaims` on generated maps (v1 = static garrisons, `enemyReclaims: false`, no `enemyArmies`); rolled/hero-generated player rosters; **win-rate balance tuning** (needs a harness); server hosting (same seeded code — `/server` owns it in beta).

**Non-goals (YAGNI):** no change to `/sim` or the parity harness; no new tile-effect types; no RNG in the sim (map-gen RNG is generation-time only, before replay).

## Files

- Create: `meta/mapgen.ts`, `meta/index.ts`, `meta/mapgen.test.ts`.
- Modify: `package.json` (`bundle:meta` script), `tools/viz/index.html` + `tools/viz/viz.js` (Generate control), `tools/viz/smoke.mjs` (generate-and-play assertion). Generation constants live in `meta/mapgen.ts` (meta-specific — `shared/config.ts` stays combat-only). Verify the TypeScript project config compiles the new `meta/` module (extend `tsconfig` includes if needed).
