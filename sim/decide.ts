import type { Unit, TraitId, Temperament } from '../shared/types';
import type { Grid } from './grid';
import { chebyshev, hasLineOfSight } from './grid';
import { COWARD_FLEE_BP, RALLY_TICKS, LEADER_RADIUS, SKILL_COST, CLEAVE_RADIUS, CLEAVE_MIN_TARGETS, VALVE_TICKS, LEAN_VALVE_DELTA } from '../shared/config';

export type MoveMode = 'engage' | 'flee' | 'retreat';
export type ActionKind = 'cast' | 'basic' | 'none';
export interface FightCtx { totalTicks: number; units: Unit[]; grid: Grid; }
export interface TurnIntent { targetId: string | null; move: MoveMode; charge: boolean; }

// Personality lean key: inserted BETWEEN priority desc and id asc tie-breaks.
// Uses BASE derived.atk only (not effectiveDerived) to keep this a soft lean
// and avoid circular imports (decide.ts must not import stats.ts).
function leanKey(t: Temperament | undefined, e: Unit): number {
  if (t === 'hotheaded') return e.hp;        // go for the kill (asc → lower HP first)
  if (t === 'brave') return -e.derived.atk;  // most dangerous first (asc → highest atk first)
  if (t === 'cautious') return e.derived.atk; // least dangerous first (asc → lowest atk first)
  return 0;                                   // stoic / none → neutral
}

// Nearest living enemy; tiebreak higher priority, then personality lean, then id asc.
// (Moved verbatim from tile-fight.ts — this is the baseline "priority/targeting" layer.)
export function chooseTarget(actor: Unit, units: Unit[]): Unit | null {
  const enemies = units.filter((u) => u.hp > 0 && !u.exited && u.side !== actor.side);
  if (enemies.length === 0) return null;
  enemies.sort((x, y) =>
    chebyshev(actor.pos, x.pos) - chebyshev(actor.pos, y.pos) ||
    y.priority - x.priority ||
    (leanKey(actor.temperament, x) - leanKey(actor.temperament, y)) ||
    (x.id < y.id ? -1 : 1));
  return enemies[0]!;
}

function nearestEnemy(actor: Unit, units: Unit[]): Unit | null {
  const en = units.filter((u) => u.hp > 0 && !u.exited && u.side !== actor.side);
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
  // 0. retreat order (top precedence; Bloodthirsty suppresses it)
  if (actor.retreating && !hasTrait(actor, 'bloodthirsty')) {
    return { targetId: null, move: 'retreat', charge: false };
  }
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

// Living enemies within CLEAVE_RADIUS with LoS; sorted chebyshev asc → priority desc → id asc.
export function cleaveTargets(actor: Unit, ctx: FightCtx): Unit[] {
  return ctx.units
    .filter((u) => u.hp > 0 && !u.exited && u.side !== actor.side
      && chebyshev(actor.pos, u.pos) <= CLEAVE_RADIUS
      && hasLineOfSight(actor.pos, u.pos, (c) => ctx.grid.isBlocked(c)))
    .sort((x, y) =>
      chebyshev(actor.pos, x.pos) - chebyshev(actor.pos, y.pos) ||
      y.priority - x.priority ||
      (x.id < y.id ? -1 : 1));
}

// Whether the actor's skill condition is met for casting (target is passed for single-target skills).
export function castCondition(actor: Unit, _target: Unit, ctx: FightCtx): boolean {
  if (actor.skill === 'cleave') return cleaveTargets(actor, ctx).length >= CLEAVE_MIN_TARGETS;
  return true; // heavyStrike: in-position is sufficient
}

// Effective valve threshold (VALVE_TICKS + personality delta from Task 6).
export function effectiveValveTicks(actor: Unit): number {
  if (actor.temperament === 'hotheaded') return Math.max(0, VALVE_TICKS - LEAN_VALVE_DELTA);
  if (actor.temperament === 'cautious') return VALVE_TICKS + LEAN_VALVE_DELTA;
  return VALVE_TICKS; // brave / stoic / none → neutral
}

export function decideAction(actor: Unit, target: Unit, ctx: FightCtx): 'cast' | 'basic' {
  if (!actor.skill || actor.mana < SKILL_COST[actor.skill]) return 'basic';
  if (castCondition(actor, target, ctx)) return 'cast';
  // valve: affordable but condition unmet for >= effectiveValveTicks → force-cast
  if (actor.stallSinceTick >= 0 && ctx.totalTicks - actor.stallSinceTick >= effectiveValveTicks(actor)) return 'cast';
  return 'basic';
}

export function hasTrait(unit: Unit, id: TraitId): boolean { return unit.traits.includes(id); }

export function proxyLeader(unit: Unit, units: Unit[]): Unit | null {
  const allies = units.filter((u) => u.hp > 0 && !u.exited && u.side === unit.side && u.id !== unit.id);
  if (allies.length === 0) return null;
  allies.sort((x, y) => y.priority - x.priority || (x.id < y.id ? -1 : 1));
  return allies[0]!;
}
