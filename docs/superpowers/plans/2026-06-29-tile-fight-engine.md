# Tile-Fight Engine (Deterministic Turn Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure, deterministic, replay-verified turn-based tile-fight engine in TypeScript — two squads on a grid, one unit acting at a time via a tempo gauge, resolving to a winner with an event log.

**Architecture:** A single authoritative `/sim` (pure functions, no I/O) consuming `/shared` (seeded RNG, types). `runTileFight(setup, seed)` initializes units on a grid, drives a tempo-gauge initiative loop (each activation = move toward target + melee attack), and returns a `FightResult` with an FNV-1a state hash. Same `(setup, seed)` ⇒ identical result. This is the first slice of the combat rework in `docs/superpowers/specs/2026-06-29-combat-rework-and-architecture-design.md` §3.

**Tech Stack:** TypeScript (strict), Vitest, Node 20+. No runtime dependencies in `/sim` or `/shared`.

## Global Constraints

- **Determinism:** `/sim` and `/shared` are pure. No wall-clock, no `Date.now()`, no `Math.random()`, no I/O. Deterministic iteration/sort order everywhere. RNG is always seeded and threaded explicitly.
- **goja-safety:** `/sim` and `/shared` must run unchanged later inside goja (the Nakama server JS runtime). Use only plain ECMAScript + integer ops (`Math.imul`, `>>> 0`). No Node-only APIs (`fs`, `process`, `Buffer`) in sim/shared logic.
- **Integer math:** all sim quantities (hp, attack, gauge, damage) are integers. RNG yields integers; no float arithmetic in sim logic.
- **TypeScript strict mode** with `noUncheckedIndexedAccess`.
- **Replay invariant:** `runTileFight(setup, seed)` called twice with equal inputs returns deep-equal `events` and equal `hash`.
- **Setup precondition:** no two units share a starting cell; every `attrs.agi >= 1`.

---

### Task 1: Project scaffold + deterministic RNG

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `shared/rng.ts`
- Test: `shared/rng.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `interface Rng { nextUint32(): number; intInRange(minIncl: number, maxIncl: number): number }`
  - `function makeRng(seed: number): Rng`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "project-nogias",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["shared", "sim"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created; `vitest` and `typescript` present. (`node_modules/` is already git-ignored.)

- [ ] **Step 4: Write the failing test**

`shared/rng.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeRng } from './rng';

describe('makeRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = makeRng(123);
    const b = makeRng(123);
    expect([a.nextUint32(), a.nextUint32(), a.nextUint32()])
      .toEqual([b.nextUint32(), b.nextUint32(), b.nextUint32()]);
  });

  it('produces different sequences for different seeds', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(a.nextUint32()).not.toBe(b.nextUint32());
  });

  it('intInRange stays within inclusive bounds', () => {
    const r = makeRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = r.intInRange(90, 110);
      expect(v).toBeGreaterThanOrEqual(90);
      expect(v).toBeLessThanOrEqual(110);
    }
  });

  it('returns unsigned 32-bit integers', () => {
    const r = makeRng(7);
    const v = r.nextUint32();
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(0xffffffff);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm test -- shared/rng.test.ts`
Expected: FAIL — cannot resolve `./rng` (module not found).

- [ ] **Step 6: Write minimal implementation**

`shared/rng.ts`:

```ts
export interface Rng {
  nextUint32(): number;
  intInRange(minIncl: number, maxIncl: number): number;
}

// Mulberry32: small, fast, integer-only PRNG. goja-safe (Math.imul + >>> 0).
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  function nextUint32(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }
  function intInRange(minIncl: number, maxIncl: number): number {
    const span = (maxIncl - minIncl + 1) >>> 0;
    return minIncl + (nextUint32() % span);
  }
  return { nextUint32, intInRange };
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- shared/rng.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json shared/rng.ts shared/rng.test.ts
git commit -m "feat(shared): deterministic seeded RNG + project scaffold"
```

---

### Task 2: Core types + derived stats

**Files:**
- Create: `shared/types.ts`
- Create: `sim/stats.ts`
- Test: `sim/stats.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces:
  - `shared/types.ts`: `Side` (`'A' | 'B'`), `Cell {x:number;y:number}`, `Attributes {str,agi,int,lck:number}`, `DerivedStats {maxHp,attack,tempoRate,moveRange,attackRange:number}`, `UnitSpec {id:string;side:Side;attrs:Attributes;priority:number;pos:Cell}`, `Unit {id:string;side:Side;attrs:Attributes;priority:number;pos:Cell;hp:number;derived:DerivedStats;gauge:number}`, `GridSpec {width:number;height:number;blocked:Cell[]}`, `FightSetup {grid:GridSpec;units:UnitSpec[]}`, `FightEvent`, `FightResult {winner:Side|'draw';ticks:number;survivors:{id:string;side:Side;hp:number}[];events:FightEvent[];hash:string}`.
  - `sim/stats.ts`: `function deriveStats(a: Attributes): DerivedStats`

- [ ] **Step 1: Create `shared/types.ts`**

```ts
export type Side = 'A' | 'B';

export interface Cell { x: number; y: number; }

export interface Attributes { str: number; agi: number; int: number; lck: number; }

export interface DerivedStats {
  maxHp: number;
  attack: number;      // physical channel (Plan 1: single channel)
  tempoRate: number;   // initiative gauge fill per tick
  moveRange: number;   // cells per turn
  attackRange: number; // Chebyshev range
}

export interface UnitSpec {
  id: string;
  side: Side;
  attrs: Attributes;
  priority: number;    // higher = more forward + more aggro
  pos: Cell;
}

export interface Unit {
  id: string;
  side: Side;
  attrs: Attributes;
  priority: number;
  pos: Cell;
  hp: number;
  derived: DerivedStats;
  gauge: number;
}

export interface GridSpec { width: number; height: number; blocked: Cell[]; }

export interface FightSetup { grid: GridSpec; units: UnitSpec[]; }

export type FightEvent =
  | { t: 'move'; id: string; from: Cell; to: Cell }
  | { t: 'attack'; id: string; target: string; damage: number; lethal: boolean }
  | { t: 'death'; id: string }
  | { t: 'end'; winner: Side | 'draw'; ticks: number };

export interface FightResult {
  winner: Side | 'draw';
  ticks: number;
  survivors: { id: string; side: Side; hp: number }[];
  events: FightEvent[];
  hash: string;
}
```

- [ ] **Step 2: Write the failing test**

`sim/stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveStats } from './stats';

describe('deriveStats', () => {
  it('derives stats from attributes using GDD formulas', () => {
    const d = deriveStats({ str: 5, agi: 5, int: 1, lck: 1 });
    expect(d.maxHp).toBe(45);       // 20 + STR*5
    expect(d.attack).toBe(20);      // 5 + STR*2 + AGI
    expect(d.tempoRate).toBe(15);   // 10 + AGI
    expect(d.moveRange).toBe(3);
    expect(d.attackRange).toBe(1);
  });

  it('is monotonic in STR for hp and attack', () => {
    const lo = deriveStats({ str: 1, agi: 1, int: 1, lck: 1 });
    const hi = deriveStats({ str: 9, agi: 1, int: 1, lck: 1 });
    expect(hi.maxHp).toBeGreaterThan(lo.maxHp);
    expect(hi.attack).toBeGreaterThan(lo.attack);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- sim/stats.test.ts`
Expected: FAIL — cannot resolve `./stats`.

- [ ] **Step 4: Write minimal implementation**

`sim/stats.ts`:

```ts
import type { Attributes, DerivedStats } from '../shared/types';

const HP_BASE = 20;
const ATK_BASE = 5;
const TEMPO_BASE = 10;
const MOVE_BASE = 3;
const ATTACK_RANGE = 1;

// Minimal subset of the GDD Part II formulas needed for the Plan 1 melee slice.
export function deriveStats(a: Attributes): DerivedStats {
  return {
    maxHp: HP_BASE + a.str * 5,
    attack: ATK_BASE + a.str * 2 + a.agi,
    tempoRate: TEMPO_BASE + a.agi,
    moveRange: MOVE_BASE,
    attackRange: ATTACK_RANGE,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- sim/stats.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add shared/types.ts sim/stats.ts sim/stats.test.ts
git commit -m "feat(sim): core types + minimal derived stats"
```

---

### Task 3: Grid — distance and step-toward

**Files:**
- Create: `sim/grid.ts`
- Test: `sim/grid.test.ts`

**Interfaces:**
- Consumes: `Cell`, `GridSpec` from `shared/types`.
- Produces:
  - `interface Grid { width:number; height:number; inBounds(c:Cell):boolean; isBlocked(c:Cell):boolean }`
  - `function makeGrid(spec: GridSpec): Grid`
  - `function chebyshev(a: Cell, b: Cell): number`
  - `function manhattan(a: Cell, b: Cell): number`
  - `function stepToward(from: Cell, target: Cell, canEnter: (c: Cell) => boolean): Cell`

- [ ] **Step 1: Write the failing test**

`sim/grid.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeGrid, chebyshev, manhattan, stepToward } from './grid';
import type { Cell } from '../shared/types';

describe('grid', () => {
  it('reports bounds and blocked cells', () => {
    const g = makeGrid({ width: 4, height: 4, blocked: [{ x: 1, y: 1 }] });
    expect(g.inBounds({ x: 0, y: 0 })).toBe(true);
    expect(g.inBounds({ x: 4, y: 0 })).toBe(false);
    expect(g.isBlocked({ x: 1, y: 1 })).toBe(true);
    expect(g.isBlocked({ x: 0, y: 0 })).toBe(false);
  });

  it('computes chebyshev and manhattan distance', () => {
    expect(chebyshev({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(3);
    expect(manhattan({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(4);
  });

  it('steps one cell toward the target along the greater axis', () => {
    const open = () => true;
    expect(stepToward({ x: 0, y: 0 }, { x: 5, y: 1 }, open)).toEqual({ x: 1, y: 0 });
  });

  it('routes around a blocked primary cell', () => {
    const blockedAt = (c: Cell) => !(c.x === 1 && c.y === 0);
    expect(stepToward({ x: 0, y: 0 }, { x: 5, y: 2 }, blockedAt)).toEqual({ x: 0, y: 1 });
  });

  it('returns the origin when fully stuck', () => {
    const closed = () => false;
    expect(stepToward({ x: 0, y: 0 }, { x: 5, y: 5 }, closed)).toEqual({ x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sim/grid.test.ts`
Expected: FAIL — cannot resolve `./grid`.

- [ ] **Step 3: Write minimal implementation**

`sim/grid.ts`:

```ts
import type { Cell, GridSpec } from '../shared/types';

export interface Grid {
  width: number;
  height: number;
  inBounds(c: Cell): boolean;
  isBlocked(c: Cell): boolean;
}

function key(c: Cell): string { return c.x + ',' + c.y; }

export function makeGrid(spec: GridSpec): Grid {
  const blocked = new Set(spec.blocked.map(key));
  return {
    width: spec.width,
    height: spec.height,
    inBounds(c) { return c.x >= 0 && c.y >= 0 && c.x < spec.width && c.y < spec.height; },
    isBlocked(c) { return blocked.has(key(c)); },
  };
}

export function chebyshev(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function sign(n: number): number { return n > 0 ? 1 : n < 0 ? -1 : 0; }

// One 4-directional step toward target: greater axis first, tie -> x.
// Tries primary then secondary; returns `from` if neither is enterable.
export function stepToward(from: Cell, target: Cell, canEnter: (c: Cell) => boolean): Cell {
  const dx = sign(target.x - from.x);
  const dy = sign(target.y - from.y);
  if (dx === 0 && dy === 0) return from;
  const ax = Math.abs(target.x - from.x);
  const ay = Math.abs(target.y - from.y);
  const primary: Cell = ax >= ay ? { x: from.x + dx, y: from.y } : { x: from.x, y: from.y + dy };
  const secondary: Cell = ax >= ay ? { x: from.x, y: from.y + dy } : { x: from.x + dx, y: from.y };
  if ((primary.x !== from.x || primary.y !== from.y) && canEnter(primary)) return primary;
  if ((secondary.x !== from.x || secondary.y !== from.y) && canEnter(secondary)) return secondary;
  return from;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- sim/grid.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add sim/grid.ts sim/grid.test.ts
git commit -m "feat(sim): grid distance + deterministic step-toward"
```

---

### Task 4: Tempo-gauge initiative

**Files:**
- Create: `sim/initiative.ts`
- Test: `sim/initiative.test.ts`

**Interfaces:**
- Consumes: `Unit` from `shared/types`.
- Produces:
  - `const TEMPO_THRESHOLD = 100`
  - `function nextActor(units: Unit[]): { actor: Unit; ticks: number } | null` — advances the gauges of all living units tick-by-tick until one reaches `TEMPO_THRESHOLD`, then returns the actor (highest gauge; tie-break by priority desc, then id asc) and the number of ticks advanced. Returns `null` if no unit is alive. The caller subtracts `TEMPO_THRESHOLD` from `actor.gauge` after the actor acts.

- [ ] **Step 1: Write the failing test**

`sim/initiative.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextActor, TEMPO_THRESHOLD } from './initiative';
import type { Unit } from '../shared/types';

function unit(id: string, tempoRate: number, priority = 0, hp = 10): Unit {
  return {
    id, side: 'A', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, priority,
    pos: { x: 0, y: 0 }, hp,
    derived: { maxHp: hp, attack: 1, tempoRate, moveRange: 1, attackRange: 1 },
    gauge: 0,
  };
}

describe('nextActor', () => {
  it('returns null when nobody is alive', () => {
    expect(nextActor([unit('a', 10, 0, 0)])).toBeNull();
  });

  it('the faster unit acts first', () => {
    const slow = unit('slow', 10);
    const fast = unit('fast', 25);
    const r = nextActor([slow, fast]);
    expect(r?.actor.id).toBe('fast');
    expect(r?.ticks).toBe(4); // 25*4 = 100
  });

  it('breaks ties by priority then id', () => {
    const a = unit('a', 50, 1);
    const b = unit('b', 50, 5);
    const r = nextActor([a, b]);
    expect(r?.actor.id).toBe('b'); // higher priority wins the tie at tick 2
  });

  it('skips dead units when advancing', () => {
    const dead = unit('dead', 1000, 99, 0);
    const live = unit('live', 20);
    const r = nextActor([dead, live]);
    expect(r?.actor.id).toBe('live');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sim/initiative.test.ts`
Expected: FAIL — cannot resolve `./initiative`.

- [ ] **Step 3: Write minimal implementation**

`sim/initiative.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- sim/initiative.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add sim/initiative.ts sim/initiative.test.ts
git commit -m "feat(sim): tempo-gauge initiative (one unit at a time)"
```

---

### Task 5: Deterministic state hash

**Files:**
- Create: `sim/hash.ts`
- Test: `sim/hash.test.ts`

**Interfaces:**
- Consumes: `Unit` from `shared/types`.
- Produces:
  - `function fnv1a(str: string): string` — 8-char hex FNV-1a of a string.
  - `function hashFight(units: Unit[], ticks: number): string` — canonical (id-sorted) hash of unit id/side/pos/hp + tick count.

- [ ] **Step 1: Write the failing test**

`sim/hash.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fnv1a, hashFight } from './hash';
import type { Unit } from '../shared/types';

function unit(id: string, x: number, hp: number): Unit {
  return {
    id, side: 'A', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, priority: 0,
    pos: { x, y: 0 }, hp,
    derived: { maxHp: hp, attack: 1, tempoRate: 1, moveRange: 1, attackRange: 1 },
    gauge: 0,
  };
}

describe('hash', () => {
  it('fnv1a is stable and 8 hex chars', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'));
    expect(fnv1a('hello')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a('hello')).not.toBe(fnv1a('world'));
  });

  it('hashFight is order-independent in unit array', () => {
    const a = unit('a', 0, 5);
    const b = unit('b', 1, 5);
    expect(hashFight([a, b], 10)).toBe(hashFight([b, a], 10));
  });

  it('hashFight changes when state changes', () => {
    const base = hashFight([unit('a', 0, 5)], 10);
    expect(hashFight([unit('a', 0, 4)], 10)).not.toBe(base); // hp changed
    expect(hashFight([unit('a', 1, 5)], 10)).not.toBe(base); // pos changed
    expect(hashFight([unit('a', 0, 5)], 11)).not.toBe(base); // ticks changed
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sim/hash.test.ts`
Expected: FAIL — cannot resolve `./hash`.

- [ ] **Step 3: Write minimal implementation**

`sim/hash.ts`:

```ts
import type { Unit } from '../shared/types';

export function fnv1a(str: string): string {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

export function hashFight(units: Unit[], ticks: number): string {
  const canon = units
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((u) => `${u.id}:${u.side}:${u.pos.x},${u.pos.y}:${u.hp}`)
    .join('|');
  return fnv1a(canon + '#' + ticks);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- sim/hash.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add sim/hash.ts sim/hash.test.ts
git commit -m "feat(sim): deterministic FNV-1a state hash"
```

---

### Task 6: Tile-fight turn loop + determinism/replay test

**Files:**
- Create: `sim/tile-fight.ts`
- Test: `sim/tile-fight.test.ts`

**Interfaces:**
- Consumes: `makeRng` (`shared/rng`); `deriveStats` (`sim/stats`); `makeGrid`, `chebyshev`, `stepToward` (`sim/grid`); `nextActor`, `TEMPO_THRESHOLD` (`sim/initiative`); `hashFight` (`sim/hash`); types from `shared/types`.
- Produces: `function runTileFight(setup: FightSetup, seed: number): FightResult`.

- [ ] **Step 1: Write the failing test**

`sim/tile-fight.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runTileFight } from './tile-fight';
import type { FightSetup } from '../shared/types';

const baseSetup: FightSetup = {
  grid: { width: 8, height: 8, blocked: [] },
  units: [
    { id: 'a1', side: 'A', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
    { id: 'b1', side: 'B', attrs: { str: 5, agi: 5, int: 1, lck: 1 }, priority: 5, pos: { x: 7, y: 7 } },
  ],
};

describe('runTileFight', () => {
  it('resolves to a single winning side', () => {
    const r = runTileFight(baseSetup, 42);
    expect(['A', 'B', 'draw']).toContain(r.winner);
    expect(r.events.at(-1)).toMatchObject({ t: 'end' });
  });

  it('a far stronger squad wins', () => {
    const lopsided: FightSetup = {
      grid: { width: 8, height: 8, blocked: [] },
      units: [
        { id: 'a1', side: 'A', attrs: { str: 9, agi: 9, int: 1, lck: 1 }, priority: 5, pos: { x: 0, y: 0 } },
        { id: 'b1', side: 'B', attrs: { str: 1, agi: 1, int: 1, lck: 1 }, priority: 5, pos: { x: 2, y: 0 } },
      ],
    };
    expect(runTileFight(lopsided, 1).winner).toBe('A');
  });

  it('emits move and attack events before a death', () => {
    const r = runTileFight(baseSetup, 42);
    expect(r.events.some((e) => e.t === 'move')).toBe(true);
    expect(r.events.some((e) => e.t === 'attack')).toBe(true);
    expect(r.events.some((e) => e.t === 'death')).toBe(true);
  });

  it('is deterministic: same seed -> identical events and hash', () => {
    const r1 = runTileFight(baseSetup, 42);
    const r2 = runTileFight(baseSetup, 42);
    expect(r2.events).toEqual(r1.events);
    expect(r2.hash).toBe(r1.hash);
    expect(r2.winner).toBe(r1.winner);
  });

  it('does not mutate the caller setup', () => {
    const snapshot = JSON.stringify(baseSetup);
    runTileFight(baseSetup, 42);
    expect(JSON.stringify(baseSetup)).toBe(snapshot);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sim/tile-fight.test.ts`
Expected: FAIL — cannot resolve `./tile-fight`.

- [ ] **Step 3: Write minimal implementation**

`sim/tile-fight.ts`:

```ts
import type { Cell, FightEvent, FightResult, FightSetup, Side, Unit } from '../shared/types';
import { makeRng } from '../shared/rng';
import { deriveStats } from './stats';
import { makeGrid, chebyshev, stepToward } from './grid';
import { nextActor, TEMPO_THRESHOLD } from './initiative';
import { hashFight } from './hash';

const MAX_TICKS = 100_000; // safety cap against stalemates

function chooseTarget(actor: Unit, units: Unit[]): Unit | null {
  const enemies = units.filter((u) => u.hp > 0 && u.side !== actor.side);
  if (enemies.length === 0) return null;
  enemies.sort((x, y) =>
    chebyshev(actor.pos, x.pos) - chebyshev(actor.pos, y.pos) ||
    y.priority - x.priority ||
    (x.id < y.id ? -1 : 1));
  return enemies[0]!;
}

export function runTileFight(setup: FightSetup, seed: number): FightResult {
  const rng = makeRng(seed);
  const grid = makeGrid(setup.grid);
  const units: Unit[] = setup.units.map((u) => {
    const derived = deriveStats(u.attrs);
    return {
      id: u.id, side: u.side, attrs: u.attrs, priority: u.priority,
      pos: { x: u.pos.x, y: u.pos.y }, hp: derived.maxHp, derived, gauge: 0,
    };
  });
  const events: FightEvent[] = [];

  const occupied = (c: Cell, selfId: string): boolean =>
    units.some((u) => u.hp > 0 && u.id !== selfId && u.pos.x === c.x && u.pos.y === c.y);

  const sidesAlive = (): { a: boolean; b: boolean } => ({
    a: units.some((u) => u.hp > 0 && u.side === 'A'),
    b: units.some((u) => u.hp > 0 && u.side === 'B'),
  });

  let totalTicks = 0;
  for (;;) {
    const alive = sidesAlive();
    if (!alive.a || !alive.b) break;

    const na = nextActor(units);
    if (na === null) break;
    totalTicks += na.ticks;
    if (totalTicks > MAX_TICKS) break;

    const actor = na.actor;
    actor.gauge -= TEMPO_THRESHOLD;

    const target = chooseTarget(actor, units);
    if (target === null) continue;

    // Move up to moveRange steps toward the target, stopping once in range.
    for (let step = 0; step < actor.derived.moveRange; step++) {
      if (chebyshev(actor.pos, target.pos) <= actor.derived.attackRange) break;
      const canEnter = (c: Cell): boolean =>
        grid.inBounds(c) && !grid.isBlocked(c) && !occupied(c, actor.id);
      const next = stepToward(actor.pos, target.pos, canEnter);
      if (next.x === actor.pos.x && next.y === actor.pos.y) break; // stuck
      events.push({ t: 'move', id: actor.id, from: { x: actor.pos.x, y: actor.pos.y }, to: next });
      actor.pos = next;
    }

    // Attack if now in range.
    if (chebyshev(actor.pos, target.pos) <= actor.derived.attackRange) {
      const variance = rng.intInRange(90, 110); // +/-10%
      const damage = Math.max(1, Math.floor((actor.derived.attack * variance) / 100));
      target.hp -= damage;
      const lethal = target.hp <= 0;
      events.push({ t: 'attack', id: actor.id, target: target.id, damage, lethal });
      if (lethal) {
        target.hp = 0;
        events.push({ t: 'death', id: target.id });
      }
    }
  }

  const fin = sidesAlive();
  const winner: Side | 'draw' = fin.a && !fin.b ? 'A' : fin.b && !fin.a ? 'B' : 'draw';
  events.push({ t: 'end', winner, ticks: totalTicks });

  return {
    winner,
    ticks: totalTicks,
    survivors: units.filter((u) => u.hp > 0).map((u) => ({ id: u.id, side: u.side, hp: u.hp })),
    events,
    hash: hashFight(units, totalTicks),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- sim/tile-fight.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the golden-hash drift guard**

Append to `sim/tile-fight.test.ts`:

```ts
describe('runTileFight golden hash', () => {
  it('matches the captured baseline hash (regenerate intentionally if logic changes)', () => {
    const r = runTileFight(baseSetup, 42);
    // CAPTURE STEP: run `npm test` once, read the received value from the
    // failure diff, and paste it here. Changing this value is a deliberate
    // act that flags a behavioral change in the engine.
    expect(r.hash).toBe('00000000');
  });
});
```

- [ ] **Step 6: Capture the golden hash**

Run: `npm test -- sim/tile-fight.test.ts`
Expected: the golden-hash test FAILS, showing `Expected "00000000"` vs a real 8-hex `Received` value. Copy the received value and replace `'00000000'` in the test with it.

- [ ] **Step 7: Re-run to confirm green + typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests PASS; `tsc --noEmit` reports no errors.

- [ ] **Step 8: Commit**

```bash
git add sim/tile-fight.ts sim/tile-fight.test.ts
git commit -m "feat(sim): deterministic tile-fight turn loop + replay guard"
```

---

## Self-Review

**1. Spec coverage (Plan 1 = combat spec §3 core slice):**
- §3.2 tempo-gauge initiative → Task 4 ✓
- §3.3 a unit's turn (move + melee act; priority-driven target) → Task 6 (`chooseTarget`, move loop, attack) ✓
- §3.4 grid + distance + terrain blocking → Task 3 ✓ (cover/high-ground/LoS deferred — see below)
- §3 determinism + replay (hash, same-seed identity) → Tasks 5 + 6 ✓
- Derived stats from attributes → Task 2 ✓ (full GDD formula set deferred)
- Global Constraints (integer math, seeded RNG, goja-safe, no I/O) honored across all tasks ✓

**Deliberately deferred to later plans (not gaps):** ranged/line-of-sight, skills/Mana, traits + behavior precedence, N/S/E/W gates + multi-army + reinforcement queue, full GDD stat/damage formulas (two channels, accuracy/evasion/crit), terrain cover/slow/high-ground, the conquest map layer, `/meta` generation, the Godot client + TCP bridge, and Nakama/goja cross-runtime parity CI. These are named in the roadmap below.

**2. Placeholder scan:** No "TBD/TODO/handle edge cases" left. The golden-hash `'00000000'` is intentional and resolved by the explicit capture step (Task 6, Steps 5–6), not a placeholder.

**3. Type consistency:** `Unit`, `DerivedStats`, `Cell`, `Side`, `FightSetup`, `FightResult`, `FightEvent` defined once in Task 2 and consumed unchanged. `makeRng`/`Rng` (Task 1), `deriveStats` (Task 2), `makeGrid`/`chebyshev`/`stepToward` (Task 3), `nextActor`/`TEMPO_THRESHOLD` (Task 4), `hashFight`/`fnv1a` (Task 5), `runTileFight` (Task 6) — names and signatures match every call site. `nextActor` is documented to advance gauges; Task 6 subtracts `TEMPO_THRESHOLD` after acting, consistent with that contract.

---

## Roadmap — subsequent plans (write each when Plan 1 is green)

1. **Tile-fight engine (this plan)** — deterministic turn core.
2. **Full combat depth** — two-channel damage + full GDD derived stats; ranged + line-of-sight; skills/Mana charge; traits + behavior precedence (`trait hooks → priority → AI`).
3. **Gates, multi-army & reinforcement** — N/S/E/W deployment, pincer back-attacks, 4-army commit with reinforcement queue, retreat.
4. **Conquest map layer** — tiles/adjacency/ownership, army travel, commit slots, capture, attrition persistence, extract/wipe, the fixed-tick driver (pause = stop driving).
5. **`/meta` (server-authoritative)** — seeded generation (heroes/traits/personality/gear), economy, muster, progression persistence.
6. **Godot client + bridge** — pure-GDScript renderer ⇄ localhost TCP (newline-JSON) ⇄ Node sidecar; map view + zoom-in fight view; input → commands.
7. **Determinism hardening + online** — V8↔goja parity CI (same `seed + input log` ⇒ identical hash in both runtimes), Nakama re-sim + lockstep relay.
