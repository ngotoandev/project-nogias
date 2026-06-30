// Sample MapSetups for the dev visualizer. Plain script: assigns globalThis so it
// works both in the browser (<script src>) and in the Node smoke (vm eval).
// These are hand-authored RunBundle.setup shapes — the exact data Sim.initRun takes.
'use strict';
(function (g) {
  // unit(id, side, str, agi, opts?) — a UnitSpec. side 'A' = player, 'B' = garrison/enemy.
  // pos is required by UnitSpec but irrelevant on the map (the fight engine assigns deploy cells).
  function unit(id, side, str, agi, opts) {
    opts = opts || {};
    const u = {
      id: id, side: side, attackKind: opts.kind || 'melee',
      attrs: { str: str, agi: agi, int: opts.int || 3, lck: opts.lck || 3 },
      priority: opts.priority || 5, pos: { x: 0, y: 0 },
    };
    if (opts.skill) u.skill = opts.skill;
    if (opts.traits) u.traits = opts.traits;
    if (opts.startHp != null) u.startHp = opts.startHp;
    return u;
  }
  const squad = (prefix, side, n, str, agi, opts) =>
    Array.from({ length: n }, (_, i) => unit(`${prefix}${i + 1}`, side, str, agi, opts));

  // ── "campaign": a 2×3 grid that exercises every shipped mechanic ───────────────
  //   t0(start) — t1(enemy) — t2(BOSS)
  //     |          |           |
  //   t3(rest) — t4(muster) — t5(boon)
  // Player starts with two armies on t0. Win by taking the boss (t2). Spurs:
  // t3 Rest (heal), t4 Muster (+reserve army), t5 Boon (+3 str). t1/t2 are defended.
  const campaign = {
    tiles: [
      { id: 't0', type: 'start',  owner: 'player', neighbors: { E: 't1', S: 't3' }, garrison: [] },
      { id: 't1', type: 'enemy',  owner: 'enemy',  neighbors: { W: 't0', E: 't2', S: 't4' }, garrison: squad('t1g', 'B', 2, 5, 4) },
      { id: 't2', type: 'boss',   owner: 'enemy',  neighbors: { W: 't1', S: 't5' }, garrison: squad('t2g', 'B', 3, 7, 5) },
      { id: 't3', type: 'rest',   owner: 'enemy',  neighbors: { N: 't0', E: 't4' }, garrison: [] },
      { id: 't4', type: 'muster', owner: 'enemy',  neighbors: { N: 't1', W: 't3', E: 't5' }, garrison: [],
        muster: squad('must', 'A', 3, 8, 7) },
      { id: 't5', type: 'boon',   owner: 'enemy',  neighbors: { N: 't2', W: 't4' }, garrison: [],
        boon: { attr: 'str', amount: 3 } },
    ],
    armies: [
      { id: 'a1', tile: 't0', units: squad('a1u', 'A', 3, 9, 8, { lck: 5 }) },
      { id: 'a2', tile: 't0', units: squad('a2u', 'A', 3, 8, 7, { skill: 'heavyStrike', int: 6 }) },
    ],
  };

  // ── "skirmish": one fight, quick win ──────────────────────────────────────────
  const skirmish = {
    tiles: [
      { id: 't0', type: 'start', owner: 'player', neighbors: { E: 't1' }, garrison: [] },
      { id: 't1', type: 'boss',  owner: 'enemy',  neighbors: { W: 't0' }, garrison: squad('eg', 'B', 2, 6, 5) },
    ],
    armies: [{ id: 'a1', tile: 't0', units: squad('a1u', 'A', 3, 9, 8) }],
  };

  // computeLayout(tiles) → { tileId: {x,y} } grid coords, via BFS over N/S/E/W from tiles[0].
  function computeLayout(tiles) {
    const byId = {}; tiles.forEach((t) => { byId[t.id] = t; });
    const D = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
    const pos = {}; const start = tiles[0];
    if (!start) return pos;
    pos[start.id] = { x: 0, y: 0 };
    const q = [start.id]; const seen = new Set([start.id]);
    while (q.length) {
      const id = q.shift(); const t = byId[id];
      for (const e of ['N', 'S', 'E', 'W']) {
        const n = t.neighbors[e];
        if (n && byId[n] && !seen.has(n)) {
          seen.add(n);
          pos[n] = { x: pos[id].x + D[e][0], y: pos[id].y + D[e][1] };
          q.push(n);
        }
      }
    }
    return pos;
  }

  g.SETUPS = { campaign, skirmish };
  g.computeLayout = computeLayout;
  g.VIZ_TRAVEL_THRESHOLD = 100; // mirror of shared/config TRAVEL_THRESHOLD (for travel interpolation only)
})(typeof window !== 'undefined' ? window : globalThis);
