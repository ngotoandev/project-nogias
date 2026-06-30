import { it, expect } from 'vitest';
import { initRun, hashRun, type RunState } from './run';
import type { MapSetup } from '../shared/types';

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
