import { it, expect } from 'vitest';
import { initRun, hashRun, runTick } from './run';
import type { MapSetup } from '../shared/types';
import { runScriptedRun } from './replay';
import { runReplay } from './replay';

// a minimal 1-tile setup: a start tile owned by the player with one army on it
const soloSetup: MapSetup = {
  tiles: [{ id: 't0', type: 'start', owner: 'player', neighbors: {}, garrison: [] }],
  armies: [{ id: 'a1', tile: 't0', units: [
    { id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
  ] }],
};

it('initRun starts active with the conquest map initialized', () => {
  const run = initRun(soloSetup, 1);
  expect(run.status).toBe('active');
  expect(run.map.armies).toHaveLength(1);
  expect(run.map.totalTicks).toBe(0);
});

it('hashRun folds in status — same map, different status ⇒ different hash', () => {
  const a = initRun(soloSetup, 1);
  const b = initRun(soloSetup, 1);
  b.status = 'won';
  expect(hashRun(a)).not.toBe(hashRun(b));
  const c = initRun(soloSetup, 1);
  expect(hashRun(a)).toBe(hashRun(c)); // identical run ⇒ identical hash (deterministic)
});

// ── runTick tests ────────────────────────────────────────────────────────────

// t0 (player start) — E — t1 (enemy boss, undefended). Reciprocal neighbors.
const bossSetup: MapSetup = {
  tiles: [
    { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
    { id: 't1', type: 'boss',  owner: 'enemy',  neighbors: { W: 't0' }, garrison: [] },
  ],
  armies: [{ id: 'a1', tile: 't0', units: [
    { id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
  ] }],
};

it('runTick advances the map (a dispatched army leaves its tile)', () => {
  const run = initRun(bossSetup, 1);
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  // dispatched this tick → travelling; subsequent ticks move it (no same-tick move per Plan 2)
  expect(run.map.armies[0]!.state === 'travelling' || run.map.armies[0]!.tile !== 't0').toBe(true);
  expect(run.status).toBe('active');
});

it('capturing the (undefended) boss tile wins the run', () => {
  const run = initRun(bossSetup, 1);
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  for (let i = 0; i < 50 && run.status === 'active'; i++) runTick(run, []);
  expect(run.map.tiles.find((t) => t.id === 't1')!.owner).toBe('player');
  expect(run.status).toBe('won');
});

it('extract ends the run as extracted, before any movement', () => {
  const run = initRun(bossSetup, 1);
  runTick(run, [{ t: 'extract' }, { t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  expect(run.status).toBe('extracted');
  expect(run.map.armies[0]!.tile).toBe('t0'); // dispatch was NOT applied
});

it('a terminal run is a no-op', () => {
  const run = initRun(bossSetup, 1);
  run.status = 'won';
  const before = run.map.totalTicks;
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  expect(run.map.totalTicks).toBe(before);
});

it('losing: no armies left ⇒ lost', () => {
  const run = initRun(bossSetup, 1);
  run.map.armies = []; // simulate all forces ground down
  runTick(run, []);
  expect(run.status).toBe('lost');
});

// ── Rest healing tests (Task 3) ──────────────────────────────────────────────

import { REST_HEAL_PER_TICK } from '../shared/config';
import { deriveStats } from './stats';

const restSetup: MapSetup = {
  tiles: [{ id: 'r0', type: 'rest', owner: 'player', neighbors: {}, garrison: [] }],
  armies: [{ id: 'a1', tile: 'r0', units: [
    { id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 }, startHp: 3 },
  ] }],
};

it('a wounded unit garrisoned on an owned rest tile heals REST_HEAL_PER_TICK/tick, capped at maxHp', () => {
  const run = initRun(restSetup, 1);
  const u = run.map.armies[0]!.units[0]!;
  const maxHp = deriveStats(u.attrs, u.attackKind).maxHp;
  runTick(run, []);
  expect(run.map.armies[0]!.units[0]!.startHp).toBe(Math.min(maxHp, 3 + REST_HEAL_PER_TICK));
  // heal to the cap and confirm it never exceeds maxHp
  for (let i = 0; i < 100; i++) runTick(run, []);
  expect(run.map.armies[0]!.units[0]!.startHp).toBe(maxHp);
});

it('no healing off a rest tile / on an enemy-owned rest tile / when not garrisoned', () => {
  // enemy-owned rest tile: army present but tile.owner !== 'player' ⇒ no heal
  const enemyRest: MapSetup = {
    tiles: [{ id: 'r0', type: 'rest', owner: 'enemy', neighbors: {}, garrison: [] }],
    armies: [{ id: 'a1', tile: 'r0', units: [
      { id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 }, startHp: 3 },
    ] }],
  };
  const run = initRun(enemyRest, 1);
  runTick(run, []);
  expect(run.map.armies[0]!.units[0]!.startHp).toBe(3); // unchanged

  // non-rest tile type: wounded unit on a player-owned 'start' tile ⇒ no heal
  const nonRestSetup: MapSetup = {
    tiles: [{ id: 't0', type: 'start', owner: 'player', neighbors: {}, garrison: [] }],
    armies: [{ id: 'a1', tile: 't0', units: [
      { id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 }, startHp: 3 },
    ] }],
  };
  const runNonRest = initRun(nonRestSetup, 1);
  runTick(runNonRest, []);
  expect(runNonRest.map.armies[0]!.units[0]!.startHp).toBe(3); // unchanged — tile.type !== 'rest'

  // not garrisoned: wounded unit on a player-owned rest tile but army is travelling ⇒ no heal
  const runNotGarrisoned = initRun(restSetup, 1);
  runNotGarrisoned.map.armies[0]!.state = 'travelling';
  runTick(runNotGarrisoned, []);
  expect(runNotGarrisoned.map.armies[0]!.units[0]!.startHp).toBe(3); // unchanged — state !== 'garrisoned'
});

// ── runScriptedRun / runReplay v4 tests (Task 4) ─────────────────────────────

it('runScriptedRun drives a dispatch to a boss capture ⇒ won', () => {
  const r = runScriptedRun({ version: 4, seed: 1, setup: bossSetup,
    script: [{ atTick: 0, commands: [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }] }] });
  expect(r.status).toBe('won');
  expect(typeof r.hash).toBe('string');
});

it('runScriptedRun: an extract command ⇒ extracted', () => {
  const r = runScriptedRun({ version: 4, seed: 1, setup: bossSetup,
    script: [{ atTick: 0, commands: [{ t: 'extract' }] }] });
  expect(r.status).toBe('extracted');
});

it('runReplay routes v4 to runScriptedRun', () => {
  const r = runReplay({ version: 4, seed: 1, setup: bossSetup,
    script: [{ atTick: 0, commands: [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }] }] });
  expect(typeof r.hash).toBe('string');
  expect(r.ticks).toBeGreaterThan(0);
});

// ── v4 parity pin tests (Task 5) ─────────────────────────────────────────────
// Mirror the exact bundles used in tools/parity/fixtures.mjs.

it('run-won-seed1 pin: strong attacker defeats lightly-garrisoned boss tile → won (hash 561ab142)', () => {
  const r = runScriptedRun({
    version: 4,
    seed: 1,
    setup: {
      tiles: [
        { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
        {
          id: 't1', type: 'boss', owner: 'enemy', neighbors: { W: 't0' },
          garrison: [{ id: 'g1', side: 'B', attackKind: 'melee', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }],
        },
      ],
      armies: [{
        id: 'a1',
        units: [{ id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 20, agi: 20, int: 5, lck: 5 }, priority: 5, pos: { x: 0, y: 0 } }],
        tile: 't0',
      }],
    },
    script: [{ atTick: 0, commands: [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }] }],
  });
  expect(r.status).toBe('won');
  expect(r.hash).toBe('561ab142');
});

it('run-rest-heal-seed1 pin: wounded a1 heals on rest tile while a2 travels → hash 930e2fc9', () => {
  const r = runScriptedRun({
    version: 4,
    seed: 1,
    setup: {
      tiles: [
        { id: 'r0', type: 'rest', owner: 'player', neighbors: { E: 'e1' }, garrison: [] },
        { id: 'e1', type: 'enemy', owner: 'enemy', neighbors: { W: 'r0' }, garrison: [] },
      ],
      armies: [
        {
          id: 'a1',
          units: [{ id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 }, startHp: 3 }],
          tile: 'r0',
        },
        {
          id: 'a2',
          units: [{ id: 'u2', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }],
          tile: 'r0',
        },
      ],
    },
    script: [{ atTick: 0, commands: [{ t: 'dispatch', armyId: 'a2', toTile: 'e1' }] }],
  });
  expect(r.status).toBe('active');
  expect(r.hash).toBe('930e2fc9');
});

it('run-extract-seed1 pin: extract at tick 0 → extracted (hash 5b653528)', () => {
  const r = runScriptedRun({
    version: 4,
    seed: 1,
    setup: {
      tiles: [
        { id: 't0', type: 'start', owner: 'player', neighbors: {}, garrison: [] },
      ],
      armies: [{
        id: 'a1',
        units: [{ id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }],
        tile: 't0',
      }],
    },
    script: [{ atTick: 0, commands: [{ t: 'extract' }] }],
  });
  expect(r.status).toBe('extracted');
  expect(r.hash).toBe('5b653528');
});

// ── Muster tile tests (Task 1) ────────────────────────────────────────────────

const musterSetup: MapSetup = {
  tiles: [
    { id: 't0', type: 'start',  owner: 'player', neighbors: { E: 't1' }, garrison: [] },
    { id: 't1', type: 'muster', owner: 'enemy',  neighbors: { W: 't0' }, garrison: [],
      muster: [
        { id: 'm1', side: 'A', attackKind: 'melee', attrs: { str: 4, agi: 4, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
      ] },
  ],
  armies: [{ id: 'a1', tile: 't0', units: [
    { id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
  ] }],
};

it('capturing a muster tile spawns a garrisoned reserve army (muster-<id>) with the tile units, once', () => {
  const run = initRun(musterSetup, 1);
  expect(run.map.armies.some((a) => a.id === 'muster-t1')).toBe(false); // not before capture
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  for (let i = 0; i < 40 && run.map.tiles.find((t) => t.id === 't1')!.owner !== 'player'; i++) runTick(run, []);
  const mustered = run.map.armies.find((a) => a.id === 'muster-t1');
  expect(mustered).toBeDefined();
  expect(mustered!.state).toBe('garrisoned');
  expect(mustered!.tile).toBe('t1');
  expect(mustered!.units.map((u) => u.id)).toEqual(['m1']);
  const countAfter = run.map.armies.filter((a) => a.id === 'muster-t1').length;
  for (let i = 0; i < 5; i++) runTick(run, []);
  expect(run.map.armies.filter((a) => a.id === 'muster-t1').length).toBe(countAfter); // fires once
});

it('a non-muster capture spawns no reserve army', () => {
  // same setup but t1.type = 'enemy', no muster field → after capture, no muster-* army exists
  const s = JSON.parse(JSON.stringify(musterSetup)); s.tiles[1].type = 'enemy'; delete s.tiles[1].muster;
  const run = initRun(s, 1);
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  for (let i = 0; i < 40; i++) runTick(run, []);
  expect(run.map.armies.some((a) => a.id.startsWith('muster-'))).toBe(false);
});

it('cloneUnitSpec isolates the mustered army from the setup', () => {
  const run = initRun(musterSetup, 1);
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  for (let i = 0; i < 40 && !run.map.armies.some((a) => a.id === 'muster-t1'); i++) runTick(run, []);
  run.map.armies.find((a) => a.id === 'muster-t1')!.units[0]!.attrs.str = 999;
  const origSpec = musterSetup.tiles[1]!.muster![0]!;
  expect(origSpec.attrs.str).toBe(4); // setup untouched
});

// ── Boon tile tests (Task 2) ─────────────────────────────────────────────────

const boonSetup: MapSetup = {
  tiles: [
    { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
    { id: 't1', type: 'boon',  owner: 'enemy',  neighbors: { W: 't0' }, garrison: [], boon: { attr: 'str', amount: 3 } },
  ],
  armies: [{ id: 'a1', tile: 't0', units: [
    { id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
  ] }],
};

it('capturing a boon tile adds amount to attr on every player unit, raising derived maxHp, once', () => {
  const run = initRun(boonSetup, 1);
  const u = run.map.armies[0]!.units[0]!;
  const hpBefore = deriveStats(u.attrs, u.attackKind).maxHp;
  expect(u.attrs.str).toBe(5);
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  for (let i = 0; i < 40 && run.map.tiles.find((t) => t.id === 't1')!.owner !== 'player'; i++) runTick(run, []);
  const after = run.map.armies[0]!.units[0]!;
  expect(after.attrs.str).toBe(8);                                   // +3, once
  expect(deriveStats(after.attrs, after.attackKind).maxHp).toBeGreaterThan(hpBefore);
  const strAfterCapture = after.attrs.str;
  for (let i = 0; i < 5; i++) runTick(run, []);
  expect(run.map.armies[0]!.units[0]!.attrs.str).toBe(strAfterCapture); // fires once
});

it('a non-boon capture does not buff', () => {
  const s = JSON.parse(JSON.stringify(boonSetup)); s.tiles[1].type = 'enemy'; delete s.tiles[1].boon;
  const run = initRun(s, 1);
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  for (let i = 0; i < 40; i++) runTick(run, []);
  expect(run.map.armies[0]!.units[0]!.attrs.str).toBe(5); // unchanged
});

it('boon does not bleed into the setup', () => {
  const run = initRun(boonSetup, 1);
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  for (let i = 0; i < 40; i++) runTick(run, []);
  expect(boonSetup.armies[0]!.units[0]!.attrs.str).toBe(5); // setup untouched (army attrs were cloned at initConquest)
});

// ── v4 parity pin tests for muster + boon fixtures (Task 3) ──────────────────
// Mirror the exact bundles used in tools/parity/fixtures.mjs.

it('run-muster-seed1 pin: capture undefended muster tile spawns reserve army muster-t1 → active (hash 205ee9dc)', () => {
  const r = runScriptedRun({
    version: 4,
    seed: 1,
    setup: {
      tiles: [
        { id: 't0', type: 'start',  owner: 'player', neighbors: { E: 't1' }, garrison: [] },
        { id: 't1', type: 'muster', owner: 'enemy',  neighbors: { W: 't0' }, garrison: [],
          muster: [
            { id: 'm1', side: 'A', attackKind: 'melee', attrs: { str: 4, agi: 4, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
          ] },
      ],
      armies: [{
        id: 'a1',
        units: [{ id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }],
        tile: 't0',
      }],
    },
    script: [{ atTick: 0, commands: [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }] }],
  });
  expect(r.status).toBe('active');
  expect(r.hash).toBe('205ee9dc');
});

it('run-boon-seed1 pin: capture undefended boon tile buffs str +3 → derived HP rises → active (hash 2064aa00)', () => {
  const r = runScriptedRun({
    version: 4,
    seed: 1,
    setup: {
      tiles: [
        { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
        { id: 't1', type: 'boon',  owner: 'enemy',  neighbors: { W: 't0' }, garrison: [],
          boon: { attr: 'str', amount: 3 } },
      ],
      armies: [{
        id: 'a1',
        units: [{ id: 'u1', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }],
        tile: 't0',
      }],
    },
    script: [{ atTick: 0, commands: [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }] }],
  });
  expect(r.status).toBe('active');
  expect(r.hash).toBe('2064aa00');
});

// ── v4 parity pin tests for enemy reclaim fixtures (Task 3) ──────────────────
// Mirror the exact bundles used in tools/parity/fixtures.mjs.

const reclaimBundle = {
  version: 4 as const,
  seed: 1,
  setup: {
    enemyReclaims: true,
    tiles: [
      { id: 't0', type: 'start' as const, owner: 'player' as const, neighbors: { E: 't1' }, garrison: [] },
      { id: 't1', type: 'enemy' as const, owner: 'enemy' as const, neighbors: { W: 't0', E: 't2' },
        garrison: [{ id: 'g1', side: 'B' as const, attackKind: 'melee' as const, attrs: { str: 4, agi: 6, int: 3, lck: 3 }, priority: 5, pos: { x: 0, y: 0 } }] },
      { id: 't2', type: 'rest' as const, owner: 'player' as const, neighbors: { W: 't1' }, garrison: [] },
    ],
    armies: [{
      id: 'a1',
      units: [{ id: 'u1', side: 'A' as const, attackKind: 'melee' as const, attrs: { str: 9, agi: 6, int: 3, lck: 3 }, priority: 5, pos: { x: 0, y: 0 } }],
      tile: 't0',
    }],
  },
  script: [{ atTick: 0, commands: [{ t: 'dispatch' as const, armyId: 'a1', toTile: 't1' }] }],
};

const holdBundle = {
  version: 4 as const,
  seed: 1,
  setup: {
    enemyReclaims: true,
    tiles: [
      { id: 't0', type: 'start' as const, owner: 'player' as const, neighbors: { E: 't1' }, garrison: [] },
      { id: 't1', type: 'enemy' as const, owner: 'enemy' as const, neighbors: { W: 't0', E: 't2' },
        garrison: [{ id: 'g1', side: 'B' as const, attackKind: 'melee' as const, attrs: { str: 4, agi: 6, int: 3, lck: 3 }, priority: 5, pos: { x: 0, y: 0 } }] },
      { id: 't2', type: 'rest' as const, owner: 'player' as const, neighbors: { W: 't1' }, garrison: [] },
    ],
    armies: [
      {
        id: 'a1',
        units: [{ id: 'u1', side: 'A' as const, attackKind: 'melee' as const, attrs: { str: 9, agi: 6, int: 3, lck: 3 }, priority: 5, pos: { x: 0, y: 0 } }],
        tile: 't0',
      },
      {
        id: 'a2',
        units: [{ id: 'u2', side: 'A' as const, attackKind: 'melee' as const, attrs: { str: 4, agi: 6, int: 3, lck: 3 }, priority: 5, pos: { x: 0, y: 0 } }],
        tile: 't2',
      },
    ],
  },
  script: [{ atTick: 0, commands: [{ t: 'dispatch' as const, armyId: 'a1', toTile: 't1' }] }],
};

it('run-reclaim-seed1 pin: enemy AI reclaims vacated t0 + undefended t2 while a1 assaults t1 (hash b06ecc1e)', () => {
  const r = runScriptedRun(reclaimBundle);
  expect(r.hash).toBe('b06ecc1e');
  // postcondition: t2 was undefended — enemy AI reclaimed it; verify via direct run
  const run = initRun(reclaimBundle.setup, reclaimBundle.seed);
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  for (let i = 0; i < 200 && run.status === 'active'; i++) runTick(run, []);
  expect(run.map.tiles.find((t) => t.id === 't2')!.owner).toBe('enemy');
});

it('run-hold-seed1 pin: t1 sorties the a2-defended t2; a2 repels g1 (defender wins); a1 captures vacated t1 (hash 9dc7f64d)', () => {
  const r = runScriptedRun(holdBundle);
  expect(r.hash).toBe('9dc7f64d');
  // postcondition: t1 sorties t2 (g1 str=4 vs a2 str=4 — even fight, defender a2 wins);
  //   t2 stays player-owned; a1 captures the now-undefended t1 (garrison committed to sortie).
  const run = initRun(holdBundle.setup, holdBundle.seed);
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  for (let i = 0; i < 200 && run.status === 'active'; i++) runTick(run, []);
  expect(run.map.tiles.find((t) => t.id === 't2')!.owner).toBe('player');            // a2 repelled the sortie
  expect(run.map.events.some((e) => e.t === 'sortie')).toBe(true);                   // sortie fired
  expect(run.map.armies.find((a) => a.id === 'a1')!.tile).toBe('t1');               // a1 captured t1
  expect(run.map.armies.find((a) => a.id === 'a2')!.state).toBe('garrisoned');      // a2 survived
});

// ── Enemy AI / sortie tests (Task 3 — lethal sortie wiring) ──────────────────

const u = (id: string, side: 'A'|'B', str: number) => ({ id, side, attackKind: 'melee' as const, attrs: { str, agi: 6, int: 3, lck: 3 }, priority: 5, pos: { x: 0, y: 0 } });

// s (enemy, garrisoned g1) — E — t (player, defended by army d)
const sortieTilesAndArmies = {
  tiles: [
    { id: 's', type: 'enemy' as const, owner: 'enemy' as const, neighbors: { E: 't' }, garrison: [u('g1','B',6)] },
    { id: 't', type: 'enemy' as const, owner: 'player' as const, neighbors: { W: 's' }, garrison: [] },
  ],
  armies: [{ id: 'd', tile: 't', units: [u('du','A',6)] }],
};

it('a garrisoned enemy tile sorties an adjacent DEFENDED player tile (battle opens, defender contested)', () => {
  const run = initRun({ enemyReclaims: true, ...sortieTilesAndArmies }, 1);
  runTick(run, []);
  expect(run.map.battles.some((b) => b.tile === 't' && b.attackerOwner === 'enemy')).toBe(true);
  expect(run.map.events.some((e) => e.t === 'sortie')).toBe(true);
});

it('enemyReclaims=false ⇒ no sortie', () => {
  const run = initRun({ enemyReclaims: false, ...sortieTilesAndArmies } as any, 1);
  runTick(run, []);
  expect(run.map.battles).toHaveLength(0);
});

// ── effectClaimed tests (Task 1) ──────────────────────────────────────────────

// player start t0 — undefended enemy muster tile t1
const musterMap: MapSetup = {
  tiles: [
    { id: 't0', type: 'start',  owner: 'player', neighbors: { E: 't1' }, garrison: [] },
    { id: 't1', type: 'muster', owner: 'enemy',  neighbors: { W: 't0' }, garrison: [], muster: [u('m1','A',4)] },
  ],
  armies: [{ id: 'a1', tile: 't0', units: [u('a1u','A',9)] }],
};

it('a captured muster tile spawns exactly one reserve, even if re-owned (claimed once ever)', () => {
  const run = initRun(musterMap, 1);
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  for (let i = 0; i < 30 && !run.map.armies.some((a) => a.id === 'muster-t1'); i++) runTick(run, []);
  expect(run.map.armies.filter((a) => a.id === 'muster-t1')).toHaveLength(1);
  // simulate a recapture cycle: flip t1 enemy then back to player, tick again → still ONE muster army
  const t1 = run.map.tiles.find((t) => t.id === 't1')!;
  t1.owner = 'enemy'; runTick(run, []); t1.owner = 'player'; runTick(run, []);
  expect(run.map.armies.filter((a) => a.id === 'muster-t1')).toHaveLength(1);
});

it('a muster tile that STARTS player-owned never fires (you did not capture it)', () => {
  const startOwned: MapSetup = {
    tiles: [{ id: 't0', type: 'muster', owner: 'player', neighbors: {}, garrison: [], muster: [u('m1','A',4)] }],
    armies: [{ id: 'a1', tile: 't0', units: [u('a1u','A',9)] }],
  };
  const run = initRun(startOwned, 1);
  for (let i = 0; i < 5; i++) runTick(run, []);
  expect(run.map.armies.some((a) => a.id.startsWith('muster-'))).toBe(false);
});

// ── Enemy AI / reclaim tests (Task 2) ────────────────────────────────────────

// t0 (player start, defended by a1) — E — t1 (enemy, garrisoned) — E — t2 (player rest, undefended)
const reclaimMap = (enemyReclaims: boolean, t1garr = [u('g1','B',4)]): MapSetup => ({
  enemyReclaims,
  tiles: [
    { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
    { id: 't1', type: 'enemy', owner: 'enemy',  neighbors: { W: 't0', E: 't2' }, garrison: t1garr },
    { id: 't2', type: 'rest',  owner: 'player', neighbors: { W: 't1' }, garrison: [] }, // player-owned but undefended
  ],
  armies: [{ id: 'a1', tile: 't0', units: [u('a1u','A',9)] }],
});

it('a garrisoned enemy tile reclaims an undefended adjacent player tile (and fires a reclaimed event)', () => {
  const run = initRun(reclaimMap(true), 1);
  runTick(run, []); // a1 holds t0 (defended); t2 is undefended → t1 reclaims it
  expect(run.map.tiles.find((t) => t.id === 't2')!.owner).toBe('enemy');
  expect(run.map.tiles.find((t) => t.id === 't0')!.owner).toBe('player'); // defended, held
  expect(run.map.events.some((e) => e.t === 'reclaimed' && e.tile === 't2' && e.by === 't1')).toBe(true);
});

it('enemyReclaims=false ⇒ no reclaim', () => {
  const run = initRun(reclaimMap(false), 1);
  runTick(run, []);
  expect(run.map.tiles.find((t) => t.id === 't2')!.owner).toBe('player');
});

it('an un-garrisoned enemy tile does not reclaim', () => {
  const run = initRun(reclaimMap(true, []), 1); // t1 garrison empty
  runTick(run, []);
  expect(run.map.tiles.find((t) => t.id === 't2')!.owner).toBe('player');
});

it('recapture-no-refire: player captures muster tile, tile flips to enemy, player re-captures — still exactly ONE muster army', () => {
  // Topology: t0 (player start) — E — t1 (muster, enemy) — E — t2 (enemy, no garrison, no boss).
  // Player dispatches a1 to capture t1 (muster fires once). We then manually flip t1 back to
  // enemy (simulating any reclaim; no AI needed) and dispatch a2 to re-capture — effectClaimed
  // blocks a second muster spawn regardless of how ownership was lost.
  const noRefireSetup: MapSetup = {
    enemyReclaims: false, // keep AI off so no sortie interferes with the test flow
    tiles: [
      { id: 't0', type: 'start',  owner: 'player', neighbors: { E: 't1' }, garrison: [] },
      { id: 't1', type: 'muster', owner: 'enemy',  neighbors: { W: 't0', E: 't2' }, garrison: [],
        muster: [u('m1','A',4)] },
      { id: 't2', type: 'enemy',  owner: 'enemy',  neighbors: { W: 't1' }, garrison: [] },
    ],
    armies: [
      { id: 'a1', tile: 't0', units: [u('a1u','A',20)] },
      { id: 'a2', tile: 't0', units: [u('a2u','A',20)] },
    ],
  };
  const run = initRun(noRefireSetup, 1);

  // Step 1: dispatch a1 to capture t1 (muster)
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }]);
  for (let i = 0; i < 50 && run.map.tiles.find((t) => t.id === 't1')!.owner !== 'player'; i++) runTick(run, []);
  expect(run.map.tiles.find((t) => t.id === 't1')!.owner).toBe('player');
  expect(run.map.armies.filter((a) => a.id === 'muster-t1')).toHaveLength(1); // first spawn

  // Step 2: manually flip t1 back to enemy (simulates any reclaim/sortie-loss scenario)
  const t1 = run.map.tiles.find((t) => t.id === 't1')!;
  t1.owner = 'enemy';

  // Step 3: dispatch a2 to re-capture t1 (fight-free: garrison was wiped on first capture)
  runTick(run, [{ t: 'dispatch', armyId: 'a2', toTile: 't1' }]);
  for (let i = 0; i < 50 && run.map.tiles.find((t) => t.id === 't1')!.owner !== 'player'; i++) runTick(run, []);
  expect(run.map.tiles.find((t) => t.id === 't1')!.owner).toBe('player');

  // effectClaimed prevents a second muster spawn — still exactly ONE muster-t1 army
  expect(run.map.armies.filter((a) => a.id === 'muster-t1')).toHaveLength(1);
});
