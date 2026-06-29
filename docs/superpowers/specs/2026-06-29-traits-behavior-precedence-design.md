# Traits + Behavior Precedence (Plan 6) — Design

Status: **draft for review** · drafted 2026-06-29 · fourth and final combat-depth slice (after Plan 3 two-channel damage, Plan 4 ranged+LoS, Plan 5 skills+Mana). Implements the GDD behavior-precedence model (`docs/game-design-document.md` §"Traits & Personality", §"Priority", §"Skills & Mana") and the combat-rework spec's per-turn decision layer (`2026-06-29-combat-rework-and-architecture-design.md` §3.3, §3.8).

This is **Plan 6**. It is the **decision/AI layer** over the existing move+attack+cast resolution, plus the deferred Mana pieces Plan 5 punted.

---

## 1. Context & Goal

Plans 3–5 built *resolution*: two-channel damage, ranged+LoS, and a Mana-charged active. But every unit still decides the same way — the per-turn decision in `runTileFight` is inline and identical for all: `chooseTarget` (nearest → priority → id) → move toward → cast-if-affordable-else-basic. There is **no precedence pipeline, no trait layer, no personality layer**, and the only skill casts the instant it's affordable (no cast-condition, no pressure-valve).

The GDD's behavior-precedence model is **`trait hooks → priority/targeting rules → default AI`**, evaluated at the start of each unit's turn, all deterministic from seed: *"a Coward flees on its turn at low HP; a Headstrong charges the nearest enemy."* Personality adds a **lowest-precedence soft lean** that colors a fight without changing numbers.

**Goal:** turn the inline decision into an explicit, testable precedence pipeline; layer on the trait hooks (decision-override, dynamic-stat, RNG), the personality lean, and the deferred Mana pieces (a second, *conditional* skill — Cleave — plus cast-conditions and the universal pressure-valve). Deterministic, integer, goja-bit-identical. The canonical all-melee fight (no traits/personality/skills) stays **byte-identical** — golden `86e238c1` is **not** re-pinned.

---

## 2. Scope

### 2.1 In scope
- **Precedence pipeline:** extract the inline per-turn decision into a pure `decideTurn(actor, eff, ctx) → TurnIntent`, executed by the loop. Behavior-preserving for trait-less / personality-less units.
- **Trait data model:** `TraitId` union, `UnitSpec.traits?` → `Unit.traits`, a config catalog marking each trait's hooks.
- **Dynamic-stat layer:** a pure `effectiveDerived(unit, ctx) → DerivedStats` applied on the damage path (attacker `atk`, target defenses), implementing **Reckless / Slow Starter / Bloodthirsty / Loyal**.
- **Decision-override hooks:** **Coward** (flee at low HP + rally valve, with a new `stepAway` primitive) and **Headstrong** (force-nearest + charge-to-melee).
- **RNG action hooks:** **Stupid** (10% basic-attack misfire; never a cast) and **Lucky Fool** (5% random retarget), resolved at action execution.
- **Skill dispatch + Cleave:** generalize the hardcoded `heavyStrike` gate into a `SKILL_COST` lookup + a small cast dispatch; add **Cleave** (AoE physical, ≥2-enemy cast-condition); the **universal pressure-valve** (no skill can dead-lock).
- **Personality temperament lean:** `UnitSpec.personality?: { temperament }`; a bounded, lowest-precedence target tie-break + skill-dump timing nudge that changes no numbers.
- New parity fixtures per mechanism; re-verify V8 == goja; **golden `86e238c1` preserved**.

### 2.2 Out of scope (later / deferred by prior plans)
- **Stateful aggro lock-on** (target stickiness until dead/out-of-range). It is GDD-canonical but the *only* thing that would re-pin the anchor (it changes targeting for trait-less units too). The precedence stack is fully demonstrated without it, and Headstrong is observable via charge-to-melee. **Deferred to a fast-follow** to keep the anchor frozen.
- **Real retreat / pull-out** (a map-layer command the tile-fight doesn't model) — so Bloodthirsty's "won't retreat" is a no-op today (it suppresses any flee intent; becomes real once retreat lands) and Coward flees by kiting within the grid (no gate exit).
- **Hero vs rank-and-file** distinction — so "leader" is a deterministic proxy (highest-priority living ally), not a flagged hero.
- Stat-shaping traits (Brawny/Nimble/Gifted/Blessed) — pure attribute trades, baked into `attrs` by `/meta` generation; the sim never sees them.
- Out-of-combat traits (Scavenger/Tough/Quartermaster), passives (Hardened/Deadeye/Arcane Resonance), element tags, healing, cast-time ticks, command auras, multi-temperament motivation/quirk (meta/flavor).

---

## 3. Approach (decided in brainstorming)

**An explicit, mostly-pure precedence pipeline; the anchor stays frozen; unbuilt deps use honest proxies.**

The per-turn decision becomes a value (`TurnIntent`) produced by a pure `decideTurn`, so each precedence layer is unit-testable. RNG-drawing hooks (Stupid/Lucky Fool, the crit/hit rolls) resolve at *execution*, keeping `decideTurn` pure. Dynamic stats are recomputed each turn from fight state (`effectiveDerived`) rather than mutated in place — simpler, deterministic, and a trait-less unit returns base stats unchanged.

**Determinism strategy — keep the canonical fixture pure and stable, demonstrate every new mechanic in its own new fixture.** Every addition (traits, personality, Cleave, valve) affects only units that opt in, so the all-melee / no-skill / no-trait canonical fight is byte-identical ⇒ **golden `86e238c1` is preserved, no re-pin** (the same precedent as Mana in Plan 5). All new math is integer / basis-point / fixed-point and goja-safe.

Rejected: stateful aggro lock-on now (forces a baseline re-pin for marginal fidelity — deferred); mutating `derived` in place for dynamic traits (re-derivation is cleaner and avoids order-dependence); a fully data-driven trait engine (YAGNI for this catalog — a `TraitId` union + a config catalog of hook flags suffices).

---

## 4. The Precedence Pipeline (`sim/tile-fight.ts` + new `sim/decide.ts`)

At the start of a unit's turn:

```
eff = effectiveDerived(actor, ctx)            // §6 dynamic-stat traits; feeds decision AND resolution
intent = decideTurn(actor, eff, ctx):         // pure; returns a TurnIntent
  1. trait decision hooks (highest precedence)
       Coward:     hp% <= COWARD_FLEE_BP and not rallied  -> { mode: 'flee' }
       Headstrong: target := nearest enemy; charge := true (close to melee)
  2. priority/targeting rules
       chooseTarget: dist asc -> priority desc -> [personality tie-break] -> id asc
  3. default AI
       mode 'engage': move toward target up to moveRange (stop in attack position); choose action
  4. personality lean (lowest precedence)
       bounded target tie-break (step 2) + skill-dump timing nudge (step 3 action choice)
execute(intent):                              // the loop mutates state
  move per intent.mode; resolve action; RNG hooks (Stupid misfire / Lucky Fool retarget) perturb here
```

`TurnIntent` (explicit, testable):
```ts
type MoveMode = 'engage' | 'flee';
type ActionKind = 'basic' | 'cast' | 'none';
interface TurnIntent { targetId: string | null; move: MoveMode; action: ActionKind; charge: boolean; }
```

The trait-hook layer can **override** target (Headstrong) and movement (Coward); priority/targeting picks the target otherwise; default AI fills in movement + action; personality only breaks ties and nudges timing. **A unit with no traits and no personality produces exactly today's behavior** (target = `chooseTarget`, `move='engage'`, `charge=false`, action = cast-if-affordable-else-basic).

**Trait stacking:** a unit may carry up to 2 traits (GDD). Dynamic-stat traits *compose* (each factor applied in a fixed `TraitId` catalog order). Decision hooks apply in fixed catalog order; a no-flee hook (Bloodthirsty "won't retreat") suppresses a flee intent from Coward. Deterministic and order-stable.

---

## 5. Trait Data Model & Taxonomy (`shared/types.ts`, `shared/config.ts`)

```ts
export type TraitId =
  | 'reckless' | 'slowStarter' | 'bloodthirsty' | 'loyal'   // dynamic-stat
  | 'coward' | 'headstrong'                                  // decision-override
  | 'stupid' | 'luckyFool';                                  // RNG action
// UnitSpec gains:  traits?: TraitId[];   // absent = no hooks
// Unit gains:      traits: TraitId[];    // normalized (default [])
//                  kills: number;        // for Bloodthirsty; transient, unhashed
//                  stallSinceTick: number;   // for the pressure-valve; transient, unhashed, -1 = inactive
//                  fleeingSinceTick: number; // for Coward's rally valve; transient, unhashed, -1 = inactive
```

The catalog (`shared/config.ts`) marks each trait's shape so dispatch is table-driven, not a scattered set of `if`s:
```ts
// e.g. TRAIT_HOOKS[id] = { dynamicStat?: true, decision?: true, rngAction?: true }
```
Only traits with a sim hook need to be passed in `UnitSpec.traits`; stat-shaping traits are already baked into `attrs` by `/meta` and are absent here.

---

## 6. Dynamic-Stat Layer (`sim/stats.ts` `effectiveDerived` + `sim/combat.ts`)

A pure function applied wherever base stats feed combat — **both** the attacker's `atk` and the **target's** defenses (so a Reckless *target* is correctly squishier):
```ts
export function effectiveDerived(unit: Unit, ctx: FightCtx): DerivedStats;
//   ctx = { totalTicks, units };  returns unit.derived UNCHANGED when unit.traits has no dynamic-stat trait
```
Integer / basis-point only. Each trait names exactly which stats it touches (others pass through). Formula *shapes* below; exact constants live in `shared/config.ts` and are pinned with node-checked example tables during implementation (correctness depends on the formula, not the values).

- **Reckless** — atk up as HP falls, physDef down (constant penalty, the trade):
  `missingBp = floor((maxHp - hp) * 10000 / maxHp)` → `atk += floor(atk * RECKLESS_ATK_BP * missingBp / (10000 * 10000))`; `physDef = floor(physDef * (10000 - RECKLESS_DEF_BP) / 10000)`.
- **Slow Starter** — a single ramp factor on atk + both defenses, from `−EARLY_BP` at t=0 to `+LATE_BP` at full ramp:
  `rampBp = min(10000, floor(totalTicks * 10000 / SLOW_STARTER_RAMP_TICKS))`; `factorBp = (10000 - SLOW_STARTER_EARLY_BP) + floor((SLOW_STARTER_EARLY_BP + SLOW_STARTER_LATE_BP) * rampBp / 10000)`.
- **Bloodthirsty** — flat atk per kill: `atk += unit.kills * BLOODTHIRSTY_ATK_PER_KILL`. "Won't retreat" = suppresses any flee intent (§4; no-op until retreat exists). `kills` increments when this unit deals a lethal blow.
- **Loyal** — leader = highest-priority living ally **excluding self** (tiebreak id; none ⇒ neutral). `d = chebyshev(unit.pos, leader.pos)`; `d <= LEADER_RADIUS` ⇒ ×`(10000 + LOYAL_NEAR_BP)`; `d >= LOYAL_FAR_RADIUS` ⇒ ×`(10000 - LOYAL_FAR_BP)`; else neutral. Applies to atk + both defenses.

`effectiveDerived` is computed once per actor turn (for its own stats) and on demand for a target at damage time. The crit/hit/Mana helpers already take the relevant stat as an argument, so they're unchanged.

---

## 7. Decision-Override Hooks (`sim/decide.ts` + new `stepAway` in `sim/grid.ts`)

- **Coward** — when `hp% <= COWARD_FLEE_BP`, intent `move = 'flee'`: the loop uses a new **`stepAway(from, threats, canEnter)`** primitive — the enterable 4-neighbor maximizing the minimum chebyshev distance to living enemies (deterministic tiebreak: greater min-distance → toward board centroid → x-then-y), `+COWARD_FLEE_MOVE_BONUS` move range while fleeing ("moves faster"), and no attack that turn. **Rally valve** (resume `engage`) on *either* `RALLY_TICKS` elapsed since fleeing began *or* within `LEADER_RADIUS` of the proxy leader — bounded, so it can cost a fight but never plays it forever. (Tracked via a transient `fleeingSinceTick`, unhashed.)
- **Headstrong** — overrides targeting to **pure nearest** (ignores priority + personality tie-breaks) and sets `charge = true`, so the loop closes to melee (range 1) regardless of `attackRange`. On a melee unit it's ~a no-op; on a ranged/caster it's the visible "charges the nearest enemy."

Both are RNG-free and fire only for units carrying the trait ⇒ anchor frozen. `stepAway` is integer-only (chebyshev), goja-safe.

---

## 8. RNG Action Hooks (`sim/tile-fight.ts`, at execution)

Resolved when the action is executed (after `decideTurn`), so the decision stays pure. Each draws exactly one `rng` value, in a fixed order relative to the existing hit/crit draws (documented so V8 == goja):

- **Stupid** — on a **basic** attack only: `rng.intInRange(0,9999) < STUPID_MISFIRE_BP` (≈10%) ⇒ misfire: wasted action, emit a new `{ t: 'misfire', id, target }` event, no damage / no Mana to either side. **Never** misfires a charged cast (the escape valve). The misfire roll happens *before* the hit roll (so a misfire consumes one draw, not two).
- **Lucky Fool** — `rng.intInRange(0,9999) < LUCKY_FOOL_BP` (≈5%) ⇒ retarget: the action's target becomes a uniformly-random living enemy (`rng.intInRange(0, n-1)` over the deterministically-sorted enemy list) instead of the chosen one. Applies to basics and casts; bounded chaos. The retarget roll happens at the start of execution.

Both demonstrated in new fixtures; no Stupid/Lucky-Fool unit in the canonical fixture ⇒ anchor frozen.

---

## 9. Skill Dispatch + Cleave + Cast-Conditions + Pressure-Valve (`shared/config.ts`, `sim/combat.ts`, `sim/tile-fight.ts`)

**Generalize the gate** (folds in the Plan 5 carried-forward item): replace the hardcoded `actor.skill === 'heavyStrike' && actor.mana >= HEAVY_STRIKE_COST` with a lookup + dispatch:
```ts
export const SKILL_COST: Record<SkillId, number> = { heavyStrike: HEAVY_STRIKE_COST, cleave: CLEAVE_COST };
// castCondition(skill, actor, eff, units, grid): boolean   // heavyStrike: target in attack position
//                                                          // cleave: >= CLEAVE_MIN_TARGETS enemies in arc
// resolveCast(skill, ...) : applies the skill's effect (single-target or AoE)
```
`SkillId` extends to `'heavyStrike' | 'cleave'`.

**Cleave** — AoE physical:
- **Arc on the grid:** all living enemies with `chebyshev(caster, e) <= CLEAVE_RADIUS` (default 1) **and** `hasLineOfSight(caster, e)`, sorted deterministically (dist asc → priority desc → id asc) for crit-roll order.
- **Cast-condition:** `targets.length >= CLEAVE_MIN_TARGETS` (2).
- **Effect:** guaranteed hit per target; `damage = floor(mitigatedDamage(eff.atk, targetEff.physDef) * CLEAVE_MULT / 100)`; per-target crit roll (one `rng` each, in sorted order); each victim charges Mana from the bite (`manaGainOnTaken`). Caster spends `CLEAVE_COST` once, gains no Mana (consistent with Heavy Strike). Emits one `attack{ skill:'cleave' }` per target.

**Universal pressure-valve** — no skill can dead-lock: while `mana >= SKILL_COST[skill]` but `castCondition` is unmet, the unit accrues stall (`stallSinceTick` set on entry; `totalTicks - stallSinceTick >= VALVE_TICKS` ⇒ force-cast on the best available target/area, requiring ≥1 valid target in range/LoS). Reset on cast / condition-met / mana-drop. No RNG; deterministic; `stallSinceTick` is transient and unhashed. Heavy Strike's condition (target in attack position) is met whenever it would act, so it never stalls — the valve exists for conditional skills like Cleave.

New fixtures: a Cleave that fires on a 2-enemy cluster, and a valve-forced Cleave against a single enemy.

---

## 10. Personality Temperament Lean (`shared/types.ts`, `sim/decide.ts`)

The sim needs only **temperament** (motivation/quirk are meta/flavor):
```ts
export type Temperament = 'brave' | 'cautious' | 'hotheaded' | 'stoic'; // the four leaning ones
// UnitSpec gains:  personality?: { temperament: Temperament };   // absent = neutral
```
(GDD's Arrogant/Cheerful/Grim are flavor-leaning ⇒ no sim effect ⇒ not in this union.)

**Lowest precedence, changes no numbers.** Two bounded surfaces:
1. **Target tie-break** — a single integer key inserted **between `priority desc` and `id asc`** in `chooseTarget`, so it can only break a tie among enemies equal on (distance, priority), never override either: `brave` → most-dangerous (enemy base `atk` desc); `hotheaded` → go-for-the-kill (enemy `hp` asc); `cautious` → least-dangerous (enemy base `atk` asc); `stoic` → neutral (falls through to id). A Headstrong trait override skips this entirely (pure nearest).
2. **Skill-dump timing** — a bounded ± on the unit's effective `VALVE_TICKS`: `hotheaded` fires sooner (`max(0, VALVE_TICKS - LEAN_VALVE_DELTA)`), `cautious` later (`+LEAN_VALVE_DELTA`), `brave`/`stoic` unchanged. Clamped; never breaks the cast-condition itself (only affects when the *valve* forces a conditional skill).

(Advance-timing — the GDD's third, fuzziest surface — is intentionally omitted to protect determinism clarity; revisit only if playtest wants it.) Applies only to units with a temperament ⇒ anchor frozen.

---

## 11. Determinism, Golden & Parity

- **Anchor `86e238c1` is preserved, no re-pin.** The pipeline refactor is behavior-preserving; every new mechanic affects only opt-in units (traits / personality / a `cleave` skill). The canonical all-melee, no-skill, no-trait, no-personality fight is byte-identical (same precedent as Mana in Plan 5). `sim/tile-fight.test.ts` / `sim/replay.test.ts` keep `86e238c1`.
- **Transient, unhashed state stays unhashed:** `kills`, `stallSinceTick`, `fleeingSinceTick` join `gauge`/`mana` outside `hashFight` (which keeps id/side/pos/HP + ticks). Their effects surface in positions/HP, which *are* hashed.
- **New RNG draws are ordered and documented** (Lucky Fool retarget → Stupid misfire → hit → crit; Cleave per-target crit in sorted order) so the stream is identical in V8 and goja.
- **New parity fixtures** in `tools/parity/fixtures.mjs`, each with its own captured hash, exercising: a dynamic-stat trait; Coward flee + rally; Headstrong charge; Stupid misfire + Lucky Fool retarget; Cleave on a cluster; a valve-forced cast; a personality tie-break. `npm run parity` then asserts V8 == goja across the expanded set.
- All new math is integer / bp / fixed-point — no floats, no `Math.sqrt`. The parity gate is the guardrail.

---

## 12. Files & Testing (task decomposition)

Decomposed into subagent tasks (sonnet implementer + sonnet spec/quality reviewer each; fix Critical/Important between; **opus** whole-branch review at the end):

1. **Decision-pipeline refactor** — new `sim/decide.ts` (`decideTurn`, `TurnIntent`); `runTileFight` executes the intent. Behavior-preserving ⇒ `86e238c1` held. Tests: intent for a baseline unit matches prior target/move/action; golden + no-mutation unchanged.
2. **Trait model + `effectiveDerived`** — `TraitId`, `UnitSpec.traits`/`Unit.traits`/`kills`, catalog; `effectiveDerived` with Reckless/Slow Starter/Bloodthirsty/Loyal (+ node-checked tables); wired into the damage path. New dynamic-stat fixture. Trait-less ⇒ identical.
3. **Decision-override hooks** — `stepAway` (+ grid tests); Coward (flee + rally valve, `fleeingSinceTick`) + Headstrong (force-nearest + charge). New Coward & Headstrong fixtures.
4. **RNG action hooks** — Stupid (misfire + `misfire` event) + Lucky Fool (retarget); ordered draws. New fixtures.
5. **Skill dispatch + Cleave + valve** — `SKILL_COST`, `castCondition`/`resolveCast`; Cleave (AoE, ≥2 condition); pressure-valve (`stallSinceTick`). New Cleave + valve-forced fixtures.
6. **Personality lean** — `Temperament`, `UnitSpec.personality`; tie-break key + valve-delta. New personality fixture.

**Changed across the plan:** `shared/types.ts` (TraitId, Temperament, Unit/UnitSpec fields, `cleave` SkillId, `misfire` event), `shared/config.ts` (all new constants + `SKILL_COST` + trait catalog), `sim/stats.ts` (`effectiveDerived`), `sim/combat.ts` (`cleaveDamage`, cast dispatch helpers), `sim/grid.ts` (`stepAway`), `sim/decide.ts` (new), `sim/tile-fight.ts` (execute the intent, RNG hooks, valve), `tools/parity/fixtures.mjs` (new fixtures + hashes), and co-located `*.test.ts`. `Unit` test helpers (`hash.test.ts`/`initiative.test.ts`) add `traits: []`, `kills: 0`, `stallSinceTick: -1`, `fleeingSinceTick: -1`.

---

## 13. Risks & Mitigations
- **An accidental baseline behavior change re-pins the anchor** — mitigated by making task 1 strictly behavior-preserving and keeping the canonical fixture pure; the golden test + parity gate catch any divergence immediately.
- **RNG draw-order divergence (V8 vs goja)** — mitigated by a single fixed, documented draw order and per-mechanism fixtures asserting V8 == goja.
- **A float/fraction divergence in the new stat/skill math** — single-`floor` integer basis-point formulas (like Plans 3/5) + parity fixtures.
- **Conflicting trait hooks (e.g. Coward + Bloodthirsty)** — fixed catalog order; no-flee suppresses flee; documented and rare (starters never roll the harshest hooks).
- **Personality leaking into numbers** — constrained to a sub-`priority` tie-break + a clamped valve-tick delta; unit tests assert it never changes a non-tied target or any damage value.
- **Balance** — all values are tunable config; correctness is independent of them (Monte-Carlo later).

## 14. Open Knobs (tune later, not gaps)
- All new constants (flee threshold, rally/valve ticks, Cleave cost/radius/mult, trait coefficients, misfire/random rates, lean delta) — Monte-Carlo balance.
- Whether stateful aggro lock-on should land in a fast-follow (and re-pin the anchor deliberately then).
- Whether advance-timing should join the personality lean.
- Whether a valve-forced Cleave should prefer the densest reachable cluster vs the nearest target.
- Whether Loyal/Slow Starter should touch accuracy/evasion too (currently atk + defenses only).
