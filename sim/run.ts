import type { MapSetup, MapCommand, RunCommand, UnitSpec } from '../shared/types';
import type { MapState } from './conquest-map';
import { initConquest, advance, hashMap } from './conquest-map';
import { fnv1a } from './hash';
import { deriveStats } from './stats';
import { REST_HEAL_PER_TICK } from '../shared/config';

export interface RunState { map: MapState; status: 'active' | 'won' | 'lost' | 'extracted'; enemyReclaims: boolean; }

export function initRun(setup: MapSetup, seed = 0): RunState {
  const map = initConquest(setup, seed);
  for (const t of map.tiles) if (t.owner === 'player') t.effectClaimed = true; // started-owned ⇒ not captured ⇒ never fires
  return { map, status: 'active', enemyReclaims: !!setup.enemyReclaims };
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

function cloneUnitSpec(u: UnitSpec): UnitSpec {
  return { ...u, attrs: { ...u.attrs }, pos: { ...u.pos },
    traits: u.traits ? u.traits.slice() : undefined,
    personality: u.personality ? { ...u.personality } : undefined };
}

function applyCaptureEffects(map: MapState): void {
  for (const tile of map.tiles) {
    if (tile.owner !== 'player' || tile.effectClaimed) continue; // fire at most once ever, on first player-ownership
    let fired = false;
    if (tile.type === 'muster' && tile.muster && tile.muster.length > 0) {
      map.armies.push({ id: `muster-${tile.id}`, units: tile.muster.map(cloneUnitSpec),
        tile: tile.id, state: 'garrisoned', travelGauge: 0 });
      fired = true;
    }
    if (tile.type === 'boon' && tile.boon) {
      const boon = tile.boon;
      for (const army of map.armies) {
        for (const u of army.units) {
          u.attrs[boon.attr] += boon.amount;
        }
      }
      fired = true;
    }
    if (fired) tile.effectClaimed = true;
  }
}

function applyRestHealing(map: MapState): void {
  for (const army of map.armies) {
    if (army.state !== 'garrisoned') continue;
    const tile = map.tiles.find((t) => t.id === army.tile);
    if (!tile || tile.type !== 'rest' || tile.owner !== 'player') continue;
    for (const u of army.units) {
      const maxHp = deriveStats(u.attrs, u.attackKind).maxHp;
      const cur = u.startHp ?? maxHp;
      if (cur < maxHp) u.startHp = Math.min(maxHp, cur + REST_HEAL_PER_TICK);
    }
  }
}

function applyEnemyAI(map: MapState): void {
  const defended = new Set(map.armies.map((a) => a.tile)); // a player army on a tile holds it
  for (const tile of map.tiles) {                          // id-ordered by construction
    if (tile.owner !== 'enemy' || tile.garrison.length === 0) continue;
    for (const e of ['N', 'S', 'E', 'W'] as const) {
      const nb = tile.neighbors[e]; if (!nb) continue;
      const nt = map.tiles.find((t) => t.id === nb);
      if (nt && nt.owner === 'player' && !defended.has(nb)) {
        nt.owner = 'enemy';
        map.events.push({ t: 'reclaimed', tile: nb, by: tile.id });
        break; // one reclaim per enemy tile per tick
      }
    }
  }
}

export function runTick(run: RunState, commands: RunCommand[]): RunState {
  if (run.status !== 'active') return run;                          // terminal status is sticky
  if (commands.some((c) => c.t === 'extract')) { run.status = 'extracted'; return run; }
  const mapCommands = commands.filter((c): c is MapCommand => c.t !== 'extract');
  advance(run.map, mapCommands);
  applyRestHealing(run.map);
  applyCaptureEffects(run.map);          // was applyCaptureEffects(run.map, ownedBefore)
  if (run.enemyReclaims) applyEnemyAI(run.map);
  if (isWon(run.map)) run.status = 'won';
  else if (isLost(run.map)) run.status = 'lost';
  return run;
}
