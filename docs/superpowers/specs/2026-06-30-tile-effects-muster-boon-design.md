# Tile Effects: Muster + Boon — Design

Status: **draft for review** · drafted 2026-06-30 · **Second slice of the run-loop sub-system** (master spec §4.3). Builds on the run state machine + Rest healing slice (`2026-06-30-run-state-machine-design.md`), which established the per-tile-effect pattern in `sim/run.ts`.

This adds the two **sim-pure** tile effects beyond Rest: **Muster** (capture → a predefined reserve army you can dispatch) and **Boon** (capture → a run-scoped attribute buff). Both are deterministic, RNG-free, and **anchor-safe** (they mutate run state, never the fight engine).

---

## 1. Context & Goal

The first run-loop slice gave runs a beginning/end (win/lose/extract) and one tile effect (Rest, per-tick HP recovery). The GDD's tile-effect catalog also includes Muster (reinforcements), Boon (run-scoped power), Cache (loot), Recruit (heroes), Event (choices), Mysterious (`?`). Cache/Recruit/Event/Mysterious pull in loot tables / heroes / branching choices — RNG or the non-replayed meta layer — so they're deferred. **Muster** and **Boon** are sim-pure and extend the existing pattern directly.

**Goal:** in `sim/run.ts` (the run-loop sub-engine — `conquest-map.ts`/`tile-fight.ts` stay untouched), add **capture-time** effects: capturing a `muster` tile spawns a predefined reserve army on it; capturing a `boon` tile applies a flat attribute buff to the player's current units for the rest of the run. Deterministic, integer, goja-bit-identical; the run layer stays RNG-free. The anchor `86e238c1` + all 19 existing fixtures stay **frozen** (the effects are additive run-state mutations; `hashMap` already hashes their consequences).

---

## 2. Scope

### 2.1 In scope
- **`MapTile` data (additive, input-only):** `muster?: UnitSpec[]` (reserve units granted on capture) and `boon?: BoonSpec` where `BoonSpec = { attr: 'str' | 'agi' | 'int' | 'lck'; amount: number }` (a flat attribute delta).
- **Capture detection** in `runTick`: a snapshot-diff — record player-owned tile ids before `advance`, then apply capture effects to tiles newly player-owned afterward (covers both undefended capture and fought capture, since `advance` flips ownership in both paths).
- **Muster effect:** on capturing a `muster` tile with `muster` content, spawn a garrisoned army `muster-<tileId>` on that tile with deep-copied predefined units — a fresh dispatchable reserve.
- **Boon effect:** on capturing a `boon` tile with `boon` content, add `boon.amount` to `boon.attr` on every current player unit's `attrs` (run-scoped — the mutation persists; `deriveStats` recomputes derived stats from buffed attrs in future fights).
- **`cloneUnitSpec`** in `run.ts` (deep-copy a `UnitSpec`) so a mustered army's units are isolated from the setup.
- **Parity:** 2 new v4 fixtures (`run-muster`, `run-boon`) V8≡goja; anchor + 19 existing fixtures unchanged.

### 2.2 Out of scope (RNG / meta / later)
- **Cache** (loot), **Recruit** (heroes), **Event** (personality-keyed choices), **Mysterious** (`?`) — RNG or meta.
- A richer **Boon catalog** (multi-stat, percentage, conditional, choice-of-boon) — alpha ships the flat single-attr buff.
- **Retroactive boons:** a boon does NOT buff units mustered/recruited *after* it (alpha simplification — capture-time application to current units only).
- Meta economy, Weary, enemy map-AI, map generation — other slices.

---

## 3. Approach (decided in brainstorming)

**Capture-time effects via run-state mutation, anchor-safe; detected by a snapshot-diff.** Effects live in `sim/run.ts` and change RUN STATE only — Muster adds an `Army` to `state.armies`; Boon mutates player units' `attrs`. Neither touches `conquest-map.ts`/`tile-fight.ts`, so the fight engine sees ordinary (buffed / additional) specs and the anchor + 19 fixtures stay byte-identical. Detection is a snapshot-diff in `runTick` (player-owned tiles before vs after `advance`) — robust across both capture paths and firing exactly once per tile (owners only ever gain in alpha).

Rejected: a persistent `RunState.modifiers` list threaded into `deriveStats`/`effectiveDerived` for Boon (invasive — touches the fight stat path → anchor-risk + more code; the spec-mutation model is simpler and sufficient for a flat buff); keying effects off `advance`'s `captured` events (the snapshot-diff is self-contained and doesn't depend on event ordering/accumulation); exporting `conquest-map.ts`'s internal `cloneSpec` (keeps the engine untouched — `run.ts` owns a tiny `cloneUnitSpec`).

---

## 4. `MapTile` data additions (`shared/types.ts`)

```ts
export interface BoonSpec { attr: 'str' | 'agi' | 'int' | 'lck'; amount: number; }
// MapTile gains:
//   muster?: UnitSpec[];   // reserve units granted to the player on capture (type 'muster')
//   boon?: BoonSpec;       // flat attribute buff applied on capture (type 'boon')
```
These are static setup data (like `garrison`). `hashMap` (in the untouched `conquest-map.ts`) reads only `id`/`owner`/`garrison`, so it ignores `muster`/`boon` — correct, because their *consequences* (the spawned army's roster, the buffed units' `startHp`/derived HP) are already hashed. `initConquest`'s `{...t}` spread carries these fields by reference; the run layer only READS them (deep-copying at muster-spawn), so the shallow share with the setup is safe.

---

## 5. Capture detection (`sim/run.ts` — `runTick`)

```ts
export function runTick(run: RunState, commands: RunCommand[]): RunState {
  if (run.status !== 'active') return run;
  if (commands.some((c) => c.t === 'extract')) { run.status = 'extracted'; return run; }
  const ownedBefore = new Set(run.map.tiles.filter((t) => t.owner === 'player').map((t) => t.id)); // snapshot
  const mapCommands = commands.filter((c): c is MapCommand => c.t !== 'extract');
  advance(run.map, mapCommands);
  applyRestHealing(run.map);                 // existing per-tick effect
  applyCaptureEffects(run.map, ownedBefore); // §6/§7 — Muster + Boon on newly-captured tiles
  if (isWon(run.map)) run.status = 'won';
  else if (isLost(run.map)) run.status = 'lost';
  return run;
}
```
`applyCaptureEffects(map, ownedBefore)` iterates tiles; a tile is **newly captured** iff `tile.owner === 'player' && !ownedBefore.has(tile.id)`. For each newly-captured tile, apply its Muster (§6) and/or Boon (§7). (Effect tiles are expected to start enemy/neutral and be captured during the run; a degenerate effect tile owned at `initRun` is never "newly" captured and its effect never fires — acceptable.)

---

## 6. Muster effect (`sim/run.ts`)

```ts
function cloneUnitSpec(u: UnitSpec): UnitSpec {
  return { ...u, attrs: { ...u.attrs }, pos: { ...u.pos },
    traits: u.traits ? u.traits.slice() : undefined,
    personality: u.personality ? { ...u.personality } : undefined };
}
// inside applyCaptureEffects, for a newly-captured tile:
if (tile.type === 'muster' && tile.muster && tile.muster.length > 0) {
  map.armies.push({
    id: `muster-${tile.id}`, units: tile.muster.map(cloneUnitSpec),
    tile: tile.id, state: 'garrisoned', travelGauge: 0,
  });
}
```
- A `muster` tile, on capture, yields a fresh **garrisoned** army on that tile (deterministic id `muster-<tileId>`; unique because a tile is captured once), dispatchable like any army — the GDD's mid-run reinforcement. It also delays the lose-condition (`armies.length` rises).
- Units are deep-copied (`cloneUnitSpec`) so the spawned army is isolated from the setup (`tile.muster` is shared with the setup via `initConquest`'s shallow spread; we never mutate it).
- A `muster` tile with no `muster` content is a no-op (lenient — content is the setup author's responsibility).

---

## 7. Boon effect (`sim/run.ts`)

```ts
// inside applyCaptureEffects, for a newly-captured tile:
if (tile.type === 'boon' && tile.boon) {
  for (const army of map.armies) {
    for (const u of army.units) {
      u.attrs[tile.boon.attr] += tile.boon.amount;
    }
  }
}
```
- A `boon` tile, on capture, applies its flat attribute delta to **every current player unit** (`map.armies` are all the player's; enemy garrisons live in `tile.garrison`, not `map.armies`). Run-scoped: the `attrs` mutation persists, so `deriveStats(buffed attrs, …)` yields higher derived stats (maxHp/atk/…) in **future** fights.
- Units currently mid-fight are unaffected this fight (their `Unit` derived stats were computed at `initFight` from a copy of `attrs`); they get the boon on their next fight. Anchor-safe — the fight engine is unchanged; it just receives buffed specs later.
- Mutating `army.units[i].attrs` is safe: those `attrs` are already deep-copied per army (at `initConquest` via `cloneSpec`, or at muster-spawn via `cloneUnitSpec`), so the buff can't bleed into the setup.
- Order: `applyCaptureEffects` runs after `applyRestHealing`; a freshly-mustered army (garrisoned on the muster tile, not a rest tile) is unaffected by Rest that tick, and a boon captured the same tick buffs all current armies including any mustered earlier this tick — deterministic regardless.

---

## 8. Determinism, hash & parity

- **RNG-free, integer-only.** Capture effects fire exactly once per tile (snapshot-diff; owners only gain). Deterministic iteration (`map.tiles`/`map.armies` are id-ordered by construction).
- **`hashRun` (= `fnv1a(hashMap(map) + '#' + status)`) reflects both effects** via the untouched `hashMap`: Muster adds an army (`hashMap` folds army id/tile/state/roster + per-unit HP); Boon raises units' derived `maxHp`, and `hashMap` hashes `startHp ?? maxHp` — so a buffed unit's hash changes. No `conquest-map.ts` change needed.
- **Anchor `86e238c1` + all 19 existing fixtures frozen** (additive run-state mutations; the fight engine + `conquest-map.ts` + `hashMap` are untouched). **2 new v4 fixtures** V8≡goja:
  - `run-muster-seedN` — dispatch to capture an undefended `muster` tile → assert the run state hash reflects the spawned `muster-<id>` army (and that it's dispatchable / counted).
  - `run-boon-seedN` — dispatch to capture an undefended `boon` tile → assert the hash reflects the buffed units (raised derived HP).
- Version-aware `runReplay` v4 already routes runs (prior slice); the goja harness stays untouched.

---

## 9. Files & task decomposition

Each task: TDD, sonnet implementer + sonnet reviewer, fix Critical/Important; opus whole-branch review at the end.

1. **Types + capture detection + Muster** — `shared/types.ts` (`BoonSpec`; `MapTile.muster?`/`boon?`); `sim/run.ts` (`cloneUnitSpec`; `applyCaptureEffects` with the snapshot-diff + the Muster branch; wire into `runTick`). Tests: capturing a `muster` tile spawns `muster-<id>` (garrisoned, right units) exactly once; no spawn before capture; a non-muster capture spawns nothing; `cloneUnitSpec` isolates (mutating the spawned army doesn't touch the setup).
2. **Boon** — `sim/run.ts` (the Boon branch in `applyCaptureEffects`). Tests: capturing a `boon` tile adds `amount` to `attr` on every player unit; derived `maxHp` rises accordingly; fires once; a captured tile with no `boon`/non-boon type doesn't buff; an army's buff doesn't bleed into the setup.
3. **Parity fixtures** — `tools/parity/fixtures.mjs` (+`run-muster-seedN`, +`run-boon-seedN`, capture hashes, V8≡goja) + pin unit tests in `sim/run.test.ts`. Confirm `86e238c1` + all 19 existing fixtures unchanged.

**Changed:** `shared/types.ts` (`BoonSpec`, `MapTile.muster?`/`boon?`), `sim/run.ts` (`cloneUnitSpec`, `applyCaptureEffects`, `runTick` wiring), `tools/parity/fixtures.mjs` (+2 v4 fixtures). Co-located `sim/run.test.ts`. `conquest-map.ts`/`tile-fight.ts`/`replay.ts` **untouched**.

---

## 10. Risks & Mitigations
- **Effect leaks into the map/fight engine** — mitigated: all logic in `sim/run.ts`; `conquest-map.ts`/`tile-fight.ts` untouched; `hashMap` ignores the input fields but hashes consequences. Enforced in review.
- **Mutation bleed into setup** — `cloneUnitSpec` deep-copies mustered units; Boon mutates already-cloned army `attrs` (cloned at `initConquest`/muster). A test asserts isolation.
- **Double-firing / mis-timing** — the snapshot-diff fires once per tile on its capture tick (owners only gain). Tested for "fires once" and "not before capture."
- **Determinism / parity** — RNG-free + integer; `hashRun` reuses the parity-proven `hashMap`; new v4 fixtures lock both effects; anchor + 19 fixtures frozen.
- **Boon buffs only current units** — accepted alpha simplification (documented); a persistent run-modifier (future-unit-inclusive) is a later refinement if needed.

## 11. Open knobs / deferred
- Boon shape (single flat attr now; multi-stat / %, choice-of-boon, conditional later) and Muster cadence (one-time on capture now; replenish-on-hold or a muster *currency* later — currency is meta).
- Whether muster armies should arrive pre-positioned vs garrisoned (garrisoned now).
- The rest of the tile-effect catalog (Cache/Recruit/Event/Mysterious), Weary, the meta economy — later slices.
