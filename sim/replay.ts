import type { ReplayBundle, ReplayResult } from '../shared/types';
import { runTileFight } from './tile-fight';

// The single entry both runtimes (V8 sidecar, goja server) invoke for parity.
// Pure and goja-safe: delegates to runTileFight and projects the result to the
// minimal cross-runtime surface (hash + outcome). The `version` envelope lets
// later plans add a command/input-log stream without breaking the wire format.
export function runReplay(bundle: ReplayBundle): ReplayResult {
  const r = runTileFight(bundle.setup, bundle.seed);
  return { hash: r.hash, winner: r.winner, ticks: r.ticks, endReason: r.endReason };
}
