import type { FightResult, ReplayBundle, ReplayResult, ScriptedFightBundle, ConquestBundle } from '../shared/types';
import { runTileFight, initFight, stepFight, fightResult, joinFight, orderRetreat } from './tile-fight';
import type { MapState } from './conquest-map';
import { initConquest, advance, hashMap } from './conquest-map';

// ── Conquest replay (v3) ─────────────────────────────────────────────────────

const CONQUEST_MAX_TICKS = 100_000;

// Runs a scripted conquest map deterministically.
// The control layer is RNG-free; bundle.seed is carried for Plan 3's fights.
// Quiescent when no army is travelling/retreating AND no scripted command
// remains at atTick >= state.totalTicks.
export function runScriptedConquest(bundle: ConquestBundle): { hash: string; ticks: number } {
  const s: MapState = initConquest(bundle.setup, bundle.seed);
  const cmdsAt = (t: number) => bundle.script.filter((a) => a.atTick === t).flatMap((a) => a.commands);
  const pending = () =>
    s.armies.some((a) => a.state === 'travelling' || a.state === 'retreating') ||
    bundle.script.some((a) => a.atTick >= s.totalTicks);
  while (pending() && s.totalTicks < CONQUEST_MAX_TICKS) advance(s, cmdsAt(s.totalTicks));
  return { hash: hashMap(s), ticks: s.totalTicks };
}

// The single entry both runtimes (V8 sidecar, goja server) invoke for parity.
// Pure and goja-safe: delegates to runTileFight (v1) or runScriptedFight (v2) and
// projects the result to the minimal cross-runtime surface (hash + outcome).
// The `version` envelope lets later plans add a command/input-log stream without
// breaking the wire format. The harness (parity.mjs / goja-runner) passes the
// bundle JSON through generically — version-awareness here means zero harness changes.
export function runScriptedFight(bundle: ScriptedFightBundle): FightResult {
  const s = initFight(bundle.setup, bundle.seed);
  let activation = 0;
  const actions = bundle.script; // applied by atActivation; ties broken by array order
  // activation is incremented on EVERY stepFight call, including no-ops (when neither side
  // has anything to do). atActivation: K fires just before the (K+1)-th stepFight (0-indexed).
  while (!s.outcome) {
    // Apply any actions stamped for this activation index, in array order, BEFORE the step.
    // atActivation: K means "apply just before the K-th step" (0-indexed).
    for (const a of actions) {
      if (a.atActivation !== activation) continue;
      if (a.kind === 'join') joinFight(s, a.specs);
      else orderRetreat(s, a.unitId, a.exitEdge);
    }
    stepFight(s);
    activation++;
  }
  return fightResult(s);
}

export function runReplay(bundle: ReplayBundle | ScriptedFightBundle | ConquestBundle): ReplayResult {
  if (bundle.version === 3) {
    const r = runScriptedConquest(bundle);
    return { hash: r.hash, ticks: r.ticks };
  }
  const r = bundle.version === 2 ? runScriptedFight(bundle) : runTileFight(bundle.setup, bundle.seed);
  return { hash: r.hash, winner: r.winner, ticks: r.ticks, endReason: r.endReason };
}
