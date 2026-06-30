# Task 2 Report: Generalized battle outcome — `attackerOwner` branch

## Commit
**SHA:** `a9e128f`
**Subject:** `feat(sim): generalized battle outcome — tile flips to attackerOwner (lethal enemy win)`

## What was done

### `sim/conquest-map.ts` — outcome-application loop refactored

**Player branch wrap (verbatim):** In `advance`'s outcome-application loop the existing two sub-branches (winner=A capture + winner=B repel) were wrapped in `if (b.attackerOwner === 'player') { … }`. `const attackers` moved inside this block; `const winner` hoisted above the branch (shared by both paths). The player-branch code is byte-for-byte identical to the prior implementation — behavior-preserving refactor.

**Enemy WIN path (`winner === 'A'`):** `tile.owner = 'enemy'`; surviving side-A fight units iterated via `f.id.slice('garrison#'.length)` to recover the original id; matched against `b.attackerGarrison` (stashed by Task 1 `openSortie`) to recover `attackKind` and attrs; `startHp = f.hp` set from fight survivor; `tile.garrison = newGarrison`; defender armies (`state.armies.filter(a => a.target === b.tile && a.state === 'contested')`) spliced from `state.armies`; `{ t: 'captured', tile, by: '-' }` event pushed.

**Enemy REPEL path (`winner !== 'A'`):** For each defender army, `reconcileArmy(army, b.fight)` called (matches `${army.id}#${u.id}` fight ids); armies with 0 survivors removed from `state.armies`; survivors set `state='garrisoned'`, `target/gate/route = undefined`; `{ t: 'repelled', tile }` event pushed. Enemy source garrison was already emptied by `openSortie` (Task 1) — no cleanup needed here.

### `sim/conquest-map.test.ts` — 2 new tests

- `enemy sortie WIN: tile flips to enemy, attacker garrison installed, defender army destroyed`
- `enemy sortie REPELLED: tile stays player, defender holds (attrited), attacker discarded`

### Files untouched
`run.ts`, `shared/types.ts`, `tile-fight.ts`, `replay.ts` — not modified. `buildFightSetup` and `hashMap` untouched; `hashMap` still folds only `b.tile + hashFight(...)`.

## TDD Sequence

**RED:** Added both tests before any implementation. WIN failed (`expected 'player' to be 'enemy'`); REPEL threw `reconcileGarrison: no original spec found for garrison unit id ''` — both failing for the correct reason (enemy battles fell into the player branch).

**GREEN:** Wrapped existing code + added enemy block. Both tests passed.

## Gate Results
- `npx vitest run sim/conquest-map.test.ts`: **34/34 passed** (+2 new)
- `npm test`: **220/220 passed** (218 prior + 2 new)
- `npm run typecheck`: **clean**
- `npm run parity`: **PARITY OK — 23 fixtures, `86e238c1` + all unchanged**

## Fix: test strengthening

### What was changed (test-only, `sim/conquest-map.test.ts`)

**WIN test** — scenario unchanged (3×str20 enemy vs 1×str1 defender). Added:
- `expect(g1.attackKind).toBe('melee')` — proves `attackKind` restored from `attackerGarrison`, not lost from fight `Unit`
- `expect(g1.startHp).toBe(116)` — exact surviving hp carried (not reset to full); g1 took 4 hp of damage before the weak defender died
- `expect(g1.startHp!).toBeLessThan(120)` — strictly below maxHp (str=20 → 20+20×5=120), proving attrition not reset

**REPEL test** — scenario **changed**: the weak `str=1` attacker couldn't damage the str=20 defenders (all survived at max), so no attrition was observable. Replaced with 2×`str=15` enemy sortieing garrison vs 3×`str=12` defenders (maxHp=80), which delivers enough enemy damage to attrit survivors. Added:
- `expect(dArmy.target).toBeUndefined()` — routing state cleared
- `expect(dArmy.gate).toBeUndefined()` — gate cleared
- `expect(dArmy.route).toBeUndefined()` — route cleared
- `expect(d2.startHp).toBe(56)` — exact surviving hp carried via `reconcileArmy` (d1 killed, d2 at 56, d3 at 80)
- `expect(d2.startHp!).toBeLessThan(80)` — strictly below maxHp, proving attrition carried

### Genuineness verification (sabotage→fail→revert→pass)

Three sabotages applied one at a time to `sim/conquest-map.ts`, each confirmed the new assertions FAIL with the expected message, then reverted:

1. **Strip `attackKind`**: changed `newGarrison.push({ ...og, startHp: f.hp })` to spread `attackKind: undefined as any` → WIN test failed `AssertionError: expected undefined to be 'melee'`
2. **Drop `startHp`**: changed to `newGarrison.push({ ...og })` (no `startHp`) → WIN test failed `AssertionError: expected undefined to be 116`
3. **Skip `reconcileArmy`**: replaced `for (const army of playerArmies) reconcileArmy(army, b.fight)` with a no-op comment → REPEL test failed `AssertionError: expected undefined to be 56`

All three reverted; production code is byte-for-byte what commit `a9e128f` left.

### Gate results

- **Focused:** `npx vitest run sim/conquest-map.test.ts` → **34/34 passed** (all green, assertions strengthened)
- **Full:** `npm test` → **220/220 passed** (test-only change; count +3 vs memory due to run-test suite additions)
- **Types:** `npm run typecheck` → **clean**
- **Parity:** `npm run parity` → **PARITY OK — 23 fixtures, `86e238c1` unchanged** (test-only, no hash impact)

### Production code unchanged

`sim/conquest-map.ts` is byte-for-byte commit `a9e128f` after sabotage reverts. No `attackKind`, `startHp`, or any other field added to `hashMap`. All 23 parity fixtures frozen.

## Self-Review
- Player branch is verbatim → no behavior change for any existing replay; parity frozen at 23/`86e238c1`.
- Enemy branch not triggered by any fixture (no `openSortie` in any replay path until Task 3).
- `attackerGarrison` stash is the only source of `attackKind` for the enemy win path — the fight `Unit` loses it after `initFight` (values merged into `derived`); Task 1's stash is essential.
- Defender-army identification (`target === b.tile && state === 'contested'`) mirrors `openSortie`'s own marking — correct by construction.
