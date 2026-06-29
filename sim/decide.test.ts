import { describe, it, expect } from 'vitest';
import { makeGrid, chebyshev } from './grid';
import { deriveStats } from './stats';
import { chooseTarget, decideTurn, decideAction, cleaveTargets, castCondition } from './decide';
import type { Unit } from '../shared/types';
import type { AttackKind, SkillId } from '../shared/types';
import { RALLY_TICKS, LEADER_RADIUS, CLEAVE_COST, CLEAVE_MIN_TARGETS, VALVE_TICKS } from '../shared/config';

function u(id: string, side: 'A' | 'B', x: number, y: number, opts: Partial<Unit> = {}): Unit {
  const attrs = opts.attrs ?? { str: 5, agi: 5, int: 1, lck: 1 };
  const kind: AttackKind = 'melee';
  const derived = deriveStats(attrs, kind);
  return { id, side, attrs, priority: opts.priority ?? 5, pos: { x, y }, hp: opts.hp ?? derived.maxHp,
    derived, gauge: 0, mana: opts.mana ?? 0, skill: opts.skill,
    traits: opts.traits ?? [], kills: opts.kills ?? 0, stallSinceTick: -1, fleeingSinceTick: -1 };
}

const ctx = (units: Unit[], totalTicks = 0) => ({ totalTicks, units, grid: makeGrid({ width: 8, height: 8, blocked: [] }) });
const grid = makeGrid({ width: 8, height: 8, blocked: [] });

describe('decideTurn (baseline)', () => {
  it('targets the nearest enemy, engage mode, no charge', () => {
    const a = u('a1', 'A', 0, 0), b = u('b1', 'B', 2, 0), c = u('b2', 'B', 5, 0);
    const intent = decideTurn(a, ctx([a, b, c]));
    expect(intent).toEqual({ targetId: 'b1', move: 'engage', charge: false });
  });
  it('null target when no enemies', () => {
    const a = u('a1', 'A', 0, 0);
    expect(decideTurn(a, ctx([a])).targetId).toBeNull();
  });
});

describe('decideTurn (Coward trait)', () => {
  it('coward at low HP flees (move=flee)', () => {
    const c = u('c', 'A', 4, 4); c.traits = ['coward']; c.hp = 1; c.fleeingSinceTick = 5;
    const e = u('e', 'B', 4, 0);
    expect(decideTurn(c, { totalTicks: 10, units: [c, e], grid }).move).toBe('flee');
  });

  it('coward rallies (engage) once fleeing >= RALLY_TICKS', () => {
    const c = u('c', 'A', 4, 4); c.traits = ['coward']; c.hp = 1; c.fleeingSinceTick = 0;
    const e = u('e', 'B', 4, 0);
    expect(decideTurn(c, { totalTicks: RALLY_TICKS, units: [c, e], grid }).move).toBe('engage');
  });

  it('coward does NOT flee when fleeingSinceTick < 0 (healthy, clock not started)', () => {
    const c = u('c', 'A', 4, 4); c.traits = ['coward']; c.hp = 1; c.fleeingSinceTick = -1;
    const e = u('e', 'B', 4, 0);
    expect(decideTurn(c, { totalTicks: 10, units: [c, e], grid }).move).toBe('engage');
  });

  it('coward rallies near the proxy leader', () => {
    // ally higher-priority within LEADER_RADIUS → engage
    const c = u('c', 'A', 4, 4); c.traits = ['coward']; c.hp = 1; c.fleeingSinceTick = 5;
    const ally = u('ldr', 'A', 4 + LEADER_RADIUS, 4); ally.priority = 9; // higher priority = proxy leader
    const e = u('e', 'B', 4, 0);
    expect(decideTurn(c, { totalTicks: 10, units: [c, ally, e], grid }).move).toBe('engage');
  });

  it('bloodthirsty suppresses coward flee (will not retreat)', () => {
    const c = u('c', 'A', 4, 4); c.traits = ['coward', 'bloodthirsty']; c.hp = 1; c.fleeingSinceTick = 1;
    const e = u('e', 'B', 4, 0);
    expect(decideTurn(c, { totalTicks: 2, units: [c, e], grid }).move).toBe('engage');
  });
});

describe('decideTurn (Headstrong trait)', () => {
  it('headstrong targets nearest and sets charge=true', () => {
    const h = u('h', 'A', 0, 0); h.traits = ['headstrong'];
    const near = u('n', 'B', 3, 0); near.priority = 0;
    const far = u('f', 'B', 2, 5); far.priority = 9;
    const intent = decideTurn(h, { totalTicks: 0, units: [h, near, far], grid });
    expect(intent.charge).toBe(true);
    expect(intent.targetId).toBe('n'); // chebyshev 3 < 5, ignoring priority
  });

  it('headstrong sets move=engage', () => {
    const h = u('h', 'A', 0, 0); h.traits = ['headstrong'];
    const e = u('e', 'B', 5, 5);
    const intent = decideTurn(h, { totalTicks: 0, units: [h, e], grid });
    expect(intent.move).toBe('engage');
  });
});

describe('decideAction (baseline)', () => {
  it('casts when skilled and mana >= cost', () => {
    const a = u('a1', 'A', 0, 0, { skill: 'heavyStrike' as SkillId, mana: 70 });
    const b = u('b1', 'B', 1, 0);
    expect(decideAction(a, b, ctx([a, b]))).toBe('cast');
  });
  it('basic when unskilled or under cost', () => {
    const a = u('a1', 'A', 0, 0, { skill: 'heavyStrike' as SkillId, mana: 69 });
    const b = u('b1', 'B', 1, 0);
    expect(decideAction(a, b, ctx([a, b]))).toBe('basic');
    const a2 = u('a2', 'A', 0, 0);
    expect(decideAction(a2, b, ctx([a2, b]))).toBe('basic');
  });
});

describe('cleaveTargets', () => {
  it('returns living enemies within CLEAVE_RADIUS with LoS', () => {
    // actor at (4,4); two enemies adjacent (chebyshev=1); one far (chebyshev=3)
    const actor = u('a', 'A', 4, 4);
    const near1 = u('e1', 'B', 4, 5);  // chebyshev=1
    const near2 = u('e2', 'B', 5, 4);  // chebyshev=1
    const far   = u('e3', 'B', 4, 7);  // chebyshev=3 — outside radius
    const targets = cleaveTargets(actor, ctx([actor, near1, near2, far]));
    expect(targets.map((t) => t.id).sort()).toEqual(['e1', 'e2']);
  });

  it('sorts by chebyshev asc, then priority desc, then id asc', () => {
    const actor = u('a', 'A', 0, 0);
    const e1 = u('e1', 'B', 1, 0, { priority: 5 }); // chebyshev=1
    const e2 = u('e2', 'B', 0, 1, { priority: 9 }); // chebyshev=1, higher priority
    const targets = cleaveTargets(actor, ctx([actor, e1, e2]));
    // same chebyshev; e2 priority 9 > e1 priority 5 → e2 first
    expect(targets[0]!.id).toBe('e2');
    expect(targets[1]!.id).toBe('e1');
  });

  it('excludes dead enemies', () => {
    const actor = u('a', 'A', 0, 0);
    const dead  = u('d', 'B', 1, 0, { hp: 0 });
    const alive = u('al', 'B', 0, 1);
    const targets = cleaveTargets(actor, ctx([actor, dead, alive]));
    expect(targets.every((t) => t.hp > 0)).toBe(true);
    expect(targets.map((t) => t.id)).toEqual(['al']);
  });

  it('excludes allies', () => {
    const actor = u('a', 'A', 0, 0);
    const ally  = u('al', 'A', 1, 0);
    const enemy = u('e1', 'B', 0, 1);
    const targets = cleaveTargets(actor, ctx([actor, ally, enemy]));
    expect(targets.map((t) => t.id)).toEqual(['e1']);
  });
});

describe('castCondition', () => {
  it('heavyStrike castCondition is always true', () => {
    const a = u('a', 'A', 0, 0, { skill: 'heavyStrike' as SkillId });
    const b = u('b', 'B', 5, 5);
    expect(castCondition(a, b, ctx([a, b]))).toBe(true);
  });

  it('cleave castCondition is true when >= CLEAVE_MIN_TARGETS in radius', () => {
    const actor = u('a', 'A', 4, 4, { skill: 'cleave' as SkillId });
    const e1 = u('e1', 'B', 4, 5);
    const e2 = u('e2', 'B', 5, 4);
    const fake = u('fake', 'B', 1, 0); // distance 5 — outside radius
    expect(castCondition(actor, e1, ctx([actor, e1, e2, fake]))).toBe(true);
  });

  it('cleave castCondition is false when < CLEAVE_MIN_TARGETS in radius', () => {
    const actor = u('a', 'A', 4, 4, { skill: 'cleave' as SkillId });
    const e1 = u('e1', 'B', 4, 5); // chebyshev=1
    const far = u('far', 'B', 7, 7); // chebyshev=3 — out of radius
    expect(castCondition(actor, e1, ctx([actor, e1, far]))).toBe(false);
  });
});

describe('decideAction (cleave + valve)', () => {
  it('cleave: casts when mana >= CLEAVE_COST and >= MIN_TARGETS in radius', () => {
    // actor at (4,4) with 2 adjacent enemies
    const actor = u('a', 'A', 4, 4, { skill: 'cleave' as SkillId, mana: CLEAVE_COST });
    const e1 = u('e1', 'B', 4, 5);
    const e2 = u('e2', 'B', 5, 4);
    expect(decideAction(actor, e1, ctx([actor, e1, e2]))).toBe('cast');
  });

  it('cleave: basics when mana >= CLEAVE_COST but only 1 enemy in radius (not stalled)', () => {
    const actor = u('a', 'A', 4, 4, { skill: 'cleave' as SkillId, mana: CLEAVE_COST });
    const e1 = u('e1', 'B', 4, 5);
    // stallSinceTick = -1 by default (fresh unit)
    expect(decideAction(actor, e1, ctx([actor, e1]))).toBe('basic');
  });

  it('cleave: force-casts (valve) after stalling >= VALVE_TICKS', () => {
    const actor = u('a', 'A', 4, 4, { skill: 'cleave' as SkillId, mana: CLEAVE_COST });
    actor.stallSinceTick = 0;
    const e1 = u('e1', 'B', 4, 5);
    // totalTicks == VALVE_TICKS: threshold crossed
    expect(decideAction(actor, e1, ctx([actor, e1], VALVE_TICKS))).toBe('cast');
  });

  it('cleave: still basics just before valve threshold', () => {
    const actor = u('a', 'A', 4, 4, { skill: 'cleave' as SkillId, mana: CLEAVE_COST });
    actor.stallSinceTick = 0;
    const e1 = u('e1', 'B', 4, 5);
    expect(decideAction(actor, e1, ctx([actor, e1], VALVE_TICKS - 1))).toBe('basic');
  });
});
