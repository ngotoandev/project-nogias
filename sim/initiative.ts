import type { Unit } from '../shared/types';

export const TEMPO_THRESHOLD = 100;

// Advances all living units' gauges one tick at a time until at least one
// reaches the threshold, then returns the actor. Deterministic: among
// eligible units, highest gauge wins; ties broken by priority desc, id asc.
export function nextActor(units: Unit[]): { actor: Unit; ticks: number } | null {
  const alive = units.filter((u) => u.hp > 0);
  if (alive.length === 0) return null;

  let ticks = 0;
  for (;;) {
    const eligible = alive.filter((u) => u.gauge >= TEMPO_THRESHOLD);
    if (eligible.length > 0) {
      eligible.sort((x, y) =>
        y.gauge - x.gauge ||
        y.priority - x.priority ||
        (x.id < y.id ? -1 : 1));
      const actor = eligible[0]!;
      return { actor, ticks };
    }
    for (const u of alive) u.gauge += u.derived.tempoRate;
    ticks++;
  }
}
