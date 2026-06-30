# Conquest-Map ↔ Tile-Fight Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the map's `advance` drive `stepFight` at contested tiles — open a battle (attacker armies vs garrison, gate→cell deploy, derived seed), step it on the map clock, `joinFight` reinforcements, `orderRetreat` on map-retreat, and apply the outcome (capture/hold) with HP-carrying attrition.

**Architecture:** Extend `sim/conquest-map.ts` (the ONE place the map may import the fight engine) to open/drive/resolve battles using Plan 1's `FightState`/`initFight`/`stepFight`/`joinFight`/`orderRetreat`/`fightResult`. Units carry HP on the map via an opt-in `UnitSpec.startHp`; standalone fights are byte-identical so the anchor stays frozen. `MapState` relocates to `sim/conquest-map.ts` (it now holds `FightState`s).

**Tech Stack:** TypeScript (strict, ES2015), Vitest, esbuild bundle, goja parity runner. Sim is pure / integer-only / goja-safe.

## Global Constraints

- **Parity-critical** (`/sim`, `/shared`): integer math only — no floats, no `Math.sqrt`, no `Math.random`, no `Date`, no Node APIs. Seeded RNG via `makeRng` only; fights draw RNG, the map's command/travel logic does not.
- **Anchor frozen:** `UnitSpec.startHp` is opt-in; `specToUnit` falls back to `maxHp`, so standalone fights are byte-identical → `canonical-baseSetup-seed42` stays `86e238c1` and all **13 standalone-fight fixtures** stay green. The conquest engine draws RNG only via the fights it spawns (new conquest-fight fixtures).
- **Army↔fight-unit identity:** a fight unit built from an army carries id `` `${army.id}#${unit.id}` ``; a garrison unit `` `garrison#${unit.id}` ``. Attacker units → side `A`, garrison → side `B`. Reconciliation parses the `#` prefix. Army ids and within-army unit ids are unique.
- **Determinism:** battles iterated/kept sorted by tile id; the per-fight determinism is Plan 1's; `fightSeed(seed, tileId)` is a pure integer mix; deploy positions are distinct + deterministic. `hashMap` folds in army rosters + per-unit HP + each active battle's `hashFight`.
- **Per-task green gate:** Plan 2's `conquest-contested-seed0` fixture asserts the now-obsolete inert seam — **remove it in Task 2** (the first task that makes a defended tile fight). `conquest-capture-seed0` (fight-free) + the 13 fight fixtures stay green throughout; the new conquest-fight fixtures are added in Task 7.
- **Engine direction:** only `sim/conquest-map.ts` imports the fight engine (`tile-fight`); the fight engine never imports the map.
- **Commits:** end every message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

### Standard commands (every task)
- Focused: `npx vitest run sim/conquest-map.test.ts` (and `sim/tile-fight.test.ts` for Task 1)
- Full: `npm test` (currently 173 tests); Types: `npm run typecheck`
- Parity (full): `export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity` → 13 fight + `conquest-capture-seed0` green (canonical `86e238c1`); fixture count drops by 1 in Task 2 (contested removed) and rises by 2 in Task 7.

### Fixture capture (Task 7): add `{name, expectedHash:'PENDING', bundle:{version:3,…}}` → `npm run parity` prints the actual V8 hash → set it → re-run full parity; confirm the 13 fight hashes unchanged.

---

## File Structure

- **Modify `shared/types.ts`** — `UnitSpec.startHp?: number`; **remove `MapState`** (relocates to `sim/conquest-map.ts`); add `MapEvent` variants (`battleOpened`/`reinforced`/`repelled`); `Army.gate?: MapEdge`. (`MapTile`/`Army`/`MapSetup`/`MapCommand`/`MapEvent`/`ConquestBundle` stay — none reference `FightState`.)
- **Modify `shared/config.ts`** — `STEPS_PER_MAP_TICK`, `DEFAULT_FIGHT_GRID`.
- **Modify `sim/tile-fight.ts`** — `specToUnit` honors `startHp`.
- **Modify `sim/conquest-map.ts`** — define+export `MapState` (now with `battles: MapBattle[]`) + `MapBattle`; `applyDispatch` records `army.gate`; `resolveArrival` opens/joins battles; the battle-step phase in `advance`; outcome reconciliation; retreat-mid-battle; `gate`/`deployUnits`/`fightSeed`/`reconcileArmy`; extend `hashMap`. Imports `FightState`/`initFight`/`stepFight`/`joinFight`/`orderRetreat`/`fightResult` from `./tile-fight`.
- **Modify `sim/replay.ts`** — import `MapState` (if named) from `./conquest-map`; extend `runScriptedConquest` quiescence to include active battles.
- **Modify `tools/parity/fixtures.mjs`** — remove `conquest-contested-seed0` (Task 2); add 2 conquest-fight fixtures (Task 7).
- Co-located tests.

---

## Task 1: Fight-engine `startHp`

**Files:** Modify `shared/types.ts`, `sim/tile-fight.ts`; Test `sim/tile-fight.test.ts`.

**Interfaces — Produces:** `UnitSpec.startHp?: number` (optional entry HP, clamped `[1, maxHp]`; absent ⇒ `maxHp`). `specToUnit`/`initFight`/`joinFight` honor it.

- [ ] **Step 1: Failing test** (`sim/tile-fight.test.ts`)
```ts
import { initFight, runTileFight } from './tile-fight';
it('a unit enters at startHp (clamped to [1,maxHp]); absent ⇒ full', () => {
  const setup = { grid: { width: 3, height: 1, blocked: [] }, units: [
    { id: 'a', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 }, startHp: 7 },
    { id: 'b', side: 'B', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 2, y: 0 } },
  ] } as const;
  const s = initFight(setup as any, 1);
  expect(s.units.find(u => u.id === 'a')!.hp).toBe(7);                 // startHp honored
  expect(s.units.find(u => u.id === 'b')!.hp).toBe(s.units.find(u=>u.id==='b')!.derived.maxHp); // absent ⇒ full
});
it('startHp is clamped to [1, maxHp]', () => { /* startHp: 9999 → maxHp; startHp: 0 → 1 */ });
it('a no-startHp fight is byte-identical (golden 86e238c1 held by the existing golden test + parity)', () => {
  // (the existing golden/parity tests are the real guard; this asserts the canonical setup still hashes 86e238c1)
});
```

- [ ] **Step 2: Run** → FAIL (`startHp` not on `UnitSpec` / not honored).

- [ ] **Step 3: Implement** — `shared/types.ts`: add `startHp?: number;` to `UnitSpec`. `sim/tile-fight.ts` `specToUnit`:
```ts
function specToUnit(u: UnitSpec): Unit {
  const derived = deriveStats(u.attrs, u.attackKind);
  const hp = u.startHp === undefined ? derived.maxHp : Math.max(1, Math.min(derived.maxHp, u.startHp));
  return { id: u.id, side: u.side, attrs: { ...u.attrs }, priority: u.priority,
    pos: { x: u.pos.x, y: u.pos.y }, hp, derived, gauge: 0, mana: 0, skill: u.skill,
    traits: u.traits ?? [], kills: 0, stallSinceTick: -1, fleeingSinceTick: -1,
    temperament: u.personality?.temperament };
}
```
(Only the `hp` line changes — `initFight`/`joinFight` call `specToUnit` so both honor it. `cloneSpec` in conquest-map already spreads `...u`, carrying `startHp`.)

- [ ] **Step 4: Verify + commit** — focused + `npm test` + typecheck + FULL parity (`86e238c1` + all 13 fight fixtures + `conquest-capture` unchanged).
```bash
git commit -m "$(cat <<'EOF'
feat(sim): opt-in UnitSpec.startHp — units enter a fight at carried HP
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Relocate `MapState` + battle state + open a battle

**Files:** Modify `shared/types.ts`, `shared/config.ts`, `sim/conquest-map.ts`, `sim/replay.ts`, `tools/parity/fixtures.mjs`; Test `sim/conquest-map.test.ts`.

**Interfaces — Produces:**
```ts
// sim/conquest-map.ts (MapState MOVED here; it now holds FightStates)
export interface MapBattle { tile: string; fight: FightState; }
export interface MapState { tiles: MapTile[]; armies: Army[]; totalTicks: number; events: MapEvent[]; seed: number; battles: MapBattle[]; }
// shared/types.ts: Army gains `gate?: MapEdge`; remove MapState; add MapEvent variants:
//   | { t: 'battleOpened'; tile: string; attackers: string[] }
//   | { t: 'reinforced'; tile: string; armyId: string }
//   | { t: 'repelled'; tile: string }
// shared/config.ts: export const STEPS_PER_MAP_TICK = 4; export const DEFAULT_FIGHT_GRID = { width: 8, height: 8, blocked: [] };
```

- [ ] **Step 1: Relocate `MapState`** — cut `MapState` from `shared/types.ts`; define+export it in `sim/conquest-map.ts` with the added `seed: number` + `battles: MapBattle[]`. `initConquest(setup, seed = 0)` gains a seed param (default `0` keeps existing callers/tests green) and returns `{ …, seed, battles: [] }`; `runScriptedConquest` calls `initConquest(bundle.setup, bundle.seed)`. Update the `MapState` import in `sim/replay.ts` / any test to `./conquest-map`. Add `Army.gate?: MapEdge` (shared) + the 3 `MapEvent` variants. Add the config consts. Run `npm test` + typecheck → green (pure relocation + additive fields).

- [ ] **Step 2: Record `army.gate` in `applyDispatch`** — after `army.route = route`:
```ts
const launchId = route.length >= 2 ? route[route.length - 2] : army.tile; // owned tile adjacent to toTile
army.gate = gateOf(toTile, launchId);
// helper:
function gateOf(tile: MapTile, launchId: string): MapEdge {
  for (const e of EDGES) if (tile.neighbors[e] === launchId) return e;
  throw new Error(`gateOf: ${launchId} is not a neighbor of ${tile.id}`);
}
```

- [ ] **Step 3: Failing tests** — a defended arrival opens a battle (right sides/ids/deploy/seed); `army.gate` recorded.
```ts
it('dispatch records the army gate (edge of target facing the launch tile)', () => { /* dispatch a1→t2 via t1(W of t2) ⇒ a1.gate==='W' */ });
it('arriving at a DEFENDED tile opens a battle: attacker units side A (ids armyId#unit), garrison side B, battleOpened event', () => {
  // build map; advance the dispatched army to t2 (garrison present); assert state.battles has one entry for t2,
  // its fight.units include `a1#a1u` (side A) and `garrison#g1` (side B), army a1.state==='contested',
  // and a battleOpened event fired. (No stepping yet — Task 3.)
});
```

- [ ] **Step 4: Implement open-battle** — `resolveArrival` defended branch (replace the inert seam):
```ts
// helpers (deterministic, integer):
function fightSeed(seed: number, tileId: string): number {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  for (let i = 0; i < tileId.length; i++) h = Math.imul(h ^ tileId.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}
// deployUnits: place each attacker army's units along its gate edge, garrison along the interior/opposite,
// at DISTINCT cells (no two units share an initial cell), deterministically by index. Armies are small
// (≤ edge length on the 8×8 default grid), so a per-edge running index gives distinct cells; same-gate
// stacking ("stack-then-disperse") is a documented later knob.
function buildFightSetup(state, tile, attackerArmies, seedBundle): { setup: FightSetup; } { /* see below */ }
```
The defended branch (no active battle for this tile yet): gather the contested attacker armies (`a.target===tile.id && a.state==='contested'` — includes the just-arrived one), build a `FightSetup`:
- grid = `DEFAULT_FIGHT_GRID`.
- attacker units: for each army, for each `u` in `army.units`, `{ id:`${army.id}#${u.id}`, side:'A', attackKind:u.attackKind, attrs:u.attrs, skill:u.skill, traits:u.traits, personality:u.personality, priority:u.priority, startHp:u.startHp, pos: deployCell(army.gate!, grid, k) }` (k = running index on that gate edge).
- garrison units: for each `g` in `tile.garrison`, `{ id:`garrison#${g.id}`, side:'B', …, startHp:g.startHp, pos: <interior/opposite cell, distinct> }`.
Then `const fight = initFight(setup, fightSeed(bundleSeed, tile.id)); state.battles.push({ tile: tile.id, fight });` (keep `battles` sorted by tile id). Emit `{ t:'battleOpened', tile:tile.id, attackers: attackerArmies.map(a=>a.id).sort() }`. The arriving army stays `state:'contested'`.

**(The `bundleSeed`** must reach `advance`/`resolveArrival`. Thread it: `advance(state, commands, seed)` gains a `seed` param? — No; keep `advance(state, commands)` and store `seed` on `MapState` at `initConquest` (add `seed: number` to `MapState`, set from a new `initConquest(setup, seed=0)` param; `runScriptedConquest` passes `bundle.seed`). `fightSeed(state.seed, tile.id)`.)

- [ ] **Step 5: Remove the obsolete fixture** — delete `conquest-contested-seed0` from `tools/parity/fixtures.mjs` (its inert behavior is gone). `conquest-capture-seed0` + 13 fight fixtures remain.

- [ ] **Step 6: Verify + commit** — focused tests; `npm test`; typecheck; full parity (now 14 fixtures: 13 fight + conquest-capture; all green, `86e238c1` held).
```bash
git commit -m "feat(sim): relocate MapState + open a battle at contested tiles (gate→cell deploy, derived seed) …"  # + trailer
```

---

## Task 3: Drive battles (step per map tick)

**Files:** Modify `sim/conquest-map.ts`, `sim/replay.ts`; Test `sim/conquest-map.test.ts`.

**Interfaces — Consumes:** `stepFight` (`./tile-fight`), `STEPS_PER_MAP_TICK`. Produces: the battle-step phase in `advance`; `runScriptedConquest` quiescence includes active battles.

- [ ] **Step 1: Failing tests** — a battle advances over ticks and reaches `outcome` (application is Task 4).
```ts
it('advance steps active battles by STEPS_PER_MAP_TICK; a one-sided battle reaches an outcome', () => {
  // open a battle (strong attacker vs weak garrison); advance several ticks;
  // assert the battle's fight.outcome becomes non-null (winner 'A'). Do NOT assert capture (Task 4).
});
```

- [ ] **Step 2: Implement** — in `advance`, AFTER the travel phase, BEFORE `totalTicks++`: for each battle in `state.battles` (tile-id order), `for (let k=0; k<STEPS_PER_MAP_TICK && !b.fight.outcome; k++) stepFight(b.fight);`. (Outcome application — capture/hold/remove — is Task 4; here a resolved battle just has `outcome` set and stays in `battles`.) In `sim/replay.ts` `runScriptedConquest`, extend the quiescence/`pending()` check so a state with any **active battle** (`state.battles.some(b => !b.fight.outcome)`) is NOT quiescent (the run keeps advancing until battles resolve).

- [ ] **Step 3: Verify + commit** (focused/suite/typecheck/parity — 14 fixtures unchanged).
```bash
git commit -m "feat(sim): drive active battles STEPS_PER_MAP_TICK per map tick …"  # + trailer
```

---

## Task 4: Outcome + HP-carrying attrition

**Files:** Modify `sim/conquest-map.ts`; Test `sim/conquest-map.test.ts`.

**Interfaces — Produces:** `reconcileArmy(army, fight)`; outcome application (capture/hold) after stepping, in `advance`.

- [ ] **Step 1: Failing tests**
```ts
it('attacker win: tile captured, surviving attacker army garrisons with carried HP, dead units dropped, slot freed', () => {
  // strong attacker vs weak garrison; advance to resolution; assert: tile.owner==='player',
  // army a1.state==='garrisoned' on the tile, a1.units = survivors (count reduced if any died) with
  // startHp set to their post-fight hp, committedCount(tile)===0, captured event.
});
it('defender win: attacker army removed, garrison survivors persist (attrited), tile stays enemy', () => {
  // weak attacker vs strong garrison; advance; assert a1 removed from state.armies, tile.owner==='enemy',
  // tile.garrison = surviving side-B units with carried startHp, repelled event.
});
```

- [ ] **Step 2: Implement** — after the battle-step loop in `advance`, for each battle with `b.fight.outcome` set: apply the outcome, then remove the battle from `state.battles`.
```ts
function reconcileArmy(army: Army, fight: FightState): void {
  const survivors: UnitSpec[] = [];
  for (const u of army.units) {
    const fu = fight.units.find((f) => f.id === `${army.id}#${u.id}`);
    if (fu && fu.hp > 0) survivors.push({ ...u, startHp: fu.hp }); // carry HP
  }
  army.units = survivors;
}
// outcome application:
const tile = tileById(state, b.tile)!;
const attackers = state.armies.filter((a) => a.target === b.tile && a.state === 'contested');
const winner = b.fight.outcome!.winner;
if (winner === 'A') {
  for (const army of attackers) { reconcileArmy(army, b.fight); }
  // capture (reuse Plan 2 capture semantics): owner→player; surviving armies garrison the tile
  tile.owner = 'player';
  tile.garrison = []; // garrison wiped
  for (const army of attackers) {
    if (army.units.length === 0) { remove army from state.armies; }
    else { army.state = 'garrisoned'; army.tile = b.tile; army.target = undefined; army.gate = undefined; army.route = undefined; }
  }
  state.events.push({ t: 'captured', tile: b.tile, by: attackers[0]?.id ?? '-' });
} else {
  // defender win (B) or timeout → defender holds: attackers removed; garrison = surviving side-B units
  for (const army of attackers) { remove army from state.armies; } // their units died
  tile.garrison = b.fight.units.filter((f) => f.side === 'B' && f.hp > 0)
    .map((f) => garrisonSpecFromFightUnit(f)); // strip the `garrison#` prefix back to a UnitSpec, startHp=f.hp
  state.events.push({ t: 'repelled', tile: b.tile });
}
// remove the resolved battle
state.battles = state.battles.filter((x) => x !== b);
```
(`garrisonSpecFromFightUnit` rebuilds a `UnitSpec` from a side-B fight unit: id = the part after `garrison#`, attrs/attackKind/etc. carried, `startHp = f.hp`. Keep the tile's original garrison specs around to copy non-fight fields, or rebuild from the fight unit's stored fields — the implementer picks the clean approach; the FightState `Unit` has `attrs`/`skill`/`traits`/`temperament`, enough to reconstruct.) Removing an army: filter `state.armies`. Iterate battles over a snapshot since the loop mutates `state.battles`.

- [ ] **Step 3: Verify + commit** (focused/suite/typecheck/parity — 14 unchanged).
```bash
git commit -m "feat(sim): battle outcome — capture/hold + HP-carrying attrition + free slots …"  # + trailer
```

---

## Task 5: Continuous join (reinforcement)

**Files:** Modify `sim/conquest-map.ts`; Test `sim/conquest-map.test.ts`.

**Interfaces — Consumes:** `joinFight` (`./tile-fight`).

- [ ] **Step 1: Failing test**
```ts
it('an army arriving at an already-battling tile joinFights its units (side A, carried HP, its gate), reinforced event', () => {
  // open a battle at t2 with a1; dispatch a2 (from a different owned neighbor → different gate) to t2;
  // advance until a2 arrives; assert the live battle's fight.units now include a2#… (side A) and a a2.state==='contested',
  // and a reinforced event fired. committedCount(t2) includes both (≤ MAX_COMMIT).
});
```

- [ ] **Step 2: Implement** — in `resolveArrival`'s defended branch, FIRST check for an active battle: `const battle = state.battles.find(b => b.tile === tile.id);` If present → `joinFight(battle.fight, <army's units as side-A specs at carried HP, deployCell(army.gate!, grid, k)>)`; `army.state='contested'`; emit `{ t:'reinforced', tile:tile.id, armyId:army.id }`. Else → open a new battle (Task 2). (Same `${army.id}#${unit.id}` ids + `startHp` from the army's units. The grid is the battle's existing grid.)

- [ ] **Step 3: Verify + commit** (focused/suite/typecheck/parity — 14 unchanged).
```bash
git commit -m "feat(sim): continuous reinforcement — arriving armies joinFight the live battle …"  # + trailer
```

---

## Task 6: Retreat mid-battle

**Files:** Modify `sim/conquest-map.ts`; Test `sim/conquest-map.test.ts`.

**Interfaces — Consumes:** `orderRetreat` (`./tile-fight`); `reconcileArmy` (Task 4).

- [ ] **Step 1: Failing test**
```ts
it('Retreat of a contesting army orders its fight units out; once all exit it returns to owned soil with survivors, slot freed', () => {
  // open a battle at t2 with a1 (durable enough to survive); Retreat a1; advance;
  // assert a1's fight units get `retreating` set, eventually exit, a1 reconstitutes (survivors, carried HP),
  // returns toward owned territory and ends 'garrisoned', committedCount(t2)===0, slotFreed event.
});
```

- [ ] **Step 2: Implement** — extend `applyRetreat`: if the army is `'contested'` AND in an active battle (`battles.find(b=>b.tile===army.target)`), for each of the army's fight units still active (`hp>0 && !exited`), `orderRetreat(battle.fight, `${army.id}#${u.id}`, army.gate!)`; free the slot (`army.target` kept until it leaves — OR free now and track via a `retreatingFrom`? simplest: keep `target` until full-exit so the battle's attacker set still includes it while its units pull out, then free on leave). Add a **post-step check** in `advance` (after the battle-step loop, before outcome): for each active battle, for each `'contested'` army targeting it that was retreat-ordered, if all its fight units are `exited || hp<=0` → `reconcileArmy` (keeps `hp>0` exited survivors, drops dead), set `army.state='retreating'`, route back to an owned neighbor (Plan-2 retreat: `route=[ownedNeighborIds(state, tile)[0]]`), `army.target=undefined`, emit `slotFreed`; if it has zero survivors, remove it. (A retreat-ordered army is marked, e.g. `army.gate` stays + a `retreatOrdered` transient flag, so the post-step check distinguishes "ordered out" from "died in combat"; the implementer adds the minimal flag.)

- [ ] **Step 3: Verify + commit** (focused/suite/typecheck/parity — 14 unchanged).
```bash
git commit -m "feat(sim): retreat mid-battle — orderRetreat fight units, return survivors to the map …"  # + trailer
```

---

## Task 7: `hashMap` extension + fixtures

**Files:** Modify `sim/conquest-map.ts`, `tools/parity/fixtures.mjs`; Test `sim/conquest-map.test.ts`, `sim/replay.test.ts`.

- [ ] **Step 1: Extend `hashMap`** — fold in army rosters + per-unit HP + active-battle fight hashes:
```ts
export function hashMap(state: MapState): string {
  const tilePart = [...state.tiles].sort(byId).map((t) => `${t.id}:${t.owner}:${t.garrison.map(g=>`${g.id}@${g.startHp ?? deriveStats(g.attrs,g.attackKind).maxHp}`).join('/')}`).join(',');
  const armyPart = [...state.armies].sort(byId).map((a) =>
    `${a.id}:${a.tile}:${a.state}:${a.target ?? '-'}:${a.units.map(u=>`${u.id}@${u.startHp ?? deriveStats(u.attrs,u.attackKind).maxHp}`).join('/')}`).join(',');
  const battlePart = [...state.battles].sort((x,y)=>x.tile<y.tile?-1:x.tile>y.tile?1:0)
    .map((b) => `${b.tile}=${hashFight(b.fight.units, b.fight.totalTicks)}`).join(',');
  return fnv1a(`${tilePart}#${armyPart}#${battlePart}#${state.totalTicks}`);
}
```
(`byId` = the existing id comparator. Import `hashFight` from `./hash`. Unit HP via `startHp ?? maxHp`.)

- [ ] **Step 2: Failing tests** (`sim/replay.test.ts`) — a full dispatch→fight→capture scenario; defender-holds scenario. Each asserts a specific captured hash (pin it).
```ts
it('runScriptedConquest: dispatch → travel → fight → CAPTURE (deterministic hash)', () => {
  const r = runScriptedConquest({ version: 3, seed: 1, setup: mapStrongAttackerVsWeakGarrison,
    script: [{ atTick: 0, commands: [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }] }] });
  expect(r.hash).toBe('<captured>'); // pinned after capture; fails on a no-op/wrong outcome
});
it('runScriptedConquest: defender holds (weak attacker repelled)', () => { /* assert pinned hash */ });
```

- [ ] **Step 3: Add 2 v3 parity fixtures** (`tools/parity/fixtures.mjs`, capture procedure): `conquest-fight-capture-seedN` (attacker takes a defended tile) and `conquest-fight-hold-seedN` (defender repels). Capture hashes; confirm the 13 fight fixtures + `conquest-capture-seed0` unchanged.

- [ ] **Step 4: Verify + commit** — `npm test`; typecheck; full parity **16 fixtures** (13 fight + conquest-capture + 2 conquest-fight), V8===goja, `86e238c1` held.
```bash
git commit -m "feat(sim): hashMap folds in rosters/HP + battle hashes; conquest-fight parity fixtures …"  # + trailer
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** startHp (T1) ✓; relocate MapState + battles + Army.gate + open-battle + remove obsolete fixture (T2) ✓; drive battles + quiescence (T3) ✓; outcome + HP-carry attrition (T4) ✓; continuous join (T5) ✓; retreat mid-battle (T6) ✓; hashMap + seed + parity (T7) ✓. Anchor-frozen + per-task-green throughout ✓; identity convention `${armyId}#${unitId}` used in T2/T4/T5/T6 ✓.
- **Type consistency:** `MapState` (now in conquest-map.ts, with `seed`+`battles`), `MapBattle`, `UnitSpec.startHp?`, `Army.gate?`, `gateOf`/`fightSeed`/`deployUnits`/`reconcileArmy` introduced once and reused; `STEPS_PER_MAP_TICK`/`DEFAULT_FIGHT_GRID` consts; the new `MapEvent`s.
- **Placeholders:** `deployUnits` placement formula + the `retreatOrdered` flag are described with their invariants (distinct/deterministic cells; flag distinguishes ordered-out from died) rather than pasted line-by-line — the implementer finalizes them and the parity fixtures pin the hashes. `<captured>`/`PENDING` are capture sentinels (T7).
- **Determinism:** `startHp` opt-in (anchor frozen); fights seeded by `fightSeed(state.seed, tileId)`; battles iterated/sorted by tile id; `hashMap` folds in rosters/HP + battle hashes; `conquest-contested-seed0` removed in T2 (per-task green), conquest-fight fixtures added in T7. Only `conquest-map.ts` imports the fight engine.
