import type { Unit, TraitId } from '../shared/types';
import type { Grid } from './grid';
import { chebyshev } from './grid';
import { HEAVY_STRIKE_COST } from '../shared/config';

export type MoveMode = 'engage' | 'flee';
export type ActionKind = 'cast' | 'basic' | 'none';
export interface FightCtx { totalTicks: number; units: Unit[]; grid: Grid; }
export interface TurnIntent { targetId: string | null; move: MoveMode; charge: boolean; }

// Nearest living enemy; tiebreak higher priority, then id asc. (Moved verbatim
// from tile-fight.ts — this is the baseline "priority/targeting" layer.)
export function chooseTarget(actor: Unit, units: Unit[]): Unit | null {
  const enemies = units.filter((u) => u.hp > 0 && u.side !== actor.side);
  if (enemies.length === 0) return null;
  enemies.sort((x, y) =>
    chebyshev(actor.pos, x.pos) - chebyshev(actor.pos, y.pos) ||
    y.priority - x.priority ||
    (x.id < y.id ? -1 : 1));
  return enemies[0]!;
}

export function decideTurn(actor: Unit, ctx: FightCtx): TurnIntent {
  const target = chooseTarget(actor, ctx.units);
  return { targetId: target ? target.id : null, move: 'engage', charge: false };
}

export function decideAction(actor: Unit, _target: Unit, _ctx: FightCtx): 'cast' | 'basic' {
  return actor.skill === 'heavyStrike' && actor.mana >= HEAVY_STRIKE_COST ? 'cast' : 'basic';
}

export function hasTrait(unit: Unit, id: TraitId): boolean { return unit.traits.includes(id); }

export function proxyLeader(unit: Unit, units: Unit[]): Unit | null {
  const allies = units.filter((u) => u.hp > 0 && u.side === unit.side && u.id !== unit.id);
  if (allies.length === 0) return null;
  allies.sort((x, y) => y.priority - x.priority || (x.id < y.id ? -1 : 1));
  return allies[0]!;
}
