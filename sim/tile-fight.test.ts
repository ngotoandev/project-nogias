import { describe, it, expect } from 'vitest';
import { runTileFight, initFight, stepFight, fightResult } from './tile-fight';
import type { FightSetup } from '../shared/types';

const baseSetup: FightSetup = {
  grid: { width: 8, height: 8, blocked: [] },
  units: [
    { id: 'a1', side: 'A', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 0, y: 0 } },
    { id: 'b1', side: 'B', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 7, y: 7 } },
  ],
};

describe('step-equivalence', () => {
  it('stepping to completion equals runTileFight (same hash, winner, ticks, events)', () => {
    const direct = runTileFight(baseSetup, 42);
    const s = initFight(baseSetup, 42);
    while (!s.outcome) stepFight(s);
    const stepped = fightResult(s);
    expect(stepped.hash).toBe(direct.hash);
    expect(stepped.winner).toBe(direct.winner);
    expect(stepped.ticks).toBe(direct.ticks);
    expect(stepped.events).toEqual(direct.events);
  });
});

describe('runTileFight', () => {
  it('resolves with an end event and a consistent endReason', () => {
    const r = runTileFight(baseSetup, 42);
    expect(r.events.at(-1)).toMatchObject({ t: 'end' });
    if (r.winner === 'A' || r.winner === 'B') {
      expect(r.endReason).toBe('decisive');
    } else {
      expect(['wipe', 'timeout']).toContain(r.endReason);
    }
  });

  it('reports a timeout (not a wipe) when units cannot reach each other', () => {
    const walled: FightSetup = {
      grid: { width: 3, height: 1, blocked: [{ x: 1, y: 0 }] },
      units: [
        { id: 'a1', side: 'A', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, attackKind: 'melee', priority: 0, pos: { x: 0, y: 0 } },
        { id: 'b1', side: 'B', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, attackKind: 'melee', priority: 0, pos: { x: 2, y: 0 } },
      ],
    };
    const r = runTileFight(walled, 7);
    expect(r.winner).toBe('draw');
    expect(r.endReason).toBe('timeout');
    expect(r.ticks).toBeGreaterThan(100_000);
    expect(r.events.at(-1)).toMatchObject({ t: 'end', winner: 'draw', endReason: 'timeout' });
  });

  it('a far stronger squad wins', () => {
    const lopsided: FightSetup = {
      grid: { width: 8, height: 8, blocked: [] },
      units: [
        { id: 'a1', side: 'A', attrs: { str: 9, agi: 9, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 0, y: 0 } },
        { id: 'b1', side: 'B', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 2, y: 0 } },
      ],
    };
    expect(runTileFight(lopsided, 1).winner).toBe('A');
  });

  it('emits move and attack events before a death', () => {
    const r = runTileFight(baseSetup, 42);
    expect(r.events.some((e) => e.t === 'move')).toBe(true);
    expect(r.events.some((e) => e.t === 'attack')).toBe(true);
    expect(r.events.some((e) => e.t === 'death')).toBe(true);
  });

  it('is deterministic: same seed -> identical events and hash', () => {
    const r1 = runTileFight(baseSetup, 42);
    const r2 = runTileFight(baseSetup, 42);
    expect(r2.events).toEqual(r1.events);
    expect(r2.hash).toBe(r1.hash);
    expect(r2.winner).toBe(r1.winner);
  });

  it('does not mutate the caller setup', () => {
    const snapshot = JSON.stringify(baseSetup);
    runTileFight(baseSetup, 42);
    expect(JSON.stringify(baseSetup)).toBe(snapshot);
  });

  it('attack events carry a crit flag and the attacker\'s channel', () => {
    const r = runTileFight(baseSetup, 42);
    const attacks = r.events.filter((e) => e.t === 'attack');
    expect(attacks.length).toBeGreaterThan(0);
    for (const e of attacks) {
      if (e.t !== 'attack') continue;
      expect(typeof e.crit).toBe('boolean');
      expect(e.channel).toBe('physical'); // both baseSetup units are melee
    }
  });

  it('routes magic attackers through the magic channel and melee through physical', () => {
    const mk = (kind: 'melee' | 'magic') => ({
      grid: { width: 2, height: 1, blocked: [] },
      units: [
        // INT 9 -> accuracy high enough that hitBp caps at 10000 vs a min-evasion
        // target, so the first attack always lands; AGI 5 -> acts first.
        { id: 'atk', side: 'A' as const, attrs: { str: 1, agi: 5, int: 9, lck: 1 }, attackKind: kind, priority: 5, pos: { x: 0, y: 0 } },
        { id: 'tgt', side: 'B' as const, attrs: { str: 5, agi: 1, int: 1, lck: 1 }, attackKind: 'melee' as const, priority: 0, pos: { x: 1, y: 0 } },
      ],
    });
    const channelOf = (kind: 'melee' | 'magic') => {
      const r = runTileFight(mk(kind), 3);
      const e = r.events.find((ev) => ev.t === 'attack' && ev.id === 'atk');
      return e && e.t === 'attack' ? e.channel : null;
    };
    expect(channelOf('magic')).toBe('magic');
    expect(channelOf('melee')).toBe('physical');
  });

  it('mitigates more damage against a higher matching defense', () => {
    const mk = (targetInt: number) => ({
      grid: { width: 2, height: 1, blocked: [] },
      units: [
        { id: 'atk', side: 'A' as const, attrs: { str: 1, agi: 5, int: 9, lck: 1 }, attackKind: 'magic' as const, priority: 5, pos: { x: 0, y: 0 } },
        { id: 'tgt', side: 'B' as const, attrs: { str: 5, agi: 1, int: targetInt, lck: 1 }, attackKind: 'melee' as const, priority: 0, pos: { x: 1, y: 0 } },
      ],
    });
    const firstDamage = (targetInt: number) => {
      const r = runTileFight(mk(targetInt), 3);
      const e = r.events.find((ev) => ev.t === 'attack' && ev.id === 'atk');
      return e && e.t === 'attack' ? e.damage : -1;
    };
    // Same attacker + seed -> identical hit/crit rolls; only magicResist differs.
    expect(firstDamage(1)).toBeGreaterThan(firstDamage(9));
  });

  it('a ranged unit attacks from range without closing to melee', () => {
    const setup: FightSetup = {
      grid: { width: 5, height: 1, blocked: [] },
      units: [
        { id: 'r', side: 'A', attrs: { str: 1, agi: 5, int: 9, lck: 1 }, attackKind: 'ranged', priority: 5, pos: { x: 0, y: 0 } },
        { id: 't', side: 'B', attrs: { str: 5, agi: 1, int: 1, lck: 1 }, attackKind: 'melee', priority: 0, pos: { x: 3, y: 0 } },
      ],
    };
    const r = runTileFight(setup, 5);
    // INT 9 vs min-evasion target -> hitBp caps at 10000 (first action lands);
    // chebyshev 3 <= ranged range 4 with clear LoS -> it shoots from (0,0), no move.
    const firstByR = r.events.find((e) => (e.t === 'attack' || e.t === 'move' || e.t === 'miss') && e.id === 'r');
    expect(firstByR?.t).toBe('attack');
    expect(r.events.some((e) => e.t === 'move' && e.id === 'r')).toBe(false);
  });

  it('a skilled unit charges Mana from basics and eventually casts Heavy Strike', () => {
    // Ranged skilled striker vs a tanky-but-weak target: STR 20 gives the target
    // HP/defense, but its MAGIC attack keys off INT (1) so it barely scratches the
    // striker. The striker chips it safely for many turns, charging to a cast.
    const setup: FightSetup = {
      grid: { width: 5, height: 1, blocked: [] },
      units: [
        { id: 's', side: 'A', attrs: { str: 9, agi: 9, int: 9, lck: 1 }, attackKind: 'ranged', skill: 'heavyStrike', priority: 5, pos: { x: 0, y: 0 } },
        { id: 't', side: 'B', attrs: { str: 20, agi: 1, int: 1, lck: 1 }, attackKind: 'magic', priority: 0, pos: { x: 4, y: 0 } },
      ],
    };
    const r = runTileFight(setup, 11);
    expect(r.events.some((e) => e.t === 'attack' && e.id === 's' && e.skill === 'heavyStrike')).toBe(true);
  });

  it('basic attacks carry no skill tag; only casts do', () => {
    // baseSetup units have no skill -> never cast -> no attack event is skill-tagged.
    const r = runTileFight(baseSetup, 42);
    expect(r.events.some((e) => e.t === 'attack')).toBe(true);
    expect(r.events.every((e) => e.t !== 'attack' || e.skill === undefined)).toBe(true);
  });

  it('a wall on the line blocks the ranged shot until the unit repositions', () => {
    const mk = (withWall: boolean): FightSetup => ({
      grid: { width: 5, height: 1, blocked: withWall ? [{ x: 2, y: 0 }] : [] },
      units: [
        { id: 'r', side: 'A', attrs: { str: 1, agi: 5, int: 9, lck: 1 }, attackKind: 'ranged', priority: 5, pos: { x: 0, y: 0 } },
        { id: 't', side: 'B', attrs: { str: 5, agi: 1, int: 1, lck: 1 }, attackKind: 'melee', priority: 0, pos: { x: 4, y: 0 } },
      ],
    });
    const firstActByR = (s: FightSetup) => {
      const r = runTileFight(s, 5);
      return r.events.find((e) => (e.t === 'attack' || e.t === 'move' || e.t === 'miss') && e.id === 'r')?.t;
    };
    expect(firstActByR(mk(false))).toBe('attack'); // clear LoS at range 4 -> shoots from start
    expect(firstActByR(mk(true))).toBe('move');    // wall at (2,0) breaks LoS -> must move first
  });
});

describe('runTileFight trait behaviors', () => {
  it('coward flees (emits moves away from enemy) when low-HP', () => {
    const setup: FightSetup = {
      grid: { width: 9, height: 1, blocked: [] },
      units: [
        { id: 'cw', side: 'A', attackKind: 'melee', traits: ['coward'], attrs: { str: 1, agi: 7, int: 1, lck: 1 }, priority: 5, pos: { x: 4, y: 0 } },
        { id: 'br', side: 'B', attackKind: 'melee', attrs: { str: 9, agi: 6, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
      ],
    };
    const r = runTileFight(setup, 3);
    // The coward should flee (move right/away from the brute on the left) at some point
    const cwMoves = r.events.filter((e) => e.t === 'move' && e.id === 'cw');
    expect(cwMoves.length).toBeGreaterThan(0);
    // The result is deterministic
    expect(r.hash).toBe('43d92801');
  });

  it('headstrong ranged unit charges to melee (x:0 closing to x:7)', () => {
    const setup: FightSetup = {
      grid: { width: 8, height: 1, blocked: [] },
      units: [
        { id: 'hs', side: 'A', attackKind: 'ranged', traits: ['headstrong'], attrs: { str: 4, agi: 7, int: 3, lck: 2 }, priority: 5, pos: { x: 0, y: 0 } },
        { id: 'tg', side: 'B', attackKind: 'melee', attrs: { str: 6, agi: 4, int: 1, lck: 2 }, priority: 5, pos: { x: 7, y: 0 } },
      ],
    };
    const r = runTileFight(setup, 3);
    // Headstrong sets charge=true → moves to melee range (1) instead of stopping at ranged range (4)
    // so the ranged unit should close all the way in
    expect(r.events.some((e) => e.t === 'move' && e.id === 'hs')).toBe(true);
    expect(r.hash).toBe('db26f7c9');
  });
});

describe('runTileFight golden hash', () => {
  it('matches the captured baseline hash (regenerate intentionally if logic changes)', () => {
    const r = runTileFight(baseSetup, 42);
    // CAPTURE STEP: run `npm test` once, read the received value from the
    // failure diff, and paste it here. Changing this value is a deliberate
    // act that flags a behavioral change in the engine.
    expect(r.hash).toBe('86e238c1');
  });

  it('stupid-misfire-seed80 golden hash', () => {
    // seed=80: first draw=158 < STUPID_MISFIRE_BP(1000) → first action misfires.
    const setup: FightSetup = {
      grid: { width: 3, height: 1, blocked: [] },
      units: [
        { id: 'st', side: 'A', attackKind: 'melee', traits: ['stupid'], attrs: { str: 5, agi: 9, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
        { id: 'tg', side: 'B', attackKind: 'melee', attrs: { str: 5, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 1, y: 0 } },
      ],
    };
    expect(runTileFight(setup, 80).hash).toBe('e7eaf7bb');
  });

  it('luckyfool-retarget-seed173 golden hash', () => {
    // seed=173: gate=111 < LUCKY_FOOL_BP(500) → retarget fires; idx=1 → picks b2 over b1.
    const setup: FightSetup = {
      grid: { width: 3, height: 1, blocked: [] },
      units: [
        { id: 'lf', side: 'A', attackKind: 'melee', traits: ['luckyFool'], attrs: { str: 5, agi: 9, int: 1, lck: 1 }, priority: 5, pos: { x: 1, y: 0 } },
        { id: 'b1', side: 'B', attackKind: 'melee', attrs: { str: 3, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
        { id: 'b2', side: 'B', attackKind: 'melee', attrs: { str: 3, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 2, y: 0 } },
      ],
    };
    expect(runTileFight(setup, 173).hash).toBe('068a1267');
  });
});

// ---------------------------------------------------------------------------
// Task 5: Cleave AoE + cast-conditions + pressure-valve
// ---------------------------------------------------------------------------

describe('runTileFight Cleave skill', () => {
  // A cleave unit adjacent to 2 enemies: charges via basics then casts Cleave → two attack{skill:'cleave'} events in one activation.
  // Grid: 3x3, cleaver at (1,1), enemies at (0,1) and (2,1) — both chebyshev=1.
  // High STR for the cleaver + high mana charge rate; tanky enemies survive the initial basics.
  it('cleave: hits >= 2 enemies in one activation (two attack{skill:cleave} events)', () => {
    const setup: FightSetup = {
      grid: { width: 5, height: 3, blocked: [] },
      units: [
        { id: 'cl', side: 'A', attackKind: 'melee', skill: 'cleave',
          attrs: { str: 9, agi: 9, int: 9, lck: 1 }, priority: 5, pos: { x: 2, y: 1 } },
        // Two adjacent tanky enemies on either side
        { id: 'e1', side: 'B', attackKind: 'melee', attrs: { str: 15, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 1, y: 1 } },
        { id: 'e2', side: 'B', attackKind: 'melee', attrs: { str: 15, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 3, y: 1 } },
      ],
    };
    const r = runTileFight(setup, 5);
    // Find a single activation where 'cl' emits two consecutive attack{skill:'cleave'} events
    // targeting DIFFERENT enemies — no intervening event from another actor.
    // This proves the AoE hit multiple enemies in one cast, not across separate turns.
    let foundAoEActivation = false;
    for (let i = 0; i < r.events.length - 1; i++) {
      const e1 = r.events[i]!;
      const e2 = r.events[i + 1]!;
      if (
        e1.t === 'attack' && e1.id === 'cl' && e1.skill === 'cleave' &&
        e2.t === 'attack' && e2.id === 'cl' && e2.skill === 'cleave' &&
        e1.target !== e2.target
      ) {
        foundAoEActivation = true;
        break;
      }
    }
    expect(foundAoEActivation).toBe(true);
  });

  it('cleave: attack events have skill=cleave and channel=physical', () => {
    const setup: FightSetup = {
      grid: { width: 5, height: 3, blocked: [] },
      units: [
        { id: 'cl', side: 'A', attackKind: 'melee', skill: 'cleave',
          attrs: { str: 9, agi: 9, int: 9, lck: 1 }, priority: 5, pos: { x: 2, y: 1 } },
        { id: 'e1', side: 'B', attackKind: 'melee', attrs: { str: 15, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 1, y: 1 } },
        { id: 'e2', side: 'B', attackKind: 'melee', attrs: { str: 15, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 3, y: 1 } },
      ],
    };
    const r = runTileFight(setup, 5);
    const cleaveAttacks = r.events.filter((e) => e.t === 'attack' && e.id === 'cl' && e.skill === 'cleave');
    expect(cleaveAttacks.length).toBeGreaterThan(0);
    for (const ev of cleaveAttacks) {
      if (ev.t !== 'attack') continue;
      expect(ev.channel).toBe('physical');
      expect(ev.skill).toBe('cleave');
    }
  });

  it('cleave: does NOT apply lucky fool retarget (no single-target redirect on AoE)', () => {
    // A luckyFool+cleave unit vs 2 adjacent enemies. The LuckyFool retarget should NOT fire.
    // We verify there's no scenario where FEWER enemies are hit (still 2 attack events per cast).
    const setup: FightSetup = {
      grid: { width: 5, height: 3, blocked: [] },
      units: [
        { id: 'cl', side: 'A', attackKind: 'melee', skill: 'cleave', traits: ['luckyFool'],
          attrs: { str: 9, agi: 9, int: 9, lck: 1 }, priority: 5, pos: { x: 2, y: 1 } },
        { id: 'e1', side: 'B', attackKind: 'melee', attrs: { str: 15, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 1, y: 1 } },
        { id: 'e2', side: 'B', attackKind: 'melee', attrs: { str: 15, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 3, y: 1 } },
      ],
    };
    const r = runTileFight(setup, 173); // seed=173 fires luckyFool gate
    const cleaveAttacks = r.events.filter((e) => e.t === 'attack' && e.id === 'cl' && e.skill === 'cleave');
    expect(cleaveAttacks.length).toBeGreaterThanOrEqual(2);
    // Both e1 and e2 should be targeted in cleave activations (AoE, not redirected)
    const cleaveTargetIds = new Set(cleaveAttacks.map((e) => e.t === 'attack' ? e.target : ''));
    expect(cleaveTargetIds.has('e1')).toBe(true);
    expect(cleaveTargetIds.has('e2')).toBe(true);
  });
});

describe('runTileFight Cleave valve', () => {
  // A cleave unit vs a SINGLE tanky enemy: condition stays <2 throughout the fight,
  // so after VALVE_TICKS the valve force-casts Cleave on the lone enemy.
  //
  // Tuning notes (verified analytically):
  //   cl: str=20, agi=9, int=9, melee → atk=51, hp=120, magicResist=9, manaChargeBp=13600
  //   tg: str=100, magic(int=1) → magicAtk=5, hp=520, physDef=100
  //   cl hits tg for 9/hit; tg hits cl for 3/hit (magic vs cl's magicResist=9)
  //   cl charges mana: 19/hit → reaches CLEAVE_COST=60 in ~4 hits (~21 ticks)
  //   After 4 hits valve clock starts. Valve fires at tick ~271 (after 52 cl activations).
  //   tg hits cl ~30 times (~90 dmg) → cl (hp=120) survives with 30 HP buffer.
  //   tg takes ~468 dmg → survives until valve fires (hp=520).
  //   Since there is only ever 1 enemy in radius, castCondition stays false the whole fight.
  it('valve: force-casts Cleave on lone enemy after VALVE_TICKS stalling', () => {
    const setup: FightSetup = {
      grid: { width: 2, height: 1, blocked: [] },
      units: [
        { id: 'cl', side: 'A', attackKind: 'melee', skill: 'cleave',
          attrs: { str: 20, agi: 9, int: 9, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
        // Tanky magic attacker: very high HP (survives until valve fires),
        // weak attack (deals 3/hit vs cl's magicResist=9).
        { id: 'tg', side: 'B', attackKind: 'magic', attrs: { str: 100, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 1, y: 0 } },
      ],
    };
    const r = runTileFight(setup, 7);
    // The valve must force-cast at least once on the lone enemy
    const cleaveAttacks = r.events.filter((e) => e.t === 'attack' && e.id === 'cl' && e.skill === 'cleave');
    expect(cleaveAttacks.length).toBeGreaterThan(0);
    // Target must be the lone enemy
    for (const ev of cleaveAttacks) {
      if (ev.t !== 'attack') continue;
      expect(ev.target).toBe('tg');
    }
  });
});

// ---------------------------------------------------------------------------
// Task 4: RNG action hooks — Stupid misfire + Lucky Fool retarget
// ---------------------------------------------------------------------------
// Draw order (fixed, same in V8 and goja):
//   Lucky Fool gate [→ retarget index] → Stupid gate [→ misfire OR hit → crit]
// ---------------------------------------------------------------------------

describe('runTileFight stupid trait', () => {
  // Scenario: stupid melee unit starts adjacent so first action = attack.
  // Unit 'st' has high AGI so it acts first. No other traits → only Stupid gate drawn.
  // seed=80: first intInRange(0,9999) = 158 < STUPID_MISFIRE_BP (1000) → misfire fires.
  const stupidSetup: FightSetup = {
    grid: { width: 3, height: 1, blocked: [] },
    units: [
      { id: 'st', side: 'A', attackKind: 'melee', traits: ['stupid'], attrs: { str: 5, agi: 9, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
      { id: 'tg', side: 'B', attackKind: 'melee', attrs: { str: 5, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 1, y: 0 } },
    ],
  };

  it('stupid unit emits misfire event on a basic attack when roll fires (seed=80)', () => {
    const r = runTileFight(stupidSetup, 80);
    // At least one misfire event emitted by 'st'
    const misfires = r.events.filter((e) => e.t === 'misfire' && e.id === 'st');
    expect(misfires.length).toBeGreaterThan(0);
    // misfire event has the expected shape
    const first = misfires[0]!;
    if (first.t !== 'misfire') throw new Error('wrong type');
    expect(first.id).toBe('st');
    expect(first.target).toBe('tg');
  });

  it('a misfire consumes the turn — no attack or miss from st in the same activation', () => {
    const r = runTileFight(stupidSetup, 80);
    const misfires = r.events.filter((e) => e.t === 'misfire' && e.id === 'st');
    expect(misfires.length).toBeGreaterThan(0);
    // Verify: immediately after each misfire from 'st', there is no attack/miss from 'st'
    // before a different unit acts. This fails if the production `continue` is removed,
    // because then the code falls through to the normal hit-roll path and emits attack/miss.
    for (const mf of misfires) {
      const idx = r.events.indexOf(mf);
      // Look at the event(s) that follow the misfire in the same stream
      // until we see an event from a unit OTHER than 'st' (or end-of-stream).
      for (let i = idx + 1; i < r.events.length; i++) {
        const ev = r.events[i]!;
        // As soon as another unit acts (or the fight ends), stop.
        if (ev.t === 'end') break;
        if (ev.t !== 'misfire' && 'id' in ev && ev.id !== 'st') break;
        // If we see an attack or miss from 'st' before another unit acts, the continue is gone.
        if ((ev.t === 'attack' || ev.t === 'miss') && 'id' in ev && ev.id === 'st') {
          throw new Error(`misfire at index ${idx} was followed by ${ev.t} from st at index ${i} — continue must be missing`);
        }
      }
    }
  });

  it('stupid unit misfires basics but casts are immune (seed=1 produces BOTH)', () => {
    // seed=1 with stupid+heavyStrike: the unit misfires at least one basic AND still lands
    // a heavyStrike cast. This proves the `action==='basic'` guard in the Stupid gate:
    // misfires happen on basic turns; the cast turn goes through unimpeded.
    // If the guard were removed (Stupid could fire on casts), the cast turn would sometimes
    // misfire instead of attacking, and ≥1 heavyStrike event would disappear.
    const castSetup: FightSetup = {
      grid: { width: 2, height: 1, blocked: [] },
      units: [
        { id: 'sc', side: 'A', attackKind: 'ranged', skill: 'heavyStrike', traits: ['stupid'],
          attrs: { str: 9, agi: 9, int: 9, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
        { id: 'td', side: 'B', attackKind: 'melee', attrs: { str: 20, agi: 1, int: 1, lck: 1 }, priority: 0, pos: { x: 1, y: 0 } },
      ],
    };
    const r = runTileFight(castSetup, 1);
    // Both must be present in the same run — proving basics misfire AND the cast still fires.
    const misfires = r.events.filter((e) => e.t === 'misfire' && e.id === 'sc');
    const casts = r.events.filter((e) => e.t === 'attack' && e.id === 'sc' && e.skill === 'heavyStrike');
    expect(misfires.length).toBeGreaterThan(0); // at least one basic misfired
    expect(casts.length).toBeGreaterThan(0);    // cast was NOT blocked by Stupid — cast is immune
    // Additionally: no misfire event from 'sc' is immediately followed by a heavyStrike attack.
    // (A cast turn cannot emit a misfire; if it did the cast attack would never appear.)
    for (const mf of misfires) {
      const idx = r.events.indexOf(mf);
      // The event immediately after a misfire from sc (if any) must not be a heavyStrike attack.
      // (Because on a misfire turn the action is consumed; no cast can follow in that same turn.)
      for (let i = idx + 1; i < r.events.length; i++) {
        const ev = r.events[i]!;
        if (ev.t === 'end') break;
        if ('id' in ev && ev.id !== 'sc') break;
        if (ev.t === 'attack' && ev.skill === 'heavyStrike') {
          throw new Error(`misfire at index ${idx} was followed by a heavyStrike cast at index ${i} — impossible if Stupid gate fires before the action decision`);
        }
        break; // only inspect the very next event from sc
      }
    }
  });
});

describe('runTileFight luckyFool trait', () => {
  // Scenario: luckyFool melee unit at center of 3-wide grid.
  // Two enemies flanking within melee range (chebyshev=1, attackRange=1).
  // chooseTarget picks 'b1' (id-sorted: b1 < b2, same distance).
  // seed=173: gate=111 < LUCKY_FOOL_BP (500) → retarget fires;
  //           retarget index=1 (of 2 in-range enemies) → picks 'b2' (different from b1).
  const luckyFoolSetup: FightSetup = {
    grid: { width: 3, height: 1, blocked: [] },
    units: [
      { id: 'lf', side: 'A', attackKind: 'melee', traits: ['luckyFool'], attrs: { str: 5, agi: 9, int: 1, lck: 1 }, priority: 5, pos: { x: 1, y: 0 } },
      { id: 'b1', side: 'B', attackKind: 'melee', attrs: { str: 3, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
      { id: 'b2', side: 'B', attackKind: 'melee', attrs: { str: 3, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 2, y: 0 } },
    ],
  };

  it('lucky fool unit retargets to a reachable enemy different from chooseTarget (seed=173)', () => {
    const r = runTileFight(luckyFoolSetup, 173);
    // chooseTarget would pick 'b1' (id asc tie-break). Lucky Fool retargets to 'b2'.
    // The first attack from 'lf' (or first hit/miss from lf) must target 'b2', not 'b1'.
    const firstLfAction = r.events.find((e) =>
      (e.t === 'attack' || e.t === 'miss') && e.id === 'lf');
    expect(firstLfAction).toBeDefined();
    if (!firstLfAction || firstLfAction.t === 'end' || firstLfAction.t === 'move' || firstLfAction.t === 'death' || firstLfAction.t === 'misfire') throw new Error('wrong type');
    expect(firstLfAction.target).toBe('b2'); // retargeted away from b1
  });

  it('lucky fool retarget is deterministic: same seed → same events and hash', () => {
    const r1 = runTileFight(luckyFoolSetup, 173);
    const r2 = runTileFight(luckyFoolSetup, 173);
    expect(r2.events).toEqual(r1.events);
    expect(r2.hash).toBe(r1.hash);
  });

  it('lucky fool only retargets among in-range enemies (never out-of-range)', () => {
    // Place a third enemy far away (out of melee range=1). Lucky Fool must not pick it
    // as a retarget while b1 and b2 are alive and in range.
    // We verify the invariant by checking that no attack from 'lf' targets 'b3'
    // BEFORE 'b3' becomes a death event (i.e., before lf walks up to it naturally).
    // Simpler: make b3 so tanky it can only die after lf closes in manually.
    // Even simpler test: run a scenario where lf CANNOT reach b3 at all (b3 isolated by walls).
    const farSetup: FightSetup = {
      grid: { width: 10, height: 1, blocked: [{ x: 5, y: 0 }] }, // wall blocks lf from ever reaching b3
      units: [
        { id: 'lf', side: 'A', attackKind: 'melee', traits: ['luckyFool'], attrs: { str: 5, agi: 9, int: 1, lck: 1 }, priority: 5, pos: { x: 1, y: 0 } },
        { id: 'b1', side: 'B', attackKind: 'melee', attrs: { str: 3, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
        { id: 'b2', side: 'B', attackKind: 'melee', attrs: { str: 3, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 2, y: 0 } },
        // b3 is on the other side of the wall at x=5 — lf can never get adjacent to it.
        { id: 'b3', side: 'B', attackKind: 'melee', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, priority: 0, pos: { x: 9, y: 0 } },
      ],
    };
    const r = runTileFight(farSetup, 173);
    // lf cannot get adjacent to b3 (wall at x=5 blocks it), so b3 is never in attack position.
    // Therefore Lucky Fool retarget must never pick b3.
    const lfAttacks = r.events.filter((e) => (e.t === 'attack' || e.t === 'miss') && e.id === 'lf');
    for (const ev of lfAttacks) {
      if (ev.t !== 'attack' && ev.t !== 'miss') continue;
      expect(ev.target).not.toBe('b3');
    }
  });
});
