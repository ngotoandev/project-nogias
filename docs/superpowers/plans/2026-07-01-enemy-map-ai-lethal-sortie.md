# Enemy Map-AI — Lethal Sorties Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The enemy fights to retake a *defended* player tile — generalize the battle engine with a single `MapBattle.attackerOwner` flag, add an enemy `openSortie`, and the lethal lose path (an enemy sortie can destroy the player's army and lose the run).

**Architecture:** One new field, `MapBattle.attackerOwner: 'player'|'enemy'`. The player armies in a battle are still found from `state.armies` (`target===tile && contested`); `attackerOwner` says whether they're the attackers (player attack) or defenders (enemy sortie). The player-attack build + outcome are **unchanged** (the `'player'` branch is today's code verbatim; `buildFightSetup` untouched). The enemy *decision* stays in `sim/run.ts` (`applyEnemyAI`), calling a new exported `openSortie`. `state.armies` stays player-only.

**Tech Stack:** TypeScript (strict, ES2015), Vitest, esbuild bundle, goja parity runner. Sim is pure / integer-only / goja-safe.

## Global Constraints

- **Parity-critical / integer-only**; the run/AI decision layer draws **NO RNG** (the fight draws RNG via `fightSeed`, as today).
- **Player attacks byte-identical:** the `attackerOwner==='player'` outcome branch is today's code verbatim and `buildFightSetup` is untouched → the **21 `enemyReclaims=false` fixtures + the anchor `86e238c1` stay byte-identical**. `MapBattle.attackerOwner`/`attackerGarrison` are NOT hashed (`hashMap.battlePart` reads only `b.fight`+`b.tile`).
- **Fixture re-pin accounting (Task 5):** slice-2 sorties are gated by `enemyReclaims`, so they only affect the two `enemyReclaims=true` fixtures: **`run-hold-seed1` is RE-PINNED** (its `t1` now SORTIES the a2-defended `t2` instead of ignoring it — hash + postcondition change); **`run-reclaim-seed1` is verified UNCHANGED** (its enemy tile reclaims its undefended E-neighbor first and no garrisoned enemy ever faces a defended player tile → no sortie). The 21 `enemyReclaims=false` fixtures + `86e238c1` are FROZEN. +3 new `run-sortie-*` fixtures.
- **Engine direction:** `sim/conquest-map.ts` IS modified (first run-loop slice to do so) + `sim/run.ts` + `shared/types.ts` + fixtures. `tile-fight.ts`/`replay.ts` untouched. `state.armies` stays player-only (no enemy-army ripple).
- **`applyEnemyAI`:** per garrisoned enemy tile (id order), its first ACTIONABLE player neighbor (N/S/E/W): undefended → reclaim (slice 1); defended + no active battle there → `openSortie`; defended + battle already there → skip to next neighbor. One action per enemy tile per tick.
- **Commits:** end every message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

### Standard commands (every task)
- Focused: `npx vitest run sim/conquest-map.test.ts sim/run.test.ts`
- Full: `npm test` (currently 217 tests); Types: `npm run typecheck`
- Parity: `export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity` → 23 fixtures green, `86e238c1` (rises to 26 in Task 5; `run-hold` re-pinned).

---

## File Structure
- **Modify `shared/types.ts`** — `MapEvent` += `{ t:'sortie'; tile: string; from: string }`.
- **Modify `sim/conquest-map.ts`** — `MapBattle.attackerOwner` + `attackerGarrison?`; `resolveArrival` sets `attackerOwner:'player'`; new `buildSortieSetup` + exported `openSortie`; generalized outcome (branch on `attackerOwner`).
- **Modify `sim/run.ts`** — `applyEnemyAI` gains the sortie branch (imports `openSortie`).
- **Modify `tools/parity/fixtures.mjs`** — +3 v4 fixtures; re-pin `run-hold-seed1`.
- Co-located tests. `tile-fight.ts`/`replay.ts` untouched.

---

## Task 1: `attackerOwner` + `openSortie`

**Files:** Modify `shared/types.ts`, `sim/conquest-map.ts`; Test `sim/conquest-map.test.ts`.

**Interfaces — Produces:**
```ts
// conquest-map.ts
export interface MapBattle { tile: string; fight: FightState; attackerOwner: 'player' | 'enemy'; attackerGarrison?: UnitSpec[]; }
export function openSortie(state: MapState, source: MapTile, target: MapTile): void;
// shared/types.ts: MapEvent |= { t: 'sortie'; tile: string; from: string }
```

- [ ] **Step 1: Failing tests** (`sim/conquest-map.test.ts`) — a garrisoned enemy `s` adjacent to a player tile `t` holding a player army `d`:
```ts
import { initConquest, openSortie } from './conquest-map';
// helper u(id, side, str, agi) as elsewhere in this file
it('openSortie opens an enemy-attacker battle: enemy garrison side A, player army side B, source emptied', () => {
  const state = initConquest({ tiles: [
    { id: 's', type: 'enemy', owner: 'enemy', neighbors: { E: 't' }, garrison: [u('g1','B',5), u('g2','B',5)] },
    { id: 't', type: 'enemy', owner: 'player', neighbors: { W: 's' }, garrison: [] },
  ], armies: [{ id: 'd', tile: 't', units: [u('du','A',6)] }] }, 1);
  const s = state.tiles.find(x => x.id === 's')!, t = state.tiles.find(x => x.id === 't')!;
  openSortie(state, s, t);
  const b = state.battles.find(x => x.tile === 't')!;
  expect(b.attackerOwner).toBe('enemy');
  expect(b.attackerGarrison!.map(g => g.id)).toEqual(['g1','g2']);   // stashed originals
  expect(s.garrison).toHaveLength(0);                                 // source committed
  const sideA = b.fight.units.filter(fu => fu.side === 'A').map(fu => fu.id);
  const sideB = b.fight.units.filter(fu => fu.side === 'B').map(fu => fu.id);
  expect(sideA).toEqual(['garrison#g1','garrison#g2']);               // enemy garrison = attacker
  expect(sideB).toEqual(['d#du']);                                    // player army = defender
  expect(state.armies.find(a => a.id === 'd')!.state).toBe('contested');
  expect(state.events.some(e => e.t === 'sortie' && e.tile === 't' && e.from === 's')).toBe(true);
});
```

- [ ] **Step 2: Run** → FAIL (`openSortie` undefined; `attackerOwner` not on `MapBattle`).

- [ ] **Step 3: Implement** — `shared/types.ts`: add `| { t: 'sortie'; tile: string; from: string }` to `MapEvent`. `sim/conquest-map.ts`:
  - `MapBattle`: add `attackerOwner: 'player' | 'enemy';` and `attackerGarrison?: UnitSpec[];`.
  - `resolveArrival`'s battle push: `state.battles.push({ tile: tile.id, fight, attackerOwner: 'player' });` (only change to that line).
  - Add a sortie builder + `openSortie` (reuse `deployCell`/`garrisonCell`/`gateOf`/`fightSeed`/`DEFAULT_FIGHT_GRID`/`byId`; do NOT touch `buildFightSetup`):
```ts
function buildSortieSetup(state: MapState, target: MapTile, source: MapTile,
  defenderArmies: Army[], attackerGarrison: UnitSpec[]): { setup: FightSetup; seed: number } {
  const grid = DEFAULT_FIGHT_GRID;
  const units: UnitSpec[] = [];
  const gate = gateOf(target, source.id);
  for (let k = 0; k < attackerGarrison.length; k++) {           // attacker: enemy garrison, side A, gate edge
    const g = attackerGarrison[k]!;
    units.push({ id: `garrison#${g.id}`, side: 'A', attackKind: g.attackKind, attrs: { ...g.attrs },
      skill: g.skill, traits: g.traits ? g.traits.slice() : undefined,
      personality: g.personality ? { ...g.personality } : undefined, priority: g.priority,
      startHp: g.startHp, pos: deployCell(gate, grid, k) });
  }
  let di = 0;                                                    // defender: player army units, side B, interior
  for (const army of defenderArmies.slice().sort(byId)) {
    for (const u of army.units) {
      units.push({ id: `${army.id}#${u.id}`, side: 'B', attackKind: u.attackKind, attrs: { ...u.attrs },
        skill: u.skill, traits: u.traits ? u.traits.slice() : undefined,
        personality: u.personality ? { ...u.personality } : undefined, priority: u.priority,
        startHp: u.startHp, pos: garrisonCell(grid, di++) });
    }
  }
  return { setup: { grid, units }, seed: fightSeed(state.seed, target.id) };
}

export function openSortie(state: MapState, source: MapTile, target: MapTile): void {
  const defenderArmies = state.armies.filter((a) => a.tile === target.id);
  const attackerGarrison = source.garrison.slice();              // stash originals (attackKind lost from fight Unit)
  const { setup, seed } = buildSortieSetup(state, target, source, defenderArmies, attackerGarrison);
  const fight = initFight(setup, seed);
  source.garrison = [];                                          // committed to the sortie
  state.battles.push({ tile: target.id, fight, attackerOwner: 'enemy', attackerGarrison });
  state.battles.sort((a, b) => (a.tile < b.tile ? -1 : a.tile > b.tile ? 1 : 0));
  const gate = gateOf(target, source.id);
  for (const army of defenderArmies) { army.state = 'contested'; army.target = target.id; army.gate = gate; }
  state.events.push({ t: 'sortie', tile: target.id, from: source.id });
}
```
(Import `Army` is already in the `shared/types` import; `UnitSpec`/`FightSetup` too. The battle-step phase already steps every battle in `state.battles`, so the sortie battle is driven without change.)

- [ ] **Step 4: Run** → PASS. Then `npm test`, `npm run typecheck`, full parity (**23 fixtures**, `86e238c1` + all unchanged — `openSortie` is not yet called by any run, and the player-attack open only gained `attackerOwner:'player'` which isn't hashed).

- [ ] **Step 5: Commit**
```bash
git add shared/types.ts sim/conquest-map.ts sim/conquest-map.test.ts
git commit -m "$(printf 'feat(sim): MapBattle.attackerOwner + openSortie (enemy-attacker battle)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Generalized outcome (branch on `attackerOwner`)

**Files:** Modify `sim/conquest-map.ts`; Test `sim/conquest-map.test.ts`.

**Interfaces:** Consumes `MapBattle.attackerOwner`/`attackerGarrison`, `openSortie` (Task 1), `reconcileArmy`.

- [ ] **Step 1: Failing tests** (`sim/conquest-map.test.ts`) — open a sortie (Task 1), step the map to resolution via `advance`, assert the enemy outcome. Use a strong enemy garrison vs a weak defender for a deterministic enemy win, and the inverse for a repel:
```ts
import { advance } from './conquest-map';
it('enemy sortie WIN: tile flips to enemy, attacker garrison installed, defender army destroyed', () => {
  const state = initConquest({ tiles: [
    { id: 's', type: 'enemy', owner: 'enemy', neighbors: { E: 't' }, garrison: [u('g1','B',20), u('g2','B',20), u('g3','B',20)] },
    { id: 't', type: 'enemy', owner: 'player', neighbors: { W: 's' }, garrison: [] },
  ], armies: [{ id: 'd', tile: 't', units: [u('du','A',1)] }] }, 1);
  openSortie(state, state.tiles.find(x=>x.id==='s')!, state.tiles.find(x=>x.id==='t')!);
  for (let i = 0; i < 80 && state.battles.length; i++) advance(state, []);
  expect(state.tiles.find(x=>x.id==='t')!.owner).toBe('enemy');        // flipped to enemy
  expect(state.tiles.find(x=>x.id==='t')!.garrison.length).toBeGreaterThan(0); // enemy survivors installed
  expect(state.armies.find(a=>a.id==='d')).toBeUndefined();            // defender destroyed (lethal)
});
it('enemy sortie REPELLED: tile stays player, defender holds (attrited), attacker discarded', () => {
  // strong defender (str 20 ×3) vs weak sortie (str 1) → defender (side B) wins
  const state = initConquest({ tiles: [
    { id: 's', type: 'enemy', owner: 'enemy', neighbors: { E: 't' }, garrison: [u('g1','B',1)] },
    { id: 't', type: 'enemy', owner: 'player', neighbors: { W: 's' }, garrison: [] },
  ], armies: [{ id: 'd', tile: 't', units: [u('d1','A',20), u('d2','A',20), u('d3','A',20)] }] }, 1);
  openSortie(state, state.tiles.find(x=>x.id==='s')!, state.tiles.find(x=>x.id==='t')!);
  for (let i = 0; i < 80 && state.battles.length; i++) advance(state, []);
  expect(state.tiles.find(x=>x.id==='t')!.owner).toBe('player');       // held
  expect(state.armies.find(a=>a.id==='d')!.state).toBe('garrisoned');  // back to holding
});
```

- [ ] **Step 2: Run** → FAIL (the enemy battle resolves via the player branch — flips `t` to `player`, mis-handles the sides).

- [ ] **Step 3: Implement** — in `advance`'s outcome-application loop, wrap the existing two-branch body in `if (b.attackerOwner === 'player') { …existing verbatim… } else { …new… }`. The existing code (the `winner==='A'` capture branch and the `else` repel branch, lines computing `attackers`, reconciling, `tile.owner='player'`, garrison rebuild) goes UNCHANGED inside the `'player'` block. Add the `'enemy'` block:
```ts
} else { // attackerOwner === 'enemy' (sortie): playerArmies are the DEFENDERS (side B); attacker = enemy garrison (side A)
  const playerArmies = state.armies.filter((a) => a.target === b.tile && a.state === 'contested');
  if (winner === 'A') {                       // enemy wins — LETHAL
    tile.owner = 'enemy';
    const orig = b.attackerGarrison ?? [];
    const newGarrison: UnitSpec[] = [];
    for (const f of b.fight.units) {           // surviving side-A enemy units → tile's new garrison
      if (f.side !== 'A' || f.hp <= 0) continue;
      const origId = f.id.slice('garrison#'.length);
      const og = orig.find((g) => g.id === origId);
      if (!og) throw new Error(`sortie outcome: no original spec for '${origId}' (fight id '${f.id}')`);
      newGarrison.push({ ...og, startHp: f.hp });
    }
    tile.garrison = newGarrison;
    for (const army of playerArmies) {         // defending armies destroyed
      const idx = state.armies.indexOf(army); if (idx !== -1) state.armies.splice(idx, 1);
    }
    state.events.push({ t: 'captured', tile: b.tile, by: '-' }); // enemy capture (by '-' = enemy/no army)
  } else {                                     // player repels (B win / timeout / draw)
    for (const army of playerArmies) reconcileArmy(army, b.fight);
    for (const army of playerArmies) {
      if (army.units.length === 0) { const idx = state.armies.indexOf(army); if (idx !== -1) state.armies.splice(idx, 1); }
      else { army.state = 'garrisoned'; army.target = undefined; army.gate = undefined; army.route = undefined; }
    }
    state.events.push({ t: 'repelled', tile: b.tile }); // attacker (enemy sortie) discarded; source already empty
  }
}
```
(The existing `const attackers = state.armies.filter(...)` and `const winner = ...` at the top of the loop body: keep `winner`; the `attackers` computation can stay inside the `'player'` block, or hoist `winner` above the branch. Keep `tile` lookup above the branch.)

- [ ] **Step 4: Run** → PASS. Then `npm test`, typecheck, full parity (**23 fixtures**, `86e238c1` + all unchanged — no sortie is triggered in any fixture yet [Task 3], and the player branch is verbatim).

- [ ] **Step 5: Commit**
```bash
git add sim/conquest-map.ts sim/conquest-map.test.ts
git commit -m "$(printf 'feat(sim): generalized battle outcome — tile flips to attackerOwner (lethal enemy win)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: `applyEnemyAI` sortie branch (`sim/run.ts`)

**Files:** Modify `sim/run.ts`; Test `sim/run.test.ts`.

**Interfaces:** Consumes `openSortie` (`./conquest-map`).

- [ ] **Step 1: Failing test** (`sim/run.test.ts`) — `enemyReclaims:true`, a garrisoned enemy `s` adjacent to a player tile `t` defended by army `d`:
```ts
it('a garrisoned enemy tile sorties an adjacent DEFENDED player tile (battle opens, defender contested)', () => {
  const run = initRun({ enemyReclaims: true, tiles: [
    { id: 's', type: 'enemy', owner: 'enemy', neighbors: { E: 't' }, garrison: [u('g1','B',6)] },
    { id: 't', type: 'enemy', owner: 'player', neighbors: { W: 's' }, garrison: [] },
  ], armies: [{ id: 'd', tile: 't', units: [u('du','A',6)] }] }, 1);
  runTick(run, []);
  expect(run.map.battles.some((b) => b.tile === 't' && b.attackerOwner === 'enemy')).toBe(true);
  expect(run.map.events.some((e) => e.t === 'sortie')).toBe(true);
});
it('enemyReclaims=false ⇒ no sortie', () => {
  const run = initRun({ enemyReclaims: false, tiles: [/* same */], armies: [/* same */] } as any, 1);
  runTick(run, []);
  expect(run.map.battles).toHaveLength(0);
});
```

- [ ] **Step 2: Run** → FAIL (no sortie opened; `openSortie` not called).

- [ ] **Step 3: Implement** — add `openSortie` to the `./conquest-map` import; extend `applyEnemyAI`:
```ts
function applyEnemyAI(map: MapState): void {
  const defended = new Set(map.armies.map((a) => a.tile));
  for (const tile of map.tiles) {
    if (tile.owner !== 'enemy' || tile.garrison.length === 0) continue;
    for (const e of ['N', 'S', 'E', 'W'] as const) {
      const nb = tile.neighbors[e]; if (!nb) continue;
      const nt = map.tiles.find((t) => t.id === nb);
      if (!nt || nt.owner !== 'player') continue;
      if (!defended.has(nb)) {                                   // undefended → reclaim (slice 1)
        nt.owner = 'enemy';
        map.events.push({ t: 'reclaimed', tile: nb, by: tile.id });
        break;
      }
      if (!map.battles.some((b) => b.tile === nb)) {             // defended, no battle → sortie
        openSortie(map, tile, nt);
        break;
      }
      // defended + battle already there → not actionable; try the next neighbor
    }
  }
}
```

- [ ] **Step 4: Run** → PASS. Then `npm test`, typecheck, full parity (**23 fixtures** — but `run-hold-seed1` may now differ; if parity reports a mismatch ONLY on `run-hold-seed1`, that is EXPECTED and is re-pinned in Task 5; `86e238c1` + the 21 `enemyReclaims=false` + `run-reclaim-seed1` must still match. If anything else mismatches, STOP.)

- [ ] **Step 5: Commit**
```bash
git add sim/run.ts sim/run.test.ts
git commit -m "$(printf 'feat(sim): enemy AI sorties defended player tiles (lethal, opt-in)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: Lethal lose + win/lose interplay

**Files:** Test `sim/run.test.ts` (no new production code expected — `isLost`/`isWon` already react to `state.armies` / boss ownership; this task VERIFIES the lethal path end-to-end and adds any missing guard the tests surface).

- [ ] **Step 1: Verification tests** (`sim/run.test.ts`):
```ts
it('a sortie that destroys the player\'s LAST army loses the run', () => {
  const run = initRun({ enemyReclaims: true, tiles: [
    { id: 's', type: 'enemy', owner: 'enemy', neighbors: { E: 't' }, garrison: [u('g1','B',20), u('g2','B',20), u('g3','B',20)] },
    { id: 't', type: 'enemy', owner: 'player', neighbors: { W: 's' }, garrison: [] },
  ], armies: [{ id: 'd', tile: 't', units: [u('du','A',1)] }] }, 1);
  for (let i = 0; i < 120 && run.status === 'active'; i++) runTick(run, []);
  expect(run.map.tiles.find(x=>x.id==='t')!.owner).toBe('enemy');
  expect(run.status).toBe('lost');                                  // last army destroyed ⇒ lose
});
it('a sortie repelled keeps the tile and the army', () => { /* strong defender → status stays active, t player, d garrisoned */ });
```

- [ ] **Step 2: Run** → the lethal test should PASS once Tasks 1–3 are in (the sortie destroys `d` → `state.armies` empty → `isLost`). If it does not (e.g., the destroyed army wasn't removed, or `isWon`/`isLost` mis-fires), fix the minimal guard in `sim/run.ts`/`conquest-map.ts` and note it. Add a boss-un-win test if a boss-tile scenario is in play: a sortie retaking a captured boss makes `isWon` stop holding.

- [ ] **Step 3: Verify + commit** (focused/suite/typecheck/parity — 23 unchanged except the expected `run-hold` mismatch deferred to Task 5).
```bash
git add sim/run.test.ts  # + any minimal guard fix
git commit -m "$(printf 'test(sim): lethal sortie lose path + win/lose interplay\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: Parity fixtures (+ re-pin `run-hold`)

**Files:** Modify `tools/parity/fixtures.mjs`; Test `sim/run.test.ts`.

- [ ] **Step 1: Add 3 v4 fixtures** (`enemyReclaims: true`; capture procedure — `expectedHash:'PENDING'` → `npm run parity` → read the V8 hash → set → re-run):
  - `run-sortie-win-seed1` — garrisoned enemy `s` (strong) — player `t` defended by a weak army; script empty or a no-op so the run ticks (the sortie itself makes the run pending via the battle). The sortie wins → `t` enemy + defender destroyed. (To drive ticks: the sortie battle is `pending` until it resolves, so `runScriptedRun` advances — no script command needed; but include a `dispatch` of an unrelated player army if a tick-0 trigger is needed. Keep it minimal; verify the run progresses.)
  - `run-sortie-repelled-seed1` — strong defender repels a weak sortie → `t` stays player, defender attrited.
  - `run-sortie-lethal-seed1` — the defender is the player's ONLY army; the sortie wins → `status:'lost'`.
- [ ] **Step 2: Re-pin `run-hold-seed1`** — its `t1` now sorties the a2-defended `t2`. Run parity, read the NEW hash, update `expectedHash`, and update its pin **unit test** in `sim/run.test.ts` (the postcondition: assert the actual sortie outcome — `t2`'s owner after the sortie resolves, which the engine now decides — not the old "stays player" claim). Document the change in a comment.
- [ ] **Step 3: Pin tests for the 3 new fixtures** (`sim/run.test.ts`) — `runScriptedRun(bundle).hash` equals the captured hash AND the meaningful postcondition (win: `t` enemy + defender gone; repelled: `t` player; lethal: `status:'lost'`).
- [ ] **Step 4: Verify** — `npm test`; typecheck; full parity **26 fixtures** V8===goja: the **21 `enemyReclaims=false` fixtures + `86e238c1` + `run-reclaim-seed1` UNCHANGED**; `run-hold-seed1` RE-PINNED; +3 new `run-sortie-*`. If any of the frozen set changed, STOP — the player-attack path must be byte-identical.
- [ ] **Step 5: Commit**
```bash
git add tools/parity/fixtures.mjs sim/run.test.ts
git commit -m "$(printf 'feat(sim): v4 parity fixtures — enemy sortie win/repelled/lethal (+ re-pin run-hold)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** `MapBattle.attackerOwner`/`attackerGarrison` + `openSortie` + sortie build + `resolveArrival` sets owner + `sortie` event (T1) ✓; generalized outcome branch (T2) ✓; `applyEnemyAI` sortie branch (T3) ✓; lethal lose + win/lose (T4) ✓; fixtures + `run-hold` re-pin + frozen-set check (T5) ✓. Out-of-scope (mobile armies, reinforcement) absent.
- **Type consistency:** `openSortie(state, source, target)`, `MapBattle.attackerOwner`/`attackerGarrison`, `buildSortieSetup` ids (`garrison#${id}` side A, `${army.id}#${unit.id}` side B), the outcome's `playerArmies` filter + `attackerGarrison`-rebuild, `sortie` event shape — consistent across tasks. `buildFightSetup` untouched; `reconcileArmy` reused (side-agnostic).
- **Placeholder scan:** fixture hashes are `PENDING` capture sentinels; the `run-sortie-repelled` test body is sketched but its setup mirrors the Task-2 repel test (concrete). No TBD logic.
- **Determinism:** RNG-free decision layer; sortie target deterministic (first actionable N/S/E/W); `attackerOwner`/`attackerGarrison` not hashed; player attacks byte-identical (verbatim `'player'` branch + untouched `buildFightSetup`). **Fixture accounting corrected vs the spec's "23 frozen": 21 + anchor + `run-reclaim` frozen; `run-hold` re-pinned (now a sortie); +3 new → 26.** `tile-fight.ts`/`replay.ts` untouched.
