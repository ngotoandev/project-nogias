# Enemy Mobile Armies (v1 — march & strike) — Design

**Date:** 2026-07-02
**Status:** Approved (brainstorm) → ready for planning
**Arc:** Enemy map-AI (slice 3) — the enemy's first *mobile* agency

## Goal

Give the enemy **mobile armies**: map-authored forces that **march across enemy-held ground toward the nearest player tile and assault it on arrival**. This is the enemy's first agency that *moves* (prior slices: static garrisons that reclaim undefended tiles and sortie stationary-defended ones). It closes the loop opened by the activity-gated pacing rule — a marching enemy army sustains time, so the player cannot sit idle while a threat closes in.

**Scope: deliver-one-attack, v1.** An enemy army marches to its target and strikes once; on a win it takes the tile (its units become the garrison), on a loss it is destroyed, and a lethal arrival can lose the run. That is the whole loop, end-to-end.

## Guiding context

- **Pacing rule (decided, [[activity-gated-pacing-complete]]):** *any* army marching — enemy or player — keeps time flowing; idle is safe only when the board is fully static. So a marching enemy army MUST make `hasPendingActivity` true.
- **The representation knot:** `state.armies` is deliberately player-only — `isLost` is `armies.length === 0`, and `committedCount`/`defended`/`MAX_COMMIT` plus all 26 frozen parity fixtures assume it. Enemy armies must be visible to the pacing selector without breaking any of that.
- **Determinism is the critical gate:** integer-only, RNG-free decision layer, total-order iteration; V8↔goja parity (26 fixtures) + anchor `86e238c1` must stay frozen for all existing (enemy-army-free) states.

## Architecture

### 1. Representation — a separate `state.enemyArmies` array

Enemy armies are map-authored and live in their **own** array, reusing the existing `Army` shape.

- `MapSetup.enemyArmies?: ArmySpec[]` — same element shape as `setup.armies` (`{ id, units, tile }`). Absent/empty ⇒ no enemy armies.
- `MapState.enemyArmies: Army[]` — built by `initConquest` (deep-copied, sorted by id, `state: 'garrisoned'`, `travelGauge: 0`), exactly like `state.armies`.

**Why separate, not owner-tagged `state.armies`:** keeping enemy armies out of `state.armies` leaves `isLost` (player-only), `committedCount`, `defended`, `MAX_COMMIT`, and every frozen fixture **untouched** — additive, minimal parity risk. The only pacing hook is a new clause in `hasPendingActivity`. Owner-tagging the shared array was rejected: it would rewrite those frozen player invariants for no real gain, since movement and combat fork by owner anyway.

`hasPendingActivity` gains one clause:
```ts
export function hasPendingActivity(map: MapState): boolean {
  return map.armies.some((a) => a.state === 'travelling' || a.state === 'retreating') ||
         map.enemyArmies.some((a) => a.state === 'travelling') ||   // NEW — a marching enemy sustains time
         map.battles.some((b) => !b.fight.outcome);
}
```
For every existing state `enemyArmies` is `[]`, so the boolean is unchanged ⇒ the replay `pending()` and all fixtures are byte-identical.

### 2. Movement — an `advanceEnemyArmies` phase inside `advance()`

A new phase within `advance(state, commands)`, after the player movement/arrival phase and before the shared battle-step phase, processing enemy armies in **id order**:

- **Target selection (idle army):** pick the **nearest reachable player tile** via deterministic BFS over enemy-held tiles (expand N/S/E/W, id-tiebreak) — the mirror of the player's `bfsRoute` (which routes over player-owned tiles). Set `target` + a `route` toward an enemy tile adjacent to the target; `state = 'travelling'`. If no player tile is reachable over enemy ground, the army stays `garrisoned` (idle, contributes no pending activity).
- **Travel:** accumulate `travelGauge` on the same tempo model as player armies (`slowestTempo` / `TRAVEL_THRESHOLD`); hop enemy tile → enemy tile along `route`.
- **Arrival → assault:** when the army reaches the launch tile (an enemy tile adjacent to the target), it opens the assault (§3).
- **No-op when `enemyArmies` is empty**, so every existing fixture (v3 conquest + v4 run) is frozen. Enemy mobile armies are gated by *presence*, not a flag.

Simpler than player travel by construction (deliver-one-attack): **no** reinforcement bookkeeping on the mover, **no** retreat, **no** commit-cap.

### 3. Combat — reuse the enemy-attacker battle layer

The lethal-sortie slice already built the `attackerOwner: 'enemy'` battle open + outcome. Generalize the *attacker source* so a mobile army can drive it:

- **Refactor `openSortie`** into a shared enemy-assault opener parameterized by the attacker's origin: extract the battle build/push (attacker units → fight side A, `attackerGarrison` stash of the originals, `attackerOwner:'enemy'`, gate = `gateOf(target, launchTile.id)`, defenders = the target tile's garrison **plus** any stationary player army on it — the existing sortie defender logic) into a helper. The current garrison-sortie caller passes `attackerUnits = source.garrison` and consumes it by emptying `source.garrison`. The **new army-assault caller** passes `attackerUnits = army.units` and consumes it by **removing the army from `state.enemyArmies`**. `openSortie`'s existing behavior (garrison sortie) stays byte-identical ⇒ frozen sortie fixtures.
- **Concurrent same-target assault (v1 — sequential):** if a battle is already open at the target when another enemy army arrives, that army **waits** (holds on its launch tile, retries next tick) rather than opening a second battle — assaults are sequential. If the target is no longer player-owned on arrival (already flipped), the army **disbands**. If the target is **undefended** (no garrison, no player army), the army takes it **fight-free** (mirror of the player capturing an undefended tile). Piling-in via `joinFight` and re-targeting are deferred refinements.
- **Outcome (already generalized, unchanged):** enemy **win** → tile flips enemy, surviving side-A units rebuild the tile garrison (via the stashed originals), the enemy army is already consumed; any defending player army is removed from `state.armies` → can trigger `isLost` (lose the run if it was the last). Enemy **loss** → the attacker units are wiped (army already removed); tile stays player.

Because the army is *consumed into the battle* on assault (exactly as a garrison sortie empties its garrison), an enemy army is only ever `garrisoned` or `travelling` in `enemyArmies`; the assault itself is covered by the `battles` clause of `hasPendingActivity`.

### 4. Determinism / parity

- RNG-free: BFS + id-order iteration; integer tempo math; no `Date.now()`/`Math.random()`.
- `hashMap` folds `enemyArmies` **additively** in the same shape it folds player armies (id : tile : state : units+HP). For every existing state `enemyArmies` is empty, so the fold contributes nothing new ⇒ **anchor `86e238c1` + all 26 fixtures byte-identical**. New enemy-army fixtures get fresh V8≡goja pins.
- Player mechanics (`isLost`, `committedCount`, `defended`, `MAX_COMMIT`, player travel/arrival/outcome) are untouched.

### 5. Pacing integration

A `travelling` enemy army makes `hasPendingActivity` true. Under the client's commit-and-resolve loop: sit idle while an enemy army marches and the world keeps ticking (it closes in, then assaults); the run only freezes once the board is static again. The viz renders enemy armies marching (a distinct owner color) so this is visible.

## Testing

- **Sim units:** an enemy army selects the nearest player tile and enters `travelling`; `hasPendingActivity` is true while it marches; on arrival an `attackerOwner:'enemy'` battle opens against the target's defenders; **win** → target `owner==='enemy'` + army units become the garrison + army gone from `enemyArmies`; **loss** → army gone, target stays player; a **lethal** assault that removes the player's last army sets `status==='lost'`; a garrison **sortie** still behaves byte-identically (refactor is behavior-preserving). BFS target-selection is deterministic; no reachable player tile ⇒ army stays idle.
- **Parity:** `npm run parity` → anchor + all 26 prior fixtures **frozen**; add new v4 fixtures (enemy-army march-and-win, march-and-repelled, march-and-lethal) pinned V8≡goja.
- **Viz smoke:** a map with an enemy army resolves with the army marching then striking (the loop plays out headlessly under commit-and-resolve).

## Scope

**In:** `state.enemyArmies` + `MapSetup.enemyArmies`; `advanceEnemyArmies` (nearest-player-tile BFS, tempo travel, arrival); the `openSortie`→shared-opener refactor + army-assault caller; `hasPendingActivity` + `hashMap` folds; parity fixtures; viz render + smoke.

**Out (deferred to later slices):**
- Garrison→army **mobilization**, spawn-over-time, reinforcement waves.
- **Smart** targeting (weakest/highest-value tile, boss-rush), multi-front coordination, difficulty scaling.
- **Persistent campaigning** — an enemy army that garrisons a captured tile and marches onward multi-hop (v1 delivers one assault, then is the garrison or dead).
- Enemy-army **retreat**; mid-march **interception** of / by player armies.

**Non-goals (YAGNI):** no owner tag on `state.armies`; no new battle engine (reuse the `attackerOwner:'enemy'` path); no RNG in targeting.

## Files

- `shared/types.ts` — `MapSetup.enemyArmies?` (same element shape as `armies`).
- `sim/conquest-map.ts` — `MapState.enemyArmies`; `initConquest` builds it; `advanceEnemyArmies` phase in `advance`; nearest-player-tile BFS (mirror of `bfsRoute`); refactor `openSortie` into a shared enemy-assault opener + the army-assault caller; `hasPendingActivity` + `hashMap` folds.
- `tools/parity/fixtures.mjs` — new enemy-army fixtures (win / repelled / lethal).
- `tools/viz/viz.js` (+ `setups.js`, `smoke.mjs`) — render enemy armies (distinct owner color) + a smoke assertion that an enemy army marches and strikes.
