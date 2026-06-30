import { it, expect } from 'vitest';
import { initRun, hashRun, runTick, type RunState } from './run';
import type { MapSetup, RunCommand } from '../shared/types';

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
