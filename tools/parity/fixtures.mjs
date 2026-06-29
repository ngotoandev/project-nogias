// Canonical replay fixture. expectedHash is the V8 golden (sim/tile-fight
// golden e9ff47f3); the parity harness requires goja to reproduce it exactly.
// Add more {name, expectedHash, bundle} entries here to broaden coverage.
export const FIXTURES = [
  {
    name: 'canonical-baseSetup-seed42',
    expectedHash: 'e9ff47f3',
    bundle: {
      version: 1,
      seed: 42,
      setup: {
        grid: { width: 8, height: 8, blocked: [] },
        units: [
          { id: 'a1', side: 'A', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
          { id: 'b1', side: 'B', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 7, y: 7 } },
        ],
      },
    },
  },
];
