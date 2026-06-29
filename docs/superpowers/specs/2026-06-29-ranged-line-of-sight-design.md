# Ranged Attacks & Line-of-Sight (Plan 4) — Design

Status: **draft for review** · drafted 2026-06-29 · second slice of "Full combat depth" (after Plan 3, the combat foundation). Implements the GDD/combat-spec notion that archers/casters strike from a distance and that terrain (rock) "blocks move + line-of-sight" (`docs/superpowers/specs/2026-06-29-combat-rework-and-architecture-design.md` §3.4).

This is **Plan 4**. Plan 3 (two-channel damage + integer derived stats, golden `86e238c1`) is merged. Plans 5 (skills + Mana) and 6 (traits + behavior precedence) build on this and are out of scope.

---

## 1. Context & Goal

Plan 3 gave units an `attackKind` (`melee`/`ranged`/`magic`) and a channel, but left `attackRange` a flat `1` for everyone — so ranged and magic units currently fight at melee range. There is no line-of-sight: an attack lands whenever `chebyshev(actor, target) ≤ attackRange`.

**Goal:** make ranged and magic units attack from a distance, gated by a **line-of-sight** check that terrain (rock / `blocked` cells) interrupts — so a wall can shield a unit from arrows. Melee is unchanged.

**Done when:** `attackRange` derives from `attackKind`; a ranged/magic unit can only land an attack when the target is within range **and** there is clear LoS; a wall between attacker and target blocks the shot until the attacker repositions; and the new behavior is deterministic and goja-bit-identical (verified by a new ranged parity fixture). Melee fights are byte-for-byte unchanged.

---

## 2. Scope

### 2.1 In scope
- `attackRange` per `attackKind` (tunable `/shared` config).
- A deterministic, integer-only, **symmetric** `hasLineOfSight(from, to, isBlocked)` in `sim/grid.ts`, blocked by terrain (`blocked` cells) only.
- The tile-fight "in attack position" gate becomes *in range AND has LoS*; the move loop advances until in attack position.
- A new ranged-with-wall parity fixture + tests; re-verify V8 == goja (broadens parity coverage — a long-deferred fast-follow).

### 2.2 Out of scope (later)
- **Active kiting / retreat** (a ranged unit backing away from melee) — that is behavior precedence, **Plan 6**.
- **Units blocking LoS** (body-screens) — decided out; only terrain blocks LoS this slice.
- **The rich terrain system** — cover (damage reduction), slow cells, high-ground bonuses, flank/back-attack bonuses, element↔terrain interactions. Plan 4 uses only the existing `blocked` (rock) cells.
- Multi-army gates / reinforcement (a separate roadmap item).

---

## 3. Approach (decided in brainstorming)

**Terrain-only, symmetric supercover LoS + range-by-kind.** LoS is interrupted only by `blocked` cells (matching the spec's "rock blocks move + line-of-sight"); units never block shots this slice (the screen still emerges from melee bodies blocking *movement* + priority). The LoS test is a **supercover** line walk (every cell the segment passes through), chosen over Bresenham because it is **symmetric** (A→B clear ⟺ B→A clear) and conservative (no shooting through a wall's corner) — both matter for fairness and readability. All integer math, no floats — goja-safe, guarded by the parity gate.

Rejected: Bresenham (direction-asymmetric; A could shoot B through a gap B can't shoot back through). Units-as-LoS-blockers (richer but out of scope — needs ally/enemy rules and couples tighter with movement).

---

## 4. `attackRange` per `attackKind`

`shared/config.ts` gains (replacing the single flat `ATTACK_RANGE`):
```ts
export const MELEE_RANGE = 1;
export const RANGED_RANGE = 4;
export const MAGIC_RANGE = 3;
```
Starting values (tunable): on the 8×8 grid, 4 reaches half the board; casters slightly shorter. Easily equalized later via the Monte-Carlo balance pass.

`sim/stats.ts` — `deriveStats(attrs, attackKind)` sets `attackRange` by kind instead of the flat constant:
```
attackRange = melee:  MELEE_RANGE   (1)
              ranged: RANGED_RANGE  (4)
              magic:  MAGIC_RANGE   (3)
```
Everything else in `DerivedStats` is unchanged. **Melee keeps `attackRange = 1`** — this is what preserves the existing golden (§7).

---

## 5. Line-of-Sight (`sim/grid.ts`)

New export:
```ts
export function hasLineOfSight(from: Cell, to: Cell, isBlocked: (c: Cell) => boolean): boolean;
```

**Contract:** returns `true` iff no `blocked` cell lies on the supercover line **strictly between** `from` and `to` (the endpoints themselves are never tested — the attacker's and target's own cells don't block). Adjacent cells (no intermediate cells) are always clear. The walk is the integer DDA that visits every cell the segment from `from` to `to` passes through (`n = 1 + dx + dy` form, stepping along the larger error axis, stepping diagonally on an exact corner) — deterministic and **symmetric** under endpoint reversal. Integer-only; no floats, no `Math.sqrt`.

**Test cases (`sim/grid.test.ts`, exact geometry — they double as expectations):**
- Clear horizontal: `(0,0)→(4,0)`, no blocked ⇒ `true`.
- Wall blocks: `(0,0)→(4,0)`, blocked `{2,0}` ⇒ `false`.
- Adjacent always clear: `(0,0)→(1,0)` and `(0,0)→(1,1)` ⇒ `true` (no strictly-intermediate cells).
- Endpoint not tested: `(0,0)→(4,0)` with the *target* cell `{4,0}` blocked ⇒ `true` (only cells strictly between matter).
- Diagonal clear / blocked: `(0,0)→(3,3)` clear ⇒ `true`; blocked `{2,2}` ⇒ `false`.
- **Symmetry:** for several from/to pairs (incl. a wall case), `hasLineOfSight(a,b)===hasLineOfSight(b,a)`.

---

## 6. Movement + Attack Gate (`sim/tile-fight.ts`)

Introduce an "in attack position" predicate combining range and LoS:
```
inAttackPosition(actor, target) =
  chebyshev(actor.pos, target.pos) <= actor.derived.attackRange
  && hasLineOfSight(actor.pos, target.pos, grid.isBlocked)
```

- **Move loop:** advance toward the target while `!inAttackPosition(...)` and moves remain (replacing the current range-only stop test). So a ranged unit walled off from its target keeps closing until it either gains LoS or reaches a position from which it can shoot; the existing greedy `stepToward` + stuck-break is unchanged.
- **Attack:** resolve (hit → mitigation → crit, unchanged from Plan 3) only if `inAttackPosition(...)` after moving; otherwise the turn ends with no attack (no `miss` event — a `miss` is a rolled-and-failed hit, not an out-of-position turn).

**Melee is unaffected:** at `attackRange = 1` the target is adjacent, which has no strictly-intermediate cells, so LoS is always clear ⇒ `inAttackPosition` reduces to `chebyshev ≤ 1`, exactly Plan 3's behavior.

---

## 7. Determinism, Golden & Parity

- **The existing golden `86e238c1` is preserved.** The canonical fixture is all-melee; melee range stays `1` and melee LoS is always clear, so the melee fight is byte-identical to Plan 3. `sim/tile-fight.test.ts` and `sim/replay.test.ts` keep `86e238c1` — **no re-pin**.
- **Add a ranged parity fixture.** `tools/parity/fixtures.mjs` gains a second fixture: a ranged unit vs a target with a wall (`blocked` cell) on the line, on a small grid, with its own **captured** hash. `npm run parity` then asserts `V8 === goja` for *both* the melee and the ranged fixtures — broadening cross-runtime coverage (the deferred "more fixtures" fast-follow) and proving the new LoS/range integer math is goja-identical.
- All new math (`hasLineOfSight`, range selection) is integer; the parity gate is the guardrail.

---

## 8. Files & Testing

**Changed:**
- `shared/config.ts` — replace `ATTACK_RANGE` with `MELEE_RANGE`/`RANGED_RANGE`/`MAGIC_RANGE`.
- `sim/stats.ts` + `sim/stats.test.ts` — `attackRange` by kind; tests assert melee 1 / ranged 4 / magic 3.
- `sim/grid.ts` + `sim/grid.test.ts` — `hasLineOfSight` + the §5 test cases.
- `sim/tile-fight.ts` + `sim/tile-fight.test.ts` — the `inAttackPosition` gate; tests: a ranged unit hits a target from range with clear LoS (no need to close to adjacency); a wall between them blocks the shot until the unit repositions (it closes distance, the wall case yields a different outcome than the no-wall case); melee golden `86e238c1` still holds; determinism + no-mutation unchanged.
- `tools/parity/fixtures.mjs` — add the ranged/wall fixture (+ captured hash).

(No `DerivedStats` shape change, so `hash.test.ts`/`initiative.test.ts` are untouched this slice.)

---

## 9. Risks & Mitigations
- **LoS asymmetry / corner-peek surprises.** Mitigated by the supercover walk (symmetric, conservative) and an explicit symmetry test.
- **Cross-runtime divergence in the new integer math.** Mitigated by integer-only LoS + the new ranged parity fixture asserting V8 == goja.
- **Greedy `stepToward` can't always path around a wall to gain LoS.** Accepted for this slice (matches the existing simple stepper); the unit closes distance and may reach an in-LoS cell or melee range. Smarter pathing/kiting is deferred to Plan 6.
- **Balance (range values).** Tunable config; correctness does not depend on them.

## 10. Open Knobs (tune later, not gaps)
- `MELEE/RANGED/MAGIC_RANGE` values (Monte-Carlo balance pass); whether magic and ranged share a range.
- Whether units eventually block LoS (a later screen mechanic).
- Supercover vs a looser LoS once the richer terrain system lands.
