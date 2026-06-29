// Replay parity fixtures. expectedHash is each fixture's V8 golden; the parity
// harness requires goja to reproduce every one exactly. Current set:
//   canonical-baseSetup-seed42       (86e238c1) — all-melee two-channel combat
//   ranged-wall-seed42               (1123ceff) — ranged range + terrain line-of-sight
//   skill-cast-seed11                (b621e99d) — ranged+heavyStrike Mana charge + cast vs tanky/weak target
//   reckless-duel-seed7              (c28a905a) — reckless melee unit vs plain unit; atk ramps as damaged
//   coward-kite-seed3                (43d92801) — coward melee kites away when low-HP; rally valve
//   headstrong-charge-seed3          (db26f7c9) — headstrong ranged charges to melee instead of kiting
//   stupid-misfire-seed80            (e7eaf7bb) — stupid melee unit misfires basic attack (seed=80 fires 10% gate)
//   luckyfool-retarget-seed173       (068a1267) — luckyFool retargets to b2 (seed=173 fires 5% gate, idx=1)
//   cleave-cluster-seed5             (57f7a0ff) — melee cleave unit reaches 2 adjacent enemies; casts Cleave hitting ≥2
//   cleave-valve-seed7               (b028690d) — melee cleave unit vs lone tanky enemy; valve force-casts after VALVE_TICKS
//   personality-tiebreak-seed1       (8d2831ec) — hotheaded lean: actor equidistant from a_tanky (str=10) + z_glass (str=4); picks z_glass (lower HP)
//   scripted-join-seed5              (7af6bcae) — A reinforcement joins at activation 3; turns B-win into A-win
//   scripted-retreat-seed7           (63b649df) — b1 ordered to retreat E at activation 2; crosses width-7 grid, takes hits, exits retreated
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
  {
    // seed=80: first intInRange(0,9999)=158 < STUPID_MISFIRE_BP(1000) → first action misfires.
    name: 'stupid-misfire-seed80',
    expectedHash: 'e7eaf7bb',
    bundle: { version: 1, seed: 80, setup: {
      grid: { width: 3, height: 1, blocked: [] }, units: [
      { id: 'st', side: 'A', attackKind: 'melee', traits: ['stupid'], attrs: { str: 5, agi: 9, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
      { id: 'tg', side: 'B', attackKind: 'melee', attrs: { str: 5, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 1, y: 0 } } ] } },
  },
  {
    // seed=173: first draw=111 < LUCKY_FOOL_BP(500) → retarget fires; retarget idx=1 of 2 picks b2.
    // chooseTarget would pick b1 (id-asc tie-break); Lucky Fool redirects to b2.
    name: 'luckyfool-retarget-seed173',
    expectedHash: '068a1267',
    bundle: { version: 1, seed: 173, setup: {
      grid: { width: 3, height: 1, blocked: [] }, units: [
      { id: 'lf', side: 'A', attackKind: 'melee', traits: ['luckyFool'], attrs: { str: 5, agi: 9, int: 1, lck: 1 }, priority: 5, pos: { x: 1, y: 0 } },
      { id: 'b1', side: 'B', attackKind: 'melee', attrs: { str: 3, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
      { id: 'b2', side: 'B', attackKind: 'melee', attrs: { str: 3, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 2, y: 0 } } ] } },
  },
  {
    // seed=5: melee cleave unit at (2,1) with enemies at (1,1) and (3,1); charges basics then casts Cleave.
    // Both enemies are within CLEAVE_RADIUS=1 (adjacent) with LoS. ≥2 attack{skill:'cleave'} events expected.
    name: 'cleave-cluster-seed5',
    expectedHash: '57f7a0ff',
    bundle: { version: 1, seed: 5, setup: {
      grid: { width: 5, height: 3, blocked: [] }, units: [
      { id: 'cl', side: 'A', attackKind: 'melee', skill: 'cleave', attrs: { str: 9, agi: 9, int: 9, lck: 1 }, priority: 5, pos: { x: 2, y: 1 } },
      { id: 'e1', side: 'B', attackKind: 'melee', attrs: { str: 15, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 1, y: 1 } },
      { id: 'e2', side: 'B', attackKind: 'melee', attrs: { str: 15, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 3, y: 1 } } ] } },
  },
  {
    // seed=7: melee cleave unit (str=20,agi=9,int=9) vs lone tanky magic enemy (str=100,int=1,agi=1).
    // Only 1 enemy ever in CLEAVE_RADIUS=1, so castCondition stays false until VALVE_TICKS=250 elapses.
    // Valve force-casts Cleave on the lone enemy. ≥1 attack{skill:'cleave'} event expected.
    // Tuning: cl(atk=51,hp=120) hits tg for 9/hit; tg(magic,int=1) hits cl for 3/hit.
    // 4 basics charge mana (19/hit → 76≥60). After ~21 ticks mana ready, valve fires at ~271 ticks.
    // tg survives (~468 dmg < 520 HP); cl survives (~90 dmg < 120 HP).
    name: 'cleave-valve-seed7',
    expectedHash: 'b028690d',
    bundle: { version: 1, seed: 7, setup: {
      grid: { width: 2, height: 1, blocked: [] }, units: [
      { id: 'cl', side: 'A', attackKind: 'melee', skill: 'cleave', attrs: { str: 20, agi: 9, int: 9, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
      { id: 'tg', side: 'B', attackKind: 'magic', attrs: { str: 100, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 1, y: 0 } } ] } },
  },
  {
    // seed=1: hotheaded actor 'a' at (2,0), equidistant (chebyshev=2) from:
    //   'a_tanky' at (0,0): str=10 → hp=70, base atk=27 (high HP, high atk)
    //   'z_glass' at (4,0): str=4  → hp=40, base atk=15 (low HP, low atk)
    // Equal priority=5. Id-asc tiebreak alone would pick 'a_tanky' ('a' < 'z').
    // Hotheaded lean key = enemy.hp → picks z_glass (hp=40 < a_tanky hp=70).
    // Control (no personality): hash=5f0f09ce; this hash=8d2831ec — different outcomes confirmed.
    name: 'personality-tiebreak-seed1',
    expectedHash: '8d2831ec',
    bundle: { version: 1, seed: 1, setup: {
      grid: { width: 5, height: 1, blocked: [] }, units: [
      { id: 'a', side: 'A', attackKind: 'melee', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 2, y: 0 }, personality: { temperament: 'hotheaded' } },
      { id: 'z_glass', side: 'B', attackKind: 'melee', attrs: { str: 4, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 4, y: 0 } },
      { id: 'a_tanky', side: 'B', attackKind: 'melee', attrs: { str: 10, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } } ] } },
  },
  {
    // seed=5: without join, weak a1(str=3) loses to strong b1(str=9) — B wins (hash e7c8414f).
    // With join at activation 3: strong a2(str=9) reinforces A-side before step 3; A wins (hash 7af6bcae).
    // Proves atActivation=3 fires, joiner participates in events, and the join hook is cross-runtime stable.
    name: 'scripted-join-seed5',
    expectedHash: '7af6bcae',
    bundle: {
      version: 2,
      seed: 5,
      setup: {
        grid: { width: 5, height: 1, blocked: [] },
        units: [
          { id: 'a1', side: 'A', attrs: { str: 3, agi: 3, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 0, y: 0 } },
          { id: 'b1', side: 'B', attrs: { str: 9, agi: 9, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 4, y: 0 } },
        ],
      },
      script: [
        { atActivation: 3, kind: 'join', specs: [
          { id: 'a2', side: 'A', attrs: { str: 9, agi: 9, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 0, y: 0 } },
        ]},
      ],
    },
  },
  {
    // seed=7: width-7 grid; b1(str=4,agi=6) at x=3 ordered to retreat to E at activation 2.
    // b1 has moveRange>1 and crosses the grid over 7 move events, taking hits from a1 en route.
    // b1 exits with retreated=true and hp=4 (not dead). Without retreat, hash=9519bd6e, ticks=15.
    // With retreat the fight lasts longer (ticks=19) and b1 survives as a retreated unit.
    // Proves orderRetreat hook, cross-edge exit, and retreated survivor are cross-runtime stable.
    name: 'scripted-retreat-seed7',
    expectedHash: '63b649df',
    bundle: {
      version: 2,
      seed: 7,
      setup: {
        grid: { width: 7, height: 1, blocked: [] },
        units: [
          { id: 'a1', side: 'A', attrs: { str: 8, agi: 4, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 0, y: 0 } },
          { id: 'b1', side: 'B', attrs: { str: 4, agi: 6, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 3, y: 0 } },
        ],
      },
      script: [
        { atActivation: 2, kind: 'retreat', unitId: 'b1', exitEdge: 'E' },
      ],
    },
  },
  {
    // conquest-capture-seed0: army a1 dispatches from owned t0 across transit t1 to undefended
    // enemy tile t2 (no garrison). After 2 hops army arrives, t2 owner flips to 'player'.
    // Quiescent once garrisoned. Proves version-3 runReplay, capture path, and V8===goja parity.
    name: 'conquest-capture-seed0',
    expectedHash: '503f1a30',
    bundle: {
      version: 3,
      seed: 0,
      setup: {
        tiles: [
          { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
          { id: 't1', type: 'start', owner: 'player', neighbors: { W: 't0', E: 't2' }, garrison: [] },
          { id: 't2', type: 'enemy', owner: 'enemy', neighbors: { W: 't1' }, garrison: [] },
        ],
        armies: [
          { id: 'a1', units: [
            { id: 'u1', side: 'A', attrs: { str: 5, agi: 1, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 0, y: 0 } },
          ], tile: 't0' },
        ],
      },
      script: [
        { atTick: 0, commands: [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }] },
      ],
    },
  },
  {
    // conquest-contested-seed0: army a1 dispatches from owned t0 across transit t1 to defended
    // enemy tile t2 (has a garrison unit). After 2 hops army arrives, engagement is contested
    // (unresolved — Plan 3 handles fights). Quiescent once contested.
    // Proves version-3 runReplay, contested seam path, and V8===goja parity.
    name: 'conquest-contested-seed0',
    expectedHash: 'f6abc10b',
    bundle: {
      version: 3,
      seed: 0,
      setup: {
        tiles: [
          { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
          { id: 't1', type: 'start', owner: 'player', neighbors: { W: 't0', E: 't2' }, garrison: [] },
          { id: 't2', type: 'enemy', owner: 'enemy', neighbors: { W: 't1' }, garrison: [
            { id: 'e1', side: 'B', attrs: { str: 5, agi: 1, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 0, y: 0 } },
          ] },
        ],
        armies: [
          { id: 'a1', units: [
            { id: 'u1', side: 'A', attrs: { str: 5, agi: 1, int: 1, lck: 1 }, attackKind: 'melee', priority: 5, pos: { x: 0, y: 0 } },
          ], tile: 't0' },
        ],
      },
      script: [
        { atTick: 0, commands: [{ t: 'dispatch', armyId: 'a1', toTile: 't2' }] },
      ],
    },
  },
];
