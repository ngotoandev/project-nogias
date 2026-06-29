# Combat Foundation — Two-Channel Damage & Integer Derived Stats (Plan 3) — Design

Status: **draft for review** · drafted 2026-06-29 · first slice of "Full combat depth" (roadmap item 2 in `docs/superpowers/plans/2026-06-29-tile-fight-engine.md`), implementing the GDD Part II derived-stat + two-channel damage model (`docs/game-design-document.md` §"Derived Stats").

This is **Plan 3**, the foundation of combat depth. Plans 4–6 (ranged + line-of-sight; skills + Mana; traits + behavior precedence) build on it and are out of scope here. Plan 2's V8↔goja parity gate now guards every change in this slice — which is why the determinism-hardest piece (porting the GDD's float/sqrt formulas to integer math) is sequenced first.

---

## 1. Context & Goal

Plan 1 gave each unit a single derived `attack` and resolved a hit as flat damage with a ±10% RNG spread. The GDD's real model is richer: **two damage channels** (Physical, Magic) each mitigated by its own defense, with **Accuracy / Evasion / Crit** derived from the four primaries. This slice replaces the placeholder damage model with the GDD formulas.

**The catch:** the GDD writes those formulas in floats and square roots (`Crit = clamp(c₁·√LCK,…)`, `Evasion = clamp(e₁·√(2·AGI+LCK),…)`, `Accuracy = 1+a₁·√INT`, `mitigation = def/(def+K)`, probabilities in [0,1]). The sim is **integer-only and must stay V8↔goja bit-identical**. So the goal is to port the model to **integer / basis-point / fixed-point** math that is faithful to the GDD's *shape* (diminishing-returns curves, two channels, hit-then-crit) while remaining deterministic and goja-safe.

**Done when:** units derive the full GDD offensive/defensive stat set as integers; an attack resolves as hit-roll → channel-vs-defense mitigation → crit-roll, all from the seeded RNG; the golden hash is re-pinned to the new model and verified identical in V8 and goja.

---

## 2. Scope

### 2.1 In scope
- Expanded `DerivedStats` (two channels, two defenses, Accuracy/Evasion/Crit in basis points) derived by integer formulas.
- An explicit `attackKind` per unit (`'melee' | 'ranged' | 'magic'`); channel derived (melee/ranged → physical, magic → magic).
- A deterministic integer square root (`isqrt` / `sqrtFP`) in `/shared`.
- Tunable combat constants in `/shared` config.
- Two-channel damage resolution in the tile-fight turn loop (hit roll, mitigation, crit), with `miss` and crit-flagged `attack` events.
- Re-pin the golden hash and the parity fixture's expected hash to the new model; re-verify V8 == goja.

### 2.2 Out of scope (each its own later plan)
- **Mana + skills** (Plan 5) — no Mana bar, no actives/passives.
- **Ranged range > 1 + line-of-sight** (Plan 4) — `attackRange` stays 1; `rangedAtk` exists as a stat but ranged units fight at range 1 for now.
- **Traits + behavior precedence** (Plan 6).
- Class system, gear, attack-speed cadence, HP regen, unit footprint, personality — not modeled; their formula bases are flat config constants for now.

---

## 3. Approach (decided in brainstorming)

**Basis-point integers + integer `isqrt`, GDD-pure.** Probabilities are integers in **basis points** (bp; 0–10000 = 0–100%) compared against the seeded RNG. Square-root terms use an integer `sqrtFP`. Mitigation and crit are integer arithmetic. Coefficients are integer config in `/shared`. The RNG enters **only** through the hit roll and the crit roll — the old flat ±10% variance is removed (crit is the spread, matching the GDD). All values are JS numbers constrained to integers via `Math.floor`, well under 2^53, so V8 and goja agree bit-for-bit (the parity gate enforces this).

Rejected: precomputed lookup tables (rigid — regenerate on every coefficient change; less transparent) and uniform Q16.16 fixed-point (more machinery than basis-points-where-needed warrants).

---

## 4. Data Shapes (`shared/types.ts`)

```ts
export type AttackKind = 'melee' | 'ranged' | 'magic';
export type DamageChannel = 'physical' | 'magic';

// UnitSpec gains (required):
//   attackKind: AttackKind
// (all existing fixtures add it; channel is derived, not stored on the spec)

export interface DerivedStats {
  maxHp: number;
  atk: number;            // the unit's effective attack for its attackKind
  channel: DamageChannel; // melee/ranged -> physical, magic -> magic
  physDef: number;
  magicResist: number;
  accuracyBp: number;     // basis points (10000 = 1.00)
  evasionBp: number;      // basis points
  critChanceBp: number;   // basis points
  critMultX100: number;   // ×100 (125 = 1.25)
  tempoRate: number;      // unchanged from Plan 1
  moveRange: number;      // unchanged (1-step melee; range stays 1 this slice)
  attackRange: number;    // stays 1 (range > 1 is Plan 4)
}
```

`FightEvent` changes:
- `attack` gains `crit: boolean` and `channel: DamageChannel`.
- new variant `{ t: 'miss'; id: string; target: string }`.

`deriveStats` signature becomes `deriveStats(attrs: Attributes, attackKind: AttackKind): DerivedStats`.

---

## 5. Stat Derivation

### 5.1 Integer square root (`shared/math.ts`, new)

```ts
// Deterministic, integer-only (no Math.sqrt). Newton's method via integer
// division; floor(sqrt(n)). goja-safe — covered by the parity gate.
export function isqrt(n: number): number;          // isqrt(0)=0, isqrt(9)=3, isqrt(1_000_000)=1000
export function sqrtFP(x: number): number;          // = isqrt(x * 1_000_000) = floor(sqrt(x) * 1000)
```

Reference body (Newton, `Math.floor(n/x)` keeps it float64-integer-exact):
```ts
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = n;
  let y = Math.floor((x + 1) / 2);
  while (y < x) { x = y; y = Math.floor((x + Math.floor(n / x)) / 2); }
  return x;
}
export function sqrtFP(x: number): number { return isqrt(x * 1_000_000); }
```

### 5.2 Combat constants (`shared/config.ts`, new — all tunable)

| Const | Value | Meaning |
| --- | --- | --- |
| `HP_BASE`, `HP_PER_STR` | 20, 5 | `maxHp = HP_BASE + STR·HP_PER_STR` (unchanged) |
| `WEAPON_BASE`, `FOCUS_BASE` | 2, 2 | flat atk bases (stand in for gear, not modeled yet) |
| `ARMOR_BASE`, `RESIST_BASE` | 0, 0 | flat defense bases |
| `MITIGATION_K` | 24 | mitigation curve constant `K` |
| `SQRT_SCALE` | 1000 | fixed-point scale (`sqrtFP` returns √·1000) |
| `ACC_BASE_BP` | 10000 | accuracy baseline (1.00) |
| `ACC_COEF` (A1) | 300 | bp per √INT |
| `EVA_COEF` (E1), `EVA_CAP_BP` | 450, 7500 | bp per √(2·AGI+LCK); cap |
| `CRIT_COEF` (C1), `CRIT_CAP_BP` | 900, 9000 | bp per √LCK; cap |
| `CRITMULT_BASE_X100`, `CRITMULT_COEF` (C2) | 125, 15 | crit multiplier base (1.25) + per √LCK |
| `HIT_MIN_BP`, `HIT_MAX_BP` | 1000, 10000 | hit clamp (10%–100%) |

Starting values; to be balanced later via the `/tools` Monte-Carlo instrument. They are not load-bearing for correctness — only the formulas and integer discipline are.

### 5.3 Formulas (`sim/stats.ts`)

```
atk          = melee:  WEAPON_BASE + STR·2 + AGI
               ranged: WEAPON_BASE + AGI·2 + STR
               magic:  FOCUS_BASE  + INT·2 + LCK
channel      = (attackKind === 'magic') ? 'magic' : 'physical'
maxHp        = HP_BASE + STR·HP_PER_STR
physDef      = ARMOR_BASE  + STR
magicResist  = RESIST_BASE + INT
accuracyBp   = ACC_BASE_BP + floor(ACC_COEF  · sqrtFP(INT)          / SQRT_SCALE)
evasionBp    = min(EVA_CAP_BP,  floor(EVA_COEF  · sqrtFP(2·AGI+LCK) / SQRT_SCALE))
critChanceBp = min(CRIT_CAP_BP, floor(CRIT_COEF · sqrtFP(LCK)        / SQRT_SCALE))
critMultX100 = CRITMULT_BASE_X100 + floor(CRITMULT_COEF · sqrtFP(LCK) / SQRT_SCALE)
tempoRate, moveRange, attackRange = unchanged from Plan 1
```

**Verified example outcomes** (these exact integers must hold; they double as test expectations):

| Unit (STR/AGI/INT/LCK, kind) | atk | physDef | magicResist | accuracyBp | evasionBp | critChanceBp | critMultX100 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| balanced 5/5/1/1 melee | 17 | 5 | 1 | 10300 | 1492 | 900 | 140 |
| bruiser 9/3/1/1 melee | 23 | 9 | 1 | 10300 | 1190 | 900 | 140 |
| archer 3/9/3/3 ranged | 23 | 3 | 3 | 10519 | 2061 | 1558 | 150 |
| mage 1/3/9/5 magic | 25 | 1 | 9 | 10900 | 1492 | 2012 | 158 |
| lucky 4/4/4/9 melee | 14 | 4 | 4 | 10600 | 1855 | 2700 | 170 |

---

## 6. Damage Resolution (`sim/tile-fight.ts`)

Replaces the current attack block (the move loop and target selection are unchanged this slice). When the actor is in range of its target:

1. **Hit roll.** `hitBp = clamp(actor.accuracyBp − target.evasionBp, HIT_MIN_BP, HIT_MAX_BP)`. Draw `r1 = rng.intInRange(0, 9999)`. If `r1 >= hitBp`: emit `{ t:'miss', id, target }` and end the turn (the attack whiffed).
2. **Mitigation.** `def = actor.channel === 'physical' ? target.physDef : target.magicResist`; `damage = max(1, floor(actor.atk · MITIGATION_K / (def + MITIGATION_K)))`.
3. **Crit roll.** Draw `r2 = rng.intInRange(0, 9999)`. If `r2 < actor.critChanceBp`: `damage = floor(damage · actor.critMultX100 / 100)`; `crit = true`.
4. **Apply.** `target.hp -= damage`; emit `{ t:'attack', id, target, damage, crit, channel: actor.channel, lethal }`; on lethal, clamp hp to 0 and emit `death` (as today).

**Exactly two RNG draws per in-range attack** (hit, then crit only on a hit — note: crit is rolled only when the hit lands, so the RNG stream depends on hits; this is intentional and deterministic). A miss draws once.

---

## 7. Determinism, Golden Re-Pin & Parity

- The damage model changes, so the canonical fight (`baseSetup`, seed 42) reaches a different end state ⇒ a **new golden hash** (no longer `e9ff47f3`). This is a deliberate, documented drift: re-capture it via the established capture step, update `sim/tile-fight.test.ts` and `sim/replay.test.ts`, and update `tools/parity/fixtures.mjs`'s `expectedHash`.
- Then **re-verify V8 == goja** on the new value with `npm run parity` (both runtimes run the rebuilt bundle).
- `fnv1a` / `hashFight` / the bundle entry / the goja runner are **unchanged** — only expected values and the stat/damage code move. The fnv1a golden-value pins from Plan 2 are unaffected.
- All new math is integer (`Math.floor`, integer compares, `isqrt`), so V8 and goja stay bit-identical; the parity gate is the guardrail.

---

## 8. Files & Testing

**New:**
- `shared/math.ts` + `shared/math.test.ts` — `isqrt`/`sqrtFP`: known values (`isqrt` of 0/1/2/4/9/16/1_000_000), monotonicity, `sqrtFP(9)=3000`.
- `shared/config.ts` — the tunable constants table.

**Changed:**
- `shared/types.ts` — `AttackKind`, `DamageChannel`, `UnitSpec.attackKind`, expanded `DerivedStats`, `FightEvent` (`miss`, `attack.crit`/`.channel`).
- `sim/stats.ts` + `sim/stats.test.ts` — new `deriveStats(attrs, attackKind)`; tests assert the §5.3 example outcomes, channel mapping, the bp clamps (evasion ≤ 7500, crit ≤ 9000), and monotonicity (atk↑ with its stats; physDef↑ STR; magicResist↑ INT; accuracy↑ INT; evasion↑ AGI/LCK; crit↑ LCK).
- `sim/tile-fight.ts` + `sim/tile-fight.test.ts` — new resolution; tests: deterministic hit/miss/crit from a fixed seed; physical attacker damage scales down vs higher `physDef`; magic attacker vs higher `magicResist`; a high-evasion target is missed more than a low-evasion one over a fixed RNG sequence; `miss`/`crit` events emitted; **golden re-pin**; determinism (same seed ⇒ identical events + hash); no-mutation.
- `sim/replay.test.ts` — golden re-pin (same new hash).
- `tools/parity/fixtures.mjs` — canonical bundle gains `attackKind`; `expectedHash` ← new golden.

All existing `UnitSpec` fixtures across tests add `attackKind`.

---

## 9. Risks & Mitigations

- **A float/sqrt subtlety diverges V8↔goja.** Mitigated by integer-only math (custom `isqrt`, no `Math.sqrt`; basis-point compares) and the parity gate, which now runs the rebuilt bundle in goja and asserts the re-pinned golden.
- **32-bit vs float64 surprises.** All combat arithmetic stays in plain JS numbers (float64) kept integer via `Math.floor`, with magnitudes far below 2^53; no `| 0` / `>>>` outside the existing RNG/hash. No overflow path (atk·K and stat·sqrtFP are ≪ 2^31 for realistic stats).
- **Balance is untuned.** Explicitly deferred to the Monte-Carlo tool; constants are config, and correctness does not depend on their values.
- **Golden churn confusion.** The re-pin is a single documented capture step; the parity harness re-confirms cross-runtime equality on the new value.

---

## 10. Open Knobs (tune later, not gaps)
- All `shared/config.ts` coefficients (balance pass via Monte-Carlo).
- Whether crit is rolled before or after the hit gate (chosen: after — crit only on a landed hit).
- Whether to keep three stored atk values vs the single resolved `atk` (chosen: single resolved `atk` + `channel`, since a unit has one `attackKind`).
- `MITIGATION_K` curve shape (linear-ish vs steeper) once more defenses/gear exist.
