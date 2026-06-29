import { describe, it, expect } from 'vitest';
import { initConquest, hashMap } from './conquest-map';
import type { MapSetup } from '../shared/types';

// 3 tiles in a row: t0(player) — t1(neutral, empty) — t2(enemy, garrison). Helper builds it.
function setup(): MapSetup {
  const u = (id: string) => ({ id, side: 'B' as const, attackKind: 'melee' as const, attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } });
  return {
    tiles: [
      { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
      { id: 't1', type: 'cache', owner: 'neutral', neighbors: { W: 't0', E: 't2' }, garrison: [] },
      { id: 't2', type: 'enemy',  owner: 'enemy',   neighbors: { W: 't1' }, garrison: [u('g1')] },
    ],
    armies: [{ id: 'a1', units: [{ id: 'a1u', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } }], tile: 't0' }],
  };
}

it('initConquest builds state with garrisoned armies at gauge 0', () => {
  const s = initConquest(setup());
  expect(s.totalTicks).toBe(0);
  expect(s.armies[0]).toMatchObject({ id: 'a1', tile: 't0', state: 'garrisoned', travelGauge: 0 });
  expect(s.tiles.find(t => t.id === 't0')!.owner).toBe('player');
});
it('hashMap is stable and independent of input tile/army ordering', () => {
  const a = initConquest(setup());
  const b = initConquest(setup()); // re-build; same content
  expect(hashMap(a)).toBe(hashMap(b));
  // reorder tiles in the input → same hash (sorted by id internally)
  const reordered = setup(); reordered.tiles.reverse();
  expect(hashMap(initConquest(reordered))).toBe(hashMap(a));
});
it('hashMap changes when an owner changes', () => {
  const s = initConquest(setup());
  const h0 = hashMap(s);
  s.tiles.find(t => t.id === 't1')!.owner = 'player';
  expect(hashMap(s)).not.toBe(h0);
});
it('initConquest deep-copies: mutating returned state does not bleed into setup input', () => {
  const input = setup();
  const origArmyStr = input.armies[0]!.units[0]!.attrs.str;
  const origGarrisonPosX = input.tiles[2]!.garrison[0]!.pos.x;

  const state = initConquest(input);

  // Mutate returned state's nested fields
  state.armies[0]!.units[0]!.attrs.str = 99;
  state.tiles.find(t => t.id === 't2')!.garrison[0]!.pos.x = 42;

  // Input must be unchanged (deep-copy contract)
  expect(input.armies[0]!.units[0]!.attrs.str).toBe(origArmyStr);
  expect(input.tiles[2]!.garrison[0]!.pos.x).toBe(origGarrisonPosX);
});
