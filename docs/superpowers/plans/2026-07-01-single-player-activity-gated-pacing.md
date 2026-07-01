# Single-Player Activity-Gated Pacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the world advance only in player-initiated beats — expose a single pure activity signal from the sim and have the interactive client (dev visualizer) freeze when idle, resolve committed actions to quiescence, and take deliberate wait-beats for idle time.

**Architecture:** One pure selector `hasPendingActivity(map)` becomes the single source of truth for "there is live activity" (a marching/retreating army, or an unresolved battle). The replay drivers' duplicated `pending()` closures dedupe onto it (behavior-preserving). `runTick` is unchanged; a "wait-beat" is just `runTick(run, [])`. All pacing lives in the client loop — the viz drives commit-and-resolve + wait-beat and shows a frozen/resolving indicator.

**Tech Stack:** TypeScript (goja-safe sim), esbuild IIFE bundle (`Sim.*`), vitest, vanilla-JS canvas viz, Node vm smoke, Go/goja parity harness.

## Global Constraints

- Deterministic + goja-safe: integer-only, RNG-free decision layer, NO `Date.now()` / `Math.random()`.
- `hasPendingActivity` is a **pure read**; the `pending()` refactor is **behavior-preserving** (the `||` operands are side-effect-free, so reordering cannot change the boolean).
- **No sim behavior change:** `runTick`, `advance`, and all engines are untouched in behavior. No new sim command (wait-beat = `runTick(run, [])`).
- **Anchor `86e238c1` + all 26 parity fixtures byte-identical.** Gate: `export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity` → `PARITY OK (V8 === goja === expected) for 26 fixture(s)`.
- Bundle rebuild for viz/smoke: `npm run bundle` (regenerates gitignored `dist/sim-bundle.js`).
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- `sim/conquest-map.ts` — add exported pure `hasPendingActivity(map: MapState): boolean` (co-located with `MapState`/`hashMap`).
- `sim/replay.ts` — dedupe both `pending()` closures (`runScriptedConquest`, `runScriptedRun`) onto the selector.
- `sim/index.ts` — re-export `hasPendingActivity` so it rides onto `Sim.*` for the client.
- `sim/conquest-map.test.ts` — unit tests for the selector.
- `tools/viz/viz.js` + `tools/viz/index.html` — replace continuous "Auto" ticking with the commit-and-resolve paced loop + a "Wait ⏭" beat control + a frozen/resolving indicator.
- `tools/viz/smoke.mjs` — headless assertions for the contract; `tools/viz/README.md` — document the interactive client contract.

---

### Task 1: `hasPendingActivity` selector + dedupe (parity-critical)

**Files:**
- Modify: `sim/conquest-map.ts` (add selector after `openSortie`, before the `hashMap` section)
- Modify: `sim/replay.ts` (import + refactor both `pending()` closures)
- Modify: `sim/index.ts` (re-export)
- Test: `sim/conquest-map.test.ts`

**Interfaces:**
- Produces: `export function hasPendingActivity(map: MapState): boolean` — true iff any army is `travelling`/`retreating` OR any battle has no `fight.outcome`.
- Consumes: existing `MapState`, `initConquest`, `advance` (for tests).

- [ ] **Step 1: Write the failing tests** — append to `sim/conquest-map.test.ts`. Use the unit-spec helper already defined in this test file (match its existing signature, e.g. `u(id, side, str)`); if none exists in-scope, add `const u = (id, side, str) => ({ id, side, attackKind: 'melee', attrs: { str, agi: 6, int: 3, lck: 3 }, priority: 5, pos: { x: 0, y: 0 } });`. Import `hasPendingActivity` from `./conquest-map`.

```ts
describe('hasPendingActivity', () => {
  const base = () => ({
    tiles: [
      { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
      { id: 't1', type: 'enemy', owner: 'enemy', neighbors: { W: 't0' }, garrison: [] },
    ],
    armies: [{ id: 'a1', tile: 't0', units: [u('u1', 'A', 5)] }],
  });

  it('is false when all armies are garrisoned and no battle exists', () => {
    const map = initConquest(base(), 0);
    expect(map.armies[0].state).toBe('garrisoned');
    expect(hasPendingActivity(map)).toBe(false);
  });

  it('is true while an army is travelling', () => {
    const map = initConquest(base(), 0);
    advance(map, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
    expect(map.armies[0].state).toBe('travelling');
    expect(hasPendingActivity(map)).toBe(true);
  });

  it('is true while a battle is unresolved', () => {
    const setup = base();
    setup.tiles[1].garrison = [u('g1', 'B', 5)];              // t1 now defended → travel ends in a fight
    const map = initConquest(setup, 0);
    advance(map, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
    for (let i = 0; i < 50 && map.battles.length === 0; i++) advance(map, []); // travel to contact
    expect(map.battles.length).toBeGreaterThan(0);
    expect(map.battles.some((b) => !b.fight.outcome)).toBe(true);
    expect(hasPendingActivity(map)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run sim/conquest-map.test.ts -t hasPendingActivity`
Expected: FAIL — `hasPendingActivity is not a function` / not exported.

- [ ] **Step 3: Add the selector** to `sim/conquest-map.ts`, immediately after the `openSortie` function and before the `// ── hashMap ──` section header:

```ts
// True while there is live in-flight activity: an army marching (travelling) or
// pulling back (retreating), or a battle still resolving. The single source of
// truth for "the world has something to advance" — the replay drivers and the
// interactive client both gate on this (the client also checks run.status).
export function hasPendingActivity(map: MapState): boolean {
  return (
    map.armies.some((a) => a.state === 'travelling' || a.state === 'retreating') ||
    map.battles.some((b) => !b.fight.outcome)
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run sim/conquest-map.test.ts -t hasPendingActivity`
Expected: PASS (3/3).

- [ ] **Step 5: Dedupe the replay drivers.** In `sim/replay.ts`, add `hasPendingActivity` to the existing import on line 4:

```ts
import { initConquest, advance, hashMap, hasPendingActivity } from './conquest-map';
```

Replace the `pending` closure in `runScriptedConquest` (currently lines ~20-23):

```ts
  const pending = () =>
    hasPendingActivity(s) ||
    bundle.script.some((a) => a.atTick >= s.totalTicks);
```

Replace the `pending` closure in `runScriptedRun` (currently lines ~59-62):

```ts
  const pending = () =>
    hasPendingActivity(run.map) ||
    bundle.script.some((a) => a.atTick >= run.map.totalTicks);
```

(The final boolean is identical — `armies || battles || script` vs the prior `armies || script || battles` — because the operands are pure reads with no side effects.)

- [ ] **Step 6: Re-export from the bundle barrel.** Add to `sim/index.ts`:

```ts
export { hasPendingActivity } from './conquest-map';
```

- [ ] **Step 7: Full verification**

Run: `npm test` — Expected: all pass (228 + 3 new = 231).
Run: `npm run typecheck` — Expected: clean.
Run: `export PATH="/c/Program Files/Go/bin:$PATH" && npm run parity`
Expected: `PARITY OK (V8 === goja === expected) for 26 fixture(s).` — anchor `86e238c1` and every prior hash unchanged (behavior-preserving refactor).

- [ ] **Step 8: Commit**

```bash
git add sim/conquest-map.ts sim/replay.ts sim/index.ts sim/conquest-map.test.ts
git commit -m "$(printf 'feat(sim): hasPendingActivity selector + dedupe replay pending()\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Viz commit-and-resolve loop + wait-beat control

**Files:**
- Modify: `tools/viz/index.html` (button set + phase indicator)
- Modify: `tools/viz/viz.js` (replace continuous-Auto with the paced resolver + wait-beat)

**Interfaces:**
- Consumes: `Sim.hasPendingActivity(run.map)` (Task 1, now on the bundle), `Sim.runTick`, `Sim.initRun`.

**Context:** Today `viz.js` has an "Auto ▶" button that `setInterval(tick, speed)` ticks **forever** regardless of activity — under the new model that would let the enemy act while the player is idle. Replace it with a self-limiting resolver that advances only `while Sim.hasPendingActivity`, then freezes. The local `pending` command-queue variable is removed (commands are passed straight to a beat), which also avoids confusion with `hasPendingActivity`.

- [ ] **Step 1: Rebuild the bundle so the viz sees the new export**

Run: `npm run bundle`
Expected: writes `dist/sim-bundle.js` (now exposing `Sim.hasPendingActivity`).

- [ ] **Step 2: Update `tools/viz/index.html`** — repurpose Step→Wait, remove Auto, add a phase indicator.

Change the Step button (line ~37) label to a wait-beat (keep `id="step"`):
```html
    <button id="step">Wait ⏭</button>
```
Remove the Auto button line (`<button id="auto">Auto ▶</button>`).
In the Run panel (line ~46), add a phase line under `#meta`:
```html
      <div class="panel"><h2>Run</h2><div id="status">—</div><div id="meta" class="hint"></div><div id="phase" class="hint"></div></div>
```

- [ ] **Step 3: Replace the driving loop in `tools/viz/viz.js`.**

Remove the `pending` field from the `state` line (~line 20) so it reads:
```js
  let run = null, layout = {}, rects = {}, selected = null, timer = null;
```

Replace `tick()`, `stopAuto()`, and `toggleAuto()` (lines ~33-47) with the paced resolver + beat:
```js
  // One player-initiated beat, then auto-resolve its consequences to quiescence.
  function beat(cmds) {
    if (!run || run.status !== 'active') return;
    Sim.runTick(run, cmds || []);      // the beat the player chose (command(s), or [] = wait)
    render();
    startResolve();                    // commit-and-resolve: play out any live activity
  }
  function startResolve() {
    if (timer) return;
    if (!run || run.status !== 'active' || !Sim.hasPendingActivity(run.map)) { render(); return; }
    timer = setInterval(resolveStep, parseInt($('speed').value, 10));
  }
  function resolveStep() {
    if (!run || run.status !== 'active' || !Sim.hasPendingActivity(run.map)) { stopResolve(); render(); return; }
    Sim.runTick(run, []);              // advance one tick; nothing is free — enemy acts in this window too
    render();
  }
  function stopResolve() { if (timer) { clearInterval(timer); timer = null; } }
```

In `start()` (line ~29), replace `selected = null; pending = []; stopAuto();` with:
```js
    selected = null; stopResolve();
```

- [ ] **Step 4: Rewire inputs + the phase indicator.**

Replace the dispatch-click branch in the canvas click handler (lines ~172-174) — issue the dispatch as an immediate beat instead of queueing:
```js
    if (selected && tile.owner !== 'player') {
      beat([{ t: 'dispatch', armyId: selected, toTile: hit }]); // commit-and-resolve; sim validates
      selected = null;
    } else {
```

Replace the button wiring (lines ~184-187) — Step becomes a wait-beat, Auto is gone, Extract is a beat:
```js
  $('new').addEventListener('click', start);
  $('step').addEventListener('click', () => beat([]));               // deliberate wait-beat
  $('extract').addEventListener('click', () => beat([{ t: 'extract' }]));
  $('speed').addEventListener('change', () => { if (timer) { stopResolve(); startResolve(); } });
```

In `sidebar()` (lines ~144-147), remove the `$('auto')` reference and set the phase line:
```js
    const done = run.status !== 'active';
    $('step').disabled = done; $('extract').disabled = done;
    $('phase').textContent = done ? '' : (timer ? 'resolving…' : 'your move — frozen');
```

- [ ] **Step 5: Verify in a browser (manual smoke)**

Run: `npm run bundle` then open `tools/viz/index.html`.
Expected: a fresh run sits **frozen** ("your move — frozen"); clicking an army then an enemy tile dispatches and the world **resolves… then freezes** again; "Wait ⏭" advances one beat and re-freezes (or resolves an enemy sortie it opened). No perpetual ticking when idle.

- [ ] **Step 6: Commit**

```bash
git add tools/viz/index.html tools/viz/viz.js
git commit -m "$(printf 'feat(viz): commit-and-resolve paced loop + wait-beat (idle = frozen)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: Smoke assertions + client-contract doc

**Files:**
- Modify: `tools/viz/smoke.mjs` (headless contract assertions)
- Modify: `tools/viz/README.md` (document the interactive client contract)

**Interfaces:**
- Consumes: `Sim.hasPendingActivity`, `Sim.initRun`, `Sim.runTick` from the bundle.

- [ ] **Step 1: Add a `resolve` helper + contract assertions to `tools/viz/smoke.mjs`.** After the existing autopilot loop and field-shape assertions (before the final `console.log('SMOKE OK')`), add:

```js
// ── interactive-contract assertions (activity-gated pacing) ───────────────────
if (typeof Sim.hasPendingActivity !== 'function') fail('Sim.hasPendingActivity missing from bundle');
const resolve = (r) => { let n = 0; while (r.status === 'active' && Sim.hasPendingActivity(r.map) && n < 1000) { Sim.runTick(r, []); n++; } return n; };

// (A) idle = frozen: a fresh run with everything garrisoned has no pending activity
const rA = Sim.initRun(JSON.parse(JSON.stringify(SETUPS.campaign)), 1);
if (Sim.hasPendingActivity(rA.map)) fail('A: fresh run should be quiescent (idle = frozen)');

// (B) commit-and-resolve: dispatch to an undefended enemy neighbor → resolves then freezes
const t0 = rA.map.tiles.find((t) => t.owner === 'player');
const target = ['N','S','E','W'].map((e) => t0.neighbors[e]).find((nb) => nb && rA.map.tiles.find((t) => t.id === nb && t.owner !== 'player'));
const army = rA.map.armies.find((a) => a.tile === t0.id);
if (target && army) {
  Sim.runTick(rA, [{ t: 'dispatch', armyId: army.id, toTile: target }]);
  if (!Sim.hasPendingActivity(rA.map)) fail('B: dispatch should create pending activity (a march)');
  resolve(rA);
  if (rA.status === 'active' && Sim.hasPendingActivity(rA.map)) fail('B: should be quiescent after resolve');
}

// (C) wait-beat = exactly one tick that heals, and idle stays frozen
const restSetup = { tiles: [{ id: 'r0', type: 'rest', owner: 'player', neighbors: {}, garrison: [] }],
  armies: [{ id: 'a1', tile: 'r0', units: [{ id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 }, startHp: 3 }] }] };
const rC = Sim.initRun(JSON.parse(JSON.stringify(restSetup)), 1);
if (Sim.hasPendingActivity(rC.map)) fail('C: rest setup should start quiescent');
const before = rC.map.armies[0].units[0].startHp;
Sim.runTick(rC, []);                                   // one deliberate wait-beat
const after = rC.map.armies[0].units[0].startHp;
if (!(after > before)) fail('C: a wait-beat on a rest tile should heal one increment (' + before + '→' + after + ')');
if (Sim.hasPendingActivity(rC.map)) fail('C: still idle after a wait-beat → should stay frozen');

// (D) a wait-beat that opens an enemy sortie auto-resolves under commit-and-resolve
const sortieSetup = { enemyReclaims: true, tiles: [
  { id: 's', type: 'enemy', owner: 'enemy', neighbors: { E: 't' }, garrison: [{ id: 'g1', side: 'B', attackKind: 'melee', attrs: { str: 5, agi: 6, int: 3, lck: 3 }, priority: 5, pos: { x: 0, y: 0 } }] },
  { id: 't', type: 'enemy', owner: 'player', neighbors: { W: 's' }, garrison: [] },
], armies: [{ id: 'd', tile: 't', units: [{ id: 'du', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 6, int: 3, lck: 3 }, priority: 5, pos: { x: 0, y: 0 } }] }] };
const rD = Sim.initRun(JSON.parse(JSON.stringify(sortieSetup)), 1);
if (Sim.hasPendingActivity(rD.map)) fail('D: sortie setup should start quiescent');
Sim.runTick(rD, []);                                   // wait-beat → enemy seizes the window, sortie opens
if (!(Sim.hasPendingActivity(rD.map) || rD.status !== 'active')) fail('D: wait-beat should have opened an enemy sortie (pending battle)');
resolve(rD);
if (rD.status === 'active' && Sim.hasPendingActivity(rD.map)) fail('D: enemy sortie should auto-resolve to quiescence');
console.log('contract        : OK (A idle-frozen · B commit-resolve · C wait-heals · D sortie auto-resolves)');
```

- [ ] **Step 2: Run the smoke**

Run: `npm run bundle && node tools/viz/smoke.mjs`
Expected: ends with `contract        : OK (...)` then `SMOKE OK` (exit 0). If any assertion trips, fix the setup/logic before proceeding.

- [ ] **Step 3: Document the contract in `tools/viz/README.md`.** Add a section (create the file if absent) describing the interactive client contract:

```markdown
## Interactive client contract (activity-gated pacing)

The world advances only in player-initiated **beats**; every beat is equally the enemy's window. Idle ⇒ frozen.

- **Quiescent + no input ⇒ frozen** ("your move"). `Sim.hasPendingActivity(run.map)` is the signal: true iff an army is marching/retreating or a battle is unresolved.
- **A command ⇒ commit-and-resolve:** `runTick(run, cmds)`, then advance `while Sim.hasPendingActivity(run.map)` (animation-paced), then freeze.
- **A wait-beat = `runTick(run, [])`:** one tick — a heal step on Rest tiles, and the enemy's window (a sortie opened here auto-resolves under the same loop). Nothing is free.

`runTick` is unchanged; all pacing lives in this client loop. `smoke.mjs` asserts the four contract properties headlessly.
```

- [ ] **Step 4: Commit**

```bash
git add tools/viz/smoke.mjs tools/viz/README.md
git commit -m "$(printf 'test(viz): headless activity-gated pacing contract + doc\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** `hasPendingActivity` selector + `pending()` dedupe (spec §The change/1) → Task 1 ✓; bundle export for the client → Task 1 Step 6 ✓; viz commit-and-resolve loop + wait-beat + frozen/resolving indicator (spec §2/§3) → Task 2 ✓; smoke A/B/C/D assertions (spec §Testing) → Task 3 ✓; contract doc (spec §scope "updated Sim client-contract documentation") → Task 3 ✓; parity-frozen gate (spec §Determinism) → Task 1 Step 7 ✓. Out-of-scope (enemy-motion-as-activity, Godot) correctly absent.
- **Type consistency:** `hasPendingActivity(map: MapState): boolean` used identically in conquest-map.ts (def), replay.ts (both closures), index.ts (re-export), viz.js/smoke.mjs (`Sim.hasPendingActivity(run.map)`). Army states `travelling`/`retreating`, battle `fight.outcome` match the pre-refactor `pending()`.
- **Placeholder scan:** no TBD/TODO; all steps carry exact code + commands. The one conditional (smoke B) guards on `target && army` because the campaign topology is data — the assertion is skipped only if no undefended neighbor exists (documented), never silently passing a broken resolve.
- **Determinism:** no RNG/Date; the refactor is a pure-read reorder; parity 26 frozen is the Task-1 gate. `runTick` and engines untouched.
