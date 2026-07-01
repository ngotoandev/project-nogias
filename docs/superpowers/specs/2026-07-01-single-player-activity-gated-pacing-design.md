# Single-Player Activity-Gated Pacing — Design

**Date:** 2026-07-01
**Status:** Approved (brainstorm) → ready for planning
**Arc:** Run-loop / interaction model (foundational pacing)

## Goal

Make single-player time **activity-gated**: the world advances only in discrete *beats* that the player initiates, and **every beat is equally the enemy's window**. When the player is idle, nothing happens — no attrition, no enemy reclaim/sortie, no healing. This removes the always-on real-time pressure and makes the game *fair for both sides*: time is a shared currency, and spending it (marching, resting, waiting) is what gives the enemy its opportunities.

## Guiding principle (the "why")

> Time only flows when someone acts, so **nothing is free** — resting to heal, marching an army, or deliberately waiting all cost the same thing: a beat the enemy also gets to use. Idle = frozen = safe, but stagnant. Acting creates the openings.

This recontextualizes the already-shipped enemy AI (reclaim/sortie): the enemy is not on an independent clock — it acts *inside* the windows the player opens.

## Interaction model (approved)

- **Idle ⇒ frozen.** With no in-flight activity and no player input, the world does not advance.
- **Commit-and-resolve.** When the player issues a command (dispatch / retreat / extract), the world **auto-advances** (animation-paced) until it is quiescent again, then freezes. The player commits, watches the whole resolution, and re-plans at the pause.
- **Beat-by-beat waiting.** To deliberately pass otherwise-idle time (e.g. to heal on a Rest tile), the player takes a single **wait-beat** — one tick — and re-decides. Healing is one increment per beat; each wait-beat is also an enemy window (an enemy sortie into that window then auto-resolves under commit-and-resolve).

## Current state (grounding)

The sim already embodies ~80% of this — the change is mostly *exposing* and *honoring* it, not building new mechanics.

- `runTick(run, commands)` (`sim/run.ts`) advances **exactly one tick**: `advance` → `applyRestHealing` → `applyCaptureEffects` → `applyEnemyAI` (opt-in) → win/lose. It does **not** self-gate on activity — the *caller* decides when to call it.
- The replay driver already gates on quiescence. In `sim/replay.ts`, both `runScriptedRun` (v4) and `runScriptedConquest` (v3) loop `while (… && pending() && … < MAX)`, where:
  ```ts
  const pending = () =>
    s.armies.some((a) => a.state === 'travelling' || a.state === 'retreating') ||
    bundle.script.some((a) => a.atTick >= s.totalTicks) ||
    s.battles.some((b) => !b.fight.outcome);
  ```
- Therefore a **wait-beat is simply `runTick(run, [])`** — one tick with no player command: units on Rest tiles heal one step, the enemy AI gets one action, any battle steps once. No new mechanic, no new command.

## The change

### 1. Sim: a single, pure activity signal (parity-critical)

Add one pure selector — the single source of truth for "is there live activity":

```ts
// sim/conquest-map.ts (MapState lives here)
export function hasPendingActivity(map: MapState): boolean {
  return (
    map.armies.some((a) => a.state === 'travelling' || a.state === 'retreating') ||
    map.battles.some((b) => !b.fight.outcome)
  );
}
```

Dedupe the replay driver to use it (keeping the script-lookahead, which is a replay-harness concern, separate):

```ts
// sim/replay.ts — both runScriptedRun and runScriptedConquest
const pending = () =>
  hasPendingActivity(<mapState>) ||
  bundle.script.some((a) => a.atTick >= <mapState>.totalTicks);
```

The final boolean is **identical** to today's (the `||` operands are side-effect-free pure reads, so reordering `armies || script || battles` into `(armies || battles) || script` cannot change the result). ⇒ **behavior-preserving refactor; all 26 parity fixtures + anchor `86e238c1` frozen.**

`runTick` is **unchanged**. No new sim command. `hasPendingActivity` reads `MapState`; the interactive client combines it with `run.status === 'active'`.

### 2. Interactive client contract (the dev visualizer is the reference client)

One paced loop covers both commit-and-resolve and wait-beat:

```
onInput(cmds):                     // cmds = player command(s), or [] for a deliberate wait-beat
  if run.status !== 'active': return
  runTick(run, cmds)               // the beat the player initiated
  resolve():                       // auto-advance consequences, one tick per animation frame/interval
    if run.status === 'active' && hasPendingActivity(run.map):
      runTick(run, [])
      schedule(resolve)            // animation-paced
    else:
      freeze()                     // → "your move"
```

Behavior:
- **Quiescent + no input ⇒ frozen** ("your move").
- **A command ⇒ resolving… → freeze** (commit-and-resolve): the committed march/battle plays out to quiescence, then stops.
- **A wait-beat (`[]`) ⇒ one tick.** If it stays quiescent, one heal increment and freeze. If the enemy sortied into that window, the *same* `resolve()` loop auto-resolves the resulting battle, then freezes. Nothing free.
- Per-tick effects (Rest heal, enemy AI, attrition) run inside each `runTick`, so during any window — committed or waited — *all* sides advance together. Fair by construction.

### 3. Viz (reference implementation)

`tools/viz/`:
- Replace any always-on/continuous ticking with the paced `onInput`/`resolve` loop above.
- Add an **"⏭ Advance beat / Wait"** control (issues `runTick(run, [])` then runs `resolve()`), alongside existing click-to-dispatch and extract.
- Show a clear state indicator: **frozen ("your move")** vs **resolving…**.
- Animation pacing: one `runTick([])` per fixed interval (or rAF) while resolving, so motion/battles are legible rather than instant.

## Determinism / parity

- **No sim behavior change.** `hasPendingActivity` is a pure read; the `pending()` refactor is behavior-preserving; `runTick` and all engines are untouched in behavior. Pacing lives entirely in the client loop.
- **Anchor `86e238c1` + all 26 fixtures byte-identical.** The extracted selector must reproduce the exact `pending()` boolean; a full `npm run parity` (V8≡goja, 26 fixtures) is the gate.

## Testing

- **Sim units** for `hasPendingActivity(map)`: `true` while an army is `travelling`/`retreating`; `true` while a battle has no `fight.outcome`; `false` when all armies `garrisoned` and no battle; independent of `run.status` (the status gate is the client's).
- **Parity:** `npm run parity` → 26 fixtures V8≡goja, anchor + every prior hash unchanged (pure refactor).
- **Viz smoke (node):** the paced loop (a) freezes at quiescence, (b) a dispatch resolves-then-freezes, (c) a wait-beat advances exactly one tick and heals one increment on a Rest tile, (d) an enemy sortie opened during a wait-beat auto-resolves before freezing.

## Scope

**In scope:**
- `hasPendingActivity` selector + `pending()` dedupe (sim).
- Viz interactive paced loop + wait-beat control + frozen/resolving indicator.
- Updated Sim client-contract documentation (the loop above).

**Out of scope (flagged for later):**
- **Enemy motion counting as activity.** Once enemy **mobile armies** exist, "an enemy army marching" would satisfy `hasPendingActivity` — should that let the world keep ticking while the *player* is idle (breaking idle-safety), or should enemy motion not sustain time when the player is idle? Deferred to the enemy-mobile-armies slice; the enemy is positionally static today, so it cannot arise now. (`hasPendingActivity` intentionally keys on army *state*, so this is a localized future decision.)
- **Godot client.** Environment-blocked (no C++ toolchain / web-export templates); the dev visualizer is the reference interactive client for this slice.

**Non-goals (YAGNI):**
- No "rest until full / until interrupted" auto-wait (rejected in favor of deliberate beat-by-beat waiting).
- No new sim command for waiting (`runTick([])` already is the wait-beat).
- No change to `runTick`, `advance`, or any engine behavior.

## Files

- `sim/conquest-map.ts` — add exported `hasPendingActivity(map: MapState)`.
- `sim/replay.ts` — dedupe both `pending()` closures onto it (behavior-preserving).
- `sim/conquest-map.test.ts` — unit tests for the selector (co-located with the function).
- `tools/viz/viz.js` (+ `index.html`, `smoke.mjs`, `README.md`) — paced loop, wait control, indicator, smoke assertions, contract doc.
