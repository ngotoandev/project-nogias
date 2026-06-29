import type { MapSetup, MapState, Army } from '../shared/types';
import { fnv1a } from './hash';

export function initConquest(setup: MapSetup): MapState {
  const tiles = setup.tiles.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((t) => ({ ...t, neighbors: { ...t.neighbors }, garrison: t.garrison.map((u) => ({ ...u })) }));
  const armies: Army[] = setup.armies.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((a) => ({ id: a.id, units: a.units.map((u) => ({ ...u })), tile: a.tile, state: 'garrisoned', travelGauge: 0 }));
  return { tiles, armies, totalTicks: 0, events: [] };
}

export function hashMap(state: MapState): string {
  const tilePart = state.tiles.slice().sort((a, b) => (a.id < b.id ? -1 : 1)).map((t) => `${t.id}:${t.owner}`).join(',');
  const armyPart = state.armies.slice().sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((a) => `${a.id}:${a.tile}:${a.state}:${a.target ?? '-'}`).join(',');
  return fnv1a(`${tilePart}#${armyPart}#${state.totalTicks}`);
}
