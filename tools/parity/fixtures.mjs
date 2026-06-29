// Replay parity fixtures. expectedHash is each fixture's V8 golden; the parity
// harness requires goja to reproduce every one exactly. Current set:
//   canonical-baseSetup-seed42 (86e238c1) — all-melee two-channel combat
//   ranged-wall-seed42         (1123ceff) — ranged range + terrain line-of-sight
//   skill-cast-seed11          (b621e99d) — ranged+heavyStrike Mana charge + cast vs tanky/weak target
//   reckless-duel-seed7        (c28a905a) — reckless melee unit vs plain unit; atk ramps as damaged
//   coward-kite-seed3          (43d92801) — coward melee kites away when low-HP; rally valve
//   headstrong-charge-seed3    (db26f7c9) — headstrong ranged charges to melee instead of kiting
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
  {
    name: 'skill-cast-seed11',
    expectedHash: 'b621e99d',
    bundle: {
      version: 1,
      seed: 11,
      setup: {
        grid: { width: 5, height: 1, blocked: [] },
        units: [
          { id: 's', side: 'A', attackKind: 'ranged', skill: 'heavyStrike', attrs: { str: 9, agi: 9, int: 9, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
          { id: 't', side: 'B', attackKind: 'magic', attrs: { str: 20, agi: 1, int: 1, lck: 1 }, priority: 0, pos: { x: 4, y: 0 } },
        ],
      },
    },
  },
  {
    name: 'reckless-duel-seed7',
    expectedHash: 'c28a905a',
    bundle: {
      version: 1,
      seed: 7,
      setup: {
        grid: { width: 5, height: 1, blocked: [] },
        units: [
          { id: 'rk', side: 'A', attackKind: 'melee', traits: ['reckless'], attrs: { str: 6, agi: 5, int: 1, lck: 2 }, priority: 5, pos: { x: 0, y: 0 } },
          { id: 'p',  side: 'B', attackKind: 'melee', attrs: { str: 6, agi: 4, int: 1, lck: 2 }, priority: 5, pos: { x: 4, y: 0 } },
        ],
      },
    },
  },
  {
    name: 'coward-kite-seed3',
    expectedHash: '43d92801',
    bundle: { version: 1, seed: 3, setup: {
      grid: { width: 9, height: 1, blocked: [] }, units: [
      { id: 'cw', side: 'A', attackKind: 'melee', traits: ['coward'], attrs: { str: 1, agi: 7, int: 1, lck: 1 }, priority: 5, pos: { x: 4, y: 0 } },
      { id: 'br', side: 'B', attackKind: 'melee', attrs: { str: 9, agi: 6, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } } ] } },
  },
  {
    name: 'headstrong-charge-seed3',
    expectedHash: 'db26f7c9',
    bundle: { version: 1, seed: 3, setup: {
      grid: { width: 8, height: 1, blocked: [] }, units: [
      { id: 'hs', side: 'A', attackKind: 'ranged', traits: ['headstrong'], attrs: { str: 4, agi: 7, int: 3, lck: 2 }, priority: 5, pos: { x: 0, y: 0 } },
      { id: 'tg', side: 'B', attackKind: 'melee', attrs: { str: 6, agi: 4, int: 1, lck: 2 }, priority: 5, pos: { x: 7, y: 0 } } ] } },
  },
];
