import type { Unit } from '../shared/types';

export function fnv1a(str: string): string {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

export function hashFight(units: Unit[], ticks: number): string {
  const canon = units
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((u) => `${u.id}:${u.side}:${u.pos.x},${u.pos.y}:${u.hp}`)
    .join('|');
  return fnv1a(canon + '#' + ticks);
}
