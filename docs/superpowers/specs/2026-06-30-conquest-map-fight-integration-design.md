# Conquest-Map ↔ Tile-Fight Integration — Design

Status: **draft for review** · drafted 2026-06-30 · **Plan 3 (capstone) of the conquest-map arc** (arc = steppable fight engine [done] → conquest-map control layer [done] → **integration**). Realizes the master spec's continuous mid-fight model (`2026-06-29-combat-rework-and-architecture-design.md` §3.5–3.6).

This closes the arc: the map's `advance` **drives** the steppable fight at contested tiles, with continuous reinforcement/retreat and HP-carrying attrition.

---

## 1. Context & Goal

Plan 1 made the tile-fight steppable (`FightState`/`stepFight`/`joinFight`/`orderRetreat`). Plan 2 built the clockless map (`advance(state, commands)`, travel, commit slots, undefended capture) with a deliberately **inert** `contested` seam at defended tiles. This plan fills that seam: when armies reach a defended tile, the map opens a real fight and steps it on the map clock — reinforcements join the live battle, retreats pull units out, and the outcome flips ownership and grinds down rosters (HP-carrying attrition).

**Goal:** make `advance` resolve contested tiles by driving `stepFight`. A defended tile opens a `FightState` (attacker armies vs garrison, units deployed at their map-approach gate); each map tick steps active battles a fixed budget; arriving reinforcements `joinFight`; map-`Retreat` calls `orderRetreat`; on resolution, capture (attacker win) or hold (defender win), writing surviving units' HP back to the map (dead units lost). Deterministic, integer, goja-bit-identical. The standalone-fight anchor `86e238c1` + the 13 standalone-fight fixtures stay **frozen** (the only new fight-engine surface is an opt-in start-HP).

---

## 2. Scope

### 2.1 In scope
- **Fight-engine start-HP extension** (additive): an optional per-unit entry HP that `initFight`/`joinFight` honor (`startHp ?? maxHp`, clamped `[1, maxHp]`). Standalone fights pass none → full HP → byte-identical.
- **Battle state on the map:** `MapState.battles: { tile, fight: FightState }[]`; a stable **army↔fight-unit identity** (fight unit id = `${armyId}#${unitId}`; garrison = `garrison#${unitId}`); attacker units → side `A`, garrison → side `B`.
- **Open a battle** when `resolveArrival` reaches a defended tile (replacing the inert seam): build a `FightSetup` (attacker army units + garrison, a default grid, gate→cell deploy from each army's map approach, a **derived fight seed**), `initFight`, attach to `battles`.
- **Drive battles:** each `advance` tick, step every active battle `STEPS_PER_MAP_TICK` activations.
- **Continuous join:** an army arriving at an already-battling tile → `joinFight` its units (side A, carried HP, its gate edge).
- **Retreat mid-battle:** map-`Retreat` of a contesting army → `orderRetreat` its units (their gate edge); exited units return the army to the map (carried HP), dead units lost.
- **Outcome + HP-carrying attrition:** on `FightState.outcome`, attacker-win → `capture` + survivors garrison; defender-win → attackers removed, garrison survivors persist; write surviving units' HP back, drop dead units, free slots.
- **Determinism:** `hashMap` folds in army rosters + per-unit HP + each active battle's `hashFight`; the fight seed is integer-derived from `bundle.seed` + tileId; new/re-pinned conquest parity fixtures, V8≡goja.

### 2.2 Out of scope (run-loop / later)
- **Run-orchestration:** HP **healing/recovery** (Rest tiles, items), Weary, rewards, extract/wipe, banking, the **objective/boss win-condition** (a run ends when the boss tile is taken — not modeled here; Plan 3 resolves individual tiles, not the run). HP only ever decreases here.
- **Tile *effects*** (Rest/Cache/Event/etc.), **map generation** (`/meta`), **enemy map-AI** (static garrisons), terrain-seeded fight grids (alpha uses a default grid — a documented knob), hero command auras, scouting, the optional in-fight nudge, multiplayer.

---

## 3. Approach (decided in brainstorming)

**The map `advance` drives `stepFight`; battles live on `MapState`; attrition carries HP.** A contested tile holds a live `FightState` that the map clock steps; reinforcement/retreat use Plan 1's `joinFight`/`orderRetreat` on that live state; the outcome reuses Plan 2's `capture`. Units carry current HP on the map (`UnitSpec.startHp`), enter fights wounded, and write survivors' HP back on resolution — so a battle costs dead units AND lingering wounds (healing is run-loop). The anchor stays frozen because the only fight-engine change is the **opt-in** `startHp` (standalone fights are byte-identical); the conquest engine now draws RNG only *via* the fights it spawns, in new/re-pinned conquest fixtures.

Rejected: wave-batched fights (the user chose continuous join/leave — Plan 1 built the steppable hooks for it); unit-loss-only attrition (the user chose HP-carrying); per-tile terrain grids now (YAGNI — default grid; terrain is a later knob); a separate fight-unit↔army index table (id-prefixing `${armyId}#${unitId}` is simpler and parse-back-able).

---

## 4. Fight-Engine Start-HP Extension (`shared/types.ts`, `sim/tile-fight.ts`)

```ts
// UnitSpec gains:
//   startHp?: number;   // optional entry HP; absent ⇒ full (maxHp). Clamped to [1, maxHp].
```
`specToUnit` (shared by `initFight` + `joinFight`) sets `hp: clamp(startHp ?? maxHp, 1, maxHp)` instead of always `maxHp`. **Standalone fights never set `startHp` ⇒ `hp = maxHp` ⇒ byte-identical ⇒ anchor `86e238c1` + 13 fight fixtures frozen.** Only map-built fight units (wounded survivors) carry `startHp`. This also satisfies the GDD "healing entry-cap" (a unit's in-fight HP ceiling is what it entered with — i.e. `maxHp` is unchanged, entry HP can be lower).

---

## 5. Battle State & Army↔Fight-Unit Identity (`shared/types.ts`, `sim/conquest-map.ts`)

```ts
// MapState gains:
//   battles: { tile: string; fight: FightState }[];   // active battles, kept sorted by tile id
// Army gains:
//   gate?: MapEdge;   // approach edge = the target tile's edge facing the chosen launch tile;
//                     // recorded by applyDispatch (the route + launch tile are known there).
//                     // After arrival the route is consumed, so the gate MUST be captured at dispatch.
```
- **Fight-unit ids encode origin** (so the map maps fight outcomes back without a side table): attacker unit → `` `${army.id}#${unit.id}` ``; garrison unit → `` `garrison#${unit.id}` ``. Army `id`s and within-army unit `id`s are unique, so the composite is unique across the battle. Resolution parses the prefix (`split('#', 1)`) to find the owning army (or the garrison).
- **Side assignment:** all attacker units → side `A`; all garrison units → side `B` (the map assigns side when building fight units, regardless of the source `UnitSpec.side`).
- An army contesting a tile has `state: 'contested'`; its units live in that tile's `battle.fight`. The army's own `units` list (with carried `startHp`) is the source for building/joining; it's reconciled from the fight on resolution/retreat.

---

## 6. Opening a Battle (`sim/conquest-map.ts` — `resolveArrival` defended branch)

When `resolveArrival` reaches a **defended** tile with **no active battle**, open one (instead of the Plan-2 inert seam):
1. **Grid:** a default `GridSpec` (alpha: `width=8, height=8, blocked=[]`; a `DEFAULT_FIGHT_GRID` const — terrain→grid is a later knob).
2. **Attacker units:** for each committed army arriving/at the tile, its units → fight units `{ id: \`${army.id}#${u.id}\`, side: 'A', attackKind, attrs, skill?, traits?, personality?, startHp: u.startHp, priority, pos: deployCell(gate(army), grid, k) }`.
3. **Gate:** `army.gate` (recorded by `applyDispatch` — the contested tile's edge facing the chosen launch tile; either the explicit `DispatchArmy{gate}` or derived from the BFS-chosen launch tile). Units deploy along that edge via `deployCell(army.gate, grid, k)` (k = the unit's index, spread deterministically along the edge). Two armies dispatched through different gates ⇒ a pincer (two edges). (`applyDispatch` from Plan 2 is extended to set `army.gate`.)
4. **Garrison units:** the tile's `garrison` → fight units `{ id: \`garrison#${u.id}\`, side: 'B', …, pos: deploy on the opposite/interior }`.
5. **Seed:** `fightSeed(bundle.seed, tile.id)` — a deterministic integer mix (fold tileId char codes into the seed with the `Math.imul`/xor pattern; goja-safe). `initFight(setup, fightSeed)` → push `{ tile, fight }` to `battles`. Emit `{ t:'battleOpened', tile, attackers, … }`.

(`deployCell`/`gate` are pure, integer, deterministic. Multiple same-tick arrivals are handled coherently — Plan 2's carried-forward multi-arrival note is resolved here: arrivals at a not-yet-open tile contribute to one `battleOpened`; arrivals at an open one `joinFight` — see §8.)

---

## 7. Driving Battles (`sim/conquest-map.ts` — `advance` travel/battle phase)

In `advance`, after travel/arrival and before `totalTicks++`: for each active battle (tile-id order), if `!fight.outcome`, step it `STEPS_PER_MAP_TICK` (config) activations: `for (k<budget && !fight.outcome) stepFight(fight)`. If `fight.outcome` becomes set, apply the outcome (§10) and remove the battle from `battles`. The fixed budget per tick is the spec's "activation occupies a fixed tick-budget"; deterministic.

---

## 8. Continuous Join (`sim/conquest-map.ts` — `resolveArrival` when a battle is active)

When an army arrives at a tile that **already has an active battle**: `joinFight(battle.fight, <its units as side-A fight specs at carried HP, deployed at its gate edge>)`. The joiners deploy at `gauge 0` and act at the next turn boundary (Plan 1 semantics). The army is `state:'contested'`. Emit `{ t:'reinforced', tile, armyId }`. (This is the reinforcement-queue/rotation: extra committed armies feed the same ongoing battle as they arrive.)

---

## 9. Retreat Mid-Battle (`sim/conquest-map.ts` — `Retreat` command)

Map-`Retreat` of an army whose `state` is `'contested'` (units in a live battle): for each of the army's still-active fight units, `orderRetreat(battle.fight, fightUnitId, gate(army))` — they move to the army's gate edge, stay hittable, and exit. The army becomes `'retreating'` **once all its fight units have exited or died**: its **exited** units (read from the fight by id, with their carried HP) reconstitute the army (dead units dropped); it then routes back to owned territory (Plan 2 retreat) and garrisons. If all its units died, the army is removed. Slot freed on the retreat order. (A travelling/not-yet-contesting army retreats as in Plan 2 — no battle involved.)

---

## 10. Outcome + HP-Carrying Attrition (`sim/conquest-map.ts`)

When a battle's `fight.outcome` is set, reconcile every participating army's roster from the final `FightState` (match fight units by their `${armyId}#${unitId}` prefix): each surviving unit (`hp>0`) → its `UnitSpec.startHp = hp` in the army (carried wound); each dead unit → dropped from the army's `units`; an army with no surviving units → removed from `state.armies`.
- **Attacker win (`A`):** `capture(tile, …)` (owner→player; reuse the Plan-2 helper); the surviving attacker armies become `garrisoned` on the captured tile (slots freed). The garrison is wiped.
- **Defender win (`B`):** all attacker armies are removed (their units died) — or any that retreated already left; the tile stays enemy-owned; its `garrison` is rewritten to the surviving side-`B` units (carried HP — the garrison attrits too). Slots freed.
- **Timeout/draw** (MAX_TICKS with both sides alive — should be rare): treat as **defender holds** (attackers fail) — attacker armies removed/withdrawn, garrison survivors persist. Documented edge.
Remove the battle from `battles`; emit `{ t:'captured'|'repelled', tile, … }`.

---

## 11. Determinism, Hash & Parity

- **Anchor `86e238c1` + the 13 standalone-fight fixtures frozen.** `startHp` is opt-in (standalone = full HP, byte-identical). The conquest engine now draws RNG **only via the fights it spawns**, in conquest fixtures.
- **`hashMap` extended** to reflect outcomes + live battles: per army, fold in its unit roster **and each unit's current HP** (`startHp ?? maxHp`); per active battle (tile-id order), fold in `hashFight(battle.fight.units, battle.fight.totalTicks)`. So attrition, capture, and mid-battle state are all parity-covered. (Tiles `id:owner` + armies `id:tile:state:target` as before, now plus rosters/HP + battle hashes.)
- **Fight seed** `fightSeed(seed, tileId)` is a pure integer mix (goja-safe, no float). Each tile's battle is reproducible; multiple tiles get distinct seeds.
- **Parity fixtures:** Plan 2's `conquest-contested-seed0` asserts the now-obsolete *inert* seam, so it is **removed in Task 2** (the first task that makes a defended tile fight) — this keeps the per-task parity gate green through the in-progress integration rather than leaving it red until a late re-pin. Task 7 then **adds** the final v3 fixtures: a full **dispatch→travel→fight→capture** (attacker takes a defended tile) and a **defender-holds** one (capture hashes, V8≡goja). `conquest-capture-seed0` (fight-free) and the 13 standalone-fight fixtures stay green throughout.
- Integer-only, deterministic ordering (battles + armies by id; the fight's own determinism from Plan 1). No floats/`Math.random`/`Date`/Node APIs.

---

## 12. Files & Testing (task decomposition)

Each task: TDD, sonnet implementer + sonnet reviewer, fix Critical/Important, opus whole-branch review at the end.

1. **Fight-engine `startHp`** — `UnitSpec.startHp?`; `specToUnit` clamps `startHp ?? maxHp`; `initFight`/`joinFight` honor it. Tests: a unit entered at reduced HP starts there + can't be healed above it; **standalone fights byte-identical (anchor `86e238c1` + all 13 fixtures held)**.
2. **Battle open + identity** — `MapState.battles`; extend `applyDispatch` to record `army.gate`; `resolveArrival` defended → build `FightSetup` (attacker side-A units `${armyId}#${unitId}` + garrison side-B, default grid, `gate`/`deployCell`, `fightSeed`), `initFight`, attach; `battleOpened` event. **Remove the obsolete `conquest-contested-seed0` fixture** (its inert behavior is superseded — keeps the per-task gate green). Tests: a defended arrival opens a battle with the right sides/ids/deploy; `army.gate` recorded at dispatch; seed deterministic.
3. **Drive battles** — step active battles `STEPS_PER_MAP_TICK`/tick in `advance`. Tests: a battle progresses over ticks; a one-sided matchup resolves (outcome set) — outcome *application* is Task 6.
4. **Continuous join** — arrival at an active-battle tile → `joinFight` (side A, carried HP, gate). Tests: a reinforcement's units appear in the live fight and act at the next boundary.
5. **Retreat mid-battle** — `Retreat` of a contesting army → `orderRetreat` its units; exited units reconstitute the army (carried HP) + return to the map; all-dead → removed. Tests: ordered army's units exit, the army returns to owned territory with survivors, slot freed.
6. **Outcome + attrition** — on `fight.outcome`: attacker-win (capture + survivors garrison) / defender-win (attackers removed + garrison survivors) / timeout (defender holds); HP write-back, drop dead units, remove empty armies, free slots; remove the battle. Tests: capture flips owner + survivors garrison with carried HP + dead units gone; defender-hold keeps owner + attriting garrison.
7. **`hashMap` + seed + parity** — extend `hashMap` (rosters + per-unit HP + active-battle `hashFight`); finalize `fightSeed`; **add** the two new v3 fixtures (dispatch→fight→capture + defender-holds) and capture their hashes (`conquest-contested-seed0` was already removed in Task 2). Tests: golden `86e238c1` + 13 standalone-fight fixtures unchanged; `conquest-capture-seed0` unchanged; the new conquest-fight fixtures V8≡goja.

**Changed:** `shared/types.ts` (`UnitSpec.startHp?`, `MapState.battles`, new `MapEvent`s), `shared/config.ts` (`STEPS_PER_MAP_TICK`, `DEFAULT_FIGHT_GRID`), `sim/tile-fight.ts` (`specToUnit` startHp), `sim/conquest-map.ts` (battle open/drive/join/retreat/outcome, `gate`/`deployCell`/`fightSeed`, `hashMap` extension; imports `initFight`/`stepFight`/`joinFight`/`orderRetreat`/`fightResult` from `tile-fight` — **the integration is the ONE place the map engine may import the fight engine**), `tools/parity/fixtures.mjs` (+2 v3 fixtures, re-pin conquest-contested). Co-located tests.

---

## 13. Risks & Mitigations
- **`startHp` perturbs the standalone anchor** — mitigated: `startHp` is optional and `specToUnit` falls back to `maxHp`; the golden test + 13 fixtures + parity gate catch any divergence (Task 1 is the guard).
- **Non-determinism via fight RNG / battle ordering** — battles iterated/seeded by tile id; each fight is Plan-1-deterministic; `fightSeed` is a pure integer mix; the conquest-fight fixtures assert V8≡goja.
- **Army↔fight-unit identity drift** — the `${armyId}#${unitId}` convention is the single source; unit/army ids are unique; resolution parses the prefix. Tested for capture, partial-death, and retreat.
- **Engine-coupling creep** — only `sim/conquest-map.ts` imports the fight engine, and only the integration entry points; the fight engine never imports the map. Enforced in review.
- **Step-budget starving / battle never ending** — `MAX_TICKS` inside the fight bounds it; the timeout→defender-holds rule resolves stalls; the map's `runScriptedConquest` quiescence already waits on active battles (extend "pending" to include non-empty `battles`).
- **HP-carry expands the hash** — accepted (it's the chosen attrition model); rosters+HP+battle-hashes are all deterministic and the fixtures lock them.

## 14. Open Knobs / Deferred
- `STEPS_PER_MAP_TICK` and the fight grid size/terrain seeding (Monte-Carlo balance / a later terrain pass).
- `deployCell` spread strategy + same-gate "stack-then-disperse" vulnerability (spec §3.4) — alpha uses a simple edge spread.
- Whether a timeout should be a draw vs defender-hold (currently defender-hold).
- Reinforcement-queue cap interplay (the 4-army cap already bounds concurrent attackers; rotation-as-units-fall emerges from join + attrition).
- Run-loop concerns (healing/Rest, Weary, objective/boss win, rewards) — the next sub-system after the arc.
