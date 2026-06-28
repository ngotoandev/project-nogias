import type { Cell, FightEvent, FightResult, FightSetup, Side, Unit } from '../shared/types';
import { makeRng } from '../shared/rng';
import { deriveStats } from './stats';
import { makeGrid, chebyshev, stepToward } from './grid';
import { nextActor, TEMPO_THRESHOLD } from './initiative';
import { hashFight } from './hash';

const MAX_TICKS = 100_000; // safety cap against stalemates

function chooseTarget(actor: Unit, units: Unit[]): Unit | null {
  const enemies = units.filter((u) => u.hp > 0 && u.side !== actor.side);
  if (enemies.length === 0) return null;
  enemies.sort((x, y) =>
    chebyshev(actor.pos, x.pos) - chebyshev(actor.pos, y.pos) ||
    y.priority - x.priority ||
    (x.id < y.id ? -1 : 1));
  return enemies[0]!;
}

export function runTileFight(setup: FightSetup, seed: number): FightResult {
  const rng = makeRng(seed);
  const grid = makeGrid(setup.grid);
  const units: Unit[] = setup.units.map((u) => {
    const derived = deriveStats(u.attrs);
    return {
      id: u.id, side: u.side, attrs: { ...u.attrs }, priority: u.priority,
      pos: { x: u.pos.x, y: u.pos.y }, hp: derived.maxHp, derived, gauge: 0,
    };
  });
  const events: FightEvent[] = [];

  const occupied = (c: Cell, selfId: string): boolean =>
    units.some((u) => u.hp > 0 && u.id !== selfId && u.pos.x === c.x && u.pos.y === c.y);

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

    const target = chooseTarget(actor, units);
    if (target === null) continue;

    // Move up to moveRange steps toward the target, stopping once in range.
    for (let step = 0; step < actor.derived.moveRange; step++) {
      if (chebyshev(actor.pos, target.pos) <= actor.derived.attackRange) break;
      const canEnter = (c: Cell): boolean =>
        grid.inBounds(c) && !grid.isBlocked(c) && !occupied(c, actor.id);
      const next = stepToward(actor.pos, target.pos, canEnter);
      if (next.x === actor.pos.x && next.y === actor.pos.y) break; // stuck
      events.push({ t: 'move', id: actor.id, from: { x: actor.pos.x, y: actor.pos.y }, to: { x: next.x, y: next.y } });
      actor.pos = next;
    }

    // Attack if now in range.
    if (chebyshev(actor.pos, target.pos) <= actor.derived.attackRange) {
      const variance = rng.intInRange(90, 110); // +/-10%
      const damage = Math.max(1, Math.floor((actor.derived.attack * variance) / 100));
      target.hp -= damage;
      const lethal = target.hp <= 0;
      events.push({ t: 'attack', id: actor.id, target: target.id, damage, lethal });
      if (lethal) {
        target.hp = 0;
        events.push({ t: 'death', id: target.id });
      }
    }
  }

  const fin = sidesAlive();
  const winner: Side | 'draw' = fin.a && !fin.b ? 'A' : fin.b && !fin.a ? 'B' : 'draw';
  events.push({ t: 'end', winner, ticks: totalTicks });

  return {
    winner,
    ticks: totalTicks,
    survivors: units.filter((u) => u.hp > 0).map((u) => ({ id: u.id, side: u.side, hp: u.hp })),
    events,
    hash: hashFight(units, totalTicks),
  };
}
