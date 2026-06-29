# Combat Foundation — Two-Channel Damage & Integer Derived Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Plan 1's single-channel flat-damage placeholder with the GDD Part II model — two damage channels, full integer-derived stats (Accuracy/Evasion/Crit/defenses), and a hit-roll → channel-mitigation → crit-roll resolution — all integer/goja-safe.

**Architecture:** A deterministic integer square root (`shared/math.ts`) feeds basis-point stat formulas (`sim/stats.ts`, constants in `shared/config.ts`); pure damage helpers (`sim/combat.ts`) are composed by the tile-fight turn loop. The damage model change re-pins the golden hash, which is re-verified V8↔goja by the Plan 2 parity gate.

**Tech Stack:** TypeScript (strict), Vitest, Node 20+; the existing esbuild/Go-goja parity harness (Go 1.25) for the cross-runtime re-pin.

**Spec:** `docs/superpowers/specs/2026-06-29-combat-foundation-two-channel-damage-design.md`.

## Global Constraints

- **Determinism / goja-safety:** `/sim` and `/shared` are pure — no wall-clock, `Date.now()`, `Math.random()`, I/O, or Node-only APIs. **No `Math.sqrt`, no float arithmetic** — square roots use the integer `isqrt`/`sqrtFP`; probabilities are integer basis points (0–10000) rolled against the seeded RNG; all quantities are integers via `Math.floor`. Deterministic iteration/sort order (unchanged this slice).
- **Integer math only** in sim logic; values stay well below 2^53 (plain JS numbers kept integer via `Math.floor`).
- **TypeScript strict** with `noUncheckedIndexedAccess`.
- **Golden re-pin:** the tile-fight golden hash **changes** in this plan (the damage model changes) — it is no longer `e9ff47f3`. The new value is captured once (Task 2) and propagated to `sim/tile-fight.test.ts`, `sim/replay.test.ts`, and `tools/parity/fixtures.mjs`. This is a deliberate, documented behavioral change — not a regression.
- **Parity:** after the re-pin, `npm run parity` must show `V8 === goja === <new golden>`. Locally, Go 1.25 is installed but off the base PATH — prepend it for parity runs: `export PATH="/c/Program Files/Go/bin:$PATH"`.
- **Tunable config:** all combat coefficients live in `shared/config.ts`; correctness does not depend on their values.
- **Commands:** `npm test`, `npm test -- <path>`, `npm run typecheck` (runs both tsconfigs), `npm run parity`. Branch: `plan-3-combat-foundation` (commit there; do not push until the plan completes).

---

### Task 1: Integer square root (`shared/math.ts`)

**Files:**
- Create: `shared/math.ts`
- Test: `shared/math.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `function isqrt(n: number): number` (floor of √n, integer-only); `function sqrtFP(x: number): number` (= `isqrt(x * 1_000_000)` = `floor(√x · 1000)`).

- [ ] **Step 1: Write the failing test**

Create `shared/math.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isqrt, sqrtFP } from './math';

describe('isqrt', () => {
  it('returns the floor of the square root', () => {
    expect(isqrt(0)).toBe(0);
    expect(isqrt(1)).toBe(1);
    expect(isqrt(2)).toBe(1);
    expect(isqrt(3)).toBe(1);
    expect(isqrt(4)).toBe(2);
    expect(isqrt(8)).toBe(2);
    expect(isqrt(9)).toBe(3);
    expect(isqrt(15)).toBe(3);
    expect(isqrt(16)).toBe(4);
    expect(isqrt(1_000_000)).toBe(1000);
  });

  it('treats non-positive input as 0', () => {
    expect(isqrt(0)).toBe(0);
    expect(isqrt(-5)).toBe(0);
  });

  it('is exact and monotonic over a range (floor property + tightness)', () => {
    let prev = 0;
    for (let n = 0; n <= 5000; n++) {
      const r = isqrt(n);
      expect(r).toBeGreaterThanOrEqual(prev);
      expect(r * r).toBeLessThanOrEqual(n);
      expect((r + 1) * (r + 1)).toBeGreaterThan(n);
      prev = r;
    }
  });
});

describe('sqrtFP', () => {
  it('returns floor(sqrt(x) * 1000)', () => {
    expect(sqrtFP(0)).toBe(0);
    expect(sqrtFP(1)).toBe(1000);
    expect(sqrtFP(2)).toBe(1414);
    expect(sqrtFP(4)).toBe(2000);
    expect(sqrtFP(9)).toBe(3000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- shared/math.test.ts`
Expected: FAIL — cannot resolve `./math`.

- [ ] **Step 3: Write minimal implementation**

Create `shared/math.ts`:

```ts
// Deterministic integer math primitives. goja-safe: integer ops only (no
// Math.sqrt, no floats), so V8 and goja agree bit-for-bit.

// Floor of the square root of n. Newton's method via integer division
// (Math.floor(n/x) is correctly-rounded float64 then floored — exact and
// identical across engines). Non-positive input -> 0.
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = n;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(n / x)) / 2);
  }
  return x;
}

// Fixed-point square root scaled by 1000: floor(sqrt(x) * 1000).
export function sqrtFP(x: number): number {
  return isqrt(x * 1_000_000);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- shared/math.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/math.ts shared/math.test.ts
git commit -m "feat(shared): integer isqrt + fixed-point sqrtFP"
```

---

### Task 2: Two-channel damage model (types + config + stats + combat helpers + resolution + golden re-pin)

This is the atomic model swap: the `DerivedStats` shape change forces the stat and resolution code to move together. After it, `npm test` + `npm run typecheck` are green with the **new** golden; the parity fixture is re-pinned in Task 3.

**Files:**
- Create: `shared/config.ts`, `sim/combat.ts`, `sim/combat.test.ts`
- Modify: `shared/types.ts`, `sim/stats.ts`, `sim/stats.test.ts`, `sim/tile-fight.ts`, `sim/tile-fight.test.ts`, `sim/replay.test.ts`

**Interfaces:**
- Consumes: `sqrtFP` (`shared/math`); `makeRng`, grid/initiative/hash helpers (unchanged).
- Produces:
  - `shared/types.ts`: `type AttackKind = 'melee'|'ranged'|'magic'`; `type DamageChannel = 'physical'|'magic'`; `UnitSpec.attackKind: AttackKind`; new `DerivedStats { maxHp, atk, channel, physDef, magicResist, accuracyBp, evasionBp, critChanceBp, critMultX100, tempoRate, moveRange, attackRange }`; `FightEvent` adds `{ t:'miss'; id; target }` and `attack` gains `crit: boolean` + `channel: DamageChannel`.
  - `sim/stats.ts`: `function deriveStats(a: Attributes, attackKind: AttackKind): DerivedStats`.
  - `sim/combat.ts`: `hitBp(accuracyBp, evasionBp): number`; `mitigatedDamage(atk, def): number`; `applyCrit(damage, critMultX100): number`.

- [ ] **Step 1: Add the combat config**

Create `shared/config.ts`:

```ts
// Tunable combat constants — the single balance source (integers only).
// Starting values; to be balanced via the /tools Monte-Carlo instrument.
// Correctness does not depend on these values, only the formulas.
export const HP_BASE = 20;
export const HP_PER_STR = 5;
export const WEAPON_BASE = 2;     // flat atk base (stands in for gear, not modeled yet)
export const FOCUS_BASE = 2;
export const ARMOR_BASE = 0;      // flat defense base
export const RESIST_BASE = 0;
export const MITIGATION_K = 24;   // mitigation curve constant
export const SQRT_SCALE = 1000;   // sqrtFP returns sqrt(x) * SQRT_SCALE
export const ACC_BASE_BP = 10000; // accuracy baseline (1.00)
export const ACC_COEF = 300;      // bp per sqrt(INT)
export const EVA_COEF = 450;      // bp per sqrt(2*AGI+LCK)
export const EVA_CAP_BP = 7500;
export const CRIT_COEF = 900;     // bp per sqrt(LCK)
export const CRIT_CAP_BP = 9000;
export const CRITMULT_BASE_X100 = 125;
export const CRITMULT_COEF = 15;  // x100 per sqrt(LCK)
export const HIT_MIN_BP = 1000;
export const HIT_MAX_BP = 10000;
// Unchanged from Plan 1:
export const TEMPO_BASE = 10;
export const MOVE_RANGE = 3;
export const ATTACK_RANGE = 1;
```

- [ ] **Step 2: Extend the types**

In `shared/types.ts`: add the two type aliases (above `Cell` is fine), add `attackKind` to `UnitSpec`, replace `DerivedStats`, and extend `FightEvent`.

Add after `export type Side = 'A' | 'B';`:
```ts
export type AttackKind = 'melee' | 'ranged' | 'magic';
export type DamageChannel = 'physical' | 'magic';
```

Replace the `DerivedStats` interface with:
```ts
export interface DerivedStats {
  maxHp: number;
  atk: number;            // effective attack for the unit's attackKind
  channel: DamageChannel; // melee/ranged -> physical, magic -> magic
  physDef: number;
  magicResist: number;
  accuracyBp: number;     // basis points (10000 = 1.00)
  evasionBp: number;      // basis points
  critChanceBp: number;   // basis points
  critMultX100: number;   // x100 (125 = 1.25)
  tempoRate: number;
  moveRange: number;
  attackRange: number;
}
```

Add `attackKind` to `UnitSpec` (after `attrs`):
```ts
export interface UnitSpec {
  id: string;
  side: Side;
  attrs: Attributes;
  attackKind: AttackKind;
  priority: number;
  pos: Cell;
}
```

Replace the `FightEvent` union with (adds `miss`; `attack` gains `crit` + `channel`):
```ts
export type FightEvent =
  | { t: 'move'; id: string; from: Cell; to: Cell }
  | { t: 'attack'; id: string; target: string; damage: number; crit: boolean; channel: DamageChannel; lethal: boolean }
  | { t: 'miss'; id: string; target: string }
  | { t: 'death'; id: string }
  | { t: 'end'; winner: Side | 'draw'; ticks: number; endReason: EndReason };
```

- [ ] **Step 3: Write the failing combat-helper test**

Create `sim/combat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hitBp, mitigatedDamage, applyCrit } from './combat';

describe('hitBp', () => {
  it('is accuracy minus evasion, clamped to [1000, 10000]', () => {
    expect(hitBp(10300, 1492)).toBe(8808);
    expect(hitBp(10000, 0)).toBe(10000);
    expect(hitBp(10300, 20000)).toBe(1000);  // floor 10%
    expect(hitBp(20000, 0)).toBe(10000);      // accuracy above 100% caps
  });
});

describe('mitigatedDamage', () => {
  it('reduces damage as defense rises: floor(atk*K/(def+K)), min 1', () => {
    expect(mitigatedDamage(17, 0)).toBe(17);
    expect(mitigatedDamage(17, 1)).toBe(16);
    expect(mitigatedDamage(17, 9)).toBe(12);
    expect(mitigatedDamage(17, 24)).toBe(8);  // def == K -> half
    expect(mitigatedDamage(1, 1000)).toBe(1);
  });

  it('is monotonic non-increasing in defense', () => {
    let prev = Infinity;
    for (let def = 0; def <= 100; def++) {
      const d = mitigatedDamage(20, def);
      expect(d).toBeLessThanOrEqual(prev);
      prev = d;
    }
  });
});

describe('applyCrit', () => {
  it('scales damage by the x100 multiplier', () => {
    expect(applyCrit(16, 140)).toBe(22);
    expect(applyCrit(12, 150)).toBe(18);
    expect(applyCrit(10, 100)).toBe(10);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm test -- sim/combat.test.ts`
Expected: FAIL — cannot resolve `./combat`.

- [ ] **Step 5: Write the combat helpers**

Create `sim/combat.ts`:

```ts
import { MITIGATION_K, HIT_MIN_BP, HIT_MAX_BP } from '../shared/config';

// Hit chance in basis points: accuracy minus evasion, clamped.
export function hitBp(accuracyBp: number, evasionBp: number): number {
  return Math.min(HIT_MAX_BP, Math.max(HIT_MIN_BP, accuracyBp - evasionBp));
}

// Integer damage after channel-matched mitigation: floor(atk * K / (def + K)), min 1.
export function mitigatedDamage(atk: number, def: number): number {
  return Math.max(1, Math.floor((atk * MITIGATION_K) / (def + MITIGATION_K)));
}

// Apply a crit multiplier (x100) to a damage value.
export function applyCrit(damage: number, critMultX100: number): number {
  return Math.floor((damage * critMultX100) / 100);
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npm test -- sim/combat.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Rewrite `deriveStats` and its test**

Replace the body of `sim/stats.ts` with:

```ts
import type { Attributes, AttackKind, DamageChannel, DerivedStats } from '../shared/types';
import { sqrtFP } from '../shared/math';
import {
  HP_BASE, HP_PER_STR, WEAPON_BASE, FOCUS_BASE, ARMOR_BASE, RESIST_BASE,
  SQRT_SCALE, ACC_BASE_BP, ACC_COEF, EVA_COEF, EVA_CAP_BP,
  CRIT_COEF, CRIT_CAP_BP, CRITMULT_BASE_X100, CRITMULT_COEF,
  TEMPO_BASE, MOVE_RANGE, ATTACK_RANGE,
} from '../shared/config';

function atkFor(a: Attributes, kind: AttackKind): number {
  if (kind === 'melee') return WEAPON_BASE + a.str * 2 + a.agi;
  if (kind === 'ranged') return WEAPON_BASE + a.agi * 2 + a.str;
  return FOCUS_BASE + a.int * 2 + a.lck; // magic
}

// GDD Part II derived stats, ported to integer / basis-point / fixed-point math.
export function deriveStats(a: Attributes, attackKind: AttackKind): DerivedStats {
  const channel: DamageChannel = attackKind === 'magic' ? 'magic' : 'physical';
  return {
    maxHp: HP_BASE + a.str * HP_PER_STR,
    atk: atkFor(a, attackKind),
    channel,
    physDef: ARMOR_BASE + a.str,
    magicResist: RESIST_BASE + a.int,
    accuracyBp: ACC_BASE_BP + Math.floor((ACC_COEF * sqrtFP(a.int)) / SQRT_SCALE),
    evasionBp: Math.min(EVA_CAP_BP, Math.floor((EVA_COEF * sqrtFP(2 * a.agi + a.lck)) / SQRT_SCALE)),
    critChanceBp: Math.min(CRIT_CAP_BP, Math.floor((CRIT_COEF * sqrtFP(a.lck)) / SQRT_SCALE)),
    critMultX100: CRITMULT_BASE_X100 + Math.floor((CRITMULT_COEF * sqrtFP(a.lck)) / SQRT_SCALE),
    tempoRate: TEMPO_BASE + a.agi,
    moveRange: MOVE_RANGE,
    attackRange: ATTACK_RANGE,
  };
}
```

Replace the body of `sim/stats.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { deriveStats } from './stats';

describe('deriveStats', () => {
  it('derives the full two-channel stat set (balanced melee 5/5/1/1)', () => {
    const d = deriveStats({ str: 5, agi: 5, int: 1, lck: 1 }, 'melee');
    expect(d.maxHp).toBe(45);
    expect(d.atk).toBe(17);          // 2 + STR*2 + AGI
    expect(d.channel).toBe('physical');
    expect(d.physDef).toBe(5);
    expect(d.magicResist).toBe(1);
    expect(d.accuracyBp).toBe(10300);
    expect(d.evasionBp).toBe(1492);
    expect(d.critChanceBp).toBe(900);
    expect(d.critMultX100).toBe(140);
    expect(d.tempoRate).toBe(15);
    expect(d.moveRange).toBe(3);
    expect(d.attackRange).toBe(1);
  });

  it('uses the ranged formula on the physical channel', () => {
    const d = deriveStats({ str: 3, agi: 9, int: 3, lck: 3 }, 'ranged');
    expect(d.atk).toBe(23);          // 2 + AGI*2 + STR
    expect(d.channel).toBe('physical');
    expect(d.accuracyBp).toBe(10519);
    expect(d.evasionBp).toBe(2061);
    expect(d.critChanceBp).toBe(1560);
    expect(d.critMultX100).toBe(150);
  });

  it('uses the magic formula on the magic channel', () => {
    const d = deriveStats({ str: 1, agi: 3, int: 9, lck: 5 }, 'magic');
    expect(d.atk).toBe(25);          // 2 + INT*2 + LCK
    expect(d.channel).toBe('magic');
    expect(d.magicResist).toBe(9);
    expect(d.accuracyBp).toBe(10900);
    expect(d.critChanceBp).toBe(2010);
    expect(d.critMultX100).toBe(158);
  });

  it('clamps evasion and crit chance to their caps', () => {
    const d = deriveStats({ str: 9, agi: 999, int: 9, lck: 999 }, 'melee');
    expect(d.evasionBp).toBe(7500);
    expect(d.critChanceBp).toBe(9000);
  });

  it('is monotonic in the driving stats', () => {
    const lo = deriveStats({ str: 1, agi: 1, int: 1, lck: 1 }, 'melee');
    const hiStr = deriveStats({ str: 9, agi: 1, int: 1, lck: 1 }, 'melee');
    expect(hiStr.maxHp).toBeGreaterThan(lo.maxHp);
    expect(hiStr.atk).toBeGreaterThan(lo.atk);
    expect(hiStr.physDef).toBeGreaterThan(lo.physDef);
    const hiInt = deriveStats({ str: 1, agi: 1, int: 9, lck: 1 }, 'melee');
    expect(hiInt.magicResist).toBeGreaterThan(lo.magicResist);
    expect(hiInt.accuracyBp).toBeGreaterThan(lo.accuracyBp);
    const hiAgi = deriveStats({ str: 1, agi: 9, int: 1, lck: 1 }, 'melee');
    expect(hiAgi.evasionBp).toBeGreaterThan(lo.evasionBp);
    expect(hiAgi.tempoRate).toBeGreaterThan(lo.tempoRate);
    const hiLck = deriveStats({ str: 1, agi: 1, int: 1, lck: 9 }, 'melee');
    expect(hiLck.critChanceBp).toBeGreaterThan(lo.critChanceBp);
    expect(hiLck.critMultX100).toBeGreaterThan(lo.critMultX100);
  });
});
```

- [ ] **Step 8: Verify stats + combat green, derivation compiles**

Run: `npm test -- sim/stats.test.ts sim/combat.test.ts`
Expected: PASS. (`sim/tile-fight.ts` will not yet compile — fixed next.)

- [ ] **Step 9: Swap the tile-fight resolution**

In `sim/tile-fight.ts`:

Change the import on line 1 to add the combat helpers and drop the unused `EndReason`-only note (keep `EndReason`):
```ts
import type { Cell, EndReason, FightEvent, FightResult, FightSetup, Side, Unit } from '../shared/types';
import { makeRng } from '../shared/rng';
import { deriveStats } from './stats';
import { makeGrid, chebyshev, stepToward } from './grid';
import { nextActor, TEMPO_THRESHOLD } from './initiative';
import { hashFight } from './hash';
import { hitBp, mitigatedDamage, applyCrit } from './combat';
```

Change the unit-mapping `deriveStats` call (currently `const derived = deriveStats(u.attrs);`) to pass `attackKind`:
```ts
    const derived = deriveStats(u.attrs, u.attackKind);
```

Replace the entire `// Attack if now in range.` block (the `if (chebyshev(...) <= actor.derived.attackRange) { ... }` that uses `variance`) with:
```ts
    // Attack if in range: hit roll -> channel mitigation -> crit roll.
    if (chebyshev(actor.pos, target.pos) <= actor.derived.attackRange) {
      const chance = hitBp(actor.derived.accuracyBp, target.derived.evasionBp);
      if (rng.intInRange(0, 9999) >= chance) {
        events.push({ t: 'miss', id: actor.id, target: target.id });
      } else {
        const channel = actor.derived.channel;
        const def = channel === 'physical' ? target.derived.physDef : target.derived.magicResist;
        let damage = mitigatedDamage(actor.derived.atk, def);
        const crit = rng.intInRange(0, 9999) < actor.derived.critChanceBp;
        if (crit) damage = applyCrit(damage, actor.derived.critMultX100);
        target.hp -= damage;
        const lethal = target.hp <= 0;
        events.push({ t: 'attack', id: actor.id, target: target.id, damage, crit, channel, lethal });
        if (lethal) {
          target.hp = 0;
          events.push({ t: 'death', id: target.id });
        }
      }
    }
```

- [ ] **Step 10: Update tile-fight tests (fixtures + new behavior) — golden left to capture**

In `sim/tile-fight.test.ts`: add `attackKind: 'melee'` to **every** unit in `baseSetup`, `walled`, and `lopsided`. Then add these behavior tests inside the `describe('runTileFight', ...)` block (before its closing `});`):

```ts
  it('attack events carry a crit flag and the attacker\'s channel', () => {
    const r = runTileFight(baseSetup, 42);
    const attacks = r.events.filter((e) => e.t === 'attack');
    expect(attacks.length).toBeGreaterThan(0);
    for (const e of attacks) {
      if (e.t !== 'attack') continue;
      expect(typeof e.crit).toBe('boolean');
      expect(e.channel).toBe('physical'); // both baseSetup units are melee
    }
  });

  it('routes magic attackers through the magic channel and melee through physical', () => {
    const mk = (kind: 'melee' | 'magic') => ({
      grid: { width: 2, height: 1, blocked: [] },
      units: [
        // INT 9 -> accuracy high enough that hitBp caps at 10000 vs a min-evasion
        // target, so the first attack always lands; AGI 5 -> acts first.
        { id: 'atk', side: 'A' as const, attrs: { str: 1, agi: 5, int: 9, lck: 1 }, attackKind: kind, priority: 5, pos: { x: 0, y: 0 } },
        { id: 'tgt', side: 'B' as const, attrs: { str: 5, agi: 1, int: 1, lck: 1 }, attackKind: 'melee' as const, priority: 0, pos: { x: 1, y: 0 } },
      ],
    });
    const channelOf = (kind: 'melee' | 'magic') => {
      const r = runTileFight(mk(kind), 3);
      const e = r.events.find((ev) => ev.t === 'attack' && ev.id === 'atk');
      return e && e.t === 'attack' ? e.channel : null;
    };
    expect(channelOf('magic')).toBe('magic');
    expect(channelOf('melee')).toBe('physical');
  });

  it('mitigates more damage against a higher matching defense', () => {
    const mk = (targetInt: number) => ({
      grid: { width: 2, height: 1, blocked: [] },
      units: [
        { id: 'atk', side: 'A' as const, attrs: { str: 1, agi: 5, int: 9, lck: 1 }, attackKind: 'magic' as const, priority: 5, pos: { x: 0, y: 0 } },
        { id: 'tgt', side: 'B' as const, attrs: { str: 5, agi: 1, int: targetInt, lck: 1 }, attackKind: 'melee' as const, priority: 0, pos: { x: 1, y: 0 } },
      ],
    });
    const firstDamage = (targetInt: number) => {
      const r = runTileFight(mk(targetInt), 3);
      const e = r.events.find((ev) => ev.t === 'attack' && ev.id === 'atk');
      return e && e.t === 'attack' ? e.damage : -1;
    };
    // Same attacker + seed -> identical hit/crit rolls; only magicResist differs.
    expect(firstDamage(1)).toBeGreaterThan(firstDamage(9));
  });
```

- [ ] **Step 11: Add `attackKind` to the replay canonical fixture**

In `sim/replay.test.ts`, add `attackKind: 'melee'` to both units in the `canonical` bundle's `setup.units`.

- [ ] **Step 12: Capture the new golden hash**

The damage model changed, so the golden moved. Run:

Run: `npm test`
Expected: the two golden tests FAIL — `sim/tile-fight.test.ts` ("matches the captured baseline hash") and `sim/replay.test.ts` ("reproduces the tile-fight golden hash") show a new 8-hex `Received` value (identical in both — same fight). Copy that value and replace **both** `'e9ff47f3'` occurrences (one in each file) with it.

- [ ] **Step 13: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: ALL pass (including the re-pinned golden in both files, the determinism test, and the new behavior tests); `tsc` clean on both configs. **Do not run `npm run parity` yet** — the parity fixture is re-pinned in Task 3.

- [ ] **Step 14: Commit**

```bash
git add shared/config.ts shared/types.ts sim/combat.ts sim/combat.test.ts sim/stats.ts sim/stats.test.ts sim/tile-fight.ts sim/tile-fight.test.ts sim/replay.test.ts
git commit -m "feat(sim): two-channel damage + integer derived stats (golden re-pinned)"
```

---

### Task 3: Re-pin the parity fixture & re-verify V8 == goja

**Files:**
- Modify: `tools/parity/fixtures.mjs`

**Interfaces:**
- Consumes: the new golden hash now in `sim/tile-fight.test.ts`; the bundle entry / goja runner / `parity.mjs` (unchanged).
- Produces: a parity fixture matching the new model, verified identical across V8 and goja.

- [ ] **Step 1: Update the canonical parity fixture**

In `tools/parity/fixtures.mjs`:
1. Add `attackKind: 'melee'` to both units in `bundle.setup.units` (the bundled `runReplay` now derives stats per `attackKind`).
2. Replace `expectedHash: 'e9ff47f3'` with the new golden hash captured in Task 2 (the value now in `sim/tile-fight.test.ts`). Update the file's top comment to drop the stale `e9ff47f3` reference.

- [ ] **Step 2: Re-verify cross-runtime parity**

Run (Go is off the base PATH — prepend it):
```bash
export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity
```
Expected: `npm run parity` rebuilds the bundle (now the new model), runs it under both `node:vm` and goja, and prints `goja parity checked.` then `PARITY OK (V8 === goja === expected) for 1 fixture(s).`, exit 0. (If V8 or goja disagrees with the new golden, stop — that is a real cross-runtime divergence in the new integer math; debug the sim, do not edit the fixture to mask it.)

- [ ] **Step 3: Confirm the suite is still green**

Run: `npm test && npm run typecheck`
Expected: all green (unchanged by the fixture edit).

- [ ] **Step 4: Commit**

```bash
git add tools/parity/fixtures.mjs
git commit -m "test(parity): re-pin canonical fixture to the two-channel golden"
```

---

## Self-Review

**1. Spec coverage** (spec §2.1 in-scope → tasks):
- Expanded integer `DerivedStats` (two channels, defenses, Accuracy/Evasion/Crit in bp) → Task 2 (types + `deriveStats`) ✓
- `attackKind` per unit, channel derived → Task 2 (types, `deriveStats`, all fixtures) ✓
- Deterministic integer `isqrt`/`sqrtFP` in `/shared` → Task 1 ✓
- Tunable combat constants in `/shared` → Task 2 (`shared/config.ts`) ✓
- Two-channel resolution (hit → mitigation → crit) with `miss`/crit-flagged `attack` events → Task 2 (`sim/combat.ts` + tile-fight rewrite + `FightEvent`) ✓
- Re-pin golden + parity fixture, re-verify V8 == goja → Task 2 (TS golden) + Task 3 (parity) ✓
- Spec §5.3 example outcomes → asserted verbatim in `sim/stats.test.ts` (Task 2 Step 7) ✓
- Out-of-scope items (Mana/skills, ranged range>1/LoS, traits, class/gear/regen/footprint) → untouched; `attackRange`/`moveRange`/`tempoRate` carried over unchanged ✓

**2. Placeholder scan:** No "TBD/TODO/handle edge cases". The new golden is an explicit capture step (Task 2 Step 12), resolved by pasting the received value — the established golden-drift pattern, not an unfilled blank. Constants are concrete. Example-outcome assertions are concrete (node-verified in the spec).

**3. Type consistency:** `AttackKind`/`DamageChannel` defined once (Task 2 Step 2), consumed by `UnitSpec`, `DerivedStats`, `deriveStats(a, attackKind)`, and the resolution. `deriveStats` is called as `deriveStats(u.attrs, u.attackKind)` (Task 2 Step 9) matching its new signature. `hitBp`/`mitigatedDamage`/`applyCrit` signatures (Task 2 Step 5) match their call sites in the resolution (Step 9) and their tests (Step 3). The `attack` event's new `crit`/`channel` fields (type, Step 2) match the emit (Step 9) and the assertions (Step 10). The golden value is one captured string propagated to exactly three places (`tile-fight.test.ts`, `replay.test.ts` in Task 2; `fixtures.mjs` in Task 3). `shared/config.ts` exports match every name imported by `sim/stats.ts` and `sim/combat.ts`.
