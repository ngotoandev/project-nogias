import type { FightResult, ReplayBundle, ReplayResult, ScriptedFightBundle } from '../shared/types';
import { runTileFight, initFight, stepFight, fightResult, joinFight, orderRetreat } from './tile-fight';

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

export function runReplay(bundle: ReplayBundle | ScriptedFightBundle): ReplayResult {
  const r = bundle.version === 2 ? runScriptedFight(bundle) : runTileFight(bundle.setup, bundle.seed);
  return { hash: r.hash, winner: r.winner, ticks: r.ticks, endReason: r.endReason };
}
