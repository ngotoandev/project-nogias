# Traits + Behavior Precedence (Plan 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the GDD behavior-precedence decision layer (`trait hooks → priority/targeting → default AI → personality lean`) over the existing move+attack+cast resolution, plus dynamic-stat / decision-override / RNG trait hooks, a conditional skill (Cleave) with cast-conditions + a universal pressure-valve, and the temperament soft lean.

**Architecture:** Extract the inline per-turn decision in `runTileFight` into a pure two-phase decision (`decideTurn` pre-move → `decideAction` post-move) in a new `sim/decide.ts`. Dynamic stats are recomputed per turn via a pure `effectiveDerived` in `sim/stats.ts`. RNG-drawing hooks resolve at execution. Every new mechanism is opt-in per unit, so the canonical all-melee fight is byte-identical and golden `86e238c1` is never re-pinned; each mechanism is proven in its own new parity fixture.

**Tech Stack:** TypeScript (strict, ES2015 target), Vitest, esbuild bundle, goja (Go) parity runner. Sim is pure / integer-only / goja-safe.

## Global Constraints

- **Parity-critical** (`/sim`, `/shared`): integer math only — no floats, no `Math.sqrt`, no `Math.random`, no `Date`, no Node APIs. Seeded RNG via `makeRng(seed)` only.
- **Total-order sorts** must end in a unique tiebreak (`id` asc) so V8 and goja agree.
- **State hash** (`hashFight`) covers id/side/pos/HP + ticks ONLY. Transient resources are NOT hashed: existing `gauge`, `mana`; new `kills`, `stallSinceTick`, `fleeingSinceTick`. Their effects surface via positions/HP.
- **Anchor `86e238c1` is FROZEN.** Every task must keep `npm run parity` green for all existing fixtures (`canonical-baseSetup-seed42`=86e238c1, `ranged-wall-seed42`=1123ceff, `skill-cast-seed11`=b621e99d). If a task changes the canonical hash, the task is wrong — fix it, do not re-pin.
- **All balance constants live in `shared/config.ts`** as integers; correctness depends on formulas, not values.
- **Go toolchain for full parity:** on this machine prepend `export PATH="/c/Program Files/Go/bin:$PATH"` before `npm run parity` to exercise goja (without Go it runs V8-only and exits 0).
- **Commits:** end every commit message with a trailer line `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

### Standard commands (used in every task)
- Run one test file: `npx vitest run sim/<file>.test.ts`
- Full suite: `npm test` (currently 61 tests / 9 files; count grows each task)
- Types: `npm run typecheck`
- Parity (full): `export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity` → expect `PARITY OK (V8 === goja === expected) for N fixture(s).`

### Fixture capture procedure (referenced by tasks that add a fixture)
1. Add the new `{ name, expectedHash: 'PENDING', bundle: {...} }` entry to `tools/parity/fixtures.mjs`.
2. Run `npm run parity`. It rebuilds the bundle and prints `V8 mismatch [<name>]: <ACTUAL> !== PENDING`.
3. Set `expectedHash` to `<ACTUAL>` (the 8-hex-char V8 hash).
4. Re-run `export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity` → expect `PARITY OK (V8 === goja === expected)`. This proves the new mechanism is goja-bit-identical.
5. Confirm `canonical-baseSetup-seed42` still shows `86e238c1` (no re-pin).

---

## File Structure

- **Create `sim/decide.ts`** — pure decision layer: `TurnIntent`/`MoveMode`/`ActionKind`/`FightCtx` types, `chooseTarget` (moved from tile-fight), `decideTurn` (pre-move precedence), `decideAction` (post-move cast-vs-basic), and decision helpers (`hasTrait`, `proxyLeader`, `cowardFlees`, personality tie-break, `castCondition`). Co-located `sim/decide.test.ts`.
- **Modify `shared/types.ts`** — `TraitId`, `Temperament`, `cleave` SkillId, `misfire` event, new `Unit`/`UnitSpec` fields.
- **Modify `shared/config.ts`** — all new constants, `SKILL_COST`, `TRAIT_HOOKS` catalog.
- **Modify `sim/stats.ts`** — `effectiveDerived(unit, ctx)`.
- **Modify `sim/combat.ts`** — `cleaveDamage` helper.
- **Modify `sim/grid.ts`** — `stepAway` primitive.
- **Modify `sim/tile-fight.ts`** — execute the intent; flee/charge movement; RNG hooks; cast dispatch + valve.
- **Modify `tools/parity/fixtures.mjs`** — new fixtures + captured hashes.
- **Modify `sim/hash.test.ts`, `sim/initiative.test.ts`** — `Unit` test-helper literals gain `traits: []`, `kills: 0`, `stallSinceTick: -1`, `fleeingSinceTick: -1`.

---

## Task 1: Decision-pipeline refactor (behavior-preserving)

Extract the inline decision into a pure two-phase API. No behavior change — golden `86e238c1` and all fixtures stay green.

**Files:**
- Create: `sim/decide.ts`, `sim/decide.test.ts`
- Modify: `sim/tile-fight.ts` (replace inline `chooseTarget` + decision with calls)

**Interfaces:**
- Consumes: `Unit` (`shared/types.ts`), `chebyshev` (`sim/grid.ts`), `HEAVY_STRIKE_COST` (`shared/config.ts`).
- Produces (relied on by Tasks 2–6):
  ```ts
  export type MoveMode = 'engage' | 'flee';
  export type ActionKind = 'cast' | 'basic' | 'none';
  export interface FightCtx { totalTicks: number; units: Unit[]; grid: Grid; }
  export interface TurnIntent { targetId: string | null; move: MoveMode; charge: boolean; }
  export function chooseTarget(actor: Unit, units: Unit[]): Unit | null;
  export function decideTurn(actor: Unit, ctx: FightCtx): TurnIntent;
  export function decideAction(actor: Unit, target: Unit, ctx: FightCtx): 'cast' | 'basic';
  ```
  `Grid` is the interface exported from `sim/grid.ts`.

- [ ] **Step 1: Write failing tests** in `sim/decide.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeGrid } from './grid';
import { deriveStats } from './stats';
import { chooseTarget, decideTurn, decideAction } from './decide';
import type { Unit } from '../shared/types';
import type { AttackKind, SkillId } from '../shared/types';

function u(id: string, side: 'A' | 'B', x: number, y: number, opts: Partial<Unit> = {}): Unit {
  const attrs = opts.attrs ?? { str: 5, agi: 5, int: 1, lck: 1 };
  const kind: AttackKind = 'melee';
  const derived = deriveStats(attrs, kind);
  return { id, side, attrs, priority: opts.priority ?? 5, pos: { x, y }, hp: opts.hp ?? derived.maxHp,
    derived, gauge: 0, mana: opts.mana ?? 0, skill: opts.skill };
}

const ctx = (units: Unit[]) => ({ totalTicks: 0, units, grid: makeGrid({ width: 8, height: 8, blocked: [] }) });

describe('decideTurn (baseline)', () => {
  it('targets the nearest enemy, engage mode, no charge', () => {
    const a = u('a1', 'A', 0, 0), b = u('b1', 'B', 2, 0), c = u('b2', 'B', 5, 0);
    const intent = decideTurn(a, ctx([a, b, c]));
    expect(intent).toEqual({ targetId: 'b1', move: 'engage', charge: false });
  });
  it('null target when no enemies', () => {
    const a = u('a1', 'A', 0, 0);
    expect(decideTurn(a, ctx([a])).targetId).toBeNull();
  });
});

describe('decideAction (baseline)', () => {
  it('casts when skilled and mana >= cost', () => {
    const a = u('a1', 'A', 0, 0, { skill: 'heavyStrike' as SkillId, mana: 70 });
    const b = u('b1', 'B', 1, 0);
    expect(decideAction(a, b, ctx([a, b]))).toBe('cast');
  });
  it('basic when unskilled or under cost', () => {
    const a = u('a1', 'A', 0, 0, { skill: 'heavyStrike' as SkillId, mana: 69 });
    const b = u('b1', 'B', 1, 0);
    expect(decideAction(a, b, ctx([a, b]))).toBe('basic');
    const a2 = u('a2', 'A', 0, 0);
    expect(decideAction(a2, b, ctx([a2, b]))).toBe('basic');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run sim/decide.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `sim/decide.ts`**

```ts
import type { Unit } from '../shared/types';
import type { Grid } from './grid';
import { chebyshev } from './grid';
import { HEAVY_STRIKE_COST } from '../shared/config';

export type MoveMode = 'engage' | 'flee';
export type ActionKind = 'cast' | 'basic' | 'none';
export interface FightCtx { totalTicks: number; units: Unit[]; grid: Grid; }
export interface TurnIntent { targetId: string | null; move: MoveMode; charge: boolean; }

// Nearest living enemy; tiebreak higher priority, then id asc. (Moved verbatim
// from tile-fight.ts — this is the baseline "priority/targeting" layer.)
export function chooseTarget(actor: Unit, units: Unit[]): Unit | null {
  const enemies = units.filter((u) => u.hp > 0 && u.side !== actor.side);
  if (enemies.length === 0) return null;
  enemies.sort((x, y) =>
    chebyshev(actor.pos, x.pos) - chebyshev(actor.pos, y.pos) ||
    y.priority - x.priority ||
    (x.id < y.id ? -1 : 1));
  return enemies[0]!;
}

export function decideTurn(actor: Unit, ctx: FightCtx): TurnIntent {
  const target = chooseTarget(actor, ctx.units);
  return { targetId: target ? target.id : null, move: 'engage', charge: false };
}

export function decideAction(actor: Unit, _target: Unit, _ctx: FightCtx): 'cast' | 'basic' {
  return actor.skill === 'heavyStrike' && actor.mana >= HEAVY_STRIKE_COST ? 'cast' : 'basic';
}
```

- [ ] **Step 4: Refactor `sim/tile-fight.ts` to use the new API**

Remove the local `chooseTarget` (lines 12–20). Add imports: `import { decideTurn, decideAction } from './decide';` (keep `chebyshev, stepToward, hasLineOfSight` from grid). In the loop, replace `const target = chooseTarget(actor, units); if (target === null) continue;` and the action block with:

```ts
const ctx = { totalTicks, units, grid };
const intent = decideTurn(actor, ctx);
if (intent.targetId === null) continue;
const target = units.find((x) => x.id === intent.targetId)!;

// Move up to moveRange steps toward the target, stopping once in range. (unchanged)
for (let step = 0; step < actor.derived.moveRange; step++) { /* …unchanged stepToward loop… */ }

if (inAttackPosition(actor, target)) {
  const action = decideAction(actor, target, ctx);
  if (action === 'cast') {
    // …existing Heavy Strike branch verbatim…
  } else {
    // …existing basic-attack branch verbatim…
  }
}
```

Keep the existing damage/Mana/crit code exactly; only the *gating* moves into `decideAction`. (The old `actor.skill === 'heavyStrike' && actor.mana >= HEAVY_STRIKE_COST` test is now `action === 'cast'`.)

- [ ] **Step 5: Verify** — `npx vitest run sim/decide.test.ts` PASS; `npm test` all green; `npm run typecheck` clean; `export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity` → `PARITY OK … for 3 fixture(s).` with `canonical-baseSetup-seed42` = **86e238c1** (unchanged).

- [ ] **Step 6: Commit**
```bash
git add sim/decide.ts sim/decide.test.ts sim/tile-fight.ts
git commit -m "$(cat <<'EOF'
refactor(sim): extract pure decideTurn/decideAction decision layer

Behavior-preserving split of the inline per-turn decision into sim/decide.ts
(pre-move TurnIntent + post-move ActionKind). Golden 86e238c1 unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Trait model + `effectiveDerived` (dynamic-stat traits)

Add the trait data model and the per-turn effective-stats layer (Reckless / Slow Starter / Bloodthirsty / Loyal), wired into the damage path. Trait-less units are byte-identical.

**Files:**
- Modify: `shared/types.ts`, `shared/config.ts`, `sim/stats.ts`, `sim/tile-fight.ts`
- Test: `sim/stats.test.ts`, `sim/decide.test.ts` (proxyLeader), `tools/parity/fixtures.mjs`
- Modify: `sim/hash.test.ts`, `sim/initiative.test.ts` (Unit helper fields)

**Interfaces:**
- Consumes: `FightCtx` (Task 1), `DerivedStats`/`Unit` (types), `chebyshev` (grid).
- Produces:
  ```ts
  // shared/types.ts
  export type TraitId = 'reckless' | 'slowStarter' | 'bloodthirsty' | 'loyal'
    | 'coward' | 'headstrong' | 'stupid' | 'luckyFool';
  // Unit gains:     traits: TraitId[]; kills: number; stallSinceTick: number; fleeingSinceTick: number;
  // UnitSpec gains: traits?: TraitId[];
  // sim/stats.ts
  export function effectiveDerived(unit: Unit, ctx: FightCtx): DerivedStats;
  // sim/decide.ts
  export function hasTrait(unit: Unit, id: TraitId): boolean;
  export function proxyLeader(unit: Unit, units: Unit[]): Unit | null; // highest-priority living ally excl self; tiebreak id; null if none
  ```

- [ ] **Step 1: Extend types** (`shared/types.ts`)

Add `TraitId` (above). In `Unit` add `traits: TraitId[]; kills: number; stallSinceTick: number; fleeingSinceTick: number;`. In `UnitSpec` add `traits?: TraitId[];`.

- [ ] **Step 2: Add config constants + catalog** (`shared/config.ts`)

```ts
// Dynamic-stat traits (Plan 6):
export const RECKLESS_ATK_BP = 6000;   // +atk fraction at 0 HP (basis points of atk)
export const RECKLESS_DEF_BP = 2500;   // flat physDef penalty (always-on downside)
export const SLOW_STARTER_RAMP_TICKS = 300;
export const SLOW_STARTER_EARLY_BP = 2000; // −20% at t=0
export const SLOW_STARTER_LATE_BP = 2000;  // +20% at full ramp
export const BLOODTHIRSTY_ATK_PER_KILL = 4;
export const LEADER_RADIUS = 2;
export const LOYAL_FAR_RADIUS = 5;
export const LOYAL_NEAR_BP = 1500;
export const LOYAL_FAR_BP = 1500;
```

- [ ] **Step 3: Write failing tests** (`sim/stats.test.ts`) — node-verified values

```ts
import { effectiveDerived } from './stats';
// helper: build a Unit with given base attrs/hp/traits/kills/pos and a FightCtx
// (reuse a local builder; ctx = { totalTicks, units, grid }).

it('reckless: +atk as HP falls, constant −physDef', () => {
  // base atk 17 (melee str=?, see deriveStats) — pick attrs giving atk 17, maxHp 45, physDef 5.
  // Verify table: hp45→atk17/def3, hp27→atk21, hp18→atk23, hp9→atk25, hp1→atk26 (def stays 3).
});
it('slowStarter: −early +late ramp on atk', () => {
  // base atk 20: t0→16, t75→18, t150→20, t300→24, t600→24
});
it('bloodthirsty: +4 atk per kill', () => {
  // base atk 17: kills 0→17, 1→21, 2→25, 3→29
});
it('loyal: +near / −far leader (atk18, physDef6)', () => {
  // d0/d2→atk20 def6, d3→atk18 def6, d5/d7→atk15 def5
});
it('no dynamic trait → returns base derived unchanged (identity)', () => {
  // effectiveDerived(plainUnit, ctx) deep-equals plainUnit.derived
});
```
(Choose attrs so `deriveStats` yields the stated base atk/def/maxHp; assert exact integers above.)

- [ ] **Step 4: Implement `effectiveDerived`** (`sim/stats.ts`)

```ts
import type { Unit } from '../shared/types';
import type { FightCtx } from './decide';
import { chebyshev } from './grid';
import { proxyLeader, hasTrait } from './decide';
import { RECKLESS_ATK_BP, RECKLESS_DEF_BP, SLOW_STARTER_RAMP_TICKS, SLOW_STARTER_EARLY_BP,
  SLOW_STARTER_LATE_BP, BLOODTHIRSTY_ATK_PER_KILL, LEADER_RADIUS, LOYAL_FAR_RADIUS,
  LOYAL_NEAR_BP, LOYAL_FAR_BP } from '../shared/config';

const DYNAMIC: ReadonlyArray<Unit['traits'][number]> = ['reckless', 'slowStarter', 'bloodthirsty', 'loyal'];

export function effectiveDerived(unit: Unit, ctx: FightCtx): DerivedStats {
  if (!unit.traits.some((t) => DYNAMIC.includes(t))) return unit.derived; // identity fast-path
  const d = unit.derived;
  let atk = d.atk, physDef = d.physDef, magicResist = d.magicResist;

  if (hasTrait(unit, 'reckless')) {
    const missingBp = Math.floor((d.maxHp - unit.hp) * 10000 / d.maxHp);
    atk += Math.floor(atk * RECKLESS_ATK_BP * missingBp / (10000 * 10000));
    physDef = Math.floor(physDef * (10000 - RECKLESS_DEF_BP) / 10000);
  }
  if (hasTrait(unit, 'slowStarter')) {
    const rampBp = Math.min(10000, Math.floor(ctx.totalTicks * 10000 / SLOW_STARTER_RAMP_TICKS));
    const factorBp = (10000 - SLOW_STARTER_EARLY_BP) + Math.floor((SLOW_STARTER_EARLY_BP + SLOW_STARTER_LATE_BP) * rampBp / 10000);
    atk = Math.floor(atk * factorBp / 10000);
    physDef = Math.floor(physDef * factorBp / 10000);
    magicResist = Math.floor(magicResist * factorBp / 10000);
  }
  if (hasTrait(unit, 'bloodthirsty')) {
    atk += unit.kills * BLOODTHIRSTY_ATK_PER_KILL;
  }
  if (hasTrait(unit, 'loyal')) {
    const leader = proxyLeader(unit, ctx.units);
    if (leader) {
      const dist = chebyshev(unit.pos, leader.pos);
      const f = dist <= LEADER_RADIUS ? 10000 + LOYAL_NEAR_BP : dist >= LOYAL_FAR_RADIUS ? 10000 - LOYAL_FAR_BP : 10000;
      atk = Math.floor(atk * f / 10000);
      physDef = Math.floor(physDef * f / 10000);
      magicResist = Math.floor(magicResist * f / 10000);
    }
  }
  return { ...d, atk, physDef, magicResist };
}
```
Apply trait factors in the fixed order above (Reckless → SlowStarter → Bloodthirsty → Loyal) so stacking is deterministic. `import type { DerivedStats }` at top.

- [ ] **Step 5: Add `hasTrait` + `proxyLeader`** to `sim/decide.ts`

```ts
import type { TraitId } from '../shared/types';
export function hasTrait(unit: Unit, id: TraitId): boolean { return unit.traits.includes(id); }
export function proxyLeader(unit: Unit, units: Unit[]): Unit | null {
  const allies = units.filter((u) => u.hp > 0 && u.side === unit.side && u.id !== unit.id);
  if (allies.length === 0) return null;
  allies.sort((x, y) => y.priority - x.priority || (x.id < y.id ? -1 : 1));
  return allies[0]!;
}
```

- [ ] **Step 6: Initialize new Unit fields + wire effectiveDerived** (`sim/tile-fight.ts`)

In the `units` map init add: `traits: u.traits ?? [], kills: 0, stallSinceTick: -1, fleeingSinceTick: -1`. In BOTH the cast and basic damage branches, compute effective stats:
```ts
const aEff = effectiveDerived(actor, ctx);
const tEff = effectiveDerived(target, ctx);
const channel = aEff.channel;
const def = channel === 'physical' ? tEff.physDef : tEff.magicResist;
// use aEff.atk in mitigatedDamage / heavyStrikeDamage; manaGainOnTaken uses tEff.maxHp
```
(`maxHp`, `manaChargeBp`, crit/accuracy/evasion still come from base `derived` — dynamic traits in this catalog touch only atk/physDef/magicResist.) Import `effectiveDerived` from `./stats`. When a basic/skill blow is lethal, also `actor.kills++` (powers Bloodthirsty next turn).

- [ ] **Step 7: Update Unit test helpers** — the new `Unit` fields are required, so every `Unit` literal must set them. In `sim/hash.test.ts` and `sim/initiative.test.ts` add `traits: [], kills: 0, stallSinceTick: -1, fleeingSinceTick: -1` to each literal; in the `u(...)` builder in `sim/decide.test.ts` (from Task 1) add `traits: opts.traits ?? [], kills: opts.kills ?? 0, stallSinceTick: -1, fleeingSinceTick: -1` to the returned object. Run `npx vitest run sim/hash.test.ts sim/initiative.test.ts sim/decide.test.ts` → PASS.

- [ ] **Step 8: Add dynamic-stat parity fixture** — append to `tools/parity/fixtures.mjs` (capture procedure in Global Constraints). A small fight with a `reckless` melee unit vs a plain unit so atk ramps as it is damaged:
```js
{
  name: 'reckless-duel-seed7', expectedHash: 'PENDING',
  bundle: { version: 1, seed: 7, setup: { grid: { width: 5, height: 1, blocked: [] }, units: [
    { id: 'rk', side: 'A', attackKind: 'melee', traits: ['reckless'], attrs: { str: 6, agi: 5, int: 1, lck: 2 }, priority: 5, pos: { x: 0, y: 0 } },
    { id: 'p',  side: 'B', attackKind: 'melee', attrs: { str: 6, agi: 4, int: 1, lck: 2 }, priority: 5, pos: { x: 4, y: 0 } },
  ] } },
}
```

- [ ] **Step 9: Verify + commit** — `npm test`, `npm run typecheck`, full parity green (4 fixtures; canonical still 86e238c1).
```bash
git add shared/types.ts shared/config.ts sim/stats.ts sim/stats.test.ts sim/decide.ts sim/decide.test.ts sim/tile-fight.ts sim/hash.test.ts sim/initiative.test.ts tools/parity/fixtures.mjs
git commit -m "$(cat <<'EOF'
feat(sim): trait model + effectiveDerived dynamic-stat hooks

Reckless/SlowStarter/Bloodthirsty/Loyal recomputed per turn on the damage
path; trait-less units identical (golden 86e238c1 held). New reckless-duel
parity fixture; V8 == goja.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Decision-override hooks (Coward + Headstrong) + `stepAway`

**Files:**
- Modify: `sim/grid.ts` (+`stepAway`), `sim/decide.ts` (Coward/Headstrong in `decideTurn`), `sim/tile-fight.ts` (flee movement, charge, `fleeingSinceTick` update), `shared/config.ts`
- Test: `sim/grid.test.ts`, `sim/decide.test.ts`, `tools/parity/fixtures.mjs`

**Interfaces:**
- Consumes: `chebyshev`, `proxyLeader`, `hasTrait`, `FightCtx`.
- Produces:
  ```ts
  // sim/grid.ts
  export function stepAway(from: Cell, threats: Cell[], canEnter: (c: Cell) => boolean): Cell;
  // sim/decide.ts — decideTurn now returns flee/charge for Coward/Headstrong
  ```

- [ ] **Step 1: Config** (`shared/config.ts`)
```ts
export const COWARD_FLEE_BP = 3000;        // flee at <= 30% HP
export const COWARD_FLEE_MOVE_BONUS = 1;   // +moveRange while fleeing
export const RALLY_TICKS = 200;            // time-valve: rally (permanently) after this long fleeing
```

- [ ] **Step 2: Failing `stepAway` tests** (`sim/grid.test.ts`)
```ts
it('stepAway moves to the enterable 4-neighbor maximizing min-distance to threats', () => {
  const open = () => true;
  // from (2,2), single threat at (2,0): best step increases distance → (2,3) (away on y) or (1,2)/(3,2) (dist stays 2 on cheby? use chebyshev). Assert the chosen cell has the greatest min-chebyshev to threats; deterministic tiebreak.
  expect(stepAway({ x: 2, y: 2 }, [{ x: 2, y: 0 }], open)).toEqual({ x: 2, y: 3 });
});
it('stepAway returns `from` when no neighbor improves or all blocked', () => {
  expect(stepAway({ x: 0, y: 0 }, [{ x: 5, y: 5 }], () => false)).toEqual({ x: 0, y: 0 });
});
```

- [ ] **Step 3: Implement `stepAway`** (`sim/grid.ts`)
```ts
// Best enterable 4-neighbor maximizing the minimum chebyshev distance to any
// threat. Candidates are tried in a fixed order (E, W, N, S) and a neighbor
// replaces the incumbent only on a STRICTLY greater score, so ties keep the
// earlier candidate and `from` wins when nothing beats staying put — fully
// deterministic, integer-only. `chebyshev` is defined in this module.
export function stepAway(from: Cell, threats: Cell[], canEnter: (c: Cell) => boolean): Cell {
  if (threats.length === 0) return from;
  const minDist = (c: Cell): number => {
    let m = Infinity;
    for (const t of threats) m = Math.min(m, chebyshev(c, t));
    return m;
  };
  const cand: Cell[] = [
    { x: from.x + 1, y: from.y }, { x: from.x - 1, y: from.y },
    { x: from.x, y: from.y + 1 }, { x: from.x, y: from.y - 1 },
  ].filter(canEnter);
  let best = from;
  let bestScore = minDist(from);
  for (const c of cand) {
    const s = minDist(c);
    if (s > bestScore) { best = c; bestScore = s; }
  }
  return best;
}
```
(`minDist` uses a loop, not `Math.min(...map)`, to stay allocation-light and avoid spread on large arrays; the test pins the observable result.)

- [ ] **Step 4: Failing Coward/Headstrong tests** (`sim/decide.test.ts`)
```ts
it('coward at low HP flees (move=flee), with fleeingSinceTick set', () => {
  const c = u('c', 'A', 4, 4, { /* traits:['coward'] */ }); c.traits = ['coward']; c.hp = 1; c.fleeingSinceTick = 5;
  const e = u('e', 'B', 4, 0); const ct = { totalTicks: 10, units: [c, e], grid };
  expect(decideTurn(c, ct).move).toBe('flee');
});
it('coward rallies (engage) once fleeing >= RALLY_TICKS', () => {
  const c = u('c', 'A', 4, 4); c.traits = ['coward']; c.hp = 1; c.fleeingSinceTick = 0;
  const e = u('e', 'B', 4, 0); const ct = { totalTicks: 999, units: [c, e], grid };
  expect(decideTurn(c, ct).move).toBe('engage');
});
it('coward rallies near the proxy leader', () => { /* ally higher-priority within LEADER_RADIUS → engage */ });
it('bloodthirsty suppresses coward flee (won’t retreat)', () => {
  const c = u('c', 'A', 4, 4); c.traits = ['coward', 'bloodthirsty']; c.hp = 1; c.fleeingSinceTick = 1;
  const e = u('e', 'B', 4, 0); expect(decideTurn(c, { totalTicks: 2, units: [c, e], grid }).move).toBe('engage');
});
it('headstrong targets nearest and sets charge=true', () => {
  const h = u('h', 'A', 0, 0); h.traits = ['headstrong'];
  const near = u('n', 'B', 3, 0, { priority: 0 }), far = u('f', 'B', 2, 5, { priority: 9 });
  const intent = decideTurn(h, { totalTicks: 0, units: [h, near, far], grid });
  expect(intent.charge).toBe(true);
  expect(intent.targetId).toBe('n'); // pure nearest by chebyshev (3 < 5), ignoring priority
});
```

- [ ] **Step 5: Implement Coward + Headstrong** in `decideTurn` (`sim/decide.ts`)
```ts
import { COWARD_FLEE_BP, RALLY_TICKS, LEADER_RADIUS } from '../shared/config';

function nearestEnemy(actor: Unit, units: Unit[]): Unit | null {
  const en = units.filter((u) => u.hp > 0 && u.side !== actor.side);
  if (en.length === 0) return null;
  en.sort((x, y) => chebyshev(actor.pos, x.pos) - chebyshev(actor.pos, y.pos) || (x.id < y.id ? -1 : 1));
  return en[0]!;
}
function cowardFlees(actor: Unit, ctx: FightCtx): boolean {
  if (!hasTrait(actor, 'coward') || hasTrait(actor, 'bloodthirsty')) return false;
  const lowHp = actor.hp * 10000 <= COWARD_FLEE_BP * actor.derived.maxHp;
  if (!lowHp || actor.fleeingSinceTick < 0) return false;
  if (ctx.totalTicks - actor.fleeingSinceTick >= RALLY_TICKS) return false; // time-valve rally (permanent: tick only grows)
  const leader = proxyLeader(actor, ctx.units);
  if (leader && chebyshev(actor.pos, leader.pos) <= LEADER_RADIUS) return false; // near-leader rally
  return true;
}

export function decideTurn(actor: Unit, ctx: FightCtx): TurnIntent {
  // 1. trait decision hooks
  if (cowardFlees(actor, ctx)) {
    const t = nearestEnemy(actor, ctx.units);
    return { targetId: t ? t.id : null, move: 'flee', charge: false };
  }
  if (hasTrait(actor, 'headstrong')) {
    const t = nearestEnemy(actor, ctx.units);
    return { targetId: t ? t.id : null, move: 'engage', charge: true };
  }
  // 2. priority/targeting
  const target = chooseTarget(actor, ctx.units);
  return { targetId: target ? target.id : null, move: 'engage', charge: false };
}
```

- [ ] **Step 6: Wire flee/charge movement + `fleeingSinceTick`** (`sim/tile-fight.ts`)

Before `decideTurn`, update the flee clock (mutation):
```ts
// Coward flee clock: begin while low-HP, clear when healthy. Never reset while
// low (so totalTicks - fleeingSinceTick crosses RALLY_TICKS → permanent rally).
if (actor.traits.includes('coward') && !actor.traits.includes('bloodthirsty')) {
  const lowHp = actor.hp * 10000 <= COWARD_FLEE_BP * actor.derived.maxHp;
  if (!lowHp) actor.fleeingSinceTick = -1;
  else if (actor.fleeingSinceTick < 0) actor.fleeingSinceTick = totalTicks;
}
```
In movement: if `intent.move === 'flee'`, step using `stepAway(actor.pos, livingEnemyPositions, canEnter)` for `moveRange + COWARD_FLEE_MOVE_BONUS` steps and SKIP the attack (fleeing units don't attack this turn). If `intent.charge`, move toward target until `chebyshev<=1` (close to melee) instead of stopping at `attackRange`. Otherwise the existing engage loop (stop at `inAttackPosition`).

- [ ] **Step 7: Add Coward + Headstrong fixtures** (capture procedure). Coward: a low-HP-prone melee unit (low STR) that gets bloodied and flees, plus an ally to test rally — or simplest, a `coward` unit vs a stronger enemy on a wider grid so it kites. Headstrong: a `ranged`+`headstrong` unit that charges to melee instead of kiting (contrast vs the `ranged-wall` fixture).
```js
{ name: 'coward-kite-seed3', expectedHash: 'PENDING', bundle: { version: 1, seed: 3, setup: {
  grid: { width: 9, height: 1, blocked: [] }, units: [
  { id: 'cw', side: 'A', attackKind: 'melee', traits: ['coward'], attrs: { str: 1, agi: 7, int: 1, lck: 1 }, priority: 5, pos: { x: 4, y: 0 } },
  { id: 'br', side: 'B', attackKind: 'melee', attrs: { str: 9, agi: 6, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } } ] } } },
{ name: 'headstrong-charge-seed3', expectedHash: 'PENDING', bundle: { version: 1, seed: 3, setup: {
  grid: { width: 8, height: 1, blocked: [] }, units: [
  { id: 'hs', side: 'A', attackKind: 'ranged', traits: ['headstrong'], attrs: { str: 4, agi: 7, int: 3, lck: 2 }, priority: 5, pos: { x: 0, y: 0 } },
  { id: 'tg', side: 'B', attackKind: 'melee', attrs: { str: 6, agi: 4, int: 1, lck: 2 }, priority: 5, pos: { x: 7, y: 0 } } ] } } },
```

- [ ] **Step 8: Verify + commit** — suite, types, full parity (6 fixtures; canonical 86e238c1).
```bash
git add sim/grid.ts sim/grid.test.ts sim/decide.ts sim/decide.test.ts sim/tile-fight.ts shared/config.ts tools/parity/fixtures.mjs
git commit -m "$(cat <<'EOF'
feat(sim): Coward flee + rally valve and Headstrong charge hooks

Trait decision-override layer in decideTurn; new stepAway primitive; flee
movement + fleeingSinceTick clock. Two new parity fixtures; golden held.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: RNG action hooks (Stupid + Lucky Fool)

Resolved at execution, fixed draw order: **Lucky Fool retarget → Stupid misfire → hit → crit**.

**Files:**
- Modify: `shared/types.ts` (`misfire` event), `shared/config.ts`, `sim/tile-fight.ts`
- Test: `sim/tile-fight.test.ts`, `tools/parity/fixtures.mjs`

**Interfaces:**
- Consumes: `hasTrait`, `rng.intInRange`, fixed enemy sort.
- Produces: `FightEvent` gains `{ t: 'misfire'; id: string; target: string }`.

- [ ] **Step 1: Config + event type**
```ts
// shared/config.ts
export const STUPID_MISFIRE_BP = 1000; // 10%
export const LUCKY_FOOL_BP = 500;      // 5%
```
`shared/types.ts` `FightEvent` union: add `| { t: 'misfire'; id: string; target: string }`.

- [ ] **Step 2: Failing tests** (`sim/tile-fight.test.ts`) — use a seed where the roll lands; assert the event stream contains a `misfire` for a `stupid` unit and a retarget for a `luckyFool` unit (target differs from `chooseTarget`). Also assert a `stupid` unit never misfires a `heavyStrike` cast.

- [ ] **Step 3: Implement hooks** (`sim/tile-fight.ts`, in the `inAttackPosition` action block, before the existing rolls)
```ts
import { STUPID_MISFIRE_BP, LUCKY_FOOL_BP } from '../shared/config';

let actualTarget = target;
// Lucky Fool: single-target actions only. At this task the only cast is
// heavyStrike (single-target), so this fires for 'basic' and 'cast' alike;
// Task 5 adds `&& actor.skill !== 'cleave'` to exclude the AoE.
if (action !== 'none' && actor.traits.includes('luckyFool')) {
  if (rng.intInRange(0, 9999) < LUCKY_FOOL_BP) {
    const en = units.filter((x) => x.hp > 0 && x.side !== actor.side)
      .sort((p, q) => chebyshev(actor.pos, p.pos) - chebyshev(actor.pos, q.pos) || (p.id < q.id ? -1 : 1));
    if (en.length > 0) actualTarget = en[rng.intInRange(0, en.length - 1)]!;
  }
}
if (action === 'basic' && actor.traits.includes('stupid')) {
  if (rng.intInRange(0, 9999) < STUPID_MISFIRE_BP) {
    events.push({ t: 'misfire', id: actor.id, target: actualTarget.id });
    // wasted action: no hit/crit draw, no damage, no mana
  } else {
    // normal basic vs actualTarget …
  }
}
```
Use `actualTarget` in place of `target` for the basic/cast resolution. Keep the misfire branch from drawing further RNG (so a misfire consumes exactly one Stupid draw).

- [ ] **Step 4: Fixtures** — a `stupid` melee unit and a `luckyFool` unit on small grids at seeds where the roll fires within the fight (implementer picks the seed by trial; document it). Capture hashes.

- [ ] **Step 5: Verify + commit** (suite/types/parity; canonical 86e238c1).
```bash
git commit -m "feat(sim): Stupid misfire + Lucky Fool retarget RNG hooks …"  # + trailer
```

---

## Task 5: Skill dispatch + Cleave + cast-conditions + pressure-valve

**Files:**
- Modify: `shared/types.ts` (`'cleave'` SkillId), `shared/config.ts` (`SKILL_COST`, Cleave/valve constants), `sim/combat.ts` (`cleaveDamage`), `sim/decide.ts` (`castCondition`, valve in `decideAction`), `sim/tile-fight.ts` (resolveCast dispatch, valve clock)
- Test: `sim/combat.test.ts`, `sim/decide.test.ts`, `sim/tile-fight.test.ts`, `tools/parity/fixtures.mjs`

**Interfaces:**
- Consumes: `mitigatedDamage`, `applyCrit`, `manaGainOnTaken`, `effectiveDerived`, `hasLineOfSight`, `chebyshev`.
- Produces:
  ```ts
  export type SkillId = 'heavyStrike' | 'cleave';
  export const SKILL_COST: Record<SkillId, number>;
  export function cleaveDamage(atk: number, def: number): number; // floor(mitigated * CLEAVE_MULT/100)
  export function castCondition(actor: Unit, target: Unit, ctx: FightCtx): boolean; // skill-specific
  export function cleaveTargets(actor: Unit, ctx: FightCtx): Unit[]; // living enemies in radius+LoS, sorted
  ```

- [ ] **Step 1: Config + types**
```ts
// shared/config.ts
export const CLEAVE_COST = 60;
export const CLEAVE_RADIUS = 1;
export const CLEAVE_MIN_TARGETS = 2;
export const CLEAVE_MULT = 120;     // ×1.20 per target
export const VALVE_TICKS = 250;     // universal pressure-valve interval
export const SKILL_COST = { heavyStrike: HEAVY_STRIKE_COST, cleave: CLEAVE_COST } as const;
```
`shared/types.ts`: `SkillId = 'heavyStrike' | 'cleave'`.

- [ ] **Step 2: `cleaveDamage` test + impl** (`sim/combat.test.ts`, `sim/combat.ts`)
```ts
// test: cleaveDamage(17,5) === 16; cleaveDamage(20,3) === 20  (node-verified)
export function cleaveDamage(atk: number, def: number): number {
  return Math.floor((mitigatedDamage(atk, def) * CLEAVE_MULT) / 100);
}
```

- [ ] **Step 3: `cleaveTargets` + `castCondition` + valve gate** (`sim/decide.ts`)
```ts
export function cleaveTargets(actor: Unit, ctx: FightCtx): Unit[] {
  return ctx.units.filter((u) => u.hp > 0 && u.side !== actor.side
      && chebyshev(actor.pos, u.pos) <= CLEAVE_RADIUS
      && hasLineOfSight(actor.pos, u.pos, (c) => ctx.grid.isBlocked(c)))
    .sort((x, y) => chebyshev(actor.pos, x.pos) - chebyshev(actor.pos, y.pos) || y.priority - x.priority || (x.id < y.id ? -1 : 1));
}
export function castCondition(actor: Unit, _target: Unit, ctx: FightCtx): boolean {
  if (actor.skill === 'cleave') return cleaveTargets(actor, ctx).length >= CLEAVE_MIN_TARGETS;
  return true; // heavyStrike: in-position is sufficient
}
```
Rework `decideAction` to gate cast on cost + condition OR the valve:
```ts
export function decideAction(actor: Unit, target: Unit, ctx: FightCtx): 'cast' | 'basic' {
  if (!actor.skill || actor.mana < SKILL_COST[actor.skill]) return 'basic';
  if (castCondition(actor, target, ctx)) return 'cast';
  // valve: affordable but condition unmet for >= VALVE_TICKS → force-cast (best target/area exists)
  if (actor.stallSinceTick >= 0 && ctx.totalTicks - actor.stallSinceTick >= effectiveValveTicks(actor)) return 'cast';
  return 'basic';
}
```
(`effectiveValveTicks` = `VALVE_TICKS` until Task 6 adds the personality delta; define it now returning `VALVE_TICKS`.)

- [ ] **Step 4: Valve clock + resolveCast dispatch** (`sim/tile-fight.ts`)

Valve clock (mutation, when in position with a skill): if `actor.skill && actor.mana >= SKILL_COST[actor.skill] && !castCondition(...)`, set `stallSinceTick` if `< 0`; else reset `stallSinceTick = -1`.
Replace the single Heavy Strike block with a dispatch on `actor.skill`:
- `heavyStrike`: unchanged single-target (guaranteed hit, `heavyStrikeDamage(aEff.atk, def)`, crit, mana to victim, spend cost).
- `cleave`: `const tgts = cleaveTargets(actor, ctx)` (or the single best target if valve-forced and `< MIN`); guaranteed hit each; per target in sorted order `cleaveDamage(aEff.atk, tEff.physDef)`, crit roll (`rng` each), apply, `manaGainOnTaken`, emit `attack{skill:'cleave'}` per target, death handling; spend `CLEAVE_COST` once; caster gains no mana.

A valve-forced cast with `< CLEAVE_MIN_TARGETS` still resolves against whatever enemies are in radius/LoS (≥1). If zero are in radius, the unit cannot cast — fall through to the engage/basic path (it keeps closing).

- [ ] **Step 5: Tests** — `decideAction`: cast when ≥2 in radius; basic when 1 in radius and not stalled; cast when stalled ≥ VALVE_TICKS. `tile-fight`: a Cleave hits 2 enemies (two `attack{skill:'cleave'}` events); a valve-forced Cleave fires against 1 enemy after VALVE_TICKS.

- [ ] **Step 6: Fixtures** — `cleave-cluster-seedN` (a `cleave` unit reaching 2 adjacent enemies → casts) and `cleave-valve-seedN` (a `cleave` unit vs a single enemy → valve forces a cast after the interval). Capture hashes.

- [ ] **Step 7: Verify + commit** (suite/types/parity; canonical 86e238c1; skill-cast-seed11 b621e99d unchanged).
```bash
git commit -m "feat(sim): skill dispatch + Cleave AoE + cast-conditions + pressure-valve …"  # + trailer
```

---

## Task 6: Personality temperament lean (lowest precedence)

**Files:**
- Modify: `shared/types.ts` (`Temperament`, `UnitSpec.personality`, `Unit.temperament?`), `shared/config.ts` (`LEAN_VALVE_DELTA`), `sim/decide.ts` (tie-break + `effectiveValveTicks`), `sim/tile-fight.ts` (init), `tools/parity/fixtures.mjs`
- Test: `sim/decide.test.ts`, `tools/parity/fixtures.mjs`

**Interfaces:**
- Consumes: `chooseTarget` sort, `effectiveValveTicks`.
- Produces:
  ```ts
  export type Temperament = 'brave' | 'cautious' | 'hotheaded' | 'stoic';
  // UnitSpec gains: personality?: { temperament: Temperament };
  // Unit gains:     temperament?: Temperament;
  ```

- [ ] **Step 1: Types + config** — add `Temperament`; `UnitSpec.personality?`; `Unit.temperament?`. `export const LEAN_VALVE_DELTA = 60;`

- [ ] **Step 2: Failing tie-break tests** (`sim/decide.test.ts`) — two enemies equal on (distance, priority); assert temperament picks: `hotheaded` → lower HP; `brave` → higher base atk; `cautious` → lower base atk; `stoic` → id asc (neutral). Assert a non-tied case (different distances) is UNAFFECTED by temperament. Assert Headstrong (pure nearest) ignores temperament.

- [ ] **Step 3: Implement tie-break** — extend `chooseTarget` to accept the actor's temperament and insert a single key BETWEEN `priority desc` and `id asc`:
```ts
function leanKey(t: Temperament | undefined, e: Unit): number {
  if (t === 'hotheaded') return e.hp;                 // go for the kill (asc)
  if (t === 'brave') return -e.derived.atk;           // most dangerous first
  if (t === 'cautious') return e.derived.atk;          // least dangerous first
  return 0;                                            // stoic / none → neutral
}
// sort: dist asc || priority desc || leanKey(actor.temperament,x)-leanKey(...,y) || id asc
```
(Keep `chooseTarget(actor, units)` signature; read `actor.temperament` internally.)

- [ ] **Step 4: Skill-dump timing** — `effectiveValveTicks(actor)` returns `hotheaded` → `Math.max(0, VALVE_TICKS - LEAN_VALVE_DELTA)`, `cautious` → `VALVE_TICKS + LEAN_VALVE_DELTA`, else `VALVE_TICKS`. Clamp ≥ 0. (Only affects conditional-skill valve timing.)

- [ ] **Step 5: Init** (`sim/tile-fight.ts`) — `temperament: u.personality?.temperament`.

- [ ] **Step 6: Fixture** — `personality-tiebreak-seedN`: a unit equidistant from two equal-priority enemies, with a temperament so the tie-break decides which it engages first. Capture hash.

- [ ] **Step 7: Verify + commit** (suite/types/parity; canonical 86e238c1).
```bash
git commit -m "feat(sim): personality temperament soft lean (tie-break + valve timing) …"  # + trailer
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** precedence pipeline (T1) ✓; trait model + dynamic-stat (T2) ✓; decision-override + stepAway (T3) ✓; RNG hooks (T4) ✓; skill dispatch + Cleave + cast-conditions + valve (T5) ✓; personality lean (T6) ✓; anchor-frozen determinism + per-mechanism fixtures (every task) ✓; proxy-leader / kite-flee / no-flee-Bloodthirsty adaptations (T2/T3) ✓.
- **Type consistency:** `TraitId`, `Temperament`, `SkillId`, `TurnIntent`, `FightCtx`, `effectiveDerived`, `hasTrait`/`proxyLeader`, `SKILL_COST`, `castCondition`/`cleaveTargets`/`cleaveDamage`, `effectiveValveTicks` are introduced once and reused with the same signatures; new `Unit` fields (`traits`/`kills`/`stallSinceTick`/`fleeingSinceTick`/`temperament?`) are added in T2/T6 and the test helpers updated in T2.
- **Placeholders:** none — `expectedHash: 'PENDING'` is an intentional capture sentinel resolved by the fixture-capture procedure; constants are concrete; example values are node-verified.
- **Determinism:** transient fields unhashed; fixed RNG draw order (Lucky Fool → Stupid → hit → crit; Cleave per-target crit in sorted order); total-order sorts end in id; canonical fixture stays 86e238c1 on every task (the parity gate enforces it).
