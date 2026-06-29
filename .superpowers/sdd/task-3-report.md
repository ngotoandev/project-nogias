## Task 3 Report: orderRetreat — exit-edge pullout

### What was implemented

**Types (`shared/types.ts`):**
- Added `export type Edge = 'N' | 'S' | 'E' | 'W';`
- `Unit` gains `retreating?: Edge` and `exited?: boolean`
- `FightResult.survivors` element gains `retreated?: boolean` (present, true, only on exited units)

**`MoveMode` (`sim/decide.ts`):** Added `'retreat'`

**`decideTurn` top-precedence branch (`sim/decide.ts`):**
- Before `cowardFlees`, added: `if (actor.retreating && !hasTrait(actor, 'bloodthirsty')) return { targetId: null, move: 'retreat', charge: false };`
- Bloodthirsty suppresses the retreat order (reuses Plan 6 flee-suppression pattern)

**Exited filters (`sim/decide.ts`):**
- `chooseTarget`: `u.hp > 0 && !u.exited && u.side !== actor.side`
- `nearestEnemy`: `u.hp > 0 && !u.exited && u.side !== actor.side`
- `cleaveTargets`: `u.hp > 0 && !u.exited && u.side !== actor.side`

**Exited filters (`sim/tile-fight.ts`):**
- `occupied`: `u.hp > 0 && !u.exited && u.id !== selfId`
- `sidesAlive`: `u.hp > 0 && !u.exited && u.side === 'A'/'B'`
- Lucky Fool `inPos` list: `x.hp > 0 && !x.exited && x.side !== actor.side`
- Flee enemy positions filter: `u.hp > 0 && !u.exited && u.side !== actor.side`

**Exited filters (`sim/initiative.ts`):**
- `nextActor` alive filter: `u.hp > 0 && !u.exited`

**`orderRetreat(state, unitId, exitEdge)` (`sim/tile-fight.ts`):**
- `const u = state.units.find(x => x.id === unitId); if (u) u.retreating = exitEdge;`

**Retreat movement in `stepFight`** (mirrors flee block, handles `intent.move === 'retreat'`):
- Computes nearest exit cell on actor's exit edge
- Steps toward it up to `moveRange` via `stepToward` + `canEnter`; emits `move` events; no attack
- After move loop: if actor is on the exit edge -> `actor.exited = true`
- Returns state immediately

**`fightResult` update:**
- `survivors: state.units.filter(u => u.hp > 0).map(u => u.exited ? {id, side, hp, retreated:true} : {id, side, hp})`

### TDD Evidence (RED -> GREEN)

**RED (before implementation):**
- `sim/decide.test.ts`: 4 failing (retreat branch not in `decideTurn`)
- `sim/tile-fight.test.ts`: 6 failing (`orderRetreat` not exported)

**GREEN (after implementation):**
- `sim/decide.test.ts`: 40/40 passed
- `sim/tile-fight.test.ts`: 38/38 passed
- Full suite: 137/137 passed
- Typecheck: clean (no errors)
- Parity: `PARITY OK (V8 === goja === expected) for 11 fixture(s)`

### Tests added

**`sim/decide.test.ts` - `decideTurn (retreat order)` describe block (5 tests):**
1. A retreating unit returns `move='retreat'` (no target)
2. Retreat intent has `targetId: null`
3. Retreat intent has `charge: false`
4. Bloodthirsty ignores a retreat order (engages instead)
5. Retreat has top precedence - fires before Coward flee AND Headstrong charge

**`sim/tile-fight.test.ts` - `orderRetreat` describe block (7 tests):**
1. An ordered unit moves toward exit edge (W) and exits as a retreated survivor
2. A retreating unit is hittable en route (enemy attacks/misses on retreating unit)
3. `orderRetreat` sets the `retreating` field on the unit
4. `orderRetreat` on unknown id is a no-op
5. Bloodthirsty unit ignores retreat order and engages instead
6. Non-retreating units are unaffected by exited filter (golden hash `86e238c1` preserved)
7. Exited survivor reported with `retreated:true`; on-field survivors omit the flag

### Files changed
- `shared/types.ts` - `Edge` type, `Unit.retreating`, `Unit.exited`, `FightResult.survivors.retreated`
- `sim/decide.ts` - `MoveMode` union, retreat top-precedence branch, `!u.exited` in 3 filters
- `sim/initiative.ts` - `!u.exited` in `nextActor` alive filter
- `sim/tile-fight.ts` - import `Edge`, `!u.exited` in 4 filters, `orderRetreat`, retreat movement block, `fightResult` update
- `sim/decide.test.ts` - 5 new retreat tests
- `sim/tile-fight.test.ts` - import `orderRetreat`, 7 new retreat tests

### Determinism / Anchor preservation
- No RNG added (retreat movement is deterministic)
- `!u.exited` is vacuously true when `exited` is `undefined` -> all existing fights unaffected
- Retreat branch in `decideTurn` only triggers when `actor.retreating` is set -> inert for all existing tests
- Canonical `86e238c1` preserved: explicitly verified in golden hash test AND confirmed by parity gate (11 fixtures, V8===goja)

### Self-review
- All behaviors from the spec implemented: top-precedence, Bloodthirsty suppression, edge cell computation, exit detection, hittable en route (enemies chase and attack), `retreated:true` in survivors
- The `sidesAlive` update means a retreated unit no longer counts toward its side being alive - intentional per design (exited units leave the field)
- Hittable scenario: 'a' starts at x=7 retreating W, 'b' has agi=9 (faster), so 'b' attacks first each turn while 'a' moves toward x=0; verified 'b' lands hits/misses on 'a' before it exits
- No new parity fixture needed for Task 3 (Task 4 brief notes fixtures land there)

---

## Review-fix addendum (test-only)

### Findings addressed

**Finding 1 — De-guard vacuously-green assertion** (`sim/tile-fight.test.ts`, test "exits as a retreated survivor"):

Removed the `if (state.outcome) { … }` guard that allowed the test to pass silently when the step loop (≤500 steps) ended without the fight concluding. The fixed assertion sequence is:
1. `expect(unitA?.exited).toBe(true)` — unit exited the field
2. `expect(state.outcome).toBeTruthy()` — fight MUST have concluded (once 'a' exits, only side B remains; `sidesAlive` drops to 1 and the engine sets `state.outcome`)
3. `expect(survivor).toBeDefined()` + `expect(survivor?.retreated).toBe(true)` — unconditional retreated-survivor check

If the retreat logic were broken and the fight failed to conclude within 500 steps, `expect(state.outcome).toBeTruthy()` now fails the test immediately instead of silently passing.

**Finding 2 — Remove dead code block** (`sim/tile-fight.test.ts`):

Deleted the leftover empty `if (!state.outcome) { // finalize manually is not exposed; just check unit state }` block that served no purpose and added noise.

### Verification
- `npx vitest run sim/tile-fight.test.ts`: 38/38 passed
- `npm test`: 137/137 passed
- `npm run typecheck`: clean
- `npm run parity`: `PARITY OK (V8 === goja === expected) for 11 fixture(s)`, canonical `86e238c1` preserved
