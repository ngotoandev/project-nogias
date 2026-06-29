# Skills & Mana — Charge + One Active (Plan 5) — Design

Status: **draft for review** · drafted 2026-06-29 · third combat-depth slice (after Plan 3 two-channel damage, Plan 4 ranged+LoS). Implements the GDD Skills & Mana foundation (`docs/game-design-document.md` §"Skills & Mana (ability charge)" + the Mana derived-stat notes).

This is **Plan 5**. Plan 6 (traits + behavior precedence) builds on it and is out of scope.

---

## 1. Context & Goal

Units have derived stats, two-channel damage, ranged+LoS — but no abilities. The GDD gives every hero class one **Mana-charged active**: Mana accumulates in-combat (no time-regen) by dealing and taking damage (INT raises the rate), and is spent to cast. Plan 5 builds the **foundation** of that system: the Mana resource, one single-target active (**Heavy Strike**), and the per-turn *cast-vs-basic-attack* decision.

**Goal:** a unit accrues Mana as it fights; when it has a skill and enough Mana, on its turn it casts (a guaranteed-hit, amplified strike) instead of a basic attack, spending the Mana. Deterministic, integer, goja-bit-identical. Units without a skill (and the all-melee canonical fight) are byte-identical to Plan 4.

---

## 2. Scope

### 2.1 In scope
- Mana as unit state: `maxMana` + INT-scaled `manaChargeBp` (derived); `Unit.mana` (current, starts 0, no carry between fights).
- Integer charge rules: a landed **basic** attack charges the attacker; **taking** damage (from anything) charges the victim (scaled to the bite, capped).
- One active, **Heavy Strike**: an optional `skill?` on a unit; guaranteed hit, amplified damage, Mana cost.
- The per-turn decision: cast when the unit has a skill and `mana ≥ cost` (and a target is in attack position); else basic attack.
- A new skill parity fixture; re-verify V8 == goja.

### 2.2 Out of scope (later)
- **AoE** actives (Cleave), **passives** (Hardened/Deadeye/Arcane Resonance), **healing** (entry-cap), **element tags** (Arcane/Fire/Lightning + terrain).
- **Cast-time ticks** (a cast is a single activation here), the **pressure-valve** / cast-conditions, **multi-skill catalogs**, **command auras**.
- Hero-vs-rank-and-file distinction; XP/progression.

---

## 3. Approach (decided in brainstorming)

**Integer/basis-point Mana, "cast when affordable", Mana left out of the state hash.** Charge fractions (`incoming/MaxHP`, INT rate) are ported to integer basis points (like Plan 3). The cast decision is the minimal "have skill && mana ≥ cost && a target is in range/LoS" — richer timing (pressure-valve, cast-conditions, personality) is Plan 6. **Mana is NOT added to `hashFight`**, consistent with `gauge` (tempo), which also isn't hashed — both are transient resources whose divergence manifests in positions/HP. This **preserves the golden `86e238c1`** (the all-melee, no-skill canonical fight is byte-identical) and keeps the state-hash subset stable; the new skill parity fixture verifies the Mana→cast→damage path cross-runtime.

Rejected: hashing Mana (tighter desync detection but forces a golden re-pin and diverges from the `gauge` precedent); modelling the skill as fully data-driven now (YAGNI for one active — an extensible `SkillId` union + config suffices).

---

## 4. Mana as State (`shared/types.ts`, `sim/stats.ts`)

```ts
export type SkillId = 'heavyStrike'; // union; extends to a catalog later

// DerivedStats gains:
//   maxMana: number;       // cap
//   manaChargeBp: number;  // INT-scaled charge multiplier (basis points, 10000 = 1.00)

// Unit gains:
//   mana: number;          // current; starts 0; no carry between fights

// UnitSpec gains:
//   skill?: SkillId;       // optional active; absent = basic-attacks only
```

`deriveStats(attrs, attackKind)` additionally returns `maxMana = MANA_MAX` and `manaChargeBp = MANA_BASE_BP + MANA_INT_COEF · INT`. `runTileFight` initializes each `Unit.mana = 0`.

---

## 5. Charge Rules (`sim/combat.ts` helpers + `sim/tile-fight.ts`)

Pure helpers (integer-only, unit-tested):
```ts
// Mana gained when a basic attack lands (charges the attacker).
export function manaGainOnHit(manaChargeBp: number): number;
//   = floor(M_HIT · manaChargeBp / 10000)

// Mana gained when a unit takes `incoming` damage (charges the victim), capped per hit.
export function manaGainOnTaken(incoming: number, maxHp: number, manaChargeBp: number): number;
//   = min(M_TAKEN_CAP, floor(M_TAKEN · incoming · manaChargeBp / (maxHp · 10000)))
```

Applied in the resolution (after damage is dealt), each capped so `mana` never exceeds `maxMana`:
- A **basic** attack that lands: `attacker.mana += manaGainOnHit(attacker.manaChargeBp)`.
- **Any** unit that takes damage (basic or skill): `victim.mana += manaGainOnTaken(incoming, victim.maxHp, victim.manaChargeBp)`.
- A **Heavy Strike** does **not** charge its caster (only basics add `M_HIT`); the caster spends `cost`.

So basics build toward a cast; frontline units charge off damage taken, strikers off damage dealt — the GDD's intent.

**Constants (`shared/config.ts`, tunable):** `MANA_MAX=100`, `MANA_BASE_BP=10000`, `MANA_INT_COEF=400`, `M_HIT=14`, `M_TAKEN=30`, `M_TAKEN_CAP=22`.

**Verified example values (node-checked; double as test expectations):**
| | INT 1 | INT 5 | INT 9 |
| --- | --- | --- | --- |
| `manaChargeBp` | 10400 | 12000 | 13600 |
| `manaGainOnHit` | 14 | 16 | 19 |
| basic hits to reach cost 70 | 5 | 5 | 4 |

`manaGainOnTaken` (INT 1): a 45-HP unit taking 14 → **9**, taking 24 → **16**, taking 45 → **22** (capped); a 25-HP unit taking 20 → **22** (capped).

---

## 6. The Skill — Heavy Strike (`sim/combat.ts` + config)

```ts
export function heavyStrikeDamage(atk: number, def: number): number;
//   = floor(mitigatedDamage(atk, def) · HEAVY_STRIKE_MULT / 100)
```

- **Cost:** `HEAVY_STRIKE_COST = 70` Mana (config). A unit casts when `mana ≥ cost`, then `mana -= cost` (remainder carries).
- **Guaranteed hit:** no hit roll (always lands) — distinct from a basic attack, which can miss.
- **Amplified:** `HEAVY_STRIKE_MULT = 180` (×1.80) on the mitigated damage, then the **normal crit roll** applies (`applyCrit`). So a Heavy Strike draws one RNG (crit only), a basic draws one (hit) or two (hit+crit).
- Same channel and `attackRange`/LoS gate as the unit's basic attack (it's a targeted single-target strike).

Verified: `atk 17` vs `def 5` → basic 14, Heavy Strike **25** (×1.8) before crit.

The cost/effect for a `SkillId` live in `shared/config.ts` (a tiny lookup, e.g. `SKILL_COST['heavyStrike']`), so adding a second skill is a config + helper addition, not a structural change.

---

## 7. The Per-Turn Decision (`sim/tile-fight.ts`)

After the actor moves into attack position (`inAttackPosition`, unchanged from Plan 4), choose the action:
```
if actor.skill is set AND actor.mana >= SKILL_COST[actor.skill]:
    cast Heavy Strike:
        damage = heavyStrikeDamage(actor.atk, def);  crit roll;  apply;
        actor.mana -= cost;  victim.mana += manaGainOnTaken(...);
        emit attack{ ..., skill: actor.skill }
else:
    basic attack (hit roll → mitigation → crit, exactly as Plan 4):
        on a landed hit: actor.mana += manaGainOnHit(...);  victim.mana += manaGainOnTaken(...)
        on a miss: emit miss (no mana to either side)
```
`FightEvent.attack` gains an optional `skill?: SkillId` (present on a skill-dealt hit; absent on a basic). `miss` only occurs on basics.

---

## 8. Determinism, Golden & Parity

- **Mana is not hashed** (`hashFight` keeps id/side/pos/HP + ticks — same subset, consistent with `gauge`). The all-melee, **no-skill** canonical fight is byte-identical (Mana accrues but is unhashed and never spent, so positions/HP are unchanged) ⇒ **golden `86e238c1` is preserved, no re-pin**. `sim/tile-fight.test.ts` / `sim/replay.test.ts` keep `86e238c1`.
- **Add a skill parity fixture** to `tools/parity/fixtures.mjs`: a small fight with at least one `skill: 'heavyStrike'` unit (it charges and casts), with its own captured hash. `npm run parity` then asserts V8 == goja across all fixtures — proving the integer Mana/charge/skill math is goja-identical.
- All charge + skill math is integer/basis-point; the parity gate is the guardrail.

---

## 9. Files & Testing

**Changed:**
- `shared/types.ts` — `SkillId`; `DerivedStats.maxMana`/`manaChargeBp`; `Unit.mana`; `UnitSpec.skill?`; `FightEvent.attack.skill?`.
- `shared/config.ts` — mana + Heavy Strike constants; `SKILL_COST` lookup.
- `sim/stats.ts` + `sim/stats.test.ts` — `maxMana`/`manaChargeBp` (assert the §5 table values).
- `sim/combat.ts` + `sim/combat.test.ts` — pure `manaGainOnHit`/`manaGainOnTaken`/`heavyStrikeDamage` with the verified values + cap/monotonicity.
- `sim/tile-fight.ts` + `sim/tile-fight.test.ts` — Mana init + accrual + the cast decision; tests: a unit accrues Mana from basics/taking damage; a skilled unit casts when charged (an `attack` event with `skill: 'heavyStrike'`), the cast out-damages and always lands vs a basic, and spends `cost`; an unskilled fight is byte-identical — golden `86e238c1` held; determinism + no-mutation unchanged.
- `tools/parity/fixtures.mjs` — add the skill fixture (+ captured hash).

(`Unit` test helpers in `hash.test.ts`/`initiative.test.ts` add `mana: 0` and the two new derived fields.)

---

## 10. Risks & Mitigations
- **A float/fraction divergence in the charge math** (`incoming/MaxHP`, INT rate) — mitigated by single-`floor` integer basis-point formulas + the new skill parity fixture asserting V8 == goja.
- **Mana unhashed masking a divergence** — accepted and bounded: Mana only matters when it flips a cast, which changes HP and surfaces in the hash; this matches the existing `gauge` precedent. The skill fixture exercises a real cast cross-runtime.
- **Cast loop / dead-lock** — not applicable yet: "cast when affordable + target in position" can't dead-lock (no cast-condition to stall on); the pressure-valve arrives with cast-conditions in Plan 6.
- **Balance** — all values are tunable config; correctness is independent of them.

## 11. Open Knobs (tune later, not gaps)
- All mana/skill constants (Monte-Carlo balance).
- Whether a Heavy Strike should also grant the caster a little Mana (currently no — only basics add `M_HIT`).
- Whether Mana should eventually enter the state hash if a future resource needs tighter desync detection.
- Cast-time ticks (deferred): today a cast is one activation.
