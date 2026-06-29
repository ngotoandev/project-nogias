// Replay parity fixtures. expectedHash is each fixture's V8 golden; the parity
// harness requires goja to reproduce every one exactly. Current set:
//   canonical-baseSetup-seed42 (86e238c1) — all-melee two-channel combat
//   ranged-wall-seed42         (1123ceff) — ranged range + terrain line-of-sight
// Add more {name, expectedHash, bundle} entries here to broaden coverage.
export const FIXTURES = [
  {
    name: 'canonical-baseSetup-seed42',
    expectedHash: '86e238c1',
    bundle: {
      version: 1,
      seed: 42,
      setup: {
        grid: { width: 8, height: 8, blocked: [] },
        units: [
          { id: 'a1', side: 'A', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 0, y: 0 } },
          { id: 'b1', side: 'B', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 7, y: 7 } },
        ],
      },
    },
  },
  {
    name: 'ranged-wall-seed42',
    expectedHash: '1123ceff',
    bundle: {
      version: 1,
      seed: 42,
      setup: {
        grid: { width: 6, height: 3, blocked: [{ x: 3, y: 1 }] },
        units: [
          { id: 'r', side: 'A', attackKind: 'ranged', attrs: { str: 3, agi: 6, int: 4, lck: 2 }, priority: 5, pos: { x: 0, y: 1 } },
          { id: 'm', side: 'B', attackKind: 'melee', attrs: { str: 6, agi: 3, int: 1, lck: 2 }, priority: 5, pos: { x: 5, y: 1 } },
        ],
      },
    },
  },
];
