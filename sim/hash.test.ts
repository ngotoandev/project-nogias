import { describe, it, expect } from 'vitest';
import { fnv1a, hashFight } from './hash';
import type { Unit } from '../shared/types';

function unit(id: string, x: number, hp: number): Unit {
  return {
    id, side: 'A', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, priority: 0,
    pos: { x, y: 0 }, hp,
    derived: { maxHp: hp, attack: 1, tempoRate: 1, moveRange: 1, attackRange: 1 },
    gauge: 0,
  };
}

describe('fnv1a golden values', () => {
  it('pins exact hashes (must hold identically in goja — parity anchor)', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('hello')).toBe('4f9f2cab');
    expect(fnv1a('nogias')).toBe('35e9a4e6');
    expect(fnv1a('project-nogias')).toBe('d6e652d2');
  });

  it('zero-pads to 8 hex chars (leading-zero branch pinned)', () => {
    expect(fnv1a('68')).toBe('0de8d5a3'); // this hash begins with 0
    for (let i = 0; i < 2000; i++) {
      expect(fnv1a(String(i))).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});

describe('hash', () => {
  it('fnv1a is stable and 8 hex chars', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'));
    expect(fnv1a('hello')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a('hello')).not.toBe(fnv1a('world'));
  });

  it('hashFight is order-independent in unit array', () => {
    const a = unit('a', 0, 5);
    const b = unit('b', 1, 5);
    expect(hashFight([a, b], 10)).toBe(hashFight([b, a], 10));
  });

  it('hashFight changes when state changes', () => {
    const base = hashFight([unit('a', 0, 5)], 10);
    expect(hashFight([unit('a', 0, 4)], 10)).not.toBe(base); // hp changed
    expect(hashFight([unit('a', 1, 5)], 10)).not.toBe(base); // pos changed
    expect(hashFight([unit('a', 0, 5)], 11)).not.toBe(base); // ticks changed
  });
});
