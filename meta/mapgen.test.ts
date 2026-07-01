import { describe, it, expect } from 'vitest';
import { generateMap } from './mapgen';
import type { MapSetup } from '../shared/types';

const colOf = (id: string): number => parseInt(id.slice(1, id.indexOf('r')), 10);
const RECOVERY = new Set(['rest', 'muster', 'boon']);

function connectedCount(setup: MapSetup): number {
  const byId = new Map(setup.tiles.map((t) => [t.id, t]));
  const seen = new Set<string>([setup.tiles[0]!.id]);
  const q = [setup.tiles[0]!.id];
  while (q.length) {
    const t = byId.get(q.shift()!)!;
    for (const e of ['N', 'S', 'E', 'W'] as const) {
      const nb = t.neighbors[e];
      if (nb && !seen.has(nb)) { seen.add(nb); q.push(nb); }
    }
  }
  return seen.size;
}

describe('generateMap', () => {
  it('is deterministic: same (seed,size) ⇒ deep-equal, different seed ⇒ differs', () => {
    expect(generateMap(42, 'medium')).toEqual(generateMap(42, 'medium'));
    expect(generateMap(42, 'medium')).not.toEqual(generateMap(43, 'medium'));
  });

  it('builds a W×H grid with reciprocal, in-bounds neighbors and is fully connected', () => {
    const m = generateMap(1, 'medium');                 // 5×3
    expect(m.tiles.length).toBe(15);
    const byId = new Map(m.tiles.map((t) => [t.id, t]));
    for (const t of m.tiles) {
      for (const e of ['N', 'S', 'E', 'W'] as const) {
        const nb = t.neighbors[e]; if (!nb) continue;
        expect(byId.has(nb)).toBe(true);
        const opp = { N: 'S', S: 'N', E: 'W', W: 'E' } as const;
        expect(byId.get(nb)!.neighbors[opp[e]]).toBe(t.id);
      }
    }
    expect(connectedCount(m)).toBe(15);
  });

  it('starts the player in column 0 with one army on the start tile; one enemy boss at the far column', () => {
    const m = generateMap(1, 'medium');                 // 5×3, mid row = 1
    expect(m.tiles.filter((t) => colOf(t.id) === 0).every((t) => t.owner === 'player')).toBe(true);
    expect(m.armies.length).toBe(1);
    expect(m.armies[0]!.tile).toBe('c0r1');
    const bosses = m.tiles.filter((t) => t.type === 'boss');
    expect(bosses.length).toBe(1);
    expect(bosses[0]!.id).toBe('c4r1');
    expect(bosses[0]!.owner).toBe('enemy');
    expect(m.enemyReclaims).toBe(false);
    expect(m.tiles.every((t) => ['start', 'enemy', 'boss', 'rest', 'muster', 'boon'].includes(t.type))).toBe(true);
  });

  it('spreads recovery toward later columns: ≥1 recovery tile in the final third', () => {
    const m = generateMap(1, 'large');                  // 6×4
    const w = 6, lastThird = w - Math.max(1, Math.floor(w / 3)); // = 4
    const lateRecovery = m.tiles.filter((t) => t.type !== 'boss' && colOf(t.id) >= lastThird && RECOVERY.has(t.type));
    expect(lateRecovery.length).toBeGreaterThanOrEqual(1);
    expect(m.tiles.some((t) => RECOVERY.has(t.type))).toBe(true);
  });

  it('scales plain-enemy garrison strength non-decreasingly by column', () => {
    const m = generateMap(1, 'large');
    const strByCol = m.tiles.filter((t) => t.type === 'enemy')
      .map((t) => ({ c: colOf(t.id), str: t.garrison[0]!.attrs.str }))
      .sort((a, b) => a.c - b.c);
    for (let i = 1; i < strByCol.length; i++) expect(strByCol[i]!.str).toBeGreaterThanOrEqual(strByCol[i - 1]!.str);
  });
});
