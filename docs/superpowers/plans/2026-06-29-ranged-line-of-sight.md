# Ranged Attacks & Line-of-Sight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ranged/magic units attack from a distance, gated by a terrain-blocked line-of-sight check, while leaving melee byte-for-byte unchanged.

**Architecture:** A deterministic integer **supercover** `hasLineOfSight` in `sim/grid.ts`; `attackRange` derived per `attackKind` from tunable `/shared` config; the tile-fight move/attack gate becomes *in range AND has LoS*. Melee keeps range 1 (adjacent LoS always clear), so the Plan 3 golden `86e238c1` is preserved; a new ranged+wall parity fixture proves the new integer math is goja-identical.

**Tech Stack:** TypeScript (strict), Vitest, Node 20+; the existing esbuild/Go-goja parity harness (Go 1.25).

**Spec:** `docs/superpowers/specs/2026-06-29-ranged-line-of-sight-design.md`.

## Global Constraints

- **Determinism / goja-safety:** `/sim` and `/shared` are pure — no wall-clock, `Date.now()`, `Math.random()`, I/O, Node-only APIs, `Math.sqrt`, or floats. `hasLineOfSight` is integer-only and **symmetric** under endpoint reversal. (`/tools` may use Node APIs.)
- **Melee golden `86e238c1` is PRESERVED — do NOT re-pin it.** Melee `attackRange` stays `1` and adjacent LoS is always clear, so the all-melee canonical fight is byte-identical to Plan 3. If the golden moves, something is wrong — stop and report.
- **LoS is terrain-only:** only `blocked` cells break LoS; units never block shots this slice.
- **TypeScript strict** with `noUncheckedIndexedAccess`. `npm run typecheck` runs both tsconfigs.
- **Parity:** locally Go 1.25 is off the base PATH — prepend `export PATH="/c/Program Files/Go/bin:$PATH"` for parity runs. Committed harness hardcodes no Go path.
- **Tunable config:** range values live in `shared/config.ts`; correctness does not depend on them.
- Branch: `plan-4-ranged-los` (commit there; do not push until the plan completes).

---

### Task 1: Line-of-sight (`sim/grid.ts`)

**Files:**
- Modify: `sim/grid.ts`
- Test: `sim/grid.test.ts`

**Interfaces:**
- Consumes: `Cell` from `shared/types`.
- Produces: `function hasLineOfSight(from: Cell, to: Cell, isBlocked: (c: Cell) => boolean): boolean`.

- [ ] **Step 1: Write the failing test**

Append to `sim/grid.test.ts` (and add `hasLineOfSight` to the existing `import { ... } from './grid';` line at the top):

```ts
describe('hasLineOfSight', () => {
  const blocked = (...cells: Cell[]) => (c: Cell) => cells.some((b) => b.x === c.x && b.y === c.y);
  const open = () => false;

  it('is clear along an open horizontal line', () => {
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 4, y: 0 }, open)).toBe(true);
  });

  it('is blocked by a wall strictly on the line', () => {
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 4, y: 0 }, blocked({ x: 2, y: 0 }))).toBe(false);
  });

  it('treats adjacent cells as always clear (no intermediate cells)', () => {
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 1, y: 0 }, open)).toBe(true);
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 1, y: 1 }, open)).toBe(true);
  });

  it('never tests the endpoints themselves', () => {
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 4, y: 0 }, blocked({ x: 4, y: 0 }))).toBe(true);
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 4, y: 0 }, blocked({ x: 0, y: 0 }))).toBe(true);
  });

  it('handles diagonals, clear and blocked', () => {
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 3, y: 3 }, open)).toBe(true);
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 3, y: 3 }, blocked({ x: 2, y: 2 }))).toBe(false);
  });

  it('is symmetric under endpoint reversal', () => {
    const cases: Array<[Cell, Cell, (c: Cell) => boolean]> = [
      [{ x: 0, y: 0 }, { x: 4, y: 0 }, blocked({ x: 2, y: 0 })],
      [{ x: 0, y: 0 }, { x: 3, y: 3 }, blocked({ x: 2, y: 2 })],
      [{ x: 1, y: 0 }, { x: 4, y: 2 }, blocked({ x: 3, y: 1 })],
      [{ x: 0, y: 2 }, { x: 5, y: 0 }, open],
    ];
    for (const [a, b, blk] of cases) {
      expect(hasLineOfSight(a, b, blk)).toBe(hasLineOfSight(b, a, blk));
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- sim/grid.test.ts`
Expected: FAIL — `hasLineOfSight` is not exported.

- [ ] **Step 3: Implement `hasLineOfSight`**

Append to `sim/grid.ts`:

```ts
// True iff no `blocked` cell lies strictly between `from` and `to` on the
// supercover line (every cell the segment passes through). Endpoints are never
// tested; adjacent cells (no intermediate) are always clear. Symmetric under
// endpoint reversal. Integer-only (goja-safe): no Math.sqrt, no floats.
export function hasLineOfSight(from: Cell, to: Cell, isBlocked: (c: Cell) => boolean): boolean {
  const nx = Math.abs(to.x - from.x);
  const ny = Math.abs(to.y - from.y);
  const sx = sign(to.x - from.x);
  const sy = sign(to.y - from.y);
  let x = from.x;
  let y = from.y;
  let ix = 0;
  let iy = 0;
  while (ix < nx || iy < ny) {
    // Symmetric supercover decision; ×2 keeps it integer. ==0 is an exact
    // corner crossing -> step diagonally (visit the corner cell).
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (decision === 0) { x += sx; y += sy; ix++; iy++; }
    else if (decision < 0) { x += sx; ix++; }
    else { y += sy; iy++; }
    if (x === to.x && y === to.y) break; // reached destination; endpoint not tested
    if (isBlocked({ x, y })) return false;
  }
  return true;
}
```

(`sign` already exists in `sim/grid.ts` from Plan 1.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- sim/grid.test.ts`
Expected: PASS (all `hasLineOfSight` cases + the existing grid tests).

- [ ] **Step 5: Commit**

```bash
git add sim/grid.ts sim/grid.test.ts
git commit -m "feat(sim): integer supercover line-of-sight"
```

---

### Task 2: `attackRange` per `attackKind` (`shared/config.ts` + `sim/stats.ts`)

**Files:**
- Modify: `shared/config.ts`, `sim/stats.ts`
- Test: `sim/stats.test.ts`

**Interfaces:**
- Consumes: `AttackKind` (`shared/types`).
- Produces: `MELEE_RANGE`/`RANGED_RANGE`/`MAGIC_RANGE` (`shared/config`); `deriveStats(attrs, attackKind)` now sets `attackRange` per kind.

- [ ] **Step 1: Replace the flat range constant**

In `shared/config.ts`, replace the line `export const ATTACK_RANGE = 1;` with:

```ts
export const MELEE_RANGE = 1;
export const RANGED_RANGE = 4;
export const MAGIC_RANGE = 3;
```

- [ ] **Step 2: Write the failing test**

In `sim/stats.test.ts`, add `attackRange` assertions to the existing tests:
- In the **ranged** test (`'uses the ranged formula on the physical channel'`), add: `expect(d.attackRange).toBe(4);`
- In the **magic** test (`'uses the magic formula on the magic channel'`), add: `expect(d.attackRange).toBe(3);`

The balanced-melee test already asserts `expect(d.attackRange).toBe(1);` — leave it.

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- sim/stats.test.ts`
Expected: FAIL — ranged/magic `attackRange` is still `1` (and `sim/stats.ts` won't compile once Step 4's import lands; do Step 4 next).
(It will also fail to import: `ATTACK_RANGE` no longer exists — that is fixed in Step 4.)

- [ ] **Step 4: Derive range per kind**

In `sim/stats.ts`: update the config import — remove `ATTACK_RANGE`, add `MELEE_RANGE, RANGED_RANGE, MAGIC_RANGE`. Add a `rangeFor` helper next to the existing `atkFor`, and use it:

```ts
function rangeFor(kind: AttackKind): number {
  if (kind === 'melee') return MELEE_RANGE;
  if (kind === 'ranged') return RANGED_RANGE;
  return MAGIC_RANGE; // magic
}
```

Change the returned `attackRange` field from `attackRange: ATTACK_RANGE,` to:

```ts
    attackRange: rangeFor(attackKind),
```

- [ ] **Step 5: Run it to verify it passes + golden held**

Run: `npm test && npm run typecheck`
Expected: ALL pass — the new ranged(4)/magic(3) assertions, melee still 1, and the golden `86e238c1` unchanged (the canonical fight is all-melee; the Plan 3 magic/ranged tile-fight tests place units adjacent, so range ≥ chebyshev still attacks). `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add shared/config.ts sim/stats.ts sim/stats.test.ts
git commit -m "feat(sim): attackRange per attackKind (ranged/magic reach)"
```

---

### Task 3: In-position gate — range AND line-of-sight (`sim/tile-fight.ts`)

**Files:**
- Modify: `sim/tile-fight.ts`
- Test: `sim/tile-fight.test.ts`

**Interfaces:**
- Consumes: `hasLineOfSight` (`sim/grid`, Task 1); per-kind `attackRange` (Task 2).
- Produces: the move loop and attack both gate on *in range AND has LoS*.

- [ ] **Step 1: Write the failing tests**

In `sim/tile-fight.test.ts`, add these inside the `describe('runTileFight', ...)` block (before its closing `});`):

```ts
  it('a ranged unit attacks from range without closing to melee', () => {
    const setup: FightSetup = {
      grid: { width: 5, height: 1, blocked: [] },
      units: [
        { id: 'r', side: 'A', attrs: { str: 1, agi: 5, int: 9, lck: 1 }, attackKind: 'ranged', priority: 5, pos: { x: 0, y: 0 } },
        { id: 't', side: 'B', attrs: { str: 5, agi: 1, int: 1, lck: 1 }, attackKind: 'melee', priority: 0, pos: { x: 3, y: 0 } },
      ],
    };
    const r = runTileFight(setup, 5);
    // INT 9 vs min-evasion target -> hitBp caps at 10000 (first action lands);
    // chebyshev 3 <= ranged range 4 with clear LoS -> it shoots from (0,0), no move.
    const firstByR = r.events.find((e) => (e.t === 'attack' || e.t === 'move' || e.t === 'miss') && e.id === 'r');
    expect(firstByR?.t).toBe('attack');
    expect(r.events.some((e) => e.t === 'move' && e.id === 'r')).toBe(false);
  });

  it('a wall on the line blocks the ranged shot until the unit repositions', () => {
    const mk = (withWall: boolean): FightSetup => ({
      grid: { width: 5, height: 1, blocked: withWall ? [{ x: 2, y: 0 }] : [] },
      units: [
        { id: 'r', side: 'A', attrs: { str: 1, agi: 5, int: 9, lck: 1 }, attackKind: 'ranged', priority: 5, pos: { x: 0, y: 0 } },
        { id: 't', side: 'B', attrs: { str: 5, agi: 1, int: 1, lck: 1 }, attackKind: 'melee', priority: 0, pos: { x: 4, y: 0 } },
      ],
    });
    const firstActByR = (s: FightSetup) => {
      const r = runTileFight(s, 5);
      return r.events.find((e) => (e.t === 'attack' || e.t === 'move' || e.t === 'miss') && e.id === 'r')?.t;
    };
    expect(firstActByR(mk(false))).toBe('attack'); // clear LoS at range 4 -> shoots from start
    expect(firstActByR(mk(true))).toBe('move');    // wall at (2,0) breaks LoS -> must move first
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- sim/tile-fight.test.ts`
Expected: FAIL — without the LoS gate, the ranged unit still only attacks when `chebyshev ≤ range` regardless of the wall, so the wall test's `'move'` expectation fails (it would `'attack'` through the wall), and/or the ranged-from-range test may pass only by luck. (At least the wall case must fail.)

- [ ] **Step 3: Add the in-position gate**

In `sim/tile-fight.ts`:

Add `hasLineOfSight` to the grid import:
```ts
import { makeGrid, chebyshev, stepToward, hasLineOfSight } from './grid';
```

Add an `inAttackPosition` helper inside `runTileFight`, just after the `occupied` helper is defined:
```ts
  const inAttackPosition = (actor: Unit, target: Unit): boolean =>
    chebyshev(actor.pos, target.pos) <= actor.derived.attackRange &&
    hasLineOfSight(actor.pos, target.pos, (c) => grid.isBlocked(c));
```

In the move loop, replace the stop condition line
```ts
      if (chebyshev(actor.pos, target.pos) <= actor.derived.attackRange) break;
```
with:
```ts
      if (inAttackPosition(actor, target)) break;
```

Replace the attack-guard line
```ts
    if (chebyshev(actor.pos, target.pos) <= actor.derived.attackRange) {
```
with:
```ts
    if (inAttackPosition(actor, target)) {
```

(The hit/mitigation/crit body inside the guard is unchanged.)

- [ ] **Step 4: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: ALL pass — the two new tests, AND the golden `86e238c1` still green (melee range 1, adjacent LoS always clear ⇒ melee fights byte-identical), determinism + no-mutation unchanged. `tsc` clean. **Do not run `npm run parity` yet** (the ranged fixture is added in Task 4).

- [ ] **Step 5: Commit**

```bash
git add sim/tile-fight.ts sim/tile-fight.test.ts
git commit -m "feat(sim): gate attacks on range AND line-of-sight"
```

---

### Task 4: Ranged parity fixture + re-verify V8 == goja

**Files:**
- Modify: `tools/parity/fixtures.mjs`

**Interfaces:**
- Consumes: the bundled sim (rebuilt by `npm run parity`); the goja runner.
- Produces: a second parity fixture exercising ranged range + LoS, verified identical across V8 and goja.

- [ ] **Step 1: Add the ranged fixture (placeholder hash)**

In `tools/parity/fixtures.mjs`, append a second entry to the `FIXTURES` array (keep the existing `canonical-baseSetup-seed42` / `86e238c1` melee fixture unchanged):

```js
  {
    name: 'ranged-wall-seed42',
    expectedHash: '00000000', // CAPTURE in Step 2
    bundle: {
      version: 1,
      seed: 42,
      setup: {
        grid: { width: 6, height: 3, blocked: [{ x: 3, y: 1 }] },
        units: [
          { id: 'r', side: 'A', attackKind: 'ranged', attrs: { str: 3, agi: 6, int: 4, lck: 2 }, priority: 5, pos: { x: 0, y: 1 } },
          { id: 'm', side: 'B', attackKind: 'melee', attrs: { str: 6, agi: 3, int: 1, lck: 2 }, priority: 5, pos: { x: 5, y: 1 } },
        ],
      },
    },
  },
```

- [ ] **Step 2: Capture the V8 hash**

Run: `npm run parity`
Expected: it rebuilds the bundle and reports a V8 mismatch for the new fixture, e.g. `V8 mismatch [ranged-wall-seed42]: <8-hex> !== 00000000`, then `PARITY FAILED`. Copy the received `<8-hex>` value and replace `'00000000'` with it. (The melee fixture stays green.)

- [ ] **Step 3: Re-verify both fixtures across V8 and goja**

Run (Go off base PATH — prepend it):
```bash
export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity
```
Expected: `goja parity checked.` then `PARITY OK (V8 === goja === expected) for 2 fixture(s).`, exit 0. (If goja disagrees with the captured hash, STOP and report — a real cross-runtime divergence in the new LoS/range integer math; do not mask it.)

- [ ] **Step 4: Confirm the suite is unaffected**

Run: `npm test && npm run typecheck`
Expected: all green (the fixture file is not part of the vitest suite, but confirm nothing regressed).

- [ ] **Step 5: Commit**

```bash
git add tools/parity/fixtures.mjs
git commit -m "test(parity): add ranged+wall fixture, verify V8 == goja"
```

---

## Self-Review

**1. Spec coverage** (spec §2.1 → tasks):
- `attackRange` per `attackKind` (tunable config) → Task 2 ✓
- Deterministic, integer, symmetric `hasLineOfSight` (terrain-only) → Task 1 ✓
- Move/attack gate = in range AND has LoS → Task 3 ✓
- New ranged+wall parity fixture, re-verify V8 == goja → Task 4 ✓
- Melee golden `86e238c1` preserved (no re-pin) → Tasks 2–3 keep it; asserted in Task 3 Step 4 ✓
- Out-of-scope (kiting, units-block-LoS, rich terrain) → untouched ✓

**2. Placeholder scan:** No "TBD/TODO/handle edge cases". The fixture `'00000000'` is an explicit capture step (Task 4 Steps 1–2), the established golden-capture pattern. Range values + LoS test geometry are concrete.

**3. Type consistency:** `hasLineOfSight(from, to, isBlocked)` (Task 1) matches its call in `inAttackPosition` (Task 3, passing `(c) => grid.isBlocked(c)`). `MELEE_RANGE`/`RANGED_RANGE`/`MAGIC_RANGE` (Task 2 config) match the `rangeFor` consumer and the removed `ATTACK_RANGE` import. `deriveStats(attrs, attackKind)` signature is unchanged (Plan 3); only the `attackRange` field's value changes. `inAttackPosition(actor, target)` is used in both the move loop and the attack guard. The golden `86e238c1` is referenced (and held) in the existing `tile-fight.test.ts`/`replay.test.ts`; the new ranged fixture carries its own captured hash.
