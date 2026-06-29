# Skills & Mana — Charge + One Active Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Mana (charged by combat) and one single-target active (Heavy Strike), with a per-turn cast-vs-basic decision — integer/goja-safe, leaving the all-melee no-skill fight byte-identical.

**Architecture:** Pure integer Mana/skill helpers in `sim/combat.ts` (config-driven); Mana as unit state (`maxMana`/`manaChargeBp` derived from INT, `Unit.mana` current); the tile-fight resolution accrues Mana and casts Heavy Strike when `mana ≥ cost`. Mana is left out of the state hash (like `gauge`), so the golden `86e238c1` is preserved; a new skill parity fixture verifies V8 == goja.

**Tech Stack:** TypeScript (strict), Vitest, Node 20+; the esbuild/Go-goja parity harness (Go 1.25).

**Spec:** `docs/superpowers/specs/2026-06-29-skills-mana-charge-design.md`.

## Global Constraints

- **Determinism / goja-safety:** `/sim` and `/shared` are pure — no wall-clock, `Date.now()`, `Math.random()`, I/O, Node-only APIs, `Math.sqrt`, or floats. Mana/skill math is integer / basis-point (single `Math.floor`). (`/tools` may use Node APIs.)
- **Golden `86e238c1` is PRESERVED — do NOT re-pin it.** Mana is NOT added to `hashFight` (consistent with `gauge`, also unhashed). For a no-skill unit the RNG draw order is unchanged (hit, then crit-on-hit) and Mana never alters positions/HP, so the all-melee canonical fight is byte-identical. If the golden moves, STOP and report.
- **TypeScript strict** with `noUncheckedIndexedAccess`.
- **Parity:** locally Go 1.25 is off the base PATH — prepend `export PATH="/c/Program Files/Go/bin:$PATH"` for parity runs. Committed harness hardcodes no Go path.
- **Tunable config:** Mana/skill constants live in `shared/config.ts`; correctness does not depend on their values.
- Branch: `plan-5-skills-mana` (commit there; do not push until the plan completes).

---

### Task 1: Mana & Heavy-Strike combat helpers (`shared/config.ts` + `sim/combat.ts`)

**Files:**
- Modify: `shared/config.ts`, `sim/combat.ts`
- Test: `sim/combat.test.ts`

**Interfaces:**
- Consumes: `mitigatedDamage` (existing, `sim/combat`).
- Produces: `manaGainOnHit(manaChargeBp): number`; `manaGainOnTaken(incoming, maxHp, manaChargeBp): number`; `heavyStrikeDamage(atk, def): number`; the Mana/skill config constants.

- [ ] **Step 1: Add the config constants**

Append to `shared/config.ts`:
```ts
// Mana & skills (Plan 5):
export const MANA_MAX = 100;
export const MANA_BASE_BP = 10000;  // charge-rate baseline (1.00) + the bp denominator
export const MANA_INT_COEF = 400;   // +bp of charge rate per INT
export const M_HIT = 14;            // flat charge when a basic attack lands
export const M_TAKEN = 30;          // charge scale when taking damage
export const M_TAKEN_CAP = 22;      // per-hit cap on charge-from-taken
export const HEAVY_STRIKE_COST = 70;
export const HEAVY_STRIKE_MULT = 180; // x100 (1.80)
```

- [ ] **Step 2: Write the failing test**

Add to `sim/combat.test.ts` — extend the import on line 2 to include the three new helpers, then append:
```ts
describe('manaGainOnHit', () => {
  it('scales the flat M_HIT charge by the INT-derived rate', () => {
    expect(manaGainOnHit(10400)).toBe(14); // INT 1
    expect(manaGainOnHit(12000)).toBe(16); // INT 5
    expect(manaGainOnHit(13600)).toBe(19); // INT 9
  });
});

describe('manaGainOnTaken', () => {
  it('scales to the bite (incoming/maxHp), capped per hit', () => {
    expect(manaGainOnTaken(14, 45, 10400)).toBe(9);
    expect(manaGainOnTaken(24, 45, 10400)).toBe(16);
    expect(manaGainOnTaken(45, 45, 10400)).toBe(22); // cap
    expect(manaGainOnTaken(20, 25, 10400)).toBe(22); // cap
  });
  it('is monotonic non-decreasing in incoming (until the cap)', () => {
    let prev = -1;
    for (let inc = 1; inc <= 20; inc++) {
      const g = manaGainOnTaken(inc, 45, 10400);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });
});

describe('heavyStrikeDamage', () => {
  it('amplifies mitigated damage by the Heavy Strike multiplier', () => {
    expect(heavyStrikeDamage(17, 5)).toBe(25);  // mit(17,5)=14, x1.8 -> 25.2 -> 25
    expect(heavyStrikeDamage(25, 1)).toBe(43);  // mit(25,1)=24, x1.8 -> 43.2 -> 43
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- sim/combat.test.ts`
Expected: FAIL — the three helpers are not exported.

- [ ] **Step 4: Implement the helpers**

In `sim/combat.ts`, extend the config import on line 1 to add `M_HIT, M_TAKEN, M_TAKEN_CAP, HEAVY_STRIKE_MULT, MANA_BASE_BP`, then append:
```ts
// Mana gained when a basic attack lands (charges the attacker).
export function manaGainOnHit(manaChargeBp: number): number {
  return Math.floor((M_HIT * manaChargeBp) / MANA_BASE_BP);
}

// Mana gained when a unit takes `incoming` damage (charges the victim), capped per hit.
export function manaGainOnTaken(incoming: number, maxHp: number, manaChargeBp: number): number {
  return Math.min(M_TAKEN_CAP, Math.floor((M_TAKEN * incoming * manaChargeBp) / (maxHp * MANA_BASE_BP)));
}

// Damage of a Heavy Strike: amplified mitigated damage (before the crit roll).
export function heavyStrikeDamage(atk: number, def: number): number {
  return Math.floor((mitigatedDamage(atk, def) * HEAVY_STRIKE_MULT) / 100);
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npm test -- sim/combat.test.ts`
Expected: PASS (the new blocks + the existing `hitBp`/`mitigatedDamage`/`applyCrit` tests).

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all green; golden `86e238c1` unchanged (no resolution change yet).

- [ ] **Step 7: Commit**

```bash
git add shared/config.ts sim/combat.ts sim/combat.test.ts
git commit -m "feat(sim): mana-charge + heavy-strike combat helpers + config"
```

---

### Task 2: Mana state + skill types (`shared/types.ts` + `sim/stats.ts`)

**Files:**
- Modify: `shared/types.ts`, `sim/stats.ts`, `sim/tile-fight.ts`
- Test: `sim/stats.test.ts`, `sim/hash.test.ts`, `sim/initiative.test.ts`

**Interfaces:**
- Consumes: `MANA_MAX`, `MANA_BASE_BP`, `MANA_INT_COEF` (`shared/config`, Task 1).
- Produces: `type SkillId = 'heavyStrike'`; `DerivedStats.maxMana`/`manaChargeBp`; `Unit.mana`/`skill?`; `UnitSpec.skill?`; `FightEvent.attack.skill?`; `deriveStats` returns `maxMana`/`manaChargeBp`.

- [ ] **Step 1: Extend the types**

In `shared/types.ts`:
- Add after line 3 (`export type DamageChannel ...`): `export type SkillId = 'heavyStrike';`
- In `DerivedStats`, add after `attackRange: number;`:
  ```ts
    maxMana: number;
    manaChargeBp: number;   // INT-scaled charge multiplier (basis points)
  ```
- In `Unit`, add after `gauge: number;`:
  ```ts
    mana: number;           // current; starts 0; no carry between fights
    skill?: SkillId;        // optional active (copied from the spec)
  ```
- In `UnitSpec`, add after `attackKind: AttackKind;`: `skill?: SkillId;`
- In the `FightEvent` `attack` variant, add an optional `skill?: SkillId` field:
  ```ts
    | { t: 'attack'; id: string; target: string; damage: number; crit: boolean; channel: DamageChannel; lethal: boolean; skill?: SkillId }
  ```

- [ ] **Step 2: Write the failing test**

In `sim/stats.test.ts`, add to the existing balanced-melee test (`'derives the full two-channel stat set (balanced melee 5/5/1/1)'`):
```ts
    expect(d.maxMana).toBe(100);
    expect(d.manaChargeBp).toBe(10400);   // 10000 + 400*INT(1)
```
And to the magic test (`'uses the magic formula on the magic channel'`, INT 9):
```ts
    expect(d.manaChargeBp).toBe(13600);   // 10000 + 400*INT(9)
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- sim/stats.test.ts`
Expected: FAIL — `deriveStats` does not yet return `maxMana`/`manaChargeBp` (and `tsc` errors until Step 4).

- [ ] **Step 4: Return the new derived fields**

In `sim/stats.ts`: extend the config import (line 3-8) to add `MANA_MAX, MANA_BASE_BP, MANA_INT_COEF`, and in `deriveStats`'s returned object add (after `attackRange: rangeFor(attackKind),`):
```ts
    maxMana: MANA_MAX,
    manaChargeBp: MANA_BASE_BP + MANA_INT_COEF * a.int,
```

- [ ] **Step 5: Update the Unit literals (init + test helpers)**

The new required `DerivedStats.maxMana`/`manaChargeBp` and `Unit.mana` make every `Unit`/`derived` literal a compile error until updated:

`sim/tile-fight.ts` — in the unit-mapping object (currently `..., gauge: 0,`), add `mana: 0, skill: u.skill,`:
```ts
      pos: { x: u.pos.x, y: u.pos.y }, hp: derived.maxHp, derived, gauge: 0, mana: 0, skill: u.skill,
```

`sim/hash.test.ts` and `sim/initiative.test.ts` — in each `unit(...)` helper's `derived: { ... }` object add `maxMana: 100, manaChargeBp: 10000,`, and add `mana: 0,` to the returned `Unit` (next to `gauge: 0,`). (Values are irrelevant to those tests; they only need to type-check.)

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all green — the new stats assertions pass, and the golden `86e238c1` is unchanged (the resolution doesn't read Mana yet; Mana is unhashed). `tsc` clean.

- [ ] **Step 7: Commit**

```bash
git add shared/types.ts sim/stats.ts sim/tile-fight.ts sim/stats.test.ts sim/hash.test.ts sim/initiative.test.ts
git commit -m "feat(sim): mana/maxMana/manaChargeBp state + skill types"
```

---

### Task 3: Cast decision + Mana accrual (`sim/tile-fight.ts`)

**Files:**
- Modify: `sim/tile-fight.ts`
- Test: `sim/tile-fight.test.ts`

**Interfaces:**
- Consumes: `manaGainOnHit`/`manaGainOnTaken`/`heavyStrikeDamage` (`sim/combat`, Task 1); `HEAVY_STRIKE_COST` (`shared/config`); `Unit.mana`/`skill`/`derived.manaChargeBp`/`derived.maxMana` (Task 2).
- Produces: the resolution accrues Mana and casts Heavy Strike when affordable; `attack` events from a cast carry `skill: 'heavyStrike'`.

- [ ] **Step 1: Write the failing tests**

In `sim/tile-fight.test.ts`, add inside `describe('runTileFight', ...)`:
```ts
  it('a skilled unit charges Mana from basics and eventually casts Heavy Strike', () => {
    // Ranged skilled striker vs a tanky-but-weak target: STR 20 gives the target
    // HP/defense, but its MAGIC attack keys off INT (1) so it barely scratches the
    // striker. The striker chips it safely for many turns, charging to a cast.
    const setup: FightSetup = {
      grid: { width: 5, height: 1, blocked: [] },
      units: [
        { id: 's', side: 'A', attrs: { str: 9, agi: 9, int: 9, lck: 1 }, attackKind: 'ranged', skill: 'heavyStrike', priority: 5, pos: { x: 0, y: 0 } },
        { id: 't', side: 'B', attrs: { str: 20, agi: 1, int: 1, lck: 1 }, attackKind: 'magic', priority: 0, pos: { x: 4, y: 0 } },
      ],
    };
    const r = runTileFight(setup, 11);
    expect(r.events.some((e) => e.t === 'attack' && e.id === 's' && e.skill === 'heavyStrike')).toBe(true);
  });

  it('basic attacks carry no skill tag; only casts do', () => {
    // baseSetup units have no skill -> never cast -> no attack event is skill-tagged.
    const r = runTileFight(baseSetup, 42);
    expect(r.events.some((e) => e.t === 'attack')).toBe(true);
    expect(r.events.every((e) => e.t !== 'attack' || e.skill === undefined)).toBe(true);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- sim/tile-fight.test.ts`
Expected: FAIL — the skilled unit never casts (no cast logic yet), so the first test's `some(... skill === 'heavyStrike')` is false.

- [ ] **Step 3: Add Mana accrual + the cast decision**

In `sim/tile-fight.ts`:

Extend the combat import (line 7) and add the cost import:
```ts
import { hitBp, mitigatedDamage, applyCrit, manaGainOnHit, manaGainOnTaken, heavyStrikeDamage } from './combat';
import { HEAVY_STRIKE_COST } from '../shared/config';
```

Add a Mana-add helper just after the `inAttackPosition` helper (caps at the unit's `maxMana`):
```ts
  const addMana = (u: Unit, amount: number): void => {
    u.mana = Math.min(u.derived.maxMana, u.mana + amount);
  };
```

Replace the whole `// Attack if in range...` block (the `if (inAttackPosition(actor, target)) { ... }`) with:
```ts
    // In position: cast Heavy Strike if able, else a basic attack.
    if (inAttackPosition(actor, target)) {
      const channel = actor.derived.channel;
      const def = channel === 'physical' ? target.derived.physDef : target.derived.magicResist;
      if (actor.skill === 'heavyStrike' && actor.mana >= HEAVY_STRIKE_COST) {
        // Cast: spend Mana, guaranteed hit, amplified damage, then the normal crit roll.
        actor.mana -= HEAVY_STRIKE_COST;
        let damage = heavyStrikeDamage(actor.derived.atk, def);
        const crit = rng.intInRange(0, 9999) < actor.derived.critChanceBp;
        if (crit) damage = applyCrit(damage, actor.derived.critMultX100);
        target.hp -= damage;
        addMana(target, manaGainOnTaken(damage, target.derived.maxHp, target.derived.manaChargeBp));
        const lethal = target.hp <= 0;
        events.push({ t: 'attack', id: actor.id, target: target.id, damage, crit, channel, lethal, skill: 'heavyStrike' });
        if (lethal) { target.hp = 0; events.push({ t: 'death', id: target.id }); }
      } else {
        // Basic attack: hit roll -> mitigation -> crit roll (unchanged from Plan 4).
        const chance = hitBp(actor.derived.accuracyBp, target.derived.evasionBp);
        if (rng.intInRange(0, 9999) >= chance) {
          events.push({ t: 'miss', id: actor.id, target: target.id });
        } else {
          let damage = mitigatedDamage(actor.derived.atk, def);
          const crit = rng.intInRange(0, 9999) < actor.derived.critChanceBp;
          if (crit) damage = applyCrit(damage, actor.derived.critMultX100);
          target.hp -= damage;
          addMana(actor, manaGainOnHit(actor.derived.manaChargeBp));
          addMana(target, manaGainOnTaken(damage, target.derived.maxHp, target.derived.manaChargeBp));
          const lethal = target.hp <= 0;
          events.push({ t: 'attack', id: actor.id, target: target.id, damage, crit, channel, lethal });
          if (lethal) { target.hp = 0; events.push({ t: 'death', id: target.id }); }
        }
      }
    }
```

Note: the basic-attack branch keeps the exact same RNG draws as Plan 4 (hit roll, then crit-on-hit) — the `addMana` calls draw no RNG — so a no-skill fight is byte-identical.

- [ ] **Step 4: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: ALL pass — the skilled unit casts (test 1), basics are untagged (test 2), and the golden `86e238c1` is unchanged (the no-skill canonical fight has the identical RNG stream and HP trajectory; Mana is unhashed). Determinism + no-mutation tests still pass. `tsc` clean. **Do not run `npm run parity` yet** (the skill fixture is Task 4).

- [ ] **Step 5: Commit**

```bash
git add sim/tile-fight.ts sim/tile-fight.test.ts
git commit -m "feat(sim): Mana accrual + Heavy Strike cast decision"
```

---

### Task 4: Skill parity fixture + re-verify V8 == goja

**Files:**
- Modify: `tools/parity/fixtures.mjs`

**Interfaces:**
- Consumes: the bundled sim (rebuilt by `npm run parity`); the goja runner.
- Produces: a third parity fixture exercising Mana charge + a Heavy Strike cast, verified identical across V8 and goja.

- [ ] **Step 1: Add the skill fixture (placeholder hash)**

In `tools/parity/fixtures.mjs`, append a third entry to `FIXTURES` (keep the melee `86e238c1` and ranged-wall `1123ceff` fixtures unchanged):
```js
  {
    name: 'skill-cast-seed11',
    expectedHash: '00000000', // CAPTURE in Step 2
    bundle: {
      version: 1,
      seed: 11,
      setup: {
        grid: { width: 5, height: 1, blocked: [] },
        units: [
          { id: 's', side: 'A', attackKind: 'ranged', skill: 'heavyStrike', attrs: { str: 9, agi: 9, int: 9, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
          { id: 't', side: 'B', attackKind: 'magic', attrs: { str: 20, agi: 1, int: 1, lck: 1 }, priority: 0, pos: { x: 4, y: 0 } },
        ],
      },
    },
  },
```
Also update the file's top comment to list the third fixture.

- [ ] **Step 2: Capture the V8 hash**

Run: `npm run parity`
Expected: it rebuilds the bundle and reports a V8 mismatch for the new fixture, e.g. `V8 mismatch [skill-cast-seed11]: <8-hex> !== 00000000`, then `PARITY FAILED`. Copy the received `<8-hex>` and replace `'00000000'` with it. (The other two fixtures stay green.)

- [ ] **Step 3: Re-verify all fixtures across V8 and goja**

Run (Go off base PATH — prepend it):
```bash
export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity
```
Expected: `goja parity checked.` then `PARITY OK (V8 === goja === expected) for 3 fixture(s).`, exit 0. (If goja disagrees with the captured hash, STOP and report — a real cross-runtime divergence in the new Mana/skill integer math; do not mask it.)

- [ ] **Step 4: Confirm the suite is unaffected**

Run: `npm test && npm run typecheck`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add tools/parity/fixtures.mjs
git commit -m "test(parity): add skill-cast fixture, verify V8 == goja"
```

---

## Self-Review

**1. Spec coverage** (spec §2.1 → tasks):
- Mana as state (`maxMana`/`manaChargeBp` derived, `Unit.mana`) → Task 2 ✓
- Integer charge rules (basic-land charges attacker; taking damage charges victim, capped) → Task 1 (helpers) + Task 3 (applied) ✓
- Heavy Strike (optional `skill?`, guaranteed-hit, amplified, Mana cost) → Task 1 (`heavyStrikeDamage`) + Task 2 (types) + Task 3 (cast) ✓
- Per-turn cast-vs-basic decision → Task 3 ✓
- Skill parity fixture, re-verify V8 == goja → Task 4 ✓
- Golden `86e238c1` preserved (Mana unhashed; no-skill RNG stream unchanged) → asserted in Task 3 Step 4 ✓
- Out-of-scope (AoE, passives, healing, elements, cast-time, valve, catalog, auras) → untouched ✓

**2. Placeholder scan:** No "TBD/TODO". The fixture `'00000000'` is an explicit capture step (Task 4) — the established pattern. Mana/skill constants + example values are concrete and node-verified.

**3. Type consistency:** `SkillId = 'heavyStrike'` (Task 2) is consumed by `UnitSpec.skill?`, `Unit.skill?`, `FightEvent.attack.skill?`, and the cast check `actor.skill === 'heavyStrike'` (Task 3). `manaGainOnHit(manaChargeBp)`, `manaGainOnTaken(incoming, maxHp, manaChargeBp)`, `heavyStrikeDamage(atk, def)` (Task 1) match their call sites in Task 3. `deriveStats` returns `maxMana`/`manaChargeBp` (Task 2), read by `addMana` (cap) and the charge helpers (Task 3). `Unit.mana` (Task 2) is initialized to 0 (Task 2 tile-fight init) and mutated by `addMana` / the cast (Task 3). `HEAVY_STRIKE_COST` is used in the cast gate. The golden `86e238c1` is held (Tasks 2–3) and carried by the unchanged `tile-fight.test.ts`/`replay.test.ts`; the new fixture carries its own captured hash.
