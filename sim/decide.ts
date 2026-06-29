import type { Unit, TraitId } from '../shared/types';
import type { Grid } from './grid';
import { chebyshev } from './grid';
import { HEAVY_STRIKE_COST, COWARD_FLEE_BP, RALLY_TICKS, LEADER_RADIUS } from '../shared/config';

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

function nearestEnemy(actor: Unit, units: Unit[]): Unit | null {
  const en = units.filter((u) => u.hp > 0 && u.side !== actor.side);
  if (en.length === 0) return null;
  en.sort((x, y) => chebyshev(actor.pos, x.pos) - chebyshev(actor.pos, y.pos) || (x.id < y.id ? -1 : 1));
  return en[0]!;
}

function cowardFlees(actor: Unit, ctx: FightCtx): boolean {
  if (!hasTrait(actor, 'coward') || hasTrait(actor, 'bloodthirsty')) return false;
  const lowHp = actor.hp * 10000 <= COWARD_FLEE_BP * actor.derived.maxHp;
  if (!lowHp || actor.fleeingSinceTick < 0) return false;
  if (ctx.totalTicks - actor.fleeingSinceTick >= RALLY_TICKS) return false; // time-valve rally
  const leader = proxyLeader(actor, ctx.units);
  if (leader && chebyshev(actor.pos, leader.pos) <= LEADER_RADIUS) return false; // near-leader rally
  return true;
}

export function decideTurn(actor: Unit, ctx: FightCtx): TurnIntent {
  // 1. trait decision hooks
  if (cowardFlees(actor, ctx)) {
    const t = nearestEnemy(actor, ctx.units);
    return { targetId: t ? t.id : null, move: 'flee', charge: false };
  }
  if (hasTrait(actor, 'headstrong')) {
    const t = nearestEnemy(actor, ctx.units);
    return { targetId: t ? t.id : null, move: 'engage', charge: true };
  }
  // 2. priority/targeting
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
