import { describe, it, expect } from 'vitest';
import { nextActor, TEMPO_THRESHOLD } from './initiative';
import type { Unit } from '../shared/types';

function unit(id: string, tempoRate: number, priority = 0, hp = 10): Unit {
  return {
    id, side: 'A', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, priority,
    pos: { x: 0, y: 0 }, hp,
    derived: { maxHp: hp, atk: 1, channel: 'physical', physDef: 0, magicResist: 0, accuracyBp: 10000, evasionBp: 0, critChanceBp: 0, critMultX100: 125, tempoRate, moveRange: 1, attackRange: 1, maxMana: 100, manaChargeBp: 10000 },
    gauge: 0, mana: 0,
  };
}

describe('nextActor', () => {
  it('returns null when nobody is alive', () => {
    expect(nextActor([unit('a', 10, 0, 0)])).toBeNull();
  });

  it('the faster unit acts first', () => {
    const slow = unit('slow', 10);
    const fast = unit('fast', 25);
    const r = nextActor([slow, fast]);
    expect(r?.actor.id).toBe('fast');
    expect(r?.ticks).toBe(4); // 25*4 = 100
  });

  it('breaks ties by priority then id', () => {
    const a = unit('a', 50, 1);
    const b = unit('b', 50, 5);
    const r = nextActor([a, b]);
    expect(r?.actor.id).toBe('b'); // higher priority wins the tie at tick 2
  });

  it('skips dead units when advancing', () => {
    const dead = unit('dead', 1000, 99, 0);
    const live = unit('live', 20);
    const r = nextActor([dead, live]);
    expect(r?.actor.id).toBe('live');
  });

  it('returns null when no living unit can gain tempo', () => {
    const a = unit('a', 0);
    const b = unit('b', 0);
    expect(nextActor([a, b])).toBeNull();
  });

  it('breaks gauge+priority ties by id ascending', () => {
    const z = unit('z', 50, 5);
    const a = unit('a', 50, 5);
    expect(nextActor([z, a])?.actor.id).toBe('a');
  });
});
