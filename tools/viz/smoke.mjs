// Headless verification for the dev visualizer: load the real bundle (as the parity
// harness does), play a sample run to a terminal state with a greedy autopilot, and
// assert the RunState has the exact fields the canvas reads. Also dumps one
// active-battle frame (for an inline preview). Run: node tools/viz/smoke.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
// Mirror the parity harness: evaluate the IIFE bundle (--global-name=Sim) and setups.js
// in a fresh vm context, then read the globals back off the contextified sandbox. The
// returned objects are usable from Node directly.
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'dist', 'sim-bundle.js'), 'utf8'), sandbox); // → sandbox.Sim
vm.runInContext(readFileSync(join(here, 'setups.js'), 'utf8'), sandbox);             // → sandbox.SETUPS
const { Sim, SETUPS } = sandbox;

function fail(msg) { console.error('SMOKE FAIL:', msg); process.exit(1); }
if (!Sim || !Sim.initRun || !Sim.runTick) fail('Sim.initRun/runTick missing from bundle');
if (!SETUPS || !SETUPS.campaign) fail('SETUPS.campaign missing');

// Greedy autopilot: each idle (garrisoned) army dispatches to its first non-owned neighbor.
function autopilot(m) {
  const cmds = [], taken = new Set();
  for (const a of m.armies) {
    if (a.state !== 'garrisoned') continue;
    const t = m.tiles.find((x) => x.id === a.tile);
    for (const e of ['N', 'S', 'E', 'W']) {
      const nb = t.neighbors[e]; if (!nb || taken.has(nb)) continue;
      const nt = m.tiles.find((x) => x.id === nb);
      if (nt && nt.owner !== 'player') { cmds.push({ t: 'dispatch', armyId: a.id, toTile: nb }); taken.add(nb); break; }
    }
  }
  return cmds;
}

const run = Sim.initRun(JSON.parse(JSON.stringify(SETUPS.campaign)), 1);
if (run.status !== 'active') fail('fresh run not active');

let frame = null, mustered = false, boonSeen = false, sawBattle = false, sawCapture = false;
let i = 0;
for (; i < 400 && run.status === 'active'; i++) {
  Sim.runTick(run, autopilot(run.map));
  const m = run.map;
  if (m.battles && m.battles.length) {
    sawBattle = true;
    if (!frame) frame = snapshot(run);
  }
  if (m.tiles.some((t) => t.owner === 'player' && t.id !== 't0')) sawCapture = true;
  if (m.armies.some((a) => a.id.startsWith('muster-'))) mustered = true;
  // boon: a player unit whose str exceeds the authored base (9/8) → buffed
  if (m.armies.some((a) => a.units.some((u) => u.attrs.str > 9))) boonSeen = true;
}

// ── assert the fields the canvas reads exist ──────────────────────────────────
const m = run.map;
if (!Array.isArray(m.tiles) || !m.tiles[0].neighbors || typeof m.tiles[0].owner !== 'string') fail('tiles shape');
if (!Array.isArray(m.armies)) fail('armies shape');
for (const a of m.armies) { if (typeof a.tile !== 'string' || typeof a.state !== 'string' || !Array.isArray(a.units)) fail('army shape ' + a.id); }
if (frame) {
  const fu = frame.battle.units[0];
  if (fu && (typeof fu.x !== 'number' || typeof fu.hp !== 'number' || typeof fu.max !== 'number')) fail('fight unit shape');
}

console.log('── visualizer smoke ──────────────────────────────');
console.log('ticks run        :', i, '  final status:', run.status);
console.log('saw a live battle:', sawBattle, ' · saw a capture:', sawCapture);
console.log('muster fired     :', mustered, ' · boon fired:', boonSeen);
console.log('final tiles      :', m.tiles.map((t) => t.id + ':' + t.owner).join('  '));
console.log('final armies     :', m.armies.map((a) => a.id + '@' + a.tile + '/' + a.state + '×' + a.units.length).join('  ') || '(none)');
console.log('canvas data path : OK (tiles/armies/battle shapes present)');
if (frame) { console.log('\n── one active-battle frame (for inline preview) ──'); console.log('FRAME ' + JSON.stringify(frame)); }

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

// (D) a wait-beat opens an enemy sortie, which auto-resolves, then the world FREEZES (game continues).
// Weak enemy attacker (str=1) vs strong stationary defender (str=20) → repelled (mirrors frozen fixture
// run-sortie-repelled-seed1), so the run stays active and re-freezes — the spec's "resolves before freezing".
const sortieSetup = { enemyReclaims: true, tiles: [
  { id: 's', type: 'enemy', owner: 'enemy', neighbors: { E: 't' }, garrison: [{ id: 'g1', side: 'B', attackKind: 'melee', attrs: { str: 1, agi: 6, int: 3, lck: 3 }, priority: 5, pos: { x: 0, y: 0 } }] },
  { id: 't', type: 'enemy', owner: 'player', neighbors: { W: 's' }, garrison: [] },
], armies: [{ id: 'd', tile: 't', units: [{ id: 'du', side: 'A', attackKind: 'melee', attrs: { str: 20, agi: 6, int: 3, lck: 3 }, priority: 5, pos: { x: 0, y: 0 } }] }] };
const rD = Sim.initRun(JSON.parse(JSON.stringify(sortieSetup)), 1);
if (Sim.hasPendingActivity(rD.map)) fail('D: sortie setup should start quiescent');
Sim.runTick(rD, []);                                   // wait-beat → enemy seizes the window, sortie opens
if (!Sim.hasPendingActivity(rD.map)) fail('D: wait-beat should have opened an enemy sortie (a pending battle)');
resolve(rD);                                           // commit-and-resolve plays the sortie out
if (Sim.hasPendingActivity(rD.map)) fail('D: enemy sortie should auto-resolve to quiescence');
if (rD.status !== 'active') fail('D: a repelled sortie should leave the run active (frozen — your move)');
if (rD.map.tiles.find((t) => t.id === 't').owner !== 'player') fail('D: defender should have repelled — tile stays player');
console.log('contract        : OK (A idle-frozen · B commit-resolve · C wait-heals · D sortie resolves→freezes)');

console.log('\nSMOKE OK');

// compact frame the visualizer would draw
function snapshot(r) {
  const m = r.map, b = m.battles[0], f = b.fight;
  return {
    status: r.status, tick: m.totalTicks,
    tiles: m.tiles.map((t) => ({ id: t.id, type: t.type, owner: t.owner, neighbors: t.neighbors, def: (t.garrison || []).length, muster: !!(t.muster && t.muster.length), boon: t.boon || null })),
    armies: m.armies.map((a) => ({ id: a.id, tile: a.tile, state: a.state, target: a.target || null, route: a.route || null, gauge: a.travelGauge, units: a.units.length })),
    battle: { tile: b.tile, tick: f.totalTicks, w: f.grid.width || 8, h: f.grid.height || 8, units: f.units.filter((u) => u.hp > 0 && !u.exited).map((u) => ({ side: u.side, x: u.pos.x, y: u.pos.y, hp: u.hp, max: u.derived ? u.derived.maxHp : u.hp })) },
  };
}
