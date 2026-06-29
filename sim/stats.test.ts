import { describe, it, expect } from 'vitest';
import { deriveStats, effectiveDerived } from './stats';
import { makeGrid } from './grid';
import type { Unit, TraitId } from '../shared/types';

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

// ── effectiveDerived tests ──────────────────────────────────────────────────

function makeUnit(id: string, side: 'A' | 'B', x: number, y: number, traits: TraitId[], attrs: { str: number; agi: number; int: number; lck: number }, attackKind: 'melee' | 'ranged' | 'magic' = 'melee', hp?: number, kills = 0, priority = 5): Unit {
  const derived = deriveStats(attrs, attackKind);
  return {
    id, side, attrs, priority, pos: { x, y },
    hp: hp ?? derived.maxHp,
    derived, gauge: 0, mana: 0,
    traits, kills,
    stallSinceTick: -1, fleeingSinceTick: -1,
  };
}

function makeCtx(totalTicks: number, units: Unit[]) {
  return { totalTicks, units, grid: makeGrid({ width: 10, height: 10, blocked: [] }) };
}

describe('effectiveDerived', () => {
  it('no dynamic trait → returns base derived unchanged (identity)', () => {
    // attrs str=5,agi=5,int=1,lck=1 → atk17, physDef5, maxHp45
    const unit = makeUnit('u', 'A', 0, 0, [], { str: 5, agi: 5, int: 1, lck: 1 });
    const ctx = makeCtx(0, [unit]);
    const eff = effectiveDerived(unit, ctx);
    expect(eff).toBe(unit.derived); // identity: same object reference
  });

  it('reckless: +atk as HP falls, constant −physDef', () => {
    // attrs str=5,agi=5,int=1,lck=1 → base atk17, maxHp45, physDef5 → physDef becomes 3 (always-on)
    const attrs = { str: 5, agi: 5, int: 1, lck: 1 };
    const unit45 = makeUnit('rk', 'A', 0, 0, ['reckless'], attrs, 'melee', 45);
    const unit27 = makeUnit('rk', 'A', 0, 0, ['reckless'], attrs, 'melee', 27);
    const unit18 = makeUnit('rk', 'A', 0, 0, ['reckless'], attrs, 'melee', 18);
    const unit9  = makeUnit('rk', 'A', 0, 0, ['reckless'], attrs, 'melee', 9);
    const unit1  = makeUnit('rk', 'A', 0, 0, ['reckless'], attrs, 'melee', 1);
    const ctx = makeCtx(0, [unit45]);

    const eff45 = effectiveDerived(unit45, ctx);
    expect(eff45.atk).toBe(17);
    expect(eff45.physDef).toBe(3); // always-on penalty: floor(5 * 7500 / 10000) = 3

    const eff27 = effectiveDerived(unit27, makeCtx(0, [unit27]));
    expect(eff27.atk).toBe(21);
    expect(eff27.physDef).toBe(3);

    const eff18 = effectiveDerived(unit18, makeCtx(0, [unit18]));
    expect(eff18.atk).toBe(23);
    expect(eff18.physDef).toBe(3);

    const eff9 = effectiveDerived(unit9, makeCtx(0, [unit9]));
    expect(eff9.atk).toBe(25);
    expect(eff9.physDef).toBe(3);

    const eff1 = effectiveDerived(unit1, makeCtx(0, [unit1]));
    expect(eff1.atk).toBe(26);
    expect(eff1.physDef).toBe(3);
  });

  it('slowStarter: −early +late ramp on atk', () => {
    // attrs str=6,agi=6,int=1,lck=1 → melee atk = 2+12+6=20
    const attrs = { str: 6, agi: 6, int: 1, lck: 1 };
    const unit = makeUnit('ss', 'A', 0, 0, ['slowStarter'], attrs);

    expect(effectiveDerived(unit, makeCtx(0, [unit])).atk).toBe(16);     // t=0 → 80%
    expect(effectiveDerived(unit, makeCtx(75, [unit])).atk).toBe(18);    // t=75 → 90%
    expect(effectiveDerived(unit, makeCtx(150, [unit])).atk).toBe(20);   // t=150 → 100%
    expect(effectiveDerived(unit, makeCtx(300, [unit])).atk).toBe(24);   // t=300 → 120%
    expect(effectiveDerived(unit, makeCtx(600, [unit])).atk).toBe(24);   // t=600 → capped 120%
  });

  it('bloodthirsty: +4 atk per kill', () => {
    // attrs str=5,agi=5,int=1,lck=1 → base atk17
    const attrs = { str: 5, agi: 5, int: 1, lck: 1 };
    const ctx = makeCtx(0, []);

    for (const [kills, expected] of [[0, 17], [1, 21], [2, 25], [3, 29]] as [number, number][]) {
      const unit = makeUnit('bt', 'A', 0, 0, ['bloodthirsty'], attrs, 'melee', undefined, kills);
      expect(effectiveDerived(unit, ctx).atk).toBe(expected);
    }
  });

  it('loyal: +near / −far leader (atk18, physDef6)', () => {
    // attrs str=6,agi=4,int=1,lck=1 → melee atk = 2+12+4=18, physDef=6
    const attrs = { str: 6, agi: 4, int: 1, lck: 1 };

    // leader at (5,0), loyal unit at varying positions
    const leader = makeUnit('leader', 'A', 5, 0, [], { str: 5, agi: 5, int: 1, lck: 1 }, 'melee', undefined, 0, 10);

    // d=0 (same cell as leader): near → atk=floor(18*11500/10000)=20, physDef=floor(6*11500/10000)=6
    const unitD0 = makeUnit('lo', 'A', 5, 0, ['loyal'], attrs);
    const effD0 = effectiveDerived(unitD0, makeCtx(0, [unitD0, leader]));
    expect(effD0.atk).toBe(20);
    expect(effD0.physDef).toBe(6);

    // d=2: near → same as d=0
    const unitD2 = makeUnit('lo', 'A', 3, 0, ['loyal'], attrs);
    const effD2 = effectiveDerived(unitD2, makeCtx(0, [unitD2, leader]));
    expect(effD2.atk).toBe(20);
    expect(effD2.physDef).toBe(6);

    // d=3: neutral (LEADER_RADIUS=2, FAR_RADIUS=5)
    const unitD3 = makeUnit('lo', 'A', 2, 0, ['loyal'], attrs);
    const effD3 = effectiveDerived(unitD3, makeCtx(0, [unitD3, leader]));
    expect(effD3.atk).toBe(18);
    expect(effD3.physDef).toBe(6);

    // d=5: far → atk=floor(18*8500/10000)=15, physDef=floor(6*8500/10000)=5
    const unitD5 = makeUnit('lo', 'A', 0, 0, ['loyal'], attrs);
    const effD5 = effectiveDerived(unitD5, makeCtx(0, [unitD5, leader]));
    expect(effD5.atk).toBe(15);
    expect(effD5.physDef).toBe(5);

    // d=7: far (capped) → same as d=5
    const unitD7 = makeUnit('lo', 'A', 0, 0, ['loyal'], attrs);
    const leaderD7 = makeUnit('leader', 'A', 7, 0, [], { str: 5, agi: 5, int: 1, lck: 1 }, 'melee', undefined, 0, 10);
    const effD7 = effectiveDerived(unitD7, makeCtx(0, [unitD7, leaderD7]));
    expect(effD7.atk).toBe(15);
    expect(effD7.physDef).toBe(5);
  });
});
