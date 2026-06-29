import vm from 'node:vm';

// Run the bundled sim under Node's V8 and return the replay hash. The bundle is
// an IIFE (not an ES module), so we evaluate it in a fresh vm context and read
// back the global `Sim`. This mirrors the goja runner exactly: same bundle,
// same JSON-in / JSON-out call shape.
export function hashInV8(bundleSource, bundle) {
  const sandbox = { __bundleJson: JSON.stringify(bundle) };
  const context = vm.createContext(sandbox);
  vm.runInContext(bundleSource, context); // defines global `Sim`
  const out = vm.runInContext(
    'JSON.stringify(Sim.runReplay(JSON.parse(__bundleJson)))',
    context,
  );
  return JSON.parse(out).hash;
}
