import type { MapSetup } from '../shared/types';
import type { MapState } from './conquest-map';
import { initConquest, hashMap } from './conquest-map';
import { fnv1a } from './hash';

export interface RunState { map: MapState; status: 'active' | 'won' | 'lost' | 'extracted'; }

export function initRun(setup: MapSetup, seed = 0): RunState {
  return { map: initConquest(setup, seed), status: 'active' };
}

export function hashRun(run: RunState): string {
  return fnv1a(`${hashMap(run.map)}#${run.status}`);
}
