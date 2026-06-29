import { describe, it, expect } from 'vitest';
import { deriveStats } from './stats';

describe('deriveStats', () => {
  it('derives the full two-channel stat set (balanced melee 5/5/1/1)', () => {
    const d = deriveStats({ str: 5, agi: 5, int: 1, lck: 1 }, 'melee');
    expect(d.maxHp).toBe(45);
    expect(d.atk).toBe(17);          // 2 + STR*2 + AGI
    expect(d.channel).toBe('physical');
    expect(d.physDef).toBe(5);
    expect(d.magicResist).toBe(1);
    expect(d.accuracyBp).toBe(10300);
    expect(d.evasionBp).toBe(1492);
    expect(d.critChanceBp).toBe(900);
    expect(d.critMultX100).toBe(140);
    expect(d.tempoRate).toBe(15);
    expect(d.moveRange).toBe(3);
    expect(d.attackRange).toBe(1);
    expect(d.maxMana).toBe(100);
    expect(d.manaChargeBp).toBe(10400);   // 10000 + 400*INT(1)
  });

  it('uses the ranged formula on the physical channel', () => {
    const d = deriveStats({ str: 3, agi: 9, int: 3, lck: 3 }, 'ranged');
    expect(d.atk).toBe(23);          // 2 + AGI*2 + STR
    expect(d.channel).toBe('physical');
    expect(d.accuracyBp).toBe(10519);
    expect(d.evasionBp).toBe(2061);
    expect(d.critChanceBp).toBe(1558);
    expect(d.critMultX100).toBe(150);
    expect(d.attackRange).toBe(4);
  });

  it('uses the magic formula on the magic channel', () => {
    const d = deriveStats({ str: 1, agi: 3, int: 9, lck: 5 }, 'magic');
    expect(d.atk).toBe(25);          // 2 + INT*2 + LCK
    expect(d.channel).toBe('magic');
    expect(d.magicResist).toBe(9);
    expect(d.accuracyBp).toBe(10900);
    expect(d.critChanceBp).toBe(2012);
    expect(d.critMultX100).toBe(158);
    expect(d.attackRange).toBe(3);
    expect(d.manaChargeBp).toBe(13600);   // 10000 + 400*INT(9)
  });

  it('clamps evasion and crit chance to their caps', () => {
    const d = deriveStats({ str: 9, agi: 999, int: 9, lck: 999 }, 'melee');
    expect(d.evasionBp).toBe(7500);
    expect(d.critChanceBp).toBe(9000);
  });

  it('is monotonic in the driving stats', () => {
    const lo = deriveStats({ str: 1, agi: 1, int: 1, lck: 1 }, 'melee');
    const hiStr = deriveStats({ str: 9, agi: 1, int: 1, lck: 1 }, 'melee');
    expect(hiStr.maxHp).toBeGreaterThan(lo.maxHp);
    expect(hiStr.atk).toBeGreaterThan(lo.atk);
    expect(hiStr.physDef).toBeGreaterThan(lo.physDef);
    const hiInt = deriveStats({ str: 1, agi: 1, int: 9, lck: 1 }, 'melee');
    expect(hiInt.magicResist).toBeGreaterThan(lo.magicResist);
    expect(hiInt.accuracyBp).toBeGreaterThan(lo.accuracyBp);
    const hiAgi = deriveStats({ str: 1, agi: 9, int: 1, lck: 1 }, 'melee');
    expect(hiAgi.evasionBp).toBeGreaterThan(lo.evasionBp);
    expect(hiAgi.tempoRate).toBeGreaterThan(lo.tempoRate);
    const hiLck = deriveStats({ str: 1, agi: 1, int: 1, lck: 9 }, 'melee');
    expect(hiLck.critChanceBp).toBeGreaterThan(lo.critChanceBp);
    expect(hiLck.critMultX100).toBeGreaterThan(lo.critMultX100);
  });
});
