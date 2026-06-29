import { describe, it, expect } from 'vitest';
import { makeGrid } from './grid';
import { deriveStats } from './stats';
import { chooseTarget, decideTurn, decideAction } from './decide';
import type { Unit } from '../shared/types';
import type { AttackKind, SkillId } from '../shared/types';

function u(id: string, side: 'A' | 'B', x: number, y: number, opts: Partial<Unit> = {}): Unit {
  const attrs = opts.attrs ?? { str: 5, agi: 5, int: 1, lck: 1 };
  const kind: AttackKind = 'melee';
  const derived = deriveStats(attrs, kind);
  return { id, side, attrs, priority: opts.priority ?? 5, pos: { x, y }, hp: opts.hp ?? derived.maxHp,
    derived, gauge: 0, mana: opts.mana ?? 0, skill: opts.skill };
}

const ctx = (units: Unit[]) => ({ totalTicks: 0, units, grid: makeGrid({ width: 8, height: 8, blocked: [] }) });

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
