# Enemy Mobile Armies (v1 — march & strike) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map-authored enemy armies that march across enemy-held ground to the nearest player tile and assault it — reusing the enemy-attacker battle layer, visible to the pacing selector, without disturbing player mechanics or the frozen fixtures.

**Architecture:** A separate `state.enemyArmies: Army[]` (player invariants untouched). A new `advanceEnemyArmies` phase inside `advance()` selects the nearest player tile via BFS over enemy ground, travels on the existing tempo model, and on arrival opens an `attackerOwner:'enemy'` battle by generalizing `openSortie` (attacker = the army's units). `hasPendingActivity` and `hashMap` fold `enemyArmies` additively.

**Tech Stack:** TypeScript (goja-safe sim), vitest, esbuild IIFE bundle, Go/goja parity harness, vanilla-JS canvas viz.

## Global Constraints

- Deterministic + goja-safe: integer-only, RNG-free decision layer, NO `Date.now()`/`Math.random()`; total-order iteration (id sorts, fixed N/S/E/W edge order).
- **Additive / frozen:** `enemyArmies` absent/empty ⇒ every existing state behaves and hashes byte-identically. **Anchor `86e238c1` + all 26 parity fixtures MUST stay frozen.** Gate: `export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity`.
- **`hashMap` fold is EMPTY-GUARDED:** append an enemy-army segment ONLY when `state.enemyArmies.length > 0`, so the hash string for enemy-army-free states is unchanged.
- **Player mechanics untouched:** `isLost` (=`state.armies.length===0`), `committedCount`, `defended`, `MAX_COMMIT`, player travel/arrival/outcome — no behavior change.
- **`openSortie` refactor is behavior-preserving:** the garrison-sortie path stays byte-identical (frozen `run-sortie-*`/`run-hold` fixtures).
- **v1 concurrency = WAIT (sequential), not join** (spec §3): an enemy army arriving where a battle already exists waits and retries; disbands if the target already flipped; takes an undefended target fight-free.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- `shared/types.ts` — `MapSetup.enemyArmies?` (same element shape as `armies`).
- `sim/conquest-map.ts` — `MapState.enemyArmies`; `initConquest` builds it; `hasPendingActivity` + `hashMap` folds; `openSortie`→shared `openEnemyAttack` refactor; `nearestPlayerAssault` BFS; `advanceEnemyArmies` phase; `enemyArmyAssault` + `removeEnemyArmy` helpers; `advance()` wiring.
- `sim/conquest-map.test.ts`, `sim/run.test.ts` — unit + end-to-end tests.
- `tools/parity/fixtures.mjs` — 3 new v4 fixtures (march-win / march-repelled / march-lethal).
- `tools/viz/viz.js` (+ `setups.js`, `smoke.mjs`) — render enemy armies + a smoke assertion.

---

### Task 1: `enemyArmies` state + pacing/hash folds (additive foundation)

**Files:** Modify `shared/types.ts`, `sim/conquest-map.ts`; Test `sim/conquest-map.test.ts`.

**Interfaces:**
- Produces: `MapState.enemyArmies: Army[]`; `MapSetup.enemyArmies?: { id: string; units: UnitSpec[]; tile: string }[]`; `hasPendingActivity`/`hashMap` fold enemy armies.

- [ ] **Step 1: Failing tests** (`sim/conquest-map.test.ts`) — use the file's existing `u(...)` unit helper (match its signature):
```ts
describe('enemyArmies foundation', () => {
  it('initConquest builds enemyArmies (garrisoned) from setup.enemyArmies', () => {
    const map = initConquest({ tiles: [
      { id: 's', type: 'enemy', owner: 'enemy', neighbors: {}, garrison: [] },
    ], armies: [], enemyArmies: [{ id: 'ea1', tile: 's', units: [u('e1','B',5)] }] } as any, 0);
    expect(map.enemyArmies.length).toBe(1);
    expect(map.enemyArmies[0]!.state).toBe('garrisoned');
    expect(map.enemyArmies[0]!.tile).toBe('s');
  });
  it('defaults enemyArmies to [] when setup omits it', () => {
    const map = initConquest({ tiles: [{ id: 't0', type: 'start', owner: 'player', neighbors: {}, garrison: [] }], armies: [] } as any, 0);
    expect(map.enemyArmies).toEqual([]);
  });
  it('hasPendingActivity is true while an enemy army is travelling, false when garrisoned', () => {
    const map = initConquest({ tiles: [{ id: 's', type: 'enemy', owner: 'enemy', neighbors: {}, garrison: [] }],
      armies: [], enemyArmies: [{ id: 'ea1', tile: 's', units: [u('e1','B',5)] }] } as any, 0);
    expect(hasPendingActivity(map)).toBe(false);           // garrisoned
    map.enemyArmies[0]!.state = 'travelling';
    expect(hasPendingActivity(map)).toBe(true);            // marching sustains time
  });
  it('hashMap is unchanged for empty enemyArmies but changes when one is present', () => {
    const base = { tiles: [{ id: 't0', type: 'start', owner: 'player', neighbors: {}, garrison: [] }], armies: [] };
    const h0 = hashMap(initConquest(base as any, 0));
    const h1 = hashMap(initConquest(base as any, 0));
    expect(h1).toBe(h0);                                    // empty ⇒ identical
    const withEnemy = initConquest({ ...base, enemyArmies: [{ id: 'ea1', tile: 't0', units: [u('e1','B',5)] }] } as any, 0);
    expect(hashMap(withEnemy)).not.toBe(h0);               // present ⇒ folded
  });
});
```

- [ ] **Step 2: Run** → FAIL (`enemyArmies` undefined; `hasPendingActivity` lacks the clause).

- [ ] **Step 3: Implement.**
  - `shared/types.ts` line 119 — add `enemyArmies?` to `MapSetup`:
```ts
export interface MapSetup { tiles: MapTile[]; armies: { id: string; units: UnitSpec[]; tile: string }[]; enemyArmies?: { id: string; units: UnitSpec[]; tile: string }[]; enemyReclaims?: boolean; }
```
  - `sim/conquest-map.ts` — add `enemyArmies: Army[]` to the `MapState` interface (after `battles`):
```ts
export interface MapState {
  tiles: MapTile[];
  armies: Army[];
  totalTicks: number;
  events: MapEvent[];
  seed: number;
  battles: MapBattle[];
  enemyArmies: Army[];
}
```
  - In `initConquest`, build `enemyArmies` exactly like `armies` and include it in the returned object:
```ts
  const enemyArmies: Army[] = (setup.enemyArmies ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((a) => ({ id: a.id, units: a.units.map(cloneSpec), tile: a.tile, state: 'garrisoned', travelGauge: 0 }));
  return { tiles, armies, totalTicks: 0, events: [], seed, battles: [], enemyArmies };
```
  - Extend `hasPendingActivity`:
```ts
export function hasPendingActivity(map: MapState): boolean {
  return (
    map.armies.some((a) => a.state === 'travelling' || a.state === 'retreating') ||
    map.enemyArmies.some((a) => a.state === 'travelling') ||
    map.battles.some((b) => !b.fight.outcome)
  );
}
```
  - Extend `hashMap` with an EMPTY-GUARDED suffix (append only when non-empty so existing hashes are byte-identical):
```ts
export function hashMap(state: MapState): string {
  const tilePart = [...state.tiles].sort(byId).map((t) =>
    `${t.id}:${t.owner}:${t.garrison.map(g => `${g.id}@${g.startHp ?? deriveStats(g.attrs, g.attackKind).maxHp}`).join('/')}`
  ).join(',');
  const armyPart = [...state.armies].sort(byId).map((a) =>
    `${a.id}:${a.tile}:${a.state}:${a.target ?? '-'}:${a.units.map(u => `${u.id}@${u.startHp ?? deriveStats(u.attrs, u.attackKind).maxHp}`).join('/')}`
  ).join(',');
  const battlePart = [...state.battles].sort((x, y) => x.tile < y.tile ? -1 : x.tile > y.tile ? 1 : 0)
    .map((b) => `${b.tile}=${hashFight(b.fight.units, b.fight.totalTicks)}`).join(',');
  const enemyPart = state.enemyArmies.length === 0 ? '' :
    '#E:' + [...state.enemyArmies].sort(byId).map((a) =>
      `${a.id}:${a.tile}:${a.state}:${a.target ?? '-'}:${a.units.map(u => `${u.id}@${u.startHp ?? deriveStats(u.attrs, u.attackKind).maxHp}`).join('/')}`
    ).join(',');
  return fnv1a(`${tilePart}#${armyPart}#${battlePart}#${state.totalTicks}${enemyPart}`);
}
```

- [ ] **Step 4: Run** → PASS. Then `npm test`, `npm run typecheck`, and `export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity` → **PARITY OK, 26 fixture(s)** (anchor + every prior hash UNCHANGED — the empty-guard preserves them). If any fixture moved, STOP.

- [ ] **Step 5: Commit**
```bash
git add shared/types.ts sim/conquest-map.ts sim/conquest-map.test.ts
git commit -m "$(printf 'feat(sim): enemyArmies state + pacing/hash folds (additive, 26 frozen)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: `openSortie` → shared `openEnemyAttack` (behavior-preserving refactor)

**Files:** Modify `sim/conquest-map.ts`; Test `sim/conquest-map.test.ts` (existing sortie tests must stay green).

**Interfaces:**
- Produces: `openEnemyAttack(state: MapState, target: MapTile, sourceTileId: string, attackerUnits: UnitSpec[], consume: () => void): void` — opens an `attackerOwner:'enemy'` battle with `attackerUnits` as side A; `openSortie` delegates to it.

- [ ] **Step 1: Confirm coverage.** The existing garrison-sortie tests in `sim/conquest-map.test.ts` (the `openSortie` structure test) + the `run-sortie-*`/`run-hold` parity fixtures are the behavior-preservation gate — no NEW test needed here; the refactor must leave them byte-identical.

- [ ] **Step 2: Refactor.** Replace the body of `openSortie` (lines ~596-609) with a thin delegator, and add the shared opener directly above it. The shared opener is `openSortie`'s exact logic with the attacker source parameterized (`.slice()` shallow-copy matches the original stash):
```ts
function openEnemyAttack(state: MapState, target: MapTile, sourceTileId: string,
  attackerUnits: UnitSpec[], consume: () => void): void {
  const source = tileById(state, sourceTileId)!;
  const defenderArmies = state.armies.filter((a) => a.tile === target.id);
  const attackerGarrison = attackerUnits.slice();               // stash originals (attackKind lost from fight Unit)
  const { setup, seed } = buildSortieSetup(state, target, source, defenderArmies, attackerGarrison);
  const fight = initFight(setup, seed);
  consume();
  state.battles.push({ tile: target.id, fight, attackerOwner: 'enemy', attackerGarrison });
  state.battles.sort((a, b) => (a.tile < b.tile ? -1 : a.tile > b.tile ? 1 : 0));
  const gate = gateOf(target, source.id);
  for (const army of defenderArmies) { army.state = 'contested'; army.target = target.id; army.gate = gate; }
  state.events.push({ t: 'sortie', tile: target.id, from: sourceTileId });
}

export function openSortie(state: MapState, source: MapTile, target: MapTile): void {
  openEnemyAttack(state, target, source.id, source.garrison, () => { source.garrison = []; });
}
```

- [ ] **Step 3: Verify behavior-preserving.** `npx vitest run sim/conquest-map.test.ts` (sortie tests green); `npm test`; `npm run typecheck`; `export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity` → **26 fixture(s) frozen** — especially `run-sortie-win`/`repelled`/`lethal` (`094fddf6`/`d5034dd6`/`e33b0318`) and `run-hold` (`9dc7f64d`) UNCHANGED. If any moved, the refactor changed behavior — STOP.

- [ ] **Step 4: Commit**
```bash
git add sim/conquest-map.ts
git commit -m "$(printf 'refactor(sim): openSortie delegates to shared openEnemyAttack (behavior-preserving)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: `advanceEnemyArmies` — march to nearest player tile + assault

**Files:** Modify `sim/conquest-map.ts`; Test `sim/conquest-map.test.ts`, `sim/run.test.ts`.

**Interfaces:**
- Consumes: `openEnemyAttack` (Task 2), `slowestTempo`, `TRAVEL_THRESHOLD`, `gateOf`, `tileById`, `EDGES`, `cloneSpec`, `byId`.
- Produces: enemy armies that march + assault, driven inside `advance()`.

- [ ] **Step 1: Failing tests.**
  - `sim/conquest-map.test.ts`:
```ts
describe('advanceEnemyArmies', () => {
  // s0 (enemy, ea1) — E — s1 (enemy) — E — t (player, defended by garrison g1)
  const march = () => initConquest({ tiles: [
    { id: 's0', type: 'enemy', owner: 'enemy', neighbors: { E: 's1' }, garrison: [] },
    { id: 's1', type: 'enemy', owner: 'enemy', neighbors: { W: 's0', E: 't' }, garrison: [] },
    { id: 't',  type: 'enemy', owner: 'player', neighbors: { W: 's1' }, garrison: [u('g1','B',5)] },
  ], armies: [], enemyArmies: [{ id: 'ea1', tile: 's0', units: [u('e1','A',20)] }] } as any, 0);

  it('selects the nearest player tile and starts travelling (no gauge the tick it sets out)', () => {
    const m = march();
    advance(m, []);
    expect(m.enemyArmies[0]!.state).toBe('travelling');
    expect(m.enemyArmies[0]!.target).toBe('t');
    expect(m.enemyArmies[0]!.travelGauge).toBe(0);          // set out this tick ⇒ no accumulation yet
  });
  it('marches over enemy ground and assaults the target (enemy-attacker battle opens)', () => {
    const m = march();
    for (let i = 0; i < 50 && m.battles.length === 0; i++) advance(m, []);
    expect(m.battles.some((b) => b.tile === 't' && b.attackerOwner === 'enemy')).toBe(true);
    expect(m.enemyArmies.length).toBe(0);                   // army consumed into the assault
  });
  it('an enemy army with no reachable player tile stays idle', () => {
    const m = initConquest({ tiles: [{ id: 's', type: 'enemy', owner: 'enemy', neighbors: {}, garrison: [] }],
      armies: [], enemyArmies: [{ id: 'ea1', tile: 's', units: [u('e1','A',5)] }] } as any, 0);
    advance(m, []);
    expect(m.enemyArmies[0]!.state).toBe('garrisoned');
  });
});
```
  - `sim/run.test.ts` (end-to-end via `runTick`; use the file's `u` helper):
```ts
it('enemy army marches and takes a defended player tile on a win (army becomes the garrison)', () => {
  const run = initRun({ tiles: [
    { id: 's0', type: 'enemy', owner: 'enemy', neighbors: { E: 't' }, garrison: [] },
    { id: 't',  type: 'enemy', owner: 'player', neighbors: { W: 's0' }, garrison: [u('g1','B',1)] },
    { id: 'k',  type: 'start', owner: 'player', neighbors: {}, garrison: [] },
  ], armies: [{ id: 'keep', tile: 'k', units: [u('ku','A',5)] }],
     enemyArmies: [{ id: 'ea1', tile: 's0', units: [u('e1','A',20)] }] } as any, 1);
  for (let i = 0; i < 120 && run.status === 'active' && (Sim_pending(run)); i++) runTick(run, []);
  expect(run.map.tiles.find((t) => t.id === 't')!.owner).toBe('enemy');
  expect(run.map.enemyArmies.length).toBe(0);              // consumed → became t's garrison
  expect(run.status).toBe('active');                        // 'keep' survives
});
it("an enemy army that destroys the player's LAST army loses the run", () => {
  const run = initRun({ tiles: [
    { id: 's0', type: 'enemy', owner: 'enemy', neighbors: { E: 't' }, garrison: [] },
    { id: 't',  type: 'enemy', owner: 'player', neighbors: { W: 's0' }, garrison: [] },
  ], armies: [{ id: 'd', tile: 't', units: [u('du','A',1)] }],
     enemyArmies: [{ id: 'ea1', tile: 's0', units: [u('e1','A',20)] }] } as any, 1);
  for (let i = 0; i < 120 && run.status === 'active'; i++) runTick(run, []);
  expect(run.map.tiles.find((t) => t.id === 't')!.owner).toBe('enemy');
  expect(run.status).toBe('lost');
});
```
  (Replace `Sim_pending(run)` with a plain bounded loop `for (let i=0;i<120 && run.status==='active';i++)` — the run stays active until the enemy resolves; drop the pending helper. Written as a bounded loop.)

- [ ] **Step 2: Run** → FAIL (`advanceEnemyArmies` not wired; enemy armies never move).

- [ ] **Step 3: Implement.** Add helpers + the phase to `sim/conquest-map.ts`, and wire the phase into `advance()`.
  - Helpers (place near `advanceEnemyArmies`):
```ts
function removeEnemyArmy(state: MapState, army: Army): void {
  const i = state.enemyArmies.indexOf(army);
  if (i !== -1) state.enemyArmies.splice(i, 1);
}

// BFS from fromId over ENEMY-owned tiles; the nearest enemy tile with a player-owned
// neighbor is the launch tile and that player neighbor is the target. Deterministic
// (N/S/E/W expansion + queue order). Returns { target, route: [...enemy path, target] } or null.
function nearestPlayerAssault(state: MapState, fromId: string): { target: string; route: string[] } | null {
  const start = tileById(state, fromId);
  if (!start || start.owner !== 'enemy') return null;
  const adjPlayer = (tile: MapTile): string | undefined => {
    for (const e of EDGES) { const nb = tile.neighbors[e]; if (nb) { const t = tileById(state, nb); if (t && t.owner === 'player') return nb; } }
    return undefined;
  };
  const here = adjPlayer(start);
  if (here) return { target: here, route: [here] };
  const visited = new Set<string>([fromId]);
  const parent = new Map<string, string>();
  const queue: string[] = [fromId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const tile = tileById(state, cur);
    if (!tile) continue;
    for (const e of EDGES) {
      const nb = tile.neighbors[e];
      if (!nb || visited.has(nb)) continue;
      const nt = tileById(state, nb);
      if (!nt || nt.owner !== 'enemy') continue;
      visited.add(nb); parent.set(nb, cur); queue.push(nb);
      const tgt = adjPlayer(nt);
      if (tgt) {
        const path: string[] = []; let node: string = nb;
        while (node !== fromId) { path.unshift(node); node = parent.get(node)!; }
        path.push(tgt);
        return { target: tgt, route: path };
      }
    }
  }
  return null;
}

// Assault a player tile with the (consumed) enemy army's units.
function enemyArmyAssault(state: MapState, army: Army, targetId: string): void {
  const target = tileById(state, targetId)!;
  const defenders = state.armies.filter((a) => a.tile === targetId);
  if (target.garrison.length === 0 && defenders.length === 0) {
    // undefended → fight-free capture (mirror of the player capturing undefended ground)
    target.owner = 'enemy';
    target.garrison = army.units.map(cloneSpec);
    removeEnemyArmy(state, army);
    state.events.push({ t: 'captured', tile: targetId, by: '-' });
    return;
  }
  openEnemyAttack(state, target, army.tile, army.units, () => removeEnemyArmy(state, army));
}

function advanceEnemyArmies(state: MapState, travellingBefore: Set<string>): void {
  for (const army of state.enemyArmies.slice().sort(byId)) {
    if (army.state === 'garrisoned') {
      const plan = nearestPlayerAssault(state, army.tile);
      if (!plan) continue;                                   // no reachable player tile → stay idle
      army.state = 'travelling';
      army.target = plan.target;
      army.route = plan.route;
      army.travelGauge = 0;
      const launchId = plan.route.length >= 2 ? plan.route[plan.route.length - 2]! : army.tile;
      army.gate = gateOf(tileById(state, plan.target)!, launchId);
      state.events.push({ t: 'dispatched', armyId: army.id, toTile: plan.target });
      continue;                                              // set out this tick ⇒ no accumulation yet
    }
    if (army.state !== 'travelling' || !travellingBefore.has(army.id)) continue;
    army.travelGauge += slowestTempo(army);
    while (army.travelGauge >= TRAVEL_THRESHOLD && army.route && army.route.length > 0) {
      army.travelGauge -= TRAVEL_THRESHOLD;
      if (army.route.length === 1) {                         // last element = player target → assault from launch tile
        const targetId = army.route[0]!;
        const target = tileById(state, targetId);
        if (!target || target.owner !== 'player') {          // target flipped away → disband
          removeEnemyArmy(state, army);
        } else if (state.battles.some((b) => b.tile === targetId)) {
          // a battle is already underway here → wait (retry next accumulation); keep route
        } else {
          army.route = [];
          enemyArmyAssault(state, army, targetId);
        }
        break;
      }
      const from = army.tile;
      const next = army.route.shift()!;
      army.tile = next;                                      // hop onto next enemy tile
      state.events.push({ t: 'hopped', armyId: army.id, from, to: next });
    }
  }
}
```
  - Wire into `advance()`. At the top (near the `travellingBefore` snapshot, ~line 391) add an enemy snapshot:
```ts
  const enemyTravellingBefore = new Set(
    state.enemyArmies.filter((a) => a.state === 'travelling').map((a) => a.id),
  );
```
  Then insert the phase **after** the player Travel phase (after line ~423, the player travel `for` loop) and **before** the Battle-step phase (line ~425):
```ts
  // Enemy-army phase: march + assault (no-op when there are no enemy armies).
  advanceEnemyArmies(state, enemyTravellingBefore);
```

- [ ] **Step 4: Run** → PASS (all new tests). Then `npm test`; `npm run typecheck`; `export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity` → **26 fixture(s) frozen** (no fixture has enemy armies yet; `advanceEnemyArmies` is a no-op for them).

- [ ] **Step 5: Commit**
```bash
git add sim/conquest-map.ts sim/conquest-map.test.ts sim/run.test.ts
git commit -m "$(printf 'feat(sim): enemy armies march to nearest player tile and assault\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: Parity fixtures (march-win / march-repelled / march-lethal)

**Files:** Modify `tools/parity/fixtures.mjs`; Test `sim/run.test.ts` (pin tests).

**Interfaces:** Consumes `runScriptedRun` (v4). Enemy armies march ≥1 hop before striking (exercises movement).

- [ ] **Step 1: Add 3 v4 fixtures** to `tools/parity/fixtures.mjs` (append after `run-sortie-lethal-seed1`), each `expectedHash:'PENDING'`. Topology `s0 (enemy, ea1) — E — s1 (enemy) — E — t (player)` so the army hops `s0→s1` then assaults `t`:
```js
  {
    // enemy-march-win-seed1: strong enemy army marches s0→s1→ assaults defended t (weak garrison) and WINS;
    // player keeps an isolated army 'keep' so the run stays active. t flips enemy, ea1 becomes its garrison.
    name: 'enemy-march-win-seed1', expectedHash: 'PENDING',
    bundle: { version: 4, seed: 1, setup: {
      tiles: [
        { id: 's0', type: 'enemy', owner: 'enemy',  neighbors: { E: 's1' }, garrison: [] },
        { id: 's1', type: 'enemy', owner: 'enemy',  neighbors: { W: 's0', E: 't' }, garrison: [] },
        { id: 't',  type: 'enemy', owner: 'player', neighbors: { W: 's1' },
          garrison: [{ id: 'g1', side: 'B', attackKind: 'melee', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }] },
        { id: 'k',  type: 'start', owner: 'player', neighbors: {}, garrison: [] },
      ],
      armies: [{ id: 'keep', tile: 'k', units: [{ id: 'ku', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }] }],
      enemyArmies: [{ id: 'ea1', tile: 's0', units: [{ id: 'e1', side: 'A', attackKind: 'melee', attrs: { str: 20, agi: 20, int: 5, lck: 5 }, priority: 5, pos: { x: 0, y: 0 } }] }],
    }, script: [] },
  },
  {
    // enemy-march-repelled-seed1: weak enemy army marches and assaults t defended by a strong player army d;
    // d repels → ea1 destroyed, t stays player, run active.
    name: 'enemy-march-repelled-seed1', expectedHash: 'PENDING',
    bundle: { version: 4, seed: 1, setup: {
      tiles: [
        { id: 's0', type: 'enemy', owner: 'enemy',  neighbors: { E: 's1' }, garrison: [] },
        { id: 's1', type: 'enemy', owner: 'enemy',  neighbors: { W: 's0', E: 't' }, garrison: [] },
        { id: 't',  type: 'enemy', owner: 'player', neighbors: { W: 's1' }, garrison: [] },
      ],
      armies: [{ id: 'd', tile: 't', units: [{ id: 'du', side: 'A', attackKind: 'melee', attrs: { str: 20, agi: 20, int: 5, lck: 5 }, priority: 5, pos: { x: 0, y: 0 } }] }],
      enemyArmies: [{ id: 'ea1', tile: 's0', units: [{ id: 'e1', side: 'A', attackKind: 'melee', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }] }],
    }, script: [] },
  },
  {
    // enemy-march-lethal-seed1: strong enemy army marches and destroys the player's ONLY army d → status 'lost'.
    name: 'enemy-march-lethal-seed1', expectedHash: 'PENDING',
    bundle: { version: 4, seed: 1, setup: {
      tiles: [
        { id: 's0', type: 'enemy', owner: 'enemy',  neighbors: { E: 's1' }, garrison: [] },
        { id: 's1', type: 'enemy', owner: 'enemy',  neighbors: { W: 's0', E: 't' }, garrison: [] },
        { id: 't',  type: 'enemy', owner: 'player', neighbors: { W: 's1' }, garrison: [] },
      ],
      armies: [{ id: 'd', tile: 't', units: [{ id: 'du', side: 'A', attackKind: 'melee', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }] }],
      enemyArmies: [{ id: 'ea1', tile: 's0', units: [{ id: 'e1', side: 'A', attackKind: 'melee', attrs: { str: 20, agi: 20, int: 5, lck: 5 }, priority: 5, pos: { x: 0, y: 0 } }] }],
    }, script: [] },
  },
```

- [ ] **Step 2: Capture hashes.** `export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity`. For each `enemy-march-*`, read the V8 hash from `V8 mismatch [enemy-march-...]: <HASH> !== PENDING`, confirm the goja line shows the IDENTICAL `<HASH>` (V8≡goja — if not, STOP: determinism bug), set `expectedHash` to `<HASH>`. Also update the fixtures-file index comment. Re-run → **PARITY OK, 29 fixture(s)**.

- [ ] **Step 3: Pin tests** (`sim/run.test.ts`) — `runScriptedRun(bundle).hash` equals the captured hash AND the meaningful postcondition (win: `t` enemy + `enemyArmies` empty + status active; repelled: `t` player + status active; lethal: `t` enemy + status lost). Bundles can be imported/duplicated inline in the test.

- [ ] **Step 4: Verify frozen set.** `npm test`; `npm run parity` → **29 fixtures V8≡goja**: the **26 prior fixtures UNCHANGED** (anchor `86e238c1`, `run-sortie-*`, `run-hold` `9dc7f64d`, `run-reclaim` `b06ecc1e`, …) + 3 new `enemy-march-*`. If any prior fixture moved, STOP.

- [ ] **Step 5: Commit**
```bash
git add tools/parity/fixtures.mjs sim/run.test.ts
git commit -m "$(printf 'feat(sim): v4 parity fixtures — enemy army march win/repelled/lethal\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: Viz renders enemy armies + smoke

**Files:** Modify `tools/viz/viz.js`, `tools/viz/setups.js`, `tools/viz/smoke.mjs`.

**Interfaces:** Consumes `run.map.enemyArmies` (Task 1), `Sim.hasPendingActivity`.

- [ ] **Step 1: Rebuild + render.** `npm run bundle`. In `tools/viz/viz.js`, render `run.map.enemyArmies` alongside player armies but in a distinct enemy color, reusing the army-drawing path. In `render()`, after the player-armies loop (~line 101), add an enemy-armies loop that draws each `run.map.enemyArmies` entry as a marker (interpolated while `travelling` using `travelGauge`/`route`, same as player armies) tinted enemy-red (e.g. fill `#b5564d`), labelled with its id. Add a roster line for enemy armies in `sidebar()` (a separate `<div>` or appended to `#roster` under an "Enemy" label — reuse the existing roster markup). Keep it minimal — this is a dev harness.

- [ ] **Step 2: A sample setup with an enemy army.** In `tools/viz/setups.js`, add an entry (e.g. `skirmish` variant or a new `assault` setup) containing an `enemyArmies` force that marches at the player, so the enemy march is visible in the browser and exercised by the smoke.

- [ ] **Step 3: Smoke assertion.** In `tools/viz/smoke.mjs`, after the existing contract assertions, add:
```js
// (E) enemy mobile army: marches (sustains pending) then strikes; the run resolves.
const marchSetup = { tiles: [
  { id: 's0', type: 'enemy', owner: 'enemy', neighbors: { E: 's1' }, garrison: [] },
  { id: 's1', type: 'enemy', owner: 'enemy', neighbors: { W: 's0', E: 't' }, garrison: [] },
  { id: 't',  type: 'enemy', owner: 'player', neighbors: { W: 's1' }, garrison: [] },
  { id: 'k',  type: 'start', owner: 'player', neighbors: {}, garrison: [] },
], armies: [{ id: 'keep', tile: 'k', units: [{ id: 'ku', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }] }],
   enemyArmies: [{ id: 'ea1', tile: 's0', units: [{ id: 'e1', side: 'A', attackKind: 'melee', attrs: { str: 20, agi: 20, int: 5, lck: 5 }, priority: 5, pos: { x: 0, y: 0 } }] }] };
const rE = Sim.initRun(JSON.parse(JSON.stringify(marchSetup)), 1);
if (!Sim.hasPendingActivity(rE.map)) fail('E: an enemy army present at start should be pending (it will march)');
let sawMarch = false, guard = 0;
while (rE.status === 'active' && Sim.hasPendingActivity(rE.map) && guard < 1000) { Sim.runTick(rE, []); if (rE.map.enemyArmies.some((a) => a.state === 'travelling')) sawMarch = true; guard++; }
if (!sawMarch) fail('E: enemy army should have marched (travelling) at some point');
if (rE.map.tiles.find((t) => t.id === 't').owner !== 'enemy') fail('E: enemy army should have taken the undefended target t');
console.log('enemy army      : OK (E marches → strikes → resolves)');
```

- [ ] **Step 4: Run smoke.** `npm run bundle && node tools/viz/smoke.mjs` → ends with `enemy army      : OK ...` then `SMOKE OK` (exit 0). Fix the setup/render honestly if an assertion trips.

- [ ] **Step 5: Commit**
```bash
git add tools/viz/viz.js tools/viz/setups.js tools/viz/smoke.mjs
git commit -m "$(printf 'feat(viz): render enemy mobile armies + smoke (march & strike)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** separate `enemyArmies` + `hasPendingActivity`/`hashMap` folds (spec §1/§4) → T1 ✓; `openSortie`→shared opener (spec §3) → T2 ✓; `advanceEnemyArmies` nearest-player-tile BFS + tempo travel + arrival (spec §2) + assault incl. undefended/wait/disband (spec §3) → T3 ✓; determinism/parity frozen (spec §4) → T1/T2/T3 gates + T4 fixtures ✓; pacing (spec §5) → T1 clause + T3 tests + T5 smoke ✓; viz render (spec files) → T5 ✓. Deferred items (mobilization, smart targeting, campaigning, difficulty, join/re-target) correctly absent.
- **Type consistency:** `enemyArmies: Army[]`, `MapSetup.enemyArmies?`, `openEnemyAttack(state,target,sourceTileId,attackerUnits,consume)`, `nearestPlayerAssault→{target,route}`, `advanceEnemyArmies(state,travellingBefore)`, `enemyArmyAssault(state,army,targetId)`, `removeEnemyArmy` — consistent across tasks. Reuses `Army`, `cloneSpec`, `byId`, `slowestTempo`, `TRAVEL_THRESHOLD`, `gateOf`, `buildSortieSetup`.
- **Placeholder scan:** no TBD/TODO; fixture hashes are `PENDING` capture sentinels (Task-4 procedure resolves them); the T3 run-test `Sim_pending` note is resolved to a plain bounded loop.
- **Determinism/parity:** RNG-free (BFS + id order + N/S/E/W); `hashMap` empty-guarded (26 frozen); `openSortie` behavior-preserving; enemy phase no-op when `enemyArmies` empty. Player invariants (`isLost`/`committedCount`/`defended`) untouched.
