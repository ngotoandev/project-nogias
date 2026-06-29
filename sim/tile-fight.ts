import type { Cell, EndReason, FightEvent, FightResult, FightSetup, Side, Unit } from '../shared/types';
import { makeRng } from '../shared/rng';
import { deriveStats, effectiveDerived } from './stats';
import { makeGrid, chebyshev, stepToward, stepAway, hasLineOfSight } from './grid';
import { nextActor, TEMPO_THRESHOLD } from './initiative';
import { hashFight } from './hash';
import { hitBp, mitigatedDamage, applyCrit, manaGainOnHit, manaGainOnTaken, heavyStrikeDamage } from './combat';
import { decideTurn, decideAction } from './decide';
import { HEAVY_STRIKE_COST, COWARD_FLEE_BP, COWARD_FLEE_MOVE_BONUS } from '../shared/config';

const MAX_TICKS = 100_000; // safety cap against stalemates

export function runTileFight(setup: FightSetup, seed: number): FightResult {
  const rng = makeRng(seed);
  const grid = makeGrid(setup.grid);
  const units: Unit[] = setup.units.map((u) => {
    const derived = deriveStats(u.attrs, u.attackKind);
    return {
      id: u.id, side: u.side, attrs: { ...u.attrs }, priority: u.priority,
      pos: { x: u.pos.x, y: u.pos.y }, hp: derived.maxHp, derived, gauge: 0, mana: 0, skill: u.skill,
      traits: u.traits ?? [], kills: 0, stallSinceTick: -1, fleeingSinceTick: -1,
    };
  });
  const events: FightEvent[] = [];

  const occupied = (c: Cell, selfId: string): boolean =>
    units.some((u) => u.hp > 0 && u.id !== selfId && u.pos.x === c.x && u.pos.y === c.y);

  const inAttackPosition = (actor: Unit, target: Unit): boolean =>
    chebyshev(actor.pos, target.pos) <= actor.derived.attackRange &&
    hasLineOfSight(actor.pos, target.pos, (c) => grid.isBlocked(c));

  const addMana = (u: Unit, amount: number): void => {
    u.mana = Math.min(u.derived.maxMana, u.mana + amount);
  };

  const sidesAlive = (): { a: boolean; b: boolean } => ({
    a: units.some((u) => u.hp > 0 && u.side === 'A'),
    b: units.some((u) => u.hp > 0 && u.side === 'B'),
  });

  let totalTicks = 0;
  for (;;) {
    const alive = sidesAlive();
    if (!alive.a || !alive.b) break;

    const na = nextActor(units);
    if (na === null) break;
    totalTicks += na.ticks;
    if (totalTicks > MAX_TICKS) break;

    const actor = na.actor;
    actor.gauge -= TEMPO_THRESHOLD;

    // Coward flee clock: begin while low-HP, clear when healthy. Never reset
    // while low (so totalTicks - fleeingSinceTick crosses RALLY_TICKS → permanent rally).
    if (actor.traits.includes('coward') && !actor.traits.includes('bloodthirsty')) {
      const lowHp = actor.hp * 10000 <= COWARD_FLEE_BP * actor.derived.maxHp;
      if (!lowHp) actor.fleeingSinceTick = -1;
      else if (actor.fleeingSinceTick < 0) actor.fleeingSinceTick = totalTicks;
    }

    const ctx = { totalTicks, units, grid };
    const intent = decideTurn(actor, ctx);
    if (intent.targetId === null) continue;
    const target = units.find((x) => x.id === intent.targetId)!;

    const canEnter = (c: Cell): boolean =>
      grid.inBounds(c) && !grid.isBlocked(c) && !occupied(c, actor.id);

    if (intent.move === 'flee') {
      // Flee: step away from all living enemies; skip attack this turn.
      const enemyPositions = units.filter((u) => u.hp > 0 && u.side !== actor.side).map((u) => u.pos);
      const fleeSteps = actor.derived.moveRange + COWARD_FLEE_MOVE_BONUS;
      for (let step = 0; step < fleeSteps; step++) {
        const next = stepAway(actor.pos, enemyPositions, canEnter);
        if (next.x === actor.pos.x && next.y === actor.pos.y) break; // stuck
        events.push({ t: 'move', id: actor.id, from: { x: actor.pos.x, y: actor.pos.y }, to: { x: next.x, y: next.y } });
        actor.pos = next;
      }
      continue; // skip attack
    }

    // Move up to moveRange steps toward the target, stopping once in range.
    const maxMoveSteps = actor.derived.moveRange;
    for (let step = 0; step < maxMoveSteps; step++) {
      // Charge: close to melee (chebyshev <= 1); otherwise stop at attackRange.
      const inPosition = intent.charge
        ? chebyshev(actor.pos, target.pos) <= 1
        : inAttackPosition(actor, target);
      if (inPosition) break;
      const next = stepToward(actor.pos, target.pos, canEnter);
      if (next.x === actor.pos.x && next.y === actor.pos.y) break; // stuck
      events.push({ t: 'move', id: actor.id, from: { x: actor.pos.x, y: actor.pos.y }, to: { x: next.x, y: next.y } });
      actor.pos = next;
    }

    // In position: cast Heavy Strike if able, else a basic attack.
    if (inAttackPosition(actor, target)) {
      const aEff = effectiveDerived(actor, ctx);
      const tEff = effectiveDerived(target, ctx);
      const channel = aEff.channel;
      const def = channel === 'physical' ? tEff.physDef : tEff.magicResist;
      const action = decideAction(actor, target, ctx);
      if (action === 'cast') {
        // Cast: spend Mana, guaranteed hit, amplified damage, then the normal crit roll.
        actor.mana -= HEAVY_STRIKE_COST;
        let damage = heavyStrikeDamage(aEff.atk, def);
        const crit = rng.intInRange(0, 9999) < actor.derived.critChanceBp;
        if (crit) damage = applyCrit(damage, actor.derived.critMultX100);
        target.hp -= damage;
        addMana(target, manaGainOnTaken(damage, tEff.maxHp, target.derived.manaChargeBp));
        const lethal = target.hp <= 0;
        events.push({ t: 'attack', id: actor.id, target: target.id, damage, crit, channel, lethal, skill: 'heavyStrike' });
        if (lethal) { target.hp = 0; events.push({ t: 'death', id: target.id }); actor.kills++; }
      } else {
        // Basic attack: hit roll -> mitigation -> crit roll (unchanged from Plan 4).
        const chance = hitBp(actor.derived.accuracyBp, target.derived.evasionBp);
        if (rng.intInRange(0, 9999) >= chance) {
          events.push({ t: 'miss', id: actor.id, target: target.id });
        } else {
          let damage = mitigatedDamage(aEff.atk, def);
          const crit = rng.intInRange(0, 9999) < actor.derived.critChanceBp;
          if (crit) damage = applyCrit(damage, actor.derived.critMultX100);
          target.hp -= damage;
          addMana(actor, manaGainOnHit(actor.derived.manaChargeBp));
          addMana(target, manaGainOnTaken(damage, tEff.maxHp, target.derived.manaChargeBp));
          const lethal = target.hp <= 0;
          events.push({ t: 'attack', id: actor.id, target: target.id, damage, crit, channel, lethal });
          if (lethal) { target.hp = 0; events.push({ t: 'death', id: target.id }); actor.kills++; }
        }
      }
    }
  }

  const fin = sidesAlive();
  const winner: Side | 'draw' = fin.a && !fin.b ? 'A' : fin.b && !fin.a ? 'B' : 'draw';
  // A draw splits by final state: both sides eliminated = mutual wipe; both
  // still alive = the loop stopped without a decision (MAX_TICKS, or a tempo
  // deadlock where nextActor cannot progress).
  const endReason: EndReason = winner !== 'draw' ? 'decisive' : fin.a && fin.b ? 'timeout' : 'wipe';
  events.push({ t: 'end', winner, ticks: totalTicks, endReason });

  return {
    winner,
    ticks: totalTicks,
    endReason,
    survivors: units.filter((u) => u.hp > 0).map((u) => ({ id: u.id, side: u.side, hp: u.hp })),
    events,
    hash: hashFight(units, totalTicks),
  };
}
