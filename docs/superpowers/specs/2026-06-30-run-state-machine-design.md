# Run State Machine + Rest Healing — Design

Status: **draft for review** · drafted 2026-06-30 · **First slice of the run-loop sub-system** (the §4.3 "run orchestration" sub-engine of the master spec `2026-06-29-combat-rework-and-architecture-design.md`). Follows the now-complete 3-plan conquest-map arc.

This makes a **run** a first-class thing: a deterministic state machine wrapping the conquest-map that ends on **boss captured** (won), **forces spent** (lost), or **Extract** (banked), plus the first **tile effect** — **Rest healing**, the recovery counterpart to the conquest-map's one-way HP-carrying attrition.

---

## 1. Context & Goal

The conquest-map arc gave us `advance(state, commands)` driving real fights with HP-carrying attrition — but a "run" doesn't exist yet: the map never *ends*, attrition only ever decreases HP, and there's no win/lose. This slice adds the run state machine on top.

**Goal:** a new `sim/run.ts` — the run-loop sub-engine — that *wraps* the conquest-map (which stays the pure control layer, untouched). The run owns: run **state/status**, the **win / lose / extract** conditions, and **Rest-tile HP recovery** (the first tile effect — without recovery, attrition is one-way and a run can't be won by grinding). Deterministic, integer, goja-bit-identical; the run layer draws **no RNG** (loot/rewards live in the non-replayed meta layer — out of scope). Parity follows the established version-aware pattern: a new **v4** bundle + `runScriptedRun`, dispatched by `runReplay` (the goja harness stays untouched). The anchor `86e238c1` + all 16 existing fixtures stay **frozen** (the run layer is purely additive).

---

## 2. Scope

### 2.1 In scope
- **`RunState`** = `{ map: MapState; status: 'active' | 'won' | 'lost' | 'extracted' }`. The objective is identified by `type === 'boss'` in the map setup — no new field.
- **`initRun(setup, seed) → RunState`** = `{ map: initConquest(setup, seed), status: 'active' }`.
- **`runTick(run, commands) → RunState`** — the run's clockless tick: split commands → handle `Extract` → `advance` the map → apply **Rest healing** → check **win / lose**. Terminal status is sticky (a non-`active` run is a no-op).
- **`Extract` command** — a new `MapCommand` variant `{ t: 'extract' }`; ends the run (`status = 'extracted'`). The player always owns ≥1 tile (the start tile; owners only ever gain), so it's unconditional while `active`.
- **Win / lose:** win = there is ≥1 `boss` tile and all `boss` tiles are player-owned. Lose = no player armies with surviving units remain (`map.armies.length === 0` — Plan 3 removes wiped armies).
- **Rest healing** — each army `garrisoned` on a player-owned `rest` tile heals every unit by `REST_HEAL_PER_TICK` toward `maxHp` (raises each unit's `startHp`, capped at `deriveStats(...).maxHp`). Deterministic, integer.
- **`hashRun(run)`** = `fnv1a(\`${hashMap(run.map)}#${run.status}\`)`.
- **`runScriptedRun(bundle)`** (v4 `RunBundle`) + version-aware **`runReplay` v4** dispatch (harness untouched) + 3 new v4 parity fixtures (won / rest-heal / extract), V8≡goja.
- **`REST_HEAL_PER_TICK`** config constant.

### 2.2 Out of scope (meta layer / later slices)
- **Meta / economy** (server-authoritative, NOT replayed): loot/rewards, banking *across* runs, crafting, recruitment, Storehouse, hero-level persistence, Home.
- **The rest of the tile-effect catalog:** Cache, Muster, Boon, Event, Recruit, Mysterious (Rest is the one effect this slice ships).
- **Weary** (needs a cross-run source — meta), enemy map-AI (static garrisons), map generation (`/meta`), structures/boss mechanics beyond "the boss tile is captured", terrain-seeded fight grids, multiplayer.

---

## 3. Approach (decided in brainstorming)

**A new `sim/run.ts` wraps the conquest-map; `conquest-map.ts` stays pure.** The run layer is the §4.3 sub-engine: it owns run status, win/lose/extract, and tile effects (Rest). The map engine never learns about runs or tile effects — `runTick` calls `advance` for movement/battles, then layers run concerns on top. This keeps each engine focused and independently testable, and matches the master spec's layering.

Rejected: folding run logic into `advance`/`conquest-map.ts` (pollutes the pure control layer with run + tile-effect concerns); a bigger first bite including Cache/Muster (those lean into the meta economy — currency/stash — blurring the replayed/non-replayed line); RNG-driven rewards now (the run layer stays RNG-free; loot is meta).

---

## 4. `RunState` & lifecycle (`sim/run.ts`)

```ts
// RunState lives in sim/run.ts (it references MapState, a sim type — same reason MapState/FightState live in sim).
export interface RunState { map: MapState; status: 'active' | 'won' | 'lost' | 'extracted'; }

export function initRun(setup: MapSetup, seed = 0): RunState {
  return { map: initConquest(setup, seed), status: 'active' };
}
```

---

## 5. The run tick (`sim/run.ts` — `runTick`)

```ts
export function runTick(run: RunState, commands: MapCommand[]): RunState {
  if (run.status !== 'active') return run;            // terminal status is sticky

  const extract = commands.some((c) => c.t === 'extract');
  if (extract) { run.status = 'extracted'; return run; } // Extract ends the run before any movement

  const mapCommands = commands.filter((c) => c.t !== 'extract');
  advance(run.map, mapCommands);                       // movement + battles + capture/attrition (Plan 3)

  applyRestHealing(run.map);                           // §6 — the tile effect

  // §7 win/lose (win takes precedence over lose on the same tick)
  if (isWon(run.map)) run.status = 'won';
  else if (isLost(run.map)) run.status = 'lost';
  return run;
}
```
Precedence within a tick: **Extract → advance → Rest → win → lose.** A run that quiesces while still `active` (player idle, nothing pending) is a valid non-terminal state — `runScriptedRun` (§8) stops there.

---

## 6. Rest healing (`sim/run.ts` — `applyRestHealing`)

The first **tile effect**: holding a Rest tile repairs run attrition (the GDD's "Rest — restore HP / repair attrition on capture or hold"). Capturing is just the first tick of holding, so a single per-tick model covers both:

```ts
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
- Heals only armies **garrisoned on a player-owned `rest` tile** (you maneuver a wounded army back to a Rest tile — Plan 3's retreat routes survivors home; if home is a Rest tile, they recover). Run-attrition recovery goes toward `maxHp` (the per-fight entry-cap is separate; Rest restores between fights).
- Deterministic, integer; iterates `map.armies` (already id-ordered by Plan 2 construction). Idempotent at full HP.

---

## 7. Win / lose (`sim/run.ts`)

```ts
function isWon(map: MapState): boolean {
  const bosses = map.tiles.filter((t) => t.type === 'boss');
  return bosses.length > 0 && bosses.every((t) => t.owner === 'player');
}
function isLost(map: MapState): boolean {
  return map.armies.length === 0; // every army ground down (Plan 3 removes zero-unit armies)
}
```
- **Win** = the objective taken. With no `boss` tile in the setup, win never fires (an extract-only / test map is valid). Multiple boss tiles → all must be owned.
- **Lose** = forces spent. In alpha the player's *garrisoned* armies are never attacked (static garrisons, no enemy map-AI), so this fires only after the player commits armies and loses them all. Roster-safe at the meta layer (unbanked haul forfeit) — not modeled here.

---

## 8. Determinism, hash & parity

- **Run layer is RNG-free** (fights still draw RNG internally, seeded as in Plan 3; the run/Rest/win/lose logic draws none). Integer-only; deterministic iteration.
- **`hashRun(run)`** = `fnv1a(\`${hashMap(run.map)}#${run.status}\`)` — reuses `hashMap` (which already folds tiles/owners + army rosters + per-unit HP + active-battle hashes), plus the run status. So Rest healing (HP↑) and capture (owner flip) are parity-covered via `hashMap`, and the run outcome via `status`.
- **`RunBundle`** (v4): `{ version: 4; setup: MapSetup; seed: number; script: { atTick: number; commands: MapCommand[] }[] }` (structurally the v3 conquest bundle at version 4; the boss/rest tiles are `type`-tagged in `setup.tiles`).
- **`runScriptedRun(bundle)`** — `initRun(setup, seed)` then a tick loop applying `commandsAt(t)`; ends when `status !== 'active'` OR quiescent (no active battles, no travelling/retreating army, no pending scripted commands) under a `RUN_MAX_TICKS` bound. Returns `{ hash: hashRun(run), status, ticks }`.
- **Version-aware `runReplay`**: add `v4 → runScriptedRun` (v1/v2/v3 byte-identical). The goja harness (`parity.mjs` / `run-node.mjs` / `main.go`) is **UNCHANGED** — it calls `Sim.runReplay`.
- **Anchor `86e238c1` + all 16 existing fixtures frozen** (the run layer is additive; conquest fixtures stay v3). **3 new v4 fixtures** V8≡goja: `run-won-seedN` (dispatch → fight → capture the boss → `won`), `run-rest-heal-seedN` (a wounded army garrisons a Rest tile and recovers HP → reflected in `hashMap`), `run-extract-seedN` (`extract` command → `extracted`).

---

## 9. Files & task decomposition

Each task: TDD, sonnet implementer + sonnet reviewer, fix Critical/Important; opus whole-branch review at the end.

1. **`RunState` + `initRun` + win/lose + `hashRun`** — `sim/run.ts` (new); `REST_HEAL_PER_TICK` in `shared/config.ts`. Tests: a fresh run is `active`; `isWon` true iff all (≥1) boss tiles owned; `isLost` true iff no armies; `hashRun` = `hashMap`+status (sensitive to status).
2. **`runTick` + `Extract`** — command split, `advance` pass-through, `Extract` → `extracted`, sticky terminal status; `MapCommand` += `{ t: 'extract' }` in `shared/types.ts`. Tests: `runTick` advances the map (a dispatched army moves); `extract` ends the run before movement; a terminal run is a no-op; win/lose set after `advance`.
3. **Rest healing** — `applyRestHealing` in `runTick`. Tests: a wounded unit in an army garrisoned on a player-owned `rest` tile heals `REST_HEAL_PER_TICK`/tick, capped at `maxHp`; an army NOT garrisoned / not on a `rest` tile / on an enemy-owned tile does NOT heal; full-HP is idempotent.
4. **`runScriptedRun` (v4) + `runReplay` dispatch** — `RunBundle` (v4) in `shared/types.ts`; `runScriptedRun` in `sim/run.ts`; `runReplay` v4 branch in `sim/replay.ts`; export the run surface from `sim/index.ts`. Tests: a scripted run drives to `won` / `extracted`; `runReplay` routes v4 → `runScriptedRun` and v1/v2/v3 unchanged; quiescence + `RUN_MAX_TICKS` bound.
5. **Parity fixtures** — 3 v4 fixtures (won / rest-heal / extract) in `tools/parity/fixtures.mjs`, capture hashes, V8≡goja; confirm `86e238c1` + all 16 existing fixtures unchanged. Tests: the 3 run scenarios assert their pinned `hashRun`.

**Changed:** `sim/run.ts` (new — the sub-engine), `shared/types.ts` (`MapCommand` += extract; `RunBundle` v4), `shared/config.ts` (`REST_HEAL_PER_TICK`, `RUN_MAX_TICKS`), `sim/replay.ts` (v4 dispatch), `sim/index.ts` (export run surface), `tools/parity/fixtures.mjs` (+3 v4 fixtures). Co-located `sim/run.test.ts`. `conquest-map.ts` / `tile-fight.ts` **untouched**.

---

## 10. Risks & Mitigations
- **Run logic leaks into the pure map engine** — mitigated: all run/tile-effect logic lives in `sim/run.ts`; `conquest-map.ts` is untouched and `run.ts` imports *from* it (one-way), never the reverse. Enforced in review.
- **Determinism / parity** — the run layer is RNG-free + integer; `hashRun` reuses the parity-proven `hashMap`; v4 fixtures assert V8≡goja. Anchor frozen (additive layer; the 16 fixtures + golden untouched).
- **Rest healing perturbs a hashed quantity** — intended (it's the recovery mechanic, and `hashMap` already hashes `startHp`); the new `run-rest-heal` fixture locks it. Standalone fights are unaffected (Rest is map-tile-only).
- **Lose-condition false positive** — `map.armies.length === 0` could fire at a transient moment; but armies are only removed at battle resolution / full retreat-death (Plan 3), and the player starts with ≥1 army, so it fires only on genuine total loss. The win check runs first (capturing the boss requires a surviving army, so a simultaneous win+lose resolves as a win).
- **`runScriptedRun` non-termination** — bounded by `RUN_MAX_TICKS` and the existing fight `MAX_TICKS`; quiescence includes active battles (Plan 3).

## 11. Open knobs / deferred
- `REST_HEAL_PER_TICK` (and whether Rest should also burst-heal on capture) — tuning, Monte-Carlo later.
- Extract preconditions (alpha: unconditional while active; later: must be on a safe/owned tile, or a channel time).
- Whether a quiesced-but-`active` run should auto-resolve (alpha: it just stops as `active` in replay).
- The rest of the tile-effect catalog, Weary, rewards/economy, enemy map-AI, map generation, boss structures/mechanics — subsequent slices (most in the meta layer).
