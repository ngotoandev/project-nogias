import type { MapSetup, MapCommand, RunCommand } from '../shared/types';
import type { MapState } from './conquest-map';
import { initConquest, advance, hashMap } from './conquest-map';
import { fnv1a } from './hash';

export interface RunState { map: MapState; status: 'active' | 'won' | 'lost' | 'extracted'; }

export function initRun(setup: MapSetup, seed = 0): RunState {
  return { map: initConquest(setup, seed), status: 'active' };
}

export function hashRun(run: RunState): string {
  return fnv1a(`${hashMap(run.map)}#${run.status}`);
}

function isWon(map: MapState): boolean {
  const bosses = map.tiles.filter((t) => t.type === 'boss');
  return bosses.length > 0 && bosses.every((t) => t.owner === 'player');
}

function isLost(map: MapState): boolean {
  return map.armies.length === 0;
}

export function runTick(run: RunState, commands: RunCommand[]): RunState {
  if (run.status !== 'active') return run;                          // terminal status is sticky
  if (commands.some((c) => c.t === 'extract')) { run.status = 'extracted'; return run; }
  const mapCommands = commands.filter((c): c is MapCommand => c.t !== 'extract');
  advance(run.map, mapCommands);
  // (Rest healing is added in Task 3, between advance and the win/lose check.)
  if (isWon(run.map)) run.status = 'won';
  else if (isLost(run.map)) run.status = 'lost';
  return run;
}
