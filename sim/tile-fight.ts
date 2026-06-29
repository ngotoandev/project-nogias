import type { Cell, Edge, EndReason, FightEvent, FightResult, FightSetup, Side, Unit, UnitSpec } from '../shared/types';
import type { Rng } from '../shared/rng';
import { makeRng } from '../shared/rng';
import { deriveStats, effectiveDerived } from './stats';
import type { Grid } from './grid';
import { makeGrid, chebyshev, stepToward, stepAway, hasLineOfSight } from './grid';
import { nextActor, TEMPO_THRESHOLD } from './initiative';
import { hashFight } from './hash';
import { hitBp, mitigatedDamage, applyCrit, manaGainOnHit, manaGainOnTaken, heavyStrikeDamage, cleaveDamage } from './combat';
import { decideTurn, decideAction, castCondition, cleaveTargets } from './decide';
import { HEAVY_STRIKE_COST, CLEAVE_COST, SKILL_COST, COWARD_FLEE_BP, COWARD_FLEE_MOVE_BONUS, STUPID_MISFIRE_BP, LUCKY_FOOL_BP } from '../shared/config';

const MAX_TICKS = 100_000; // safety cap against stalemates

export interface FightState {
  units: Unit[];
  grid: Grid;
  rng: Rng;
  events: FightEvent[];
  totalTicks: number;
  outcome: { winner: Side | 'draw'; endReason: EndReason } | null;
}

function specToUnit(u: UnitSpec): Unit {
  const derived = deriveStats(u.attrs, u.attackKind);
  return {
    id: u.id, side: u.side, attrs: { ...u.attrs }, priority: u.priority,
    pos: { x: u.pos.x, y: u.pos.y }, hp: derived.maxHp, derived, gauge: 0, mana: 0, skill: u.skill,
    traits: u.traits ?? [], kills: 0, stallSinceTick: -1, fleeingSinceTick: -1,
    temperament: u.personality?.temperament,
  };
}

export function initFight(setup: FightSetup, seed: number): FightState {
  const rng = makeRng(seed);
  const grid = makeGrid(setup.grid);
  const units: Unit[] = setup.units.map(specToUnit);
  return { units, grid, rng, events: [], totalTicks: 0, outcome: null };
}

export function joinFight(state: FightState, specs: UnitSpec[]): void {
  for (const u of specs) {
    state.units.push(specToUnit(u));
  }
}

function finalize(state: FightState, sidesAlive: () => { a: boolean; b: boolean }): void {
  const fin = sidesAlive();
  const winner: Side | 'draw' = fin.a && !fin.b ? 'A' : fin.b && !fin.a ? 'B' : 'draw';
  const endReason: EndReason = winner !== 'draw' ? 'decisive' : fin.a && fin.b ? 'timeout' : 'wipe';
  state.outcome = { winner, endReason };
  state.events.push({ t: 'end', winner, ticks: state.totalTicks, endReason });
}

export function stepFight(state: FightState): FightState {
  const { units, grid, rng } = state;

  const occupied = (c: Cell, selfId: string): boolean =>
    units.some((u) => u.hp > 0 && !u.exited && u.id !== selfId && u.pos.x === c.x && u.pos.y === c.y);

  const inAttackPosition = (actor: Unit, target: Unit): boolean =>
    chebyshev(actor.pos, target.pos) <= actor.derived.attackRange &&
    hasLineOfSight(actor.pos, target.pos, (c) => grid.isBlocked(c));

  const addMana = (u: Unit, amount: number): void => {
    u.mana = Math.min(u.derived.maxMana, u.mana + amount);
  };

  const sidesAlive = (): { a: boolean; b: boolean } => ({
    a: units.some((u) => u.hp > 0 && !u.exited && u.side === 'A'),
    b: units.some((u) => u.hp > 0 && !u.exited && u.side === 'B'),
  });

  // ---- ONE loop iteration (today's body), with `break`→finalize+return and `continue`→return ----
  const alive = sidesAlive();
  if (!alive.a || !alive.b) { finalize(state, sidesAlive); return state; }

  const na = nextActor(units);
  if (na === null) { finalize(state, sidesAlive); return state; }
  state.totalTicks += na.ticks;
  if (state.totalTicks > MAX_TICKS) { finalize(state, sidesAlive); return state; }

  const actor = na.actor;
  actor.gauge -= TEMPO_THRESHOLD;

  // Coward flee clock: begin while low-HP, clear when healthy. Never reset
  // while low (so totalTicks - fleeingSinceTick crosses RALLY_TICKS → permanent rally).
  if (actor.traits.includes('coward') && !actor.traits.includes('bloodthirsty')) {
    const lowHp = actor.hp * 10000 <= COWARD_FLEE_BP * actor.derived.maxHp;
    if (!lowHp) actor.fleeingSinceTick = -1;
    else if (actor.fleeingSinceTick < 0) actor.fleeingSinceTick = state.totalTicks;
  }

  const ctx = { totalTicks: state.totalTicks, units, grid };
  const intent = decideTurn(actor, ctx);

  const canEnter = (c: Cell): boolean =>
    grid.inBounds(c) && !grid.isBlocked(c) && !occupied(c, actor.id);

  if (intent.move === 'retreat') {
    // Retreat: move toward the exit edge; skip attack this turn.
    const edge = actor.retreating!;
    const exitCell: Cell = edge === 'W' ? { x: 0, y: actor.pos.y }
      : edge === 'E' ? { x: grid.width - 1, y: actor.pos.y }
        : edge === 'N' ? { x: actor.pos.x, y: 0 }
          : { x: actor.pos.x, y: grid.height - 1 }; // 'S'
    for (let step = 0; step < actor.derived.moveRange; step++) {
      const next = stepToward(actor.pos, exitCell, canEnter);
      if (next.x === actor.pos.x && next.y === actor.pos.y) break; // stuck
      state.events.push({ t: 'move', id: actor.id, from: { x: actor.pos.x, y: actor.pos.y }, to: { x: next.x, y: next.y } });
      actor.pos = next;
    }
    // Check if the actor has reached the exit edge
    const onExitEdge =
      (edge === 'W' && actor.pos.x === 0) ||
      (edge === 'E' && actor.pos.x === grid.width - 1) ||
      (edge === 'N' && actor.pos.y === 0) ||
      (edge === 'S' && actor.pos.y === grid.height - 1);
    if (onExitEdge) actor.exited = true;
    return state;
  }

  if (intent.targetId === null) return state;
  const target = units.find((x) => x.id === intent.targetId)!;

  if (intent.move === 'flee') {
    // Flee: step away from all living enemies; skip attack this turn.
    const enemyPositions = units.filter((u) => u.hp > 0 && !u.exited && u.side !== actor.side).map((u) => u.pos);
    const fleeSteps = actor.derived.moveRange + COWARD_FLEE_MOVE_BONUS;
    for (let step = 0; step < fleeSteps; step++) {
      const next = stepAway(actor.pos, enemyPositions, canEnter);
      if (next.x === actor.pos.x && next.y === actor.pos.y) break; // stuck
      state.events.push({ t: 'move', id: actor.id, from: { x: actor.pos.x, y: actor.pos.y }, to: { x: next.x, y: next.y } });
      actor.pos = next;
    }
    return state; // skip attack
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
    state.events.push({ t: 'move', id: actor.id, from: { x: actor.pos.x, y: actor.pos.y }, to: { x: next.x, y: next.y } });
    actor.pos = next;
  }

  // In position: cast or basic attack.
  if (inAttackPosition(actor, target)) {
    // Valve clock: track how long the actor has been affordable but condition-blocked.
    // This MUST run before decideAction so stallSinceTick is current for this tick.
    if (actor.skill && actor.mana >= SKILL_COST[actor.skill] && !castCondition(actor, target, ctx)) {
      if (actor.stallSinceTick < 0) actor.stallSinceTick = state.totalTicks;
    } else {
      actor.stallSinceTick = -1;
    }

    const aEff = effectiveDerived(actor, ctx);
    const channel = aEff.channel;
    const action = decideAction(actor, target, ctx);

    // ---- RNG action hooks (Task 4) ----
    // Fixed draw order: Lucky Fool gate [→ retarget index] → Stupid gate [→ misfire OR hit → crit]
    // Both gates draw only for units carrying the relevant trait.
    // Only basic attacks are subject to Stupid; Lucky Fool fires for single-target actions
    // (basic or heavyStrike cast). Cleave is AoE — Lucky Fool excluded when action==='cast' && skill==='cleave'.
    let actualTarget = target;

    // Lucky Fool: retarget among in-position enemies (chebyshev ≤ attackRange AND LoS).
    // Applies to basic and heavyStrike cast (single-target). Excluded for cleave cast (AoE).
    if (actor.traits.includes('luckyFool') && !(action === 'cast' && actor.skill === 'cleave')) {
      if (rng.intInRange(0, 9999) < LUCKY_FOOL_BP) {
        // Build deterministic in-position enemy list: chebyshev asc → id asc.
        const inPos = units
          .filter((x) => x.hp > 0 && !x.exited && x.side !== actor.side && inAttackPosition(actor, x))
          .sort((p, q) => chebyshev(actor.pos, p.pos) - chebyshev(actor.pos, q.pos) || (p.id < q.id ? -1 : 1));
        if (inPos.length > 0) {
          actualTarget = inPos[rng.intInRange(0, inPos.length - 1)]!;
        }
      }
    }

    // Stupid: on a basic attack only. Misfire consumes exactly one draw; no further rolls.
    if (action === 'basic' && actor.traits.includes('stupid')) {
      if (rng.intInRange(0, 9999) < STUPID_MISFIRE_BP) {
        state.events.push({ t: 'misfire', id: actor.id, target: actualTarget.id });
        // Wasted action: no damage, no mana, no hit/crit draw.
        return state;
      }
      // Fall through to normal basic-attack resolution below.
    }
    // ---- end RNG action hooks ----

    if (action === 'cast') {
      if (actor.skill === 'heavyStrike') {
        // Recompute def against actualTarget (may differ after Lucky Fool retarget).
        const tEffActual = effectiveDerived(actualTarget, ctx);
        const defActual = channel === 'physical' ? tEffActual.physDef : tEffActual.magicResist;
        // Cast: spend Mana, guaranteed hit, amplified damage, then the normal crit roll.
        actor.mana -= HEAVY_STRIKE_COST;
        let damage = heavyStrikeDamage(aEff.atk, defActual);
        const crit = rng.intInRange(0, 9999) < actor.derived.critChanceBp;
        if (crit) damage = applyCrit(damage, actor.derived.critMultX100);
        actualTarget.hp -= damage;
        addMana(actualTarget, manaGainOnTaken(damage, tEffActual.maxHp, actualTarget.derived.manaChargeBp));
        const lethal = actualTarget.hp <= 0;
        state.events.push({ t: 'attack', id: actor.id, target: actualTarget.id, damage, crit, channel, lethal, skill: 'heavyStrike' });
        if (lethal) { actualTarget.hp = 0; state.events.push({ t: 'death', id: actualTarget.id }); actor.kills++; }
      } else if (actor.skill === 'cleave') {
        // Cleave: AoE. Get sorted target list (or single enemy if valve-forced with <MIN).
        // Zero targets is unreachable when in attack position (melee CLEAVE_RADIUS=1 === attackRange=1),
        // but treated as a safe no-op: unit keeps closing next tick.
        const tgts = cleaveTargets(actor, ctx);
        if (tgts.length > 0) {
          // Spend cost once, hit all targets in sorted order.
          actor.mana -= CLEAVE_COST;
          for (const tgt of tgts) {
            if (tgt.hp <= 0) continue; // may have died in this same cast
            const tEff = effectiveDerived(tgt, ctx);
            const def = channel === 'physical' ? tEff.physDef : tEff.magicResist;
            let damage = cleaveDamage(aEff.atk, def);
            const crit = rng.intInRange(0, 9999) < actor.derived.critChanceBp;
            if (crit) damage = applyCrit(damage, actor.derived.critMultX100);
            tgt.hp -= damage;
            addMana(tgt, manaGainOnTaken(damage, tEff.maxHp, tgt.derived.manaChargeBp));
            const lethal = tgt.hp <= 0;
            state.events.push({ t: 'attack', id: actor.id, target: tgt.id, damage, crit, channel, lethal, skill: 'cleave' });
            if (lethal) { tgt.hp = 0; state.events.push({ t: 'death', id: tgt.id }); actor.kills++; }
          }
          // Caster gains no mana from Cleave.
        }
      }
    } else {
      // Basic attack: hit roll -> mitigation -> crit roll (unchanged from Plan 4).
      // Recompute def against actualTarget (may differ after Lucky Fool retarget).
      const tEffActual = effectiveDerived(actualTarget, ctx);
      const defActual = channel === 'physical' ? tEffActual.physDef : tEffActual.magicResist;
      const chance = hitBp(actor.derived.accuracyBp, actualTarget.derived.evasionBp);
      if (rng.intInRange(0, 9999) >= chance) {
        state.events.push({ t: 'miss', id: actor.id, target: actualTarget.id });
      } else {
        let damage = mitigatedDamage(aEff.atk, defActual);
        const crit = rng.intInRange(0, 9999) < actor.derived.critChanceBp;
        if (crit) damage = applyCrit(damage, actor.derived.critMultX100);
        actualTarget.hp -= damage;
        addMana(actor, manaGainOnHit(actor.derived.manaChargeBp));
        addMana(actualTarget, manaGainOnTaken(damage, tEffActual.maxHp, actualTarget.derived.manaChargeBp));
        const lethal = actualTarget.hp <= 0;
        state.events.push({ t: 'attack', id: actor.id, target: actualTarget.id, damage, crit, channel, lethal });
        if (lethal) { actualTarget.hp = 0; state.events.push({ t: 'death', id: actualTarget.id }); actor.kills++; }
      }
    }
  }

  return state;
}

export function orderRetreat(state: FightState, unitId: string, exitEdge: Edge): void {
  const u = state.units.find((x) => x.id === unitId);
  if (u) u.retreating = exitEdge;
}

export function fightResult(state: FightState): FightResult {
  return {
    winner: state.outcome!.winner,
    ticks: state.totalTicks,
    endReason: state.outcome!.endReason,
    survivors: state.units
      .filter((u) => u.hp > 0)
      .map((u) => u.exited
        ? { id: u.id, side: u.side, hp: u.hp, retreated: true as const }
        : { id: u.id, side: u.side, hp: u.hp }),
    events: state.events,
    hash: hashFight(state.units, state.totalTicks),
  };
}

export function runTileFight(setup: FightSetup, seed: number): FightResult {
  const s = initFight(setup, seed);
  while (!s.outcome) stepFight(s);
  return fightResult(s);
}
