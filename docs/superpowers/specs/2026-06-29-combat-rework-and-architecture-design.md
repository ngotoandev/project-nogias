# Combat Rework (Turn-Based Tile-Fights) & Whole-Game Architecture — Design

Status: **draft for review** · drafted 2026-06-29 · supersedes the tile-fight portion of GDD v2.2 (`docs/game-design-document.md` Part III).

This document refines **one part** of the existing GDD — the tile-fight combat model — and sets a **recommended architecture for the whole game**. The GDD remains the intent reference for everything else (world, roster, economy, progression, lore). On conflict for the tile-fight model specifically, **this document wins**; the GDD's Part III continuous-swarm description is retired.

---

## 1. Context & Scope

The repository is a genuine clean slate: only `docs/game-design-document.md` (v2.2) and `docs/lore/` exist. Every spec the GDD forward-references (`realtime-conquest.md`, `phasing.md`, `alpha-design-lock.md`) is unwritten. There is no code or detailed combat spec to contradict, so we are free to re-shape combat before anything is committed.

This doc covers:
1. A short assessment of the existing plan (what to keep, the one load-bearing risk).
2. The reworked tile-fight: **turn-based tempo-initiative on a grid**, with small, individually impactful squads.
3. A recommended **whole-game architecture** that fits that combat model and the existing determinism / solo-first / co-op-later goals.

Out of scope here: economy/trading specifics, full lore, MP match structure (all remain as in the GDD, flagged where the combat change touches them).

---

## 2. Assessment of the Existing Plan

**Strong foundations (keep):**
- **Deterministic from day one** (fixed-tick + seeded RNG, sim-authoritative) — the spine that makes replay, daily-seed, telemetry, and lockstep co-op nearly free.
- **Solo-first, one engine reused for MP** (additive, not re-architected).
- **Four-stat model with explicit anti-degeneracy rules** (2+1 attack scaling, crit = LCK only, accuracy = INT only, minimized stat overlap).
- **Roster-safe roguelite** (XP banks instantly, no permadeath).
- **Server-side generation, no real-money roster power.**
- **Coherent, diegetically-delivered lore** (creators → original sin → prison-world; ambition as the tragedy).
- **Disciplined alpha scope** (Humans only, T1–T2, one campaign, static garrisons).

**The load-bearing risk (now addressed by this rework):** the GDD's tile-fight was a *continuous real-time swarm* — up to 4 armies/side (~36 units a side, ~72 on a tile), every unit on its own AGI timer with interpolated positions, auto-resolving, while the player ran up to 4 simultaneous fights with no online pause. That single choice created three problems at once: (a) **poor readability** (the GDD compensates with heavy audio cues + zoom), (b) **determinism fragility** (continuous float positions + per-unit timers + dozens of entities is the hardest thing to keep in cross-runtime parity — exactly what lockstep needs), and (c) **high cognitive load**. The rework below attacks all three.

**Other flags (not solved here):** the systems surface is broad for a small team (apply YAGNI ruthlessly), and the generation/trading economy is the largest pile of open questions (fine to defer; it is where live-game and anti-abuse risk concentrate).

---

## 3. Combat Rework — Turn-Based Tempo-Initiative Tile-Fights

### 3.1 The shape

The **real-time conquest map is unchanged** and remains where player skill lives: send armies to adjacent owned→enemy tiles, open fronts, reinforce, retreat, extract — all in real time. When armies meet on a tile, the fight is a **turn-based grid skirmish**: small squads, **one unit acts at a time**, board frozen between activations, positioning matters. Each fight *plays out* over a chunk of real wall-clock on the live map, so several can resolve concurrently and the map never stops.

Reference feel: **Final Fantasy Tactics / Into the Breach** for the fight, wrapped inside a **real-time Galcon / Northgard** map.

### 3.2 Initiative engine — tempo gauge (ATB-on-a-grid)

Chosen because it reuses the GDD's existing stat design almost verbatim ("AGI → acting tempo / attack-timer fill rate").

- Every unit has a **tempo gauge** that fills each tick at a rate derived from **AGI**.
- When a unit's gauge fills first, **it takes exactly one turn** (move + one action), then the gauge resets carrying overflow. All other units are frozen during the activation.
- Ties broken deterministically: **priority, then seed**.
- Net effect: **strictly one unit at a time**, and **faster units act more often** (AGI buys more turns, not bigger numbers).

**Alternative (kept on the shelf):** *round-based initiative* — every unit acts once per round in AGI order, bonus action above a speed threshold. Less granular, more predictable. A one-component swap if the tempo gauge proves hard to read in playtest.

### 3.3 A unit's turn

Driven by the unit's **pre-set priority + AI** — **pure auto-resolve, no manual in-fight control** (see 3.7). On its turn a unit:
1. **Moves** up to its move range across grid cells (blocked by terrain and other units), advancing or kiting per its priority.
2. **Acts once:** basic attack if a target is in range; a **charged skill** if Mana ≥ cost and the cast condition holds (Mana still charges by dealing/taking damage, spent per skill, with the universal pressure-valve — unchanged from the GDD); or reposition only.

**Behavior precedence is preserved** and is cleaner in discrete turns: **trait hooks → priority/targeting → default AI**, evaluated at the start of each unit's turn. A Coward flees on its turn at low HP; a Headstrong charges the nearest enemy. All deterministic from seed.

### 3.4 The grid — where "each unit has impact" comes from

- Small grid (**~8×8 to 10×10**, to tune), with the **four N/S/E/W gates preserved**: armies enter on the edge matching their map approach, so two-sided entry is a real **pincer** that lands on the garrison's back line.
- **Positioning is mechanically real:** per-tile primary terrain (Flatland / Forest / Mountain / Riverlands) seeds the grid's cells — cover, slow cells, blocking cells / high ground, blocked line-of-sight for ranged & casters — plus **flank / back-attack bonuses** from pincers.
- **Front/back emerges from priority:** high-priority melee advance and screen; low-priority archers/casters sit back and are ignored until the screen breaks. The GDD's intent, now spatial.
- **Lethality tuned for weight:** units durable enough that a death is *felt* and fights last several rounds; losing a unit is a real blow, not noise.

Schematic (not to scale):

```
              N  (Army A enters from your north tile)
            v  v  v
        .  .  .  .  .  .  .  .
        .  . ### E  E  .  .  .     E   = enemy FRONT (high-priority brutes)
   W >  .  . ### .  .  .  .  .     e   = enemy BACK  (low-priority casters)
        .  A  A  .  e  e  .  .     ### = rock: blocks move + line-of-sight
        .  A  A  ~  e  e  .  .     ~   = river: slows + grants cover
        .  .  .  .  .  .  .  .     A   = your Army A
            ^  ^  ^
              S  (Army B reinforces -> hits the back line = pincer)
```

### 3.5 Scale (the major change from the GDD)

| | GDD (swarm) | This rework |
| --- | --- | --- |
| Army size | hero + up to 8 (≤9) | **hero + ~3 (≤4)** |
| Units/side on grid | up to ~36 | **~4–12** (chess-scale) |
| Rank-and-file role | disposable numbers | **fewer, each meaningful** |
| Map commit cap | 4 armies/tile | **keep the 4-army cap** — extra committed armies act as a *reinforcement queue*, rotating in as units fall, so the on-grid count stays readable |

The muster economy shifts accordingly: fewer rank-and-file, each costing/mattering more — a cleaner "disposable bodies vs permanent hero power" tension.

### 3.6 How it sits inside the real-time map

- **One clock.** The map and every in-progress tile-fight advance on the **same fixed tick**. A turn-based activation occupies a fixed tick-budget for animation pacing.
- **Wall-clock pacing.** Each activation animates in a small slice (~0.3–0.5s, to tune); a small fight ≈ a handful of rounds ≈ **~20–40s real time**, during which the map keeps flowing. Multiple fights run their own turn sequences concurrently.
- **Reinforcement.** A newly-arrived army's units deploy at their gate edge and are inserted into the tempo order at the next turn boundary — no awkward mid-activation injection.
- **Retreat.** Ordered units spend their turns moving to their gate and exit at the edge; they remain hittable on enemies' turns while pulling out (the GDD's vulnerable pullout, now spatial).
- **Pause rule (unchanged, and now free — see 4.3):** offline can pause to issue map orders; online cannot.

### 3.7 Control model — pure auto-resolve

No manual in-fight control. The player sets composition + per-unit priority before/within the run (Barracks + muster), then commands at the **map layer** during the run and **watches** fights resolve (zoom-in optional). This preserves "commanding the map is the skill," keeps several simultaneous fights tractable, and keeps the sim fully deterministic. (A light "nudge" was considered and explicitly declined for now.)

### 3.8 Reuse vs. change

**Reused (most of the GDD survives):** four-stat model, two damage channels, priority-as-the-one-knob, Mana charge/skills, trait hooks + precedence, scouting, the real-time conquest map, determinism, roster/economy/progression. The "AGI → acting tempo" stat slots straight into the initiative gauge.

**Changed:** tile-fight is now turn-based tempo-grid (was continuous swarm); army size shrinks to hero + ~3; discrete cell positions (was interpolated); muster numbers rebalance; the "up to 4 armies = ~36/side on the grid simultaneously" assumption is retired in favor of a reinforcement queue.

**Bonus:** strictly easier to make deterministic and cross-runtime parity-safe than the swarm — directly de-risking the lockstep co-op goal.

---

## 4. Whole-Game Architecture

### 4.1 Principles

1. **One authoritative deterministic sim, written once, run everywhere.** TypeScript/Node. Solo runs it as a **local sidecar process**; online runs the **same code on a server**. One implementation ⇒ no cross-language parity problem.
2. **The client is a pure renderer + input device.** It computes no game logic.
3. **The sim is clockless; a driver advances it.** Who drives the tick decides pausing.
4. **Determinism is a first-class, tested invariant**, not an aspiration.

### 4.2 Topology

```
        SOLO (alpha / beta)                        ONLINE (MP phase, later)
 +------------------------------+        +------------------------------------+
 | Godot 4.7 client (GDScript)  |        | Godot client(s) <-> Relay / Server |
 |   render + input ONLY        |        |   render+input     (runs same /sim)|
 |      ^ snapshots | commands  |        |   each client runs a local /sim;   |
 |      |           v           |        |   relay exchanges inputs (lockstep)|
 | +--------------------------+ |        |   server owns generation + validates|
 | | Node sim sidecar         | |        |   + persistence + desync detection |
 | |  /sim  (+ /shared)       | |        +------------------------------------+
 | +--------------------------+ |
 +------------------------------+              one TS sim, deployed both ways
```

### 4.3 Layers (single responsibility, well-defined interfaces)

```
/shared   config • types • rng          single source of truth; deterministic primitives
/sim      stat-resolve • conquest-map • tile-fight (turn engine) • generation • run-loop
/client   Godot 4.7 GDScript: map view • fight view • Home/Barracks UI • input->commands • interpolation
/server   (beta+) generation authority • lockstep relay • persistence • identity • telemetry
/tools    balance Monte-Carlo • replay viewer • config validation
```

- **`/shared`** — all tuning (stat coefficients, formula constants, class/trait/personality catalogs, level-scaled archetype templates, gear grades, campaign/tile tables, economy numbers), the seeded integer PRNG (`rng.ts`; never `Math.random`), and shared data shapes (`UnitAttribute`, `UnitTrait`, `UnitPersonality`, `Hero`, `RankFile`, derived stats, commands, snapshots). Pure data; consumed by `/sim`, validated by `/server`.
- **`/sim`** — the deterministic engine: a pure function of `(state, commands, seed) -> next state`. No I/O, no rendering, no wall-clock. Sub-engines:
  - **stat resolution** — primaries → derived (GDD Part II formulas). Pure.
  - **conquest-map** — tiles, N/S/E/W adjacency, ownership, army travel, commit slots, fronts; processes map commands.
  - **tile-fight** — the turn-based tempo-initiative grid skirmish (§3); emits per-turn events.
  - **generation** — hero rolls, traits, personality, gear crafting, map/garrison generation; all seeded.
  - **run orchestration** — run state, capture, attrition persistence, rewards, banking, extract/wipe, Weary.
- **`/client`** — Godot 4.7, GDScript. Renders snapshots, tweens units cell→cell, fires audio cues, translates clicks into commands. **Computes zero game logic.**
- **`/server`** (beta+) — reuses `/sim` + `/shared`. Owns generation (client cannot influence rolls — GDD requirement), relays per-tick inputs for co-op lockstep, holds the authoritative save, validates via per-tick state hashes, ingests telemetry. Identity is device/local now, Steam later (swap provider only).
- **`/tools`** (dev-side) — the win-probability **Monte-Carlo balance instrument** (headless `/sim` runs; dev-only, never a player readout), a **replay viewer** (seed + input log → deterministic playback), and **config validation**.

### 4.4 Two decisions that make it click

1. **Clockless sim + external driver = the pause rule for free.** The sim never reads a clock; a *driver* tells it "advance tick N with these inputs." In **solo the client drives** (pause = stop driving); **online the relay drives** at a fixed cadence (no pause). The GDD's "offline pauses, online can't" is not special-cased anywhere — it is a property of who holds the tick.
2. **One fixed-tick clock for everything + turn-based fights = cheap, lockstep-safe traffic.** Map and all in-progress fights advance on the same tick; turn-based activations emit **chunky, low-frequency deltas** instead of a high-frequency float-position stream, lowering sidecar IPC cost and making lockstep trivially consistent.

### 4.5 The client ↔ sim interface (the most important boundary)

- **Commands in** (tick-stamped, validated): `DispatchArmy{armyId, fromTile, toTile, gate}`, `Reinforce`, `Retreat`, `Extract`, `SetPriority` (pre-run/Barracks), `HomeAction{...}`. The client never mutates sim state directly.
- **Snapshots + event stream out:** authoritative state deltas plus a semantic event stream — `UnitActed`, `DamageDealt`, `UnitDied`, `TileCaptured`, `SlotFreed`, `FrontUnderPressure`, etc. **The same events drive both rendering and audio cues**, which is how the GDD's "command several fronts by ear" works.
- **Transport:** local socket or stdio between Godot and the sidecar, length-prefixed messages (binary or compact JSON). Fixed-tick cadence; turn-based fights keep payloads small.

### 4.6 Determinism strategy (cross-cutting, from the first commit)

- Fixed-point / integer math in the sim; seeded PRNG; deterministic iteration order (no unordered-map hazards); no wall-clock or `Math.random` in `/sim`.
- **State-hash every tick** for desync detection (online).
- **Replay = seed + input log.** This one property powers replay, the daily seed, telemetry margins, and co-op lockstep.
- **CI hash-replay test from day one:** same seed + same input log must produce an identical end-state hash.

### 4.7 Risks & mitigations

- **Sidecar packaging + per-tick IPC** — ships Node alongside Godot and serializes each tick. Mitigated by turn-based chunky deltas; the future optimization is compiling `/sim` to **WASM and running it inside Godot**, removing the separate process while keeping the one TS codebase. Not required for alpha.
- **Client-logic leak** — the architecture's value collapses if logic creeps into GDScript. The client must stay a renderer; enforce in review.
- **Determinism discipline** — a single violation (wall-clock, unordered iteration, uncontrolled float) breaks replay + lockstep. The CI hash-replay test is the guardrail.

### 4.8 Build order (matches existing phasing)

- **Alpha:** `/shared` + `/sim` (map + tile-fight + generation + run loop) + `/client` (Godot) + local sidecar. Solo only; static garrisons; Humans; T1–T2; one campaign. Determinism + replay in from the start.
- **Beta:** add `/server` (verified saves, daily seed), active enemies, procedural maps, more content.
- **MP phase:** add the lockstep relay + authoritative generation/persistence, reusing `/sim` untouched.

---

## 5. Open Knobs (to tune in playtest, not gaps in the design)

- Grid size (8×8 vs 10×10) and exact army size (hero + 3 vs hero + 2/4).
- Initiative model: tempo gauge (default) vs round-based fallback.
- Per-activation animation duration and resulting fight wall-clock length.
- On-grid simultaneous-army cap (treat all 4 committed as on-grid, or cap on-grid at 2 with the rest queued).
- Lethality / durability curve that makes each unit "felt."
- IPC encoding (binary vs JSON) and tick rate.

## 6. Explicitly Deferred / Out of Scope

- Generation & trading economy specifics (anti-abuse, rates, dupe handling).
- MP match structure (Part VI is under redesign; reuse goals only).
- Tier-3 classes, Beastmen, mixed-race armies, terrain-affinity per race.
- The optional in-fight "nudge" control (declined for now).
- Player base-building (already out of scope in the GDD).
