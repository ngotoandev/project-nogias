# Enemy Map-AI — Slice 2: Lethal Sorties (two-sided battles) — Design

Status: **draft for review** · drafted 2026-07-01 · **Second slice of the enemy-map-AI arc.** Builds on slice 1 (territorial reclaim, [[enemy-map-ai-reclaim-complete]]). Cohesive single slice (user choice): generalize the battle engine for two-sided attacks **and** add the enemy sortie + lethal lose path together.

The enemy can now **fight to retake a *defended* player tile**: a garrisoned enemy tile sorties against an adjacent player army, opening a real battle. If the enemy wins, the tile flips to enemy and **the player's army is destroyed** — so you can now lose the run to enemy action, not just to your own overreach.

---

## 1. Context & Goal

Slice 1 made the enemy reclaim *undefended* tiles (fight-free). The battle engine, though, is entirely **player-attacker-coupled**: `buildFightSetup` builds the attacker from player `Army` objects (side A) and the defender from `tile.garrison` (side B); the outcome hardcodes A-win → `tile.owner='player'` + armies garrison, B-win → garrison rebuilt. A lethal enemy sortie **inverts** this — the attacker is an enemy force (a tile's garrison), the defender is a player **army**, and the tile flips to **enemy** on attacker-win.

**Goal:** generalize the conquest-map battle/capture engine to carry an **`attackerOwner`** so the tile flips to the attacker's owner on attacker-win and the outcome assigns the player armies vs the garrison to the right roles; then add an **enemy sortie** (a run-layer decision) that opens an enemy-attacker battle against a defended player tile, plus the **lethal lose path**. **Player attacks stay byte-identical** (`attackerOwner='player'` is the default; the existing build + outcome are unchanged for that case) so all existing fixtures + the anchor freeze; the enemy-sortie path is new. Deterministic, integer, goja-bit-identical; the run/AI decision layer draws no RNG (the fight draws RNG, seeded as before). This is the first run-loop slice to modify `conquest-map.ts`.

---

## 2. Scope

### 2.1 In scope
- **`MapBattle.attackerOwner: 'player' | 'enemy'`** (default `'player'`). One field disambiguates the battle; the player armies in a battle are still found via `state.armies` (`target === tile && state === 'contested'`), and `attackerOwner` says whether they are the **attackers** (player attack) or the **defenders** (enemy sortie). The other side is always a garrison, read from the fight's `garrison#` units / the tile.
- **Enemy sortie** (run-layer decision, `applyEnemyAI` in `sim/run.ts`): a garrisoned enemy tile, at its first adjacent player neighbor (N/S/E/W) — if **undefended**, reclaim it (slice 1); if **defended** (player army present) and no battle is already there, **sortie** via a new exported `openSortie(map, source, target)`.
- **`openSortie`** (`conquest-map.ts`): the source tile's **whole garrison moves** into a new battle at the target — attacker = those garrison units (side A, deployed on the `gateOf(target, source)` edge, `garrison#${id}`); defender = the player army(ies) on the target (side B, interior, `${army.id}#${unit.id}`); `attackerOwner='enemy'`; **source garrison emptied**; the defending armies marked `contested` (target = the defended tile) so they're busy + the existing battle/retreat bookkeeping holds; `{ t:'sortie', tile, from }` event.
- **Generalized outcome** (`advance`): branch on `attackerOwner`. `'player'` → today's logic verbatim (attackers = the contested player armies; defender = `tile.garrison`; A-win → capture for player; B-win → garrison rebuilt). `'enemy'` → the new path (tile flips to enemy on A-win; the attacker garrison survivors become `tile.garrison`; the defending player armies are destroyed on A-win **(lethal)** or reconciled + held on B-win; the enemy attacker discarded on B-win).
- **Lethal lose path:** a sortie win removes the defending army from `state.armies`; if it was the last → `isLost`. Tiles flip to enemy; a captured boss can be lost.
- **Opt-in:** gated by the existing `MapSetup.enemyReclaims` flag (slice 1) — when on, the enemy reclaims **and** sorties. Default-off → all existing fixtures frozen.
- **Parity:** new v4 fixtures (sortie wins / repelled / lethal). Anchor `86e238c1` + the 21 `enemyReclaims=false` fixtures + `run-reclaim-seed1` unchanged; **`run-hold-seed1` re-pinned** (its `enemyReclaims=true` run now triggers a sortie — see §7).

### 2.2 Out of scope (later arc slices)
- **Enemy mobile armies** (`state.armies` stays **player-only** — the sortie force lives in the battle and, on a win, becomes `tile.garrison`). **Reinforcement / production** (the enemy is *self-depleting* this slice — a sortie commits the source garrison; a sustained enemy is a later slice). **Partial / smart sorties** (whole-garrison move, deterministic first-neighbor target; threat/value weighting, sortie-odds, enemy retreat are later). The meta economy, map generation, boss structures.

---

## 3. Approach (decided in brainstorming)

**A single `attackerOwner` flag on the battle + branch the outcome on it; keep the enemy *decision* in `sim/run.ts`; do it cohesively.** Rather than a heavy per-side descriptor, the one fact a battle needs is *who is attacking*: the player armies are found from state as today, and `attackerOwner` assigns them to attacker (player attack) or defender (sortie); the garrison side is read from the fight's `garrison#` units. So the **player-attack build + outcome are literally unchanged** (the default `'player'` branch), and the sortie adds a new build (`openSortie`) + the `'enemy'` outcome branch. `state.armies` stays player-only (no enemy-army ripple). The enemy *decision* (when/where) stays a run-layer concern; it calls the `conquest-map` `openSortie`.

Rejected: a full per-side `BattleSide{role,owner,kind,armyIds,fromTile}` model (over-engineered — the player armies are already derivable from state, and only the attacker's *owner* is genuinely new); enemy mobile armies in `state.armies` (huge ripple through every `state.armies` consumer); splitting generalize-then-sortie (user chose cohesive; the new outcome branch is validated by the sortie that uses it); RNG sortie targeting (deterministic first-neighbor; smarts later); projecting/copying the garrison (non-physical — the source commits, accepting self-depletion as a documented first-slice limitation).

---

## 4. The battle generalization (`sim/conquest-map.ts`)

`MapBattle` gains `attackerOwner: 'player' | 'enemy'`. The existing player-attack open (`resolveArrival`) sets `attackerOwner: 'player'` (and is otherwise unchanged). `hashMap`'s `battlePart` (`${tile}=${hashFight(...)}`) is unchanged — `attackerOwner` is bookkeeping, not hashed (its consequences — owners/garrisons/rosters — are).

**Generalized outcome** (in `advance`, replacing the current two branches with a branch on `attackerOwner`):

```
playerArmies = state.armies.filter(a => a.target === b.tile && a.state === 'contested'); // the player armies in this battle
winner = b.fight.outcome.winner;

if (b.attackerOwner === 'player') {
  // ── unchanged from today ──────────────────────────────────────────────
  // attacker = playerArmies (side A, armies); defender = tile.garrison (side B, garrison)
  // winner 'A' → tile.owner='player'; reconcileArmy each + garrison survivors (drop empty); tile.garrison=[]; 'captured'
  // else       → remove playerArmies; rebuild tile.garrison from surviving side-B garrison# units; 'repelled'
} else { // attackerOwner === 'enemy' (sortie)
  // attacker = the enemy sortie force (side A, garrison# units in the fight); defender = playerArmies (side B, armies)
  if (winner === 'A') {                       // enemy wins — LETHAL
    tile.owner = 'enemy';
    tile.garrison = <surviving side-A garrison# units rebuilt from the original sortie specs, startHp = fight hp>;
    for (const army of playerArmies) remove army from state.armies;   // defending army(ies) destroyed
    state.events.push({ t: 'captured', tile, by: '-' });              // enemy capture (reuse captured event; by '-' = enemy)
  } else {                                    // player repels the sortie
    for (const army of playerArmies) reconcileArmy(army, b.fight);    // defenders survive, attrited
    for (const army of playerArmies) { army.state='garrisoned'; army.target=undefined; army.gate=undefined; } // back to holding
    // attacker (enemy sortie force) discarded — source tile already emptied at open
    state.events.push({ t: 'repelled', tile });
  }
}
```
Helpers reused: `reconcileArmy` (matches `${army.id}#${unit.id}` — side-agnostic, works for the defending army too) and the garrison-rebuild-from-survivors (matches `garrison#${id}` against original specs + sets `startHp = fight hp` — reused for the sortie's surviving attacker garrison). For the sortie's enemy-A-win, the "original specs" are **`b.attackerGarrison`** (stashed at open, §5) — NOT `tile.garrison` (which is the empty player tile) — matched to surviving side-A `garrison#` fight units. The `playerArmies` filter also correctly excludes a defender that retreated mid-sortie (it transitions out of `contested` via the existing retreat exit-check).

---

## 5. The enemy sortie (`sim/run.ts` + `openSortie` in `conquest-map.ts`)

**`applyEnemyAI(map)`** (slice 1, extended): for each enemy-owned tile with a non-empty garrison (id order), its first player-owned neighbor (N/S/E/W):
- **undefended** (no player army on it) → reclaim (slice 1, fight-free).
- **defended** (a player army sits on it) **and no active battle at that tile** → `openSortie(map, sourceTile, targetTile)`.

**`openSortie(map, source, target)`** (new, exported):
- `attacker` units = `source.garrison` (deployed on `gateOf(target, source)`, side A, `garrison#${id}`); `defender` units = the player army(ies) on `target` (interior, side B, `${army.id}#${unit.id}`).
- build the `FightSetup` (a sortie-specific builder, sharing the `deployCell`/`garrisonCell`/id helpers with `buildFightSetup`; **player-attack `buildFightSetup` stays untouched** to guarantee byte-identical player battles), seed = `fightSeed(state.seed, target.id)`.
- **Stash the original sortie specs** on the battle (`MapBattle.attackerGarrison?: UnitSpec[] = source.garrison.slice()`) BEFORE emptying — needed to rebuild `tile.garrison` on an enemy win, because a fight `Unit` doesn't retain `attackKind` (reconstructing from the Unit would be lossy). Then `source.garrison = []` (the garrison committed to the sortie now lives in the battle). Push `{ tile: target.id, fight, attackerOwner: 'enemy', attackerGarrison }` (sorted by tile id); set each defending army `state:'contested'`, `target: target.id`, `gate: gateOf(target, source)` (a value so retreat works); emit `{ t:'sortie', tile: target.id, from: source.id }`.
- The existing battle-step phase drives it; the §4 `'enemy'` outcome resolves it on a later tick.

**Self-depletion (documented):** a sortie commits the source garrison; repelled → source stays empty (the enemy can be ground down). Lethal but not yet sustained — reinforcement is a later slice. Deterministic, RNG-free at the decision layer.

---

## 6. Lethal lose + win/lose interplay (`sim/run.ts`)
- **Lose reachable via the enemy:** a sortie win removes the defending army (§4); `isLost` (`map.armies.length === 0`) now fires from enemy action if it was the last army — the first time the enemy can lose you the run.
- **The boss can be lost:** a player-owned boss whose defending army is destroyed by a sortie flips back to enemy; `isWon` (requires *all* boss tiles player-owned, re-checked each tick) correctly stops holding — the win must be *kept*.
- `runTick` order unchanged from slice 1: advance → Rest → tile effects → `applyEnemyAI` (reclaim + sortie) → win/lose.

---

## 7. Determinism, hash & parity
- **RNG-free decision layer; integer.** Sortie target deterministic (first N/S/E/W player neighbor of a garrisoned enemy tile); the fight is `fightSeed`-seeded as today.
- **`hashMap` unchanged.** `battlePart` reads `b.fight` + `b.tile` only; `attackerOwner` is not hashed (consequences — tile owners/garrisons/army rosters — are). Player-attack battle hashes identical.
- **Player attacks byte-identical** (the `attackerOwner==='player'` outcome branch is today's code verbatim; `buildFightSetup` untouched) → anchor `86e238c1` + the **21 `enemyReclaims=false` fixtures + `run-reclaim-seed1` stay frozen**. **`run-hold-seed1` is RE-PINNED**: it sets `enemyReclaims:true` and its garrisoned enemy tile is adjacent to the a2-*defended* `t2`, so slice 2 now makes it **sortie** `t2` (new behavior) instead of leaving it — its hash + postcondition change (a legitimate re-pin of an `enemyReclaims=true` fixture, NOT the anchor). (`run-reclaim-seed1` reclaims its undefended E-neighbor first and never faces a defended player tile → no sortie → unchanged.)
- **New v4 fixtures** (V8≡goja, `enemyReclaims: true`): `run-sortie-win` — a garrisoned enemy tile sorties a defended player tile, wins → tile enemy + defender destroyed + enemy garrison installed; `run-sortie-repelled` — the player army repels it (holds, attrited; source emptied); `run-sortie-lethal` — the destroyed army was the player's last → `status:'lost'`.

---

## 8. Files & task decomposition

1. **`attackerOwner` + sortie build + `openSortie`** — `conquest-map.ts`: `MapBattle.attackerOwner` (default `'player'`); `resolveArrival` sets `'player'` on the existing open (otherwise untouched); a sortie `FightSetup` builder (enemy garrison side A on `gateOf(target,source)`, defender army side B interior; shares cell/id helpers, leaves `buildFightSetup` untouched); `openSortie(map, source, target)` (empty source garrison, push battle `attackerOwner:'enemy'`, mark defenders contested, `sortie` event). `shared/types.ts`: `MapEvent` += `{ t:'sortie'; tile; from }`. Tests: `openSortie` builds the right sides/ids/deploy, empties the source, marks the defender contested, `attackerOwner:'enemy'`; player-attack open still sets `'player'`.
2. **Generalized outcome** — `conquest-map.ts` `advance` outcome phase branches on `attackerOwner`: `'player'` = today's two branches verbatim; `'enemy'` = the new branch (§4: A-win → tile enemy + attacker-garrison survivors become `tile.garrison` + defending armies removed; B-win → defenders reconciled+held, attacker discarded). Tests: player-attack capture + repel unchanged (parity gate); enemy-sortie A-win (tile→enemy, garrison installed, defender army gone) + B-win (defender held+attrited, source stays empty).
3. **`applyEnemyAI` sortie branch** — `sim/run.ts`: defended first-neighbor → `openSortie`; undefended → reclaim (slice 1). Tests: garrisoned enemy adjacent to a defended player tile opens a sortie; undefended still reclaims; `enemyReclaims:false` → neither; sortie not opened if a battle already exists there.
4. **Lethal lose + win/lose** — run-level via `runTick`. Tests: enemy sortie wins → tile enemy + defending army removed; the destroyed army was the player's last → `status:'lost'`; sortie repelled → player holds; a sortie retaking a captured boss un-wins (status returns to/stays active until re-taken).
5. **Parity fixtures** — `tools/parity/fixtures.mjs` (+`run-sortie-win`, +`run-sortie-repelled`, +`run-sortie-lethal`; capture hashes; V8≡goja) + pin unit tests. Confirm `86e238c1` + all 23 existing fixtures unchanged.

(Tasks 1–2 generalize the engine [player path byte-identical]; 3–4 add the sortie decision + lethality; 5 locks parity. ~5 tasks, each independently testable.)

**Changed:** `shared/types.ts` (`MapEvent` += `sortie`), `sim/conquest-map.ts` (`MapBattle.attackerOwner`, sortie build, `openSortie`, `resolveArrival` sets attackerOwner, generalized outcome), `sim/run.ts` (`applyEnemyAI` sortie branch), `tools/parity/fixtures.mjs` (+3 v4 fixtures). Co-located tests. `tile-fight.ts`/`replay.ts` untouched.

---

## 9. Risks & Mitigations
- **Highest-risk change of the arc** (the core battle engine). Mitigated: the `attackerOwner==='player'` branch is today's code **verbatim** and `buildFightSetup` is untouched → player attacks are byte-identical, proven by the 23 frozen fixtures + anchor (the gate); the new `'enemy'` branch is unit-tested on both win directions; opus whole-branch review. Keeping the generalization to one flag (not a descriptor model) minimizes the blast radius.
- **`hashMap` drift** — `attackerOwner` not hashed; `battlePart` unchanged. Player-attack hashes identical.
- **Enemy-army ripple** — avoided: `state.armies` stays player-only; the sortie force lives in the battle / becomes `tile.garrison`. `isLost`/`committedCount`/`defended`/travel unaffected by enemy forces.
- **The defender filter** — `playerArmies = filter(target===tile && contested)` works for BOTH roles because `attackerOwner` disambiguates; a sortie's defending army is marked `contested`+`target` at open so it's found, and excluded if it retreats (existing exit-check). Join/retreat dynamics for player attacks are unchanged.
- **Self-depletion / balance** — accepted + documented (lethal, not yet sustained); reinforcement is a later slice. First-neighbor targeting is crude but parity-stable.
- **Boss lost after won** — `isWon` re-checks all boss tiles each tick; a sortie that retakes the boss un-wins. Tested.

## 10. Open knobs / deferred
- Whole-garrison vs partial sortie; sortie cadence / odds / threat-value targeting; enemy retreat; **reinforcement / production** (to make the enemy *sustained*); enemy **mobile armies**; multi-front coordination — later arc slices. Plus the slice-1 carry-forward comment nits and the `defended = all armies` note (a travelling player army over a tile still counts as defending it against a sortie — acceptable here, flagged).
