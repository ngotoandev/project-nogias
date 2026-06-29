## Task 5 Report: Skill dispatch + Cleave AoE + cast-conditions + pressure-valve

### Summary
Task 5 generalizes the hardcoded `heavyStrike` gate into a `SKILL_COST` lookup, adds the `castCondition` predicate, implements the **Cleave** AoE skill, and introduces the **universal pressure-valve** (force-cast after VALVE_TICKS of stalling). All prior fixture hashes are unchanged.

---

### 1. Dispatch Generalization — heavyStrike byte-identical confirmed

**What changed:** `decideAction` previously hard-coded `actor.skill === 'heavyStrike' && actor.mana >= HEAVY_STRIKE_COST`. It now uses `SKILL_COST[actor.skill]` and calls `castCondition(actor, target, ctx)`.

**Why it stays byte-identical for heavyStrike:**
- `castCondition` returns `true` for `heavyStrike` unconditionally (being in attack position is sufficient).
- `SKILL_COST['heavyStrike'] === HEAVY_STRIKE_COST` (same value, different lookup).
- The valve clock always hits the `else` branch for heavyStrike (condition is always true → `stallSinceTick` resets to -1 every tick → valve never fires).
- Confirmed: `skill-cast-seed11` hash is still `b621e99d` after generalization.

---

### 2. Cleave Skill

**Config additions** (`shared/config.ts`):
```ts
CLEAVE_COST = 60
CLEAVE_RADIUS = 1
CLEAVE_MIN_TARGETS = 2
CLEAVE_MULT = 120     // ×1.20 per target
VALVE_TICKS = 250
SKILL_COST = { heavyStrike: 70, cleave: 60 }
```

**Type** (`shared/types.ts`): `SkillId = 'heavyStrike' | 'cleave'`

**`cleaveDamage`** (`sim/combat.ts`): `floor(mitigated(atk,def) * CLEAVE_MULT / 100)`
- node-verified: `cleaveDamage(17,5)=16` ✓, `cleaveDamage(20,3)=20` ✓

**`cleaveTargets`** (`sim/decide.ts`): living enemies with chebyshev ≤ CLEAVE_RADIUS AND LoS, sorted chebyshev asc → priority desc → id asc.

**`castCondition`** (`sim/decide.ts`): cleave → `cleaveTargets().length >= 2`; heavyStrike → `true`.

**Resolution** (`sim/tile-fight.ts`): Spend `CLEAVE_COST` once; for each target in `cleaveTargets` order, guaranteed hit, `cleaveDamage`, per-target crit roll (via `rng` in sorted order), apply, `manaGainOnTaken`, emit `{t:'attack', skill:'cleave'}`, handle death. Caster gains NO mana.

**Lucky Fool exclusion:** `if (actor.traits.includes('luckyFool') && !(action === 'cast' && actor.skill === 'cleave'))` — the gate draw is skipped entirely for cleave casts.

---

### 3. Universal Pressure-Valve

**Valve clock** (`sim/tile-fight.ts`, inside `inAttackPosition` block, BEFORE `decideAction`):
```ts
if (actor.skill && actor.mana >= SKILL_COST[actor.skill] && !castCondition(actor, target, ctx)) {
  if (actor.stallSinceTick < 0) actor.stallSinceTick = totalTicks;
} else {
  actor.stallSinceTick = -1;
}
```

**Valve in `decideAction`** (`sim/decide.ts`):
```ts
if (actor.stallSinceTick >= 0 && ctx.totalTicks - actor.stallSinceTick >= effectiveValveTicks(actor)) return 'cast';
```

**`effectiveValveTicks`** returns `VALVE_TICKS` (seam for Task 6 personality delta).

**Valve-forced cast resolution**: uses `cleaveTargets(actor, ctx)`. If ≥1 target found, cast proceeds. If 0 targets, falls through to basic (unit keeps closing).

---

### 4. TDD Evidence (RED → GREEN)

**`sim/combat.test.ts`**: Added `cleaveDamage` test (RED before export, GREEN after).
- 2 new tests: `cleaveDamage(17,5)===16`, `cleaveDamage(20,3)===20` — both pass.

**`sim/decide.test.ts`**: Added `cleaveTargets`, `castCondition`, `decideAction (cleave + valve)` tests (9 RED before implementation, all GREEN after).
- `cleaveTargets`: 4 tests (radius filter, sort order, dead exclusion, ally exclusion)
- `castCondition`: 3 tests (heavyStrike always true, cleave ≥2 true, cleave <2 false)
- `decideAction (cleave + valve)`: 4 tests (cast at ≥2, basic at 1 not-stalled, force-cast at VALVE_TICKS, basic just before threshold)

**`sim/tile-fight.test.ts`**: Added Cleave skill + valve integration tests (4 RED before tile-fight.ts changes, all GREEN after).
- Cleave hits ≥2 enemies (two `attack{skill:'cleave'}` events)
- Cleave attack events have `skill='cleave'` and `channel='physical'`
- Lucky Fool exclusion: luckyFool+cleave still hits both enemies (no single-target redirect)
- Valve: force-casts on lone enemy after VALVE_TICKS stalling

---

### 5. New Fixture Hashes + Tuning

**`cleave-cluster-seed5`** → hash `57f7a0ff`
- Setup: cl(melee,cleave,str=9,agi=9,int=9) at (2,1), e1(melee,str=15,agi=1) at (1,1), e2(melee,str=15,agi=1) at (3,1); 5x3 grid; seed=5
- Result: 2 cleave attacks (e1 and e2), winner=B in 19 ticks
- Path exercised: mana charges via basics → castCondition true (2 adj enemies) → casts Cleave hitting both

**`cleave-valve-seed7`** → hash `b028690d`
- Setup: cl(melee,cleave,str=20,agi=9,int=9) at (0,0), tg(magic,str=100,agi=1,int=1) at (1,0); 2x1 grid; seed=7
- Result: 1 valve-forced cleave attack on tg, winner=A in 295 ticks
- Path exercised: castCondition stays false (single enemy) → valve fires at ~271 ticks → force-cast
- Tuning: cl(atk=51,hp=120) hits tg for 9/hit; tg(magic,int=1) hits cl for 3/hit. 4 basics charge mana (19/hit → 76≥60). ~52 cl activations before valve fires. tg survives (~468 of 520 HP) and cl survives (~90 of 120 HP). Analytically verified.

---

### 6. All 8 Prior Fixtures Unchanged

| Fixture | Expected Hash | Status |
|---|---|---|
| canonical-baseSetup-seed42 | 86e238c1 | UNCHANGED |
| ranged-wall-seed42 | 1123ceff | UNCHANGED |
| skill-cast-seed11 | b621e99d | UNCHANGED |
| reckless-duel-seed7 | c28a905a | UNCHANGED |
| coward-kite-seed3 | 43d92801 | UNCHANGED |
| headstrong-charge-seed3 | db26f7c9 | UNCHANGED |
| stupid-misfire-seed80 | e7eaf7bb | UNCHANGED |
| luckyfool-retarget-seed173 | 068a1267 | UNCHANGED |

Full parity (V8 === goja === expected) for all 10 fixtures.

---

### 7. Files Changed

- `shared/config.ts` — added `CLEAVE_COST`, `CLEAVE_RADIUS`, `CLEAVE_MIN_TARGETS`, `CLEAVE_MULT`, `VALVE_TICKS`, `SKILL_COST`
- `shared/types.ts` — `SkillId = 'heavyStrike' | 'cleave'`
- `sim/combat.ts` — added `cleaveDamage` function
- `sim/decide.ts` — added `cleaveTargets`, `castCondition`, `effectiveValveTicks`; generalized `decideAction`; updated import
- `sim/tile-fight.ts` — valve clock; Cleave dispatch; Lucky Fool exclusion for cleave; updated imports
- `sim/combat.test.ts` — `cleaveDamage` tests
- `sim/decide.test.ts` — `cleaveTargets`, `castCondition`, valve `decideAction` tests; updated imports
- `sim/tile-fight.test.ts` — Cleave skill + valve integration tests
- `tools/parity/fixtures.mjs` — added `cleave-cluster-seed5` and `cleave-valve-seed7` fixtures

### 8. Self-Review

- heavyStrike generalization is provably byte-identical: `castCondition` always returns `true` for heavyStrike, and `SKILL_COST['heavyStrike'] === HEAVY_STRIKE_COST`. Confirmed by skill-cast-seed11 remaining `b621e99d`.
- Cleave sort order (chebyshev asc → priority desc → id asc) matches the brief exactly and is tested.
- Valve clock runs BEFORE `decideAction` as specified, so `stallSinceTick` is current for the current tick's decision.
- Lucky Fool gate draws 0 random numbers for a cleave cast (entire block skipped), ensuring no RNG leakage.
- `effectiveValveTicks` returns `VALVE_TICKS` with the seam for Task 6.
- Both new fixtures verified to exercise their intended paths (cluster: 2 cleave targets; valve: 1 force-cast after 295 ticks).
- 109 tests pass, typecheck clean, full parity for 10 fixtures.

---

## Post-Review Fixes (review of commit 82e28a0)

### Fix 1: Removed dead zero-target cleave fallback (`sim/tile-fight.ts`)

The `else { /* zero tgts → inline basic attack */ }` branch (~18 lines) was unreachable: `decideAction` is only called inside `if (inAttackPosition(actor, target))`, and for a melee cleave unit (`CLEAVE_RADIUS = 1 === attackRange = 1`) an in-position target is necessarily within cleave radius + LoS, so `cleaveTargets()` always returns ≥1. Restructured to:

```ts
const tgts = cleaveTargets(actor, ctx);
if (tgts.length > 0) {
  actor.mana -= CLEAVE_COST;
  for (const tgt of tgts) { ...per-target resolution verbatim... }
}
// Zero-target case is unreachable when in attack position; safe no-op.
```

No `else` and no inline basic-attack duplication.

### Fix 2: Use named constant `CLEAVE_COST` (`sim/tile-fight.ts`)

Changed `actor.mana -= SKILL_COST['cleave']` → `actor.mana -= CLEAVE_COST`, matching how the `heavyStrike` branch uses `HEAVY_STRIKE_COST`. Added `CLEAVE_COST` to the import. `SKILL_COST` remains in use for the skill-agnostic gate/valve paths.

### Fix 3: Strengthened cleave AoE test (`sim/tile-fight.test.ts`)

The "hits ≥2 enemies in one activation" test previously counted `attack{skill:'cleave'}` events across the whole fight. Strengthened to assert that two consecutive `attack{skill:'cleave'}` events with **different `target` values** and **no intervening event from another actor** appear in the event stream — proving the AoE hit multiple enemies in a single cast activation.

### Verification

- All 109 tests pass.
- Typecheck clean.
- All 10 parity fixture hashes UNCHANGED: `canonical-baseSetup-seed42=86e238c1`, `skill-cast-seed11=b621e99d`, `cleave-cluster-seed5=57f7a0ff`, `cleave-valve-seed7=b028690d` (plus 6 others).
