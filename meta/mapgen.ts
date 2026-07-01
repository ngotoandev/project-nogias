import type { MapSetup, MapTile, UnitSpec, TileType, BoonSpec } from '../shared/types';
import { makeRng } from '../shared/rng';

export type MapSize = 'small' | 'medium' | 'large';

const DIMS: Record<MapSize, { w: number; h: number }> = {
  small: { w: 4, h: 3 }, medium: { w: 5, h: 3 }, large: { w: 6, h: 4 },
};

// Generation tunables (meta-only; NOT combat config).
const RECOVERY_BASE_BP = 1500;    // 15% baseline chance an enemy tile is recovery
const RECOVERY_SLOPE_BP = 4000;   // + up to +40% by the last column
const GARRISON_STR_BASE = 3;      // plain-enemy garrison str at column 1
const GARRISON_STR_STEP = 3;      // + per column toward the boss
const BOSS_STR_BONUS = 6;         // boss garrison extra str
const RECOVERY_TYPES: TileType[] = ['rest', 'muster', 'boon'];

const tid = (c: number, r: number): string => `c${c}r${r}`;
const colOf = (id: string): number => parseInt(id.slice(1, id.indexOf('r')), 10);
const isRecovery = (t: TileType): boolean => t === 'rest' || t === 'muster' || t === 'boon';

function unit(id: string, side: 'A' | 'B', str: number): UnitSpec {
  return { id, side, attackKind: 'melee', attrs: { str, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } };
}

export function generateMap(seed: number, size: MapSize = 'medium'): MapSetup {
  const rng = makeRng(seed);
  const { w, h } = DIMS[size];
  const mid = h >> 1;
  const startId = tid(0, mid);
  const bossId = tid(w - 1, mid);
  const tiles: MapTile[] = [];

  for (let c = 0; c < w; c++) {
    for (let r = 0; r < h; r++) {
      const id = tid(c, r);
      const neighbors: MapTile['neighbors'] = {};
      if (r > 0) neighbors.N = tid(c, r - 1);
      if (r < h - 1) neighbors.S = tid(c, r + 1);
      if (c > 0) neighbors.W = tid(c - 1, r);
      if (c < w - 1) neighbors.E = tid(c + 1, r);
      const owner: MapTile['owner'] = c === 0 ? 'player' : 'enemy';

      let type: TileType = 'enemy';
      let garrison: UnitSpec[] = [];
      let muster: UnitSpec[] | undefined;
      let boon: BoonSpec | undefined;

      if (id === bossId) {
        type = 'boss';
        garrison = [unit(`g_${id}`, 'B', GARRISON_STR_BASE + (w - 1) * GARRISON_STR_STEP + BOSS_STR_BONUS)];
      } else if (owner === 'player') {
        type = 'start';
      } else {
        const p = RECOVERY_BASE_BP + Math.floor((RECOVERY_SLOPE_BP * c) / (w - 1));
        if (rng.intInRange(0, 9999) < p) {
          type = RECOVERY_TYPES[rng.intInRange(0, RECOVERY_TYPES.length - 1)]!;
          if (type === 'muster') muster = [unit(`m_${id}`, 'A', 4)];
          if (type === 'boon') boon = { attr: 'str', amount: 2 };
          // recovery tiles are un-garrisoned — sustain must be reachable
        } else {
          garrison = [unit(`g_${id}`, 'B', GARRISON_STR_BASE + c * GARRISON_STR_STEP)];
        }
      }
      const tile: MapTile = { id, type, owner, neighbors, garrison };
      if (muster) tile.muster = muster;
      if (boon) tile.boon = boon;
      tiles.push(tile);
    }
  }

  // Guarantee ≥1 recovery tile in the final third of columns (the spread principle).
  const lastThird = w - Math.max(1, Math.floor(w / 3));
  if (!tiles.some((t) => t.id !== bossId && colOf(t.id) >= lastThird && isRecovery(t.type))) {
    const cand = tiles.find((t) => t.owner === 'enemy' && t.type === 'enemy' && colOf(t.id) >= lastThird);
    if (cand) { cand.type = 'rest'; cand.garrison = []; }
  }

  const armies = [{ id: 'p1', tile: startId, units: [unit('p1u1', 'A', 6), unit('p1u2', 'A', 6), unit('p1u3', 'A', 6)] }];
  return { tiles, armies, enemyReclaims: false };
}
