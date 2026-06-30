# Dev sim visualizer

A zero-dependency browser harness that **drives the real simulation** (`dist/sim-bundle.js`)
and draws it. It does not re-implement any game logic — it only calls `Sim.initRun(setup, seed)`
and `Sim.runTick(run, commands)` and renders the returned `RunState`. This is the same
`Sim.*` contract the Godot client will use, so it doubles as living client↔sim documentation.

**It is a dev harness, not the shipping client.**

## Run it

```bash
npm run bundle          # build dist/sim-bundle.js from the current sim
# then open tools/viz/index.html in a browser.
# If your browser blocks the local <script src> over file://, serve it:
npx serve tools/viz     # or:  python -m http.server -d tools/viz
```

## Controls
- **map / seed / New run** — pick a sample map (`campaign` or `skirmish`) and a seed; deterministic.
- **Step ▷** — advance one map tick (`Sim.runTick`). **Auto ▶/⏸** — play on a timer (speed selectable).
- **Click an army, then a non-owned tile** — queues a `dispatch` for the next tick (the sim validates; rejects show in the Events log).
- **Extract ⏏** — ends the run (`{t:'extract'}`), banking.
- Watch the **fight inset** (top-right) when a tile is contested: units by side with HP bars, stepping live. Watch **Rest** heal a garrisoned army, **Muster** spawn a reserve army on capture, **Boon** buff your units.

## Verify (headless)
```bash
node tools/viz/smoke.mjs
```
Loads the bundle the same way the parity harness does, plays a sample run to a terminal
state with a greedy autopilot, and asserts the state has the fields the canvas reads.
