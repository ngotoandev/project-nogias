import { describe, it, expect } from 'vitest';
import { makeGrid, chebyshev } from './grid';
import { deriveStats } from './stats';
import { chooseTarget, decideTurn, decideAction } from './decide';
import type { Unit } from '../shared/types';
import type { AttackKind, SkillId } from '../shared/types';
import { RALLY_TICKS, LEADER_RADIUS } from '../shared/config';

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
