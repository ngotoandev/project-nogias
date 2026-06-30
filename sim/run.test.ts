import { it, expect } from 'vitest';
import { initRun, hashRun, runTick, type RunState } from './run';
import type { MapSetup, RunCommand } from '../shared/types';
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
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }] as RunCommand[]);
  // dispatched this tick → travelling; subsequent ticks move it (no same-tick move per Plan 2)
  expect(run.map.armies[0]!.state === 'travelling' || run.map.armies[0]!.tile !== 't0').toBe(true);
  expect(run.status).toBe('active');
});

it('capturing the (undefended) boss tile wins the run', () => {
  const run = initRun(bossSetup, 1);
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }] as RunCommand[]);
  for (let i = 0; i < 50 && run.status === 'active'; i++) runTick(run, []);
  expect(run.map.tiles.find((t) => t.id === 't1')!.owner).toBe('player');
  expect(run.status).toBe('won');
});

it('extract ends the run as extracted, before any movement', () => {
  const run = initRun(bossSetup, 1);
  runTick(run, [{ t: 'extract' }, { t: 'dispatch', armyId: 'a1', toTile: 't1' }] as RunCommand[]);
  expect(run.status).toBe('extracted');
  expect(run.map.armies[0]!.tile).toBe('t0'); // dispatch was NOT applied
});

it('a terminal run is a no-op', () => {
  const run = initRun(bossSetup, 1);
  run.status = 'won';
  const before = run.map.totalTicks;
  runTick(run, [{ t: 'dispatch', armyId: 'a1', toTile: 't1' }] as RunCommand[]);
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
