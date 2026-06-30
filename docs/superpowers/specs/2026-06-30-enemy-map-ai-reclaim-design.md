# Enemy Map-AI — First Slice: Territorial Reclaim — Design

Status: **draft for review** · drafted 2026-06-30 · **First slice of the enemy-map-AI arc**, within the run-loop sub-system (master spec §4.3). Builds on the run state machine + tile effects ([[run-state-machine-complete]], [[tile-effects-muster-boon-complete]]).

This gives the enemy its first agency: a garrisoned enemy tile **reclaims an adjacent undefended player tile** (a fight-free flip back to enemy). Captured ground becomes losable — the GDD's core tension of a finite army spread across fronts.

---

## 1. Context & Goal

Today the enemy is inert: `advance` processes only **player** commands, and enemy `garrison`s merely defend when attacked. The map is one-sided — you expand against static defenders and can only lose by throwing away your own armies. This slice gives the enemy its first move.

**Goal:** in `sim/run.ts` (run-orchestration — `conquest-map.ts`/`tile-fight.ts` stay untouched), a deterministic enemy behavior that, each run tick, lets each garrisoned enemy tile **reclaim one adjacent undefended player tile** (fight-free). Opt-in (`MapSetup.enemyReclaims`), default-off, so it's purely additive — anchor `86e238c1` + all 21 existing fixtures stay byte-identical. Tiles can now flip player→enemy, so the slice also **hardens the tile-effect detector** (snapshot-diff → a once-ever `effectClaimed` flag) to keep Muster/Boon from re-firing on a re-captured tile. Deterministic, integer, goja-bit-identical.

**Explicitly NOT in this slice** (deferred to later arc slices): the enemy does not kill armies and cannot fight to retake a *defended* tile (that needs the battle/capture engine generalized for two-sided attacks). This slice contests *territory*, not armies.

---

## 2. Scope

### 2.1 In scope
- **`MapSetup.enemyReclaims?: boolean`** (default `false`); `initRun` reads it → `RunState.enemyReclaims`. Off ⇒ behavior is exactly as today.
- **`applyEnemyAI(map)`** in `sim/run.ts`, called by `runTick` when `enemyReclaims` is on: each enemy-owned tile **with a non-empty garrison** (iterated in tile-id order) reclaims its first player-owned **undefended** neighbor (N/S/E/W order) — set `owner = 'enemy'`, emit `{ t:'reclaimed', tile, by }`. One reclaim per enemy tile per tick. Fight-free, RNG-free.
- **Invariant hardening:** `MapTile.effectClaimed?: boolean`; `applyCaptureEffects` fires a tile's Muster/Boon iff the tile is player-owned **and** `!effectClaimed`, then sets `effectClaimed = true` — so each tile's effect fires **at most once ever** (robust to recapture). Replaces the `ownedBefore` snapshot-diff; behavior-identical when the enemy is off.
- **`MapEvent`** gains `{ t: 'reclaimed'; tile: string; by: string }`.
- **Parity:** 2 new v4 fixtures (`enemyReclaims: true`) — the enemy reclaims a vacated undefended tile; a defended tile is held. Anchor + 21 existing fixtures unchanged.

### 2.2 Out of scope (later arc slices)
- **Enemy sorties WITH battles** (fighting to retake a defended tile; needs two-sided battle/capture — the tile flips to the *attacker's* owner). 
- **Enemy mobile armies**, garrison movement/reinforcement between enemy tiles, garrison attrition/transfer on reclaim, smarter target selection (threat/value weighting), enemy aggression cadence/tuning. The meta economy, map generation.

---

## 3. Approach (decided in brainstorming)

**Run-orchestration in `sim/run.ts`, opt-in, fight-free reclaim of vacated tiles; harden the effect detector.** The enemy AI is a run-layer concern (like Rest/Muster/Boon) operating on `map` after `advance` — the conquest engine stays the pure deterministic *player-command* layer. Opt-in/default-off keeps the slice additive (no re-pin; anchor + all fixtures frozen). "Undefended" = no player army on the tile, so you can never lose a tile you occupy, and freshly-captured tiles (always holding their capturer) are safe — the enemy only takes back ground you've **vacated**. Because tiles can now flip both ways, the once-only `effectClaimed` flag replaces the snapshot-diff.

Rejected: always-on enemy AI (re-pins existing run fixtures + forces enemy behavior into every run/test setup); enemy AI inside `advance`/`conquest-map.ts` (pollutes the pure player-control engine + the parity story); fighting to retake defended tiles now (the two-sided battle generalization is a whole slice); RNG target selection (this layer stays deterministic — seeded RNG, if ever, comes with the battle slice).

---

## 4. The enemy reclaim (`sim/run.ts` — `applyEnemyAI`)

```ts
// Called by runTick only when run.enemyReclaims is true.
function applyEnemyAI(map: MapState): void {
  const defended = new Set(map.armies.map((a) => a.tile)); // a player army on a tile holds it
  for (const tile of map.tiles) {                          // map.tiles is id-ordered by construction
    if (tile.owner !== 'enemy' || tile.garrison.length === 0) continue; // only garrisoned enemy tiles project power
    for (const e of ['N', 'S', 'E', 'W']) {
      const nb = tile.neighbors[e]; if (!nb) continue;
      const nt = map.tiles.find((t) => t.id === nb);
      if (nt && nt.owner === 'player' && !defended.has(nb)) {
        nt.owner = 'enemy';                                // fight-free reclaim
        map.events.push({ t: 'reclaimed', tile: nb, by: tile.id });
        break;                                             // one reclaim per enemy tile per tick
      }
    }
  }
}
```
- `defended` is snapshotted once per call (a tile is defended iff a player army sits on it). A freshly-captured tile holds its capturer (Plan 2/4 garrison the winner), so it's never reclaimed the tick it's taken — the enemy only reclaims tiles the player has moved off.
- No garrison transfer / no fight: the reclaimed tile becomes enemy-owned and undefended (the player can re-take it fight-free, but the enemy can re-reclaim it if it's left vacant again — a tug-of-war the player resolves by leaving a holding force). Garrison transfer + lethal sorties are later slices.
- Deterministic: tile-id iteration + fixed N/S/E/W order, no RNG.

---

## 5. Invariant hardening — `effectClaimed` (`sim/run.ts` — `applyCaptureEffects`)

Tiles can now revert player→enemy, so the snapshot-diff ("newly player-owned this tick") would re-fire a tile's effect on recapture (re-spawning a Muster reserve — an exploit). Replace it with a once-ever flag:

```ts
function applyCaptureEffects(map: MapState): void {           // no more `ownedBefore` param
  for (const tile of map.tiles) {
    if (tile.owner !== 'player' || tile.effectClaimed) continue; // fire once ever per tile
    let claimed = false;
    if (tile.type === 'muster' && tile.muster && tile.muster.length > 0) { /* spawn muster-<id> */ claimed = true; }
    if (tile.type === 'boon' && tile.boon) { /* buff current player units */ claimed = true; }
    if (claimed) tile.effectClaimed = true;
  }
}
```
- Fires on the **first tick a tile is player-owned** (the capture tick) — the same tick the snapshot-diff fired — so with the enemy off, behavior and hashes are identical (existing `run-muster`/`run-boon` fixtures frozen). With the enemy on, a re-captured muster/boon tile is already `effectClaimed` → no re-fire.
- `effectClaimed` is set only when an effect actually fired (a `muster` tile with no `muster` content, or an effect-less tile, stays unclaimed — harmless).
- **`initRun` pre-marks tiles that are player-owned at the start as `effectClaimed`** (you didn't *capture* them, so they must never fire — matching the GDD's "capturing a tile claims its effect"). This makes the flag exactly equivalent to the old snapshot-diff for *every* case (the snapshot-diff likewise never fired on a start-owned tile), not just the current fixtures (where effect tiles always start enemy anyway).

---

## 6. `runTick` order (`sim/run.ts`)

```ts
export function runTick(run: RunState, commands: RunCommand[]): RunState {
  if (run.status !== 'active') return run;
  if (commands.some((c) => c.t === 'extract')) { run.status = 'extracted'; return run; }
  advance(run.map, commands.filter((c): c is MapCommand => c.t !== 'extract'));
  applyRestHealing(run.map);
  applyCaptureEffects(run.map);                 // claimed-flag (no ownedBefore snapshot)
  if (run.enemyReclaims) applyEnemyAI(run.map); // enemy responds after the player's tick + effects
  if (isWon(run.map)) run.status = 'won';
  else if (isLost(run.map)) run.status = 'lost';
  return run;
}
```
Order preserved from the prior slice (advance → Rest → effects), then the enemy acts, then win/lose. Win is checked after the enemy moves; a boss tile is captured *and held by the capturing army* (defended) so the enemy can't reclaim it, and win fires. `isLost` (armies empty) is unaffected — this slice doesn't destroy armies.

---

## 7. Determinism, hash & parity
- **RNG-free, integer.** `applyEnemyAI` is pure rule-based (id-ordered, fixed edge order). `hashMap`/`hashRun` already hash tile `owner` (and rosters/HP/battles), so reclaims and effect outcomes are fully parity-covered. `enemyReclaims` and `effectClaimed` are config/bookkeeping — not hashed directly (their consequences are).
- **Anchor `86e238c1` + all 21 existing fixtures FROZEN.** `enemyReclaims` defaults false (existing fixtures don't set it → `applyEnemyAI` never runs); the `effectClaimed` swap is behavior-identical to the snapshot-diff for them. `conquest-map.ts`/`tile-fight.ts` untouched.
- **New v4 fixtures** (V8≡goja): `run-reclaim-seedN` — a setup with `enemyReclaims: true` where the player captures a tile, moves on (vacates it), and a garrisoned enemy neighbor reclaims it (hash reflects the flip); `run-hold-seedN` — same but a holding army keeps the tile (no reclaim). Confirm the 21 existing hashes unchanged.

---

## 8. Files & task decomposition

1. **Effect-detector hardening** — `shared/types.ts` (`MapTile.effectClaimed?: boolean`); `sim/run.ts` (`applyCaptureEffects` → claimed-flag; drop the `ownedBefore` snapshot from `runTick`; **`initRun` pre-marks initially-player-owned tiles `effectClaimed`**). Tests: a captured `muster`/`boon` tile fires once; a tile manually reverted then re-owned (simulated recapture) does NOT re-fire; a `muster`/`boon` tile that starts player-owned never fires; the no-enemy behavior/timing is unchanged (existing run fixtures stay green under full parity).
2. **Enemy reclaim** — `shared/types.ts` (`MapSetup.enemyReclaims?: boolean`; `MapEvent` += `reclaimed`); `sim/run.ts` (`RunState.enemyReclaims`; `initRun` reads `setup.enemyReclaims`; `applyEnemyAI`; `runTick` gates it on `run.enemyReclaims`). Tests: a garrisoned enemy tile reclaims an undefended adjacent player tile (+ `reclaimed` event); does NOT reclaim a defended tile (army present), a non-adjacent tile, or from an un-garrisoned enemy tile; `enemyReclaims` false ⇒ no reclaim; with the enemy on, a re-captured muster tile does NOT re-spawn (the Task-1 flag + this together).
3. **Parity fixtures** — `tools/parity/fixtures.mjs` (+`run-reclaim-seedN`, +`run-hold-seedN`, `enemyReclaims: true`, capture hashes, V8≡goja) + pin unit tests in `sim/run.test.ts`. Confirm `86e238c1` + all 21 existing fixtures unchanged.

**Changed:** `shared/types.ts` (`MapTile.effectClaimed?`, `MapSetup.enemyReclaims?`, `MapEvent` reclaimed), `sim/run.ts` (`RunState.enemyReclaims`, `initRun`, `applyEnemyAI`, `applyCaptureEffects` hardening, `runTick`), `tools/parity/fixtures.mjs` (+2 v4 fixtures). Co-located `sim/run.test.ts`. `conquest-map.ts`/`tile-fight.ts`/`replay.ts` **untouched**.

---

## 9. Risks & Mitigations
- **Breaks the tile-effect "fires once" guarantee** — mitigated by the `effectClaimed` flag (once-ever), the central reason this slice pairs the hardening with the enemy AI. Tested for recapture-no-refire.
- **Accidentally perturbs existing fixtures** — mitigated: opt-in/default-off + the behavior-identical claimed-flag swap; full parity (21 fixtures + anchor) is the gate.
- **Degenerate dispossession** — the player can't lose a tile they occupy (armies defend their tile), so a player with armies always holds ≥ their armies' tiles; no "owns nothing but has armies" state.
- **Determinism** — id-ordered, RNG-free; the new fixtures lock V8≡goja.
- **Engine-coupling creep** — all logic in `sim/run.ts`; `conquest-map.ts`/`tile-fight.ts` untouched (the enemy is run-orchestration, not the player-control engine). Enforced in review.

## 10. Open knobs / deferred
- Always-on vs opt-in (this slice: opt-in; game maps enable it); reclaim cadence (every tick now); whether reclaim should move/cost garrison (no now).
- The arc's next slices: enemy **sorties with battles** (two-sided capture — the big generalization), enemy **mobile armies**, **reinforcement**/garrison movement, threat/value **target selection**, difficulty tuning.
