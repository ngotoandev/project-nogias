# Project Nogias — Game Design Document

Living design reference (intent, not a production spec). **v2.2** · drafted 2026-06-22 · combat reworked to **real-time territorial conquest** (Part III; spec `docs/specs/realtime-conquest.md`).

This is a clean-slate GDD for a **new repository**. Same world and roster fantasy as the prior project, with a reworked combat core: **real-time territorial conquest** (see Part III) — you command **~10 armies** (each a hero + units, or a headless mix) across a map of tiles in real time, sending them to take adjacent enemy tiles, each contested tile resolving as a multi-army grid auto-fight. Designed deterministic from day one (fixed-tick + seeded RNG), hardened to cross-runtime parity + lockstep when online/co-op arrive (phasing: `docs/specs/phasing.md`). Earlier combat models — turn-based, then gridless real-time, then prep-and-watch grid battles — are all retired. The companion design spec is `docs/specs/realtime-conquest.md` (the earlier `realtime-grid-combat.md` and `realtime-continuous-combat.md` are its superseded predecessors); canon/setting lore lives in `docs/lore/`.

On conflict: this GDD = intent; the build spec / code = reality to reconcile.

## Terminology

- **Campaign** — one solo roguelite run (tiles → boss).
- **Match** — one online co-op session (shared regional war map).
- **Saga** — overarching narrative (e.g. "The First Wound").
- **Company / armies** — the force you field in a run: **~10 armies** (each ≤9 units — a hero + units, or a headless mix). **Heroes** (permanent, deep progression) lead armies; **mustered rank-and-file** fill them. Up to **4 armies** engage a tile.

## Contents

1. [Vision, Setting & Structure](#part-i--vision-setting--structure)
2. [Units, Roster & Growth](#part-ii--units-roster--growth)
3. [Combat — Real-Time Conquest](#part-iii--combat--real-time-conquest)
4. [Shared Systems](#part-iv--shared-systems-world-economy-enemies)
5. [Solo Campaigns](#part-v--solo-campaigns)
6. [Online Matches](#part-vi--online-conquest-matches-later)

---

# Part I — Vision, Setting & Structure

## High-Level Vision

PC-first, Steam, cooperative-PvE strategy. Long-term north star: a shared regional war map where players reclaim territory, resist Lidium corruption, complete objectives, and beat escalating threats.

Built as two pillars, shipped in sequence: **alpha/beta = single-player roguelite Campaign mode; multiplayer Match mode later.** One authoritative deterministic engine — solo stands alone and is the multiplayer foundation.

Match-mode target: small-party real-time co-op — players matchmake into a shared conquest map and fight enemies together. Solo Campaigns and Matches are both **active, real-time, sit-down play** (not background/idle). Scale and structure: Part VI; deferred until after solo.

## Core Fantasy & Setting

Players are commanders in Nogias's first coalition — not chosen heroes — leading local forces against the first Lidium breaches. Players think they fight demonic invaders; the saga reveals Lidium is a prison-world, archdemons were once Ethers, and the "Gods" engineered the disaster.

The battlefield fantasy: you are a **commander** directing a campaign in real time. You read the map, open fronts, commit your line where it matters, pincer from two sides, and feed reinforcements as units fall — while each clash resolves on its own from the priorities you set. The drama is in the live reading and commanding across fronts, not in micro-managing a single fight.

## Game Structure, Modes & Phasing

Two co-op-PvE pillars share one engine; built solo-first.

**Pillars**
- **Solo Campaigns (roguelite PvE)** — alpha/beta focus. Run a Campaign: tiles → boss; earn materials, gear, growth. Roster-safe (no permadeath; a wipe loses only the unbanked haul — earned XP is kept).
- **Online Matches (co-op PvE)** — Multiplayer Phase (Part VI). Bring a grown warband into a shared war.

**Shared substrate** — units, four-stat model, two-channel real-time battles, items/crafting, economy (Parts II–IV). Built once for solo, reused for multiplayer (additive, not re-architected).


## First-Time User Flow

`Launch → Login → War Dispatch → Choose Race → Starter Recruitment (5 heroes) → Warband Review → First Campaign → Secure First Tile`

Login = device/local (Steam later swaps only the identity provider).

- **War Dispatch** — short in-world intro before race choice: Lidium breaches opened; Nogias doesn't understand the threat; Humans + Beastmen forced into a coalition; raise a warband and secure a front. Urgency, not cosmology.
- **Race Choice** — Human or Beastmen; sets starting roster identity, region, and starter-recruit race. A cultural commitment, not a stat pick. *(Alpha ships **Humans only**; Beastmen are post-slice — `alpha-design-lock.md`.)*
- **Starter Recruitment** — 5 protected hero recruits in one batch, no rerolls (Part II).
- **Warband Review** — show the 5 (race, Squire class, base stats, traits, role hints) + a recommended squad; confirm → enter Campaign.
- **First Objective** — take a nearby tile in real time (read map → muster a few rank-and-file into an army → send the army at an adjacent enemy tile → watch the clash, reinforce if a slot frees → tile captured). Teaches the core loop minimally: assemble, send, gate, reinforce, and the **muster** step.

---

# Part II — Units, Roster & Growth

Permanent layer carried across runs. Two unit classes of citizen: **heroes** (deep, permanent, individually rolled) and **rank-and-file** (mustered numbers; see *Muster* below).

## Playable Race Roles

Asymmetric but not radically different in alpha; shared UI/map/economy/objectives. Avoid separate economies or race-only systems early.

- **Humans** — organized, systemic; scale through systems. Convert AGI/INT into tactical/mana/ability performance. Areas: ruined towns, fortified settlements, roads, engineering/mage sites.
- **Beastmen** — powerful, territorial, survival-driven; strong early units, melee, rough-terrain. Convert STR into durability/melee force. Areas: wildlands, clan sites, mountains, plains, broken forests, borders.

*Terrain affinity (beta option):* races may convert battlefield terrain differently — e.g. Beastmen suffer reduced slow-terrain penalties (rough-terrain identity), Humans gain more from fortified/road ground. Not in alpha; the terrain system (Part III) leaves room for it.

## Recruitment & Unit Identity (heroes)

Permanent individual heroes with personality/flaws, not anonymous copies or visible rarity labels. Player-facing terms: recruitment/muster/warband/summons (never "gacha/roll/pity/reroll"). **No real-money roster power.** All generation is server-side (rolls, traits, rarity floor); the client can't influence or reroll.

Generation maximizes uniqueness (stats + traits/personality) → true duplicates are rare. Surplus heroes salvage to materials (tradable later); no dupe-fusion/ascension.

**Starter recruitment** — 5 protected hero recruits, one batch:
- Permanent, race-specific roster units; all start as **Squire**; no duplicate identities; no rerolls.
- Hidden rarity floor (starters roll a total stat budget of at least 24 — see Base Attributes) + hidden composition safety net (a playable opening squad); the starter batch never rolls the harshest behavioral trait hooks.
- No explicit rarity labels — rarity is inferred from total stat budget, stat shape, traits, class potential, performance.

### Base Attributes

Four primary stats:
- **STR** — physical power (Warrior home).
- **AGI** — speed/finesse (Archer home).
- **INT** — mind/magic (Mage home).
- **LCK** — fortune; shared wildcard, also reaches outside combat.

Alpha roll: first roll a **total stat budget of 22–26** (distribution config; **starter recruits floor at 24** — the literal hidden rarity floor), then random integers with `STR+AGI+INT+LCK = budget`, each ≥ 1, uniform over valid sets. Budget variance is deliberately small: a high roll is a *good* unit, never a different power class. Traits may modify after the roll; clamp finals ≥ 1.

**Rolled distribution is permanent** — never changed by leveling/respec. Growth = level-up points (Unit Progression), allocated/respec'd separately.

### Derived Stats

Derived from primaries + class/race/gear/trait. Damage = **two channels** (Physical, Magic), each vs its own defense. Warriors/Archers physical (STR/AGI lean), Mages magic; LCK = fortune.

In the **real-time** model (Part III), a unit has no "turn." AGI feeds **acting tempo** — how fast it moves across the field and how fast its attack timer refills — and class/gear **Attack Speed** is the cadence multiplier on top. AGI also sets a unit's **map travel speed** between tiles (Part III).

| Stat | Offense | Defense / Utility |
| --- | --- | --- |
| STR | Melee Atk (primary), Ranged Atk (secondary — draw weight) | Max HP + regen, Phys Def |
| AGI | Ranged Atk (primary), Melee Atk (secondary) | **Acting tempo — move speed + attack-timer fill rate (sole stat-derived tempo input)**, Evasion |
| INT | Magic Atk (primary) | Magic Resist, **Mana charge rate (all classes — ability tempo)**, Accuracy |
| LCK | **Crit chance + crit damage (sole source)**, Magic Atk (secondary — volatile magic) | Evasion (minor), out-of-combat fortune |

Structural rules (these, not the coefficients, are the design):
- **Symmetric 2+1 attack scaling** — every attack stat = base + primary×2 + secondary×1. No channel scales off a single stat.
- **Acting tempo is linear in AGI** — AGI is the only primary-derived tempo input (move speed + attack-timer fill). **Attack Speed** (the cadence multiplier) comes from **class/gear only**, never primaries.
- **Crit is pure LCK** — class crit identity comes from passives (e.g. Archer Deadeye), not from AGI.
- **Accuracy is INT** ("battle-sense") — every class has an offensive reason to value INT, alongside Mana charge rate, which speeds *every* class's active.
- Stat overlap is minimized to one deliberate case: **evasion** draws on both AGI and LCK (LCK minor), while crit (LCK only) and accuracy (INT) stay single-stat — so there is no broad double-dip pairing.

Reference formulas (`base` from class/gear; coefficients in `shared/config`, computed sim-side):
- Max HP = hp_base + STR×5 · HP regen/5s = STR÷5
- Mana (ability charge) — accumulating pool, **not** an INT pool and **no** time-regen; charged in combat by dealing + taking damage (INT raises charge rate), **spent per skill at each active's own Mana cost** (Part III).
- Melee Atk = weapon_base + STR×2 + AGI · Ranged Atk = weapon_base + AGI×2 + STR · Magic Atk = focus_base + INT×2 + LCK
- Physical Def = armor_base + STR · Magic Resist = base + INT
- Crit chance = clamp(c₁·√LCK, 0, 0.9) · Crit damage = 1.25 + c₂·√LCK
- Evasion = clamp(e₁·√(2·AGI + LCK), 0, 0.75)
- Accuracy = 1 + a₁·√INT
- **Acting tempo** = tempo_base + AGI (drives move speed and attack-timer fill rate) · **Attack Speed** = atkspd_base (class) × gear modifiers

Fixed (from class/race, not rolled): move speed base, attack range, weapon profile, attack speed base, unit footprint (1 cell in alpha), upgrade path. Race scales *conversion*, not the roll; LCK race-neutral.

Hit & mitigation (resolved, Part III): hit = clamp(Accuracy − Evasion, 0.10, 1.00); mitigation = `def/(def+K)` vs matching defense.

### Luck Beyond Combat

- Crafting: higher LCK biases item rolls toward better stats/quality.
- Campaign rewards: LCK nudges drop quality / lucky events.

Source: in a run, fortune = **leader's LCK**; Home crafting = assigned crafter's LCK (else roster-highest).

### Starting Class & Progression (heroes)

Every hero starts **Squire**; attributes/traits hint at its path. Three tiers:
- **T1 Base** (shared): Warrior, Archer, Mage. (No Defender base — defensive is a Warrior branch.)
- **T2 First upgrade**: each base → 2 race-specific role branches (pick one).
- **T3 Mastered**: one improved form of the chosen T2 (no branching).

**Alpha/beta = Tiers 1–2; Tier 3 later.**

| Base | Branch | Human (T2→T3) | Beastman (T2→T3) |
| --- | --- | --- | --- |
| Warrior | Offensive | Duelist → Blademaster | Berserker → Bloodrager |
| Warrior | Defensive | Guardian → Paladin | Ironhide → Mountainback |
| Archer | Ranger | Marksman → Sharpshooter | Hunter → Stormhunter |
| Archer | Thief | Rogue → Assassin | Stalker → Shadowclaw |
| Mage | Combat | Arcanist → Archmage | Stormcaller → Tempest |
| Mage | Support | Enchanter → Sage | Shaman → Spiritbinder |

*(A diagram of the class tree may be ported as an `assets/class-progression.svg`; the table above is canonical.)* **Alpha ships the Human branches only** (Duelist, Guardian, Marksman, Rogue, Arcanist, Enchanter); Beastman branches are post-slice.

### Muster — Rank-and-File

Heroes are the **depth**; rank-and-file are the **body** that fills your **armies** (≤9 units each) and the **reinforcements** you feed in as a run grinds them down (Part III). The player **musters** rank-and-file from the economy before/within a run; they are simpler than heroes — typed archetypes, fielded in numbers, **disposable per-run** (no individual leveling).

Alpha rank-and-file are **typed archetypes grouped by class family** (these types are what hero auras target):
- **Warrior family** — **Infantry** (shield line; screens and holds ground), **Spearman** (braces vs chargers; the line's answer to cavalry), **Cavalry** (fast flanker — reaches the soft backline via a flank gate, run down if it over-commits into braced spears).
- **Archer family** — **Bowman** (massed ranged; thins an advance from behind the screen).
- **Mage family** — **Caster** (ranged magic; *new for the armies model*).

Combined arms is expressed through **army composition** (mixing units within an army, and mixing armies across fronts), **priority** (front screens vs rear shooters), **gate/pincer** choice, and light typed advantages (config; never a hard rock-paper-scissors).

### Traits & Personality (heroes)

Two independent identity axes, both rolled at recruitment, both permanent and visible. **Traits** carry combat mechanics (they change the sim); **Personality** carries identity with only a small, bounded behavioral lean. (Rank-and-file do not roll individual traits/personality in alpha — uniqueness is a hero property.)

#### Traits (mechanical)

Permanent stat + behavior modifiers that change the simulation.
- Every trait has an upside **and** a downside; none purely useless; downsides are tactical risks, not random punishment.
- **Bounded worst cases** — every behavioral downside carries an *escape valve* (a condition that ends or limits the misbehavior). A downside may cost a fight, never play it for you indefinitely.
- The **starter batch** never rolls the harshest behavioral hooks.
- 1 trait default (75%), 2 traits (25%).
- Attribute mods clamp finals ≥ 1. **Behavior hooks** are hard rules the sim obeys — they outrank the unit's priority/targeting (Part III precedence).

Alpha starter catalog (exact numbers/hooks in `shared/config`; expand in beta), grouped by what they touch:

- **Stat-shaping** (pure attribute trade) — Brawny (STR +4 / AGI −2) · Nimble (AGI +4 / STR −2) · Gifted (INT +4 / STR −2) · Blessed (LCK +4 / INT −2).
- **Behavioral combat** (stat + hard hook) — **Coward** (AGI +3; flees at low HP, moves faster while fleeing; breaks from the line; *valve:* rallies after a short interval or while near the leader) · **Stupid** (STR +5, INT −5; 10% misfire — wasted action / griefless friendly-fire; *valve:* misfires only on basic attacks, never wastes a charged cast) · **Headstrong** (STR +3; ignores its set targeting, charges the nearest enemy) · **Bloodthirsty** (+Phys Atk after a kill; won't retreat — ignores pull-out orders) · **Reckless** (+Phys Atk as HP falls; −Phys Def) · **Loyal** (+stats near the leader; −stats far from the leader) · **Slow Starter** (−stats early in a fight, +stats as it goes on).
- **Out-of-combat / economy** — Scavenger (better Cache/material drops; −minor combat stat) · Tough (slower HP attrition / heals more at Rest; −Acting tempo) · Quartermaster (as leader, +crafting/loot fortune) · Lucky Fool (LCK +5; 5% random action).

#### Personality (identity + soft lean)

Three rolled dimensions plus a generated name; permanent, visible. Personality surfaces in three places, **none of which change a unit's numbers**:

1. **Soft battle lean** — temperament gives a *small, deterministic* behavioral bias (advance timing, target tie-break, when to dump a charged skill). **Bounded and lowest-precedence**: trait hooks and the unit's priority/targeting both outrank it, so it colors a fight without overriding the plan or breaking determinism. (Temperament also nudges a unit's default priority.)
2. **Event-tile keys** — motivation (and some quirks) decide how run-map **Event** tiles resolve. The meta surface where personality has real stakes.
3. **Flavor** — banter, status-log lines, recruitment/Home presentation; cosmetic text.

Dimensions (alpha pools — expand in beta):
- **Temperament** (drives the battle lean) — Brave · Cautious · Hot-headed · Stoic · plus flavor-leaning Arrogant / Cheerful / Grim.
- **Motivation** (drives Event keys) — Glory · Coin · Vengeance · Duty · Survival · Faith · Knowledge.
- **Quirk** (flavor + occasional Event key) — Superstitious · Talkative · Trophy-taker · Fears magic · Old wound · Speaks in proverbs.

### Design Interfaces (data shapes)

- `UnitAttribute`: STR, AGI, INT, LCK.
- `UnitTrait`: id, name, +mods, −mods, behavior hooks.
- `UnitPersonality`: name, temperament, motivation, quirk.
- `Hero`: identity, race, class, base + final attributes, traits, personality, **priority (player-set)**, progression state.
- `RankFile`: archetype, tier, derived stats, **priority (player-set)** (no individual traits/personality in alpha).
- Derived: HP/regen, Mana (charge bar + rate), phys/magic atk, phys def/magic resist, **acting tempo (move speed + attack-timer fill)**, attack speed, attack range, unit footprint, accuracy, evasion, crit chance/damage.

## Unit Progression & Meta Advancement (heroes)

Axes: levels + stat points, class promotion, abilities (plus equipment). Persisted, roster-safe.

**Levels** — only the **deployed heroes** earn full XP, granted per fight won and **kept even on a wipe** (XP banks the instant enemies fall; a wipe only forfeits the unbanked *haul*). A failed run still grows the warband. Curves (config): XP-to-next ≈ `level^1.5 × 1000`. **Alpha cap:** T1 levels 1–9; **lv10 unlocks T2**; T2 to ~20.

**Catch-up** — the **Training Grounds trickles a %** of each run's banked XP to benched roster heroes, and **fresh recruits enter at a level floor** of (highest roster level − N).

**Stat points** — each level grants points across STR/AGI/INT/LCK. Rolled base immutable; only earned points are allocated, **freely respecable** at Home.

**Class promotion** — at lv10, pick one of two race-specific T2 branches. May cost resources; gated by Training Grounds. Each tier grants role passives. T3 later.

**Ability progression** — each hero has an **active** signature (Mana-charged) + a **passive** (always-on) + a **command aura** (an army-wide effect its army gets — a type-targeted buff, an army-wide buff, or a unique mechanical effect; Part III). The active gains ranks with level; T2 adds/upgrades a skill and may shape the aura.

**Account / Commander level** — rises with total play; unlocks features, raises caps, small global bonuses. Deliberately gentle (config).

## Items, Equipment & Crafting

Second power axis (heroes). Generated/equipped/upgraded/salvaged, all server-side.

- **Sources** — battles drop materials or gear (deeper/elite = better); bosses drop premium; salvage yields materials.
- **Model** — slots (alpha: Weapon, Armor, Accessory); each piece has slot, level, grade, stats feeding the two-channel derived model. **Grades**: Common → Uncommon → Rare → Epic → Legendary. Gear grades are explicit (the no-rarity rule is characters-only).
- **Crafting-with-generation** — spend materials → server-rolled stats within grade/level bounds; LCK biases quality.
- **Enhancement** — level gear with materials; grade-up by combining; reforge (beta).
- **Salvage / trade** — unwanted gear/heroes → materials; gear tradable in multiplayer (trade-only, no marketplace).

## Roster & Company Assembly

**Roster** — permanent collection of **heroes** in race-specific profile rosters (seeded by the 5 starters, grown by recruitment). Heroes persist level, points, abilities, traits, gear (roster-safe). Heroes that wiped carry **Weary** into the next run (Part V — small temporary penalty, cleared by benching one run or a Home cost). Storage **capped** (raised by Storehouse).

**Company / armies** — the deployed force = **~10 armies**, each ≤9 units (a meta knob; the **Barracks** raises army count + size). An army is a **hero + up to 8 units** (the hero = an elite unit + a command aura) or a **headless unit mix** (no aura). Armies are **freely composed**; up to **4 armies** engage a tile. Only deployed **heroes** earn full XP.
- **Single-race (alpha)** — drawn from one race-roster (**Humans** in alpha); **mixed-race unlocks later**.
- A hero reduced to 0 HP is **out for the run** (its army loses the aura; surviving units fight on leaderless); rank-and-file losses are gone for the run.
- One hero = **commander**: small party bonus + source of out-of-combat LCK fortune.

**Loadout** — per-hero slots (Weapon/Armor/Accessory), equipped at Home, swappable between runs.
**Presets** — save **armies** + loadouts in the Barracks (alpha: "last used"; beta: named).
**Plan** — compose armies and set each unit's **priority** (in the Barracks); read off scouting; live commands (send army, reinforce, retreat) happen during the run (Part III).

---

# Part III — Combat — Real-Time Conquest

This is the centerpiece. Full engineering detail lives in `docs/specs/realtime-conquest.md`; this section is design intent.

Combat is **real-time territorial conquest**. A run plays out on a **map of tiles** in real time: you command **~10 armies** (each ≤9 units), expand by sending armies to take adjacent enemy tiles, and each contested tile resolves as a **multi-army grid auto-fight** (≤4 armies/side). **No live input *inside* a fight** — your agency is at the **map layer** (which armies to send where, from which direction, when to reinforce, when to cut losses), and each unit's pre-set **priority** governs how it behaves once fighting. **Offline can pause; online cannot.**

Genre: real-time node conquest (Galcon / Eufloria / Northgard) **with a persistent, individual RPG roster** — the leveled heroes, traits, and gear of Part II, not anonymous units.

**Design pillar — real-time command is the skill.** *(This retires the prior "prep is the skill / watch a deterministic replay" pillar, and the turn-based model before it.)* Depth lives in reading the map and commanding live: which fronts to open, how to route and pincer, when to commit or retreat. The run's resource is your **finite army**, ground down by attrition as you race the objective — heroes are the durable anchors you protect; rank-and-file are the expendable body you feed in.

## Two layers, one clock

- **Conquest map (real time — you command).** A grid of tiles, each owned by you / enemy / neutral, with 4-directional (N/S/E/W) adjacency. You may attack a tile only from an **owned, adjacent tile** — no leapfrogging; you conquer outward. Dispatching an army sends it across owned territory to a launch tile; it **travels in real time** then enters the fight. Capturing a tile flips it to you, opening new fronts.
- **Tile fight (multi-army grid auto-fight).** Up to **4 of your armies** engage a tile's garrison on a large grid. Each army **enters through the gate (N/S/E/W edge) matching its map approach** — armies from two owned sides enter two gates, a **pincer** hitting the garrison's flank/back. Same-gate entrants **stack then disperse** (a concentrated entry is briefly AoE-vulnerable). The fight resolves itself; you do not micro it.

## Engagement, reinforcement & retreat

- **4-army cap.** At most 4 of your armies may be committed to one enemy tile; an **army-slot is reserved the moment an army is dispatched** (a travelling reinforcement counts).
- **Reinforce.** When a slot frees (an army is wiped or retreats), send another from any owned adjacent tile.
- **Retreat.** Pull an army — it exits via its gate and travels back, freeing the slot, but it can be hit during the pullout.
- **Heavy garrisons** (1–4 defending armies' worth) are ground down by feeding fresh armies through your slots. Win the run by taking the **objective / boss tile**; lose when your forces are spent (roster-safe — Part V).

## Armies, heroes & auras

- **You command armies, not units.** ~10 armies/run, each ≤9 units, **freely composed** in the Barracks (Part V). Up to **4 armies** engage a tile; their units **auto-resolve** via priority.
- **A hero leads an army** — fighting as an **elite unit** and projecting a **command aura**: a **type-targeted buff** (e.g. +to cavalry, +to magic units — rewards composing around it; *synergy encouraged, not enforced* — a knight can ride with mages, the aura just won't touch them), an **army-wide buff**, or a **mechanical / signature effect** (e.g. *doubling the army's charge generation*, *"the army can't rout"*). Auras are class/branch-defined (Part II).
- **Headless armies** have no hero (no aura). Heroes are scarce early, so **early runs lean headless; hero-led armies are the recruited upgrade**.

## Priority — the one tactical knob

Each unit carries a player-set **priority** that does two things at once, and they reinforce each other:

- **Move/act order** — high priority acts first, so it **advances and takes the front**; low priority hangs back.
- **Aggro** — enemies target **nearest, tiebreak highest priority**, then lock on until the target dies, leaves range, or becomes unreachable (mild stickiness, so advancing units don't thrash aggro).

So priority is "**how forward / how much does this unit want the enemy's attention.**" Tanks: high (front + soak). DPS and casters: low (rear + ignored until the front falls). Targeting is symmetric, so fronts clash while both backlines stay protected until a front collapses. **Formation and combined arms emerge from priority** — no manual placement, no in-fight micro — which is exactly what keeps several simultaneous fights manageable. Priority is **pre-set** (a unit property; class sets a default, personality temperament nudges it), never changed mid-fight. *(This replaces the old per-unit tactics presets.)* The one build it forbids: a glass cannon that acts first yet is ignored — "acts first" is welded to "gets hit first," which *is* the tank/DPS tension.

**Behavior precedence (preserved):** **trait hooks → priority/targeting rules → default AI.** A Coward still flees, a Headstrong still charges the nearest enemy — trait hooks outrank priority, and all are deterministic from seed.

## Scouting (pre-commit read)

Before committing to a tile you can **scout** its garrison (seed-deterministic) — the **single most valuable read in the game**:

- **Every defender** — archetype, level, the four primaries, key derived stats (HP, phys/magic atk, phys def/magic resist, acting tempo), damage **channel** and **element tag**, signature ability, and its priority.
- **Structure** (fortified/boss tiles) — HP, attack channel, range/arc (an emplacement; auto-attacks, must be destroyed).
- **Threat callouts** *(cues, not a verdict)* — a handful of deterministic, plain-language reads derived from the visible data — e.g. *"their cavalry can reach your backline," "their casters out-bulk your front line."* They **teach the read**: they point at what matters without summing it into an answer.

**No win-probability verdict is shown to the player.** Whether a tile is winnable, and at what attrition cost, is the read you make — and learn by playing — not a number the game computes for you. The residual the player can't compute in-head — resolution dice, the live clash's timing/ordering, the true attrition cost, and how it interacts with your other fronts — is what playing the fight reveals. *(The deterministic win-probability Monte-Carlo still runs as a **dev-side balance/telemetry instrument** (Part VIII), not a player readout. A coarse "Favored / Even / Risky" tier may be an **assist option** (Part VII), never the default.)*

## Skills & Mana (ability charge)

Every hero class has **one active** (the Mana-charged signature) and **one passive** (always-on). T2 branches add or upgrade a skill.

**Element tags.** Magic skills carry an element tag — alpha set: **Arcane, Fire, Lightning**. Tags are a **modifier layer inside the Magic channel** — they interact with terrain (Wet → Lightning, Forest → Fire) — not a third channel, and there are no per-element unit resistances.

**Mana is charged by combat and spent per skill** (no time-regen):
- **Dealing damage** — each basic attack that lands adds a flat charge (`+M_hit`).
- **Taking damage** — each hit received adds charge scaled to the bite (`+M_taken × incoming/MaxHP`, capped per hit).
- **INT** raises charge rate. Mana accumulates to a cap; it is **not** an INT pool.

**Each active has its own Mana cost.** A unit casts when Mana ≥ cost, then spends it (remainder carries); a cast takes cast-time ticks. Cheap skills fire often; expensive skills land rarely. **Pressure valve (universal):** if a skill stays affordable but its cast-condition stays unmet for a sustained interval (config), it casts anyway on the best target — no active can dead-lock. Frontline units charge off damage **taken**; strikers off damage **dealt** — which the player exploits via priority (front vs rear) and gate choice.

**Actives (T1)** — Warrior **Cleave** (arc physical, high cost; held until ≥2 enemies in arc, subject to the valve); Archer **Aimed Shot** (single-target physical, pierce/crit, mid cost); Mage **Bolt** (single-target Arcane nuke, low cost; Support branch swaps to **Ward/Heal** at T2).

**Passives (T1)** — Warrior **Hardened** (flat reduction to incoming physical); Archer **Deadeye** (bonus crit; crits grant extra Mana); Mage **Arcane Resonance** (magic ignores a flat % of Magic Resist). Passives are part of the pre-battle read.

**Healing entry-cap.** In-battle healing can never raise a unit above the HP it **entered that battle with**. Healing answers burst within a fight; recovering run attrition belongs to Rest tiles and items (Part V).

## Damage, resolution & view

- **Damage** — hit = clamp(Accuracy − Evasion, 0.10, 1.00); mitigation = `incoming × K/(def+K)` vs matching defense; crit × Crit damage; ×0.9–1.1 variance, floor 1. These rolls plus the live clash's timing/ordering are the only uncertainty against a fully-scouted tile.
- **Tile resolution** — a tile fight is won when the garrison is wiped (the tile **flips** to you) and lost when your committed units are wiped or pulled out. A boss/objective tile may add a structure (auto-attacks, must be destroyed) plus adds/mechanics. The **run** is won by taking the objective tile and lost when your army is wiped (roster-safe — Part V). Recorded as per-tick snapshots (replay); same seed + input log = identical run.
- **View** — you **manage from the map**: tiles show ownership, garrison strength, and combat status; travelling armies show an army→tile indicator. **Zoom into a tile** to watch its grid fight in detail. It is **live — no fast-playback or skip** (you are playing, not reviewing); **offline can pause to issue army orders, online cannot** (a shared map can't be frozen). The client interpolates per-tick cell positions for smooth motion (cosmetic, never feeds back into the sim).

---

# Part IV — Shared Systems (World, Economy, Enemies)

Substrate for both pillars.

## Connected World Map

The tile map is now the **core surface of combat itself** (Part III), in both pillars: in solo it's the **run's conquest map** (you expand tile-by-tile toward the objective); in MP it's a **shared conquest map** several players push together. The map creates fronts, routes, supply lines (you attack only from owned adjacent tiles), chokepoints, and objectives (anchors, seals, settlements, towers, ruins). MP adds player clusters/squads, regional identity, and corruption that spreads through connected tiles. Alpha-match shape (later, Part VI): a small shared region with a central Lidium wound and a few co-op commanders.

## Economy & Resources

Solo economy feeds progression — **no territory/production/base-building**. Currencies/materials flow from Campaigns into power systems; all server-held.

- **Currencies/materials**: XP (hero levels); crafting materials (tiered); enhancement materials; recruit currency (heroes); **muster currency / upkeep** (rank-and-file); home-upgrade resources; premium/boss materials.
- **Sources**: battles (materials/gear/XP), bosses (premium), salvage (gear/heroes → materials).
- **Sinks**: crafting, enhancement, home facilities + perks, hero recruitment, **muster**, promotion.

Tension = where to spend a finite haul; harder content gates richer materials. The muster economy adds a second tactical question — how much of the haul to spend on disposable numbers vs permanent hero power. Numbers in `shared/config`.

## Towers, Base & Army Capacity

*Deferred / out of scope for solo.* No player base-building in solo alpha/beta. Multiplayer-only if ever; the design is moving away from base-building. (The solo Home Base hub is separate — not map base-building.)

## PvE Enemy Behavior

**Alpha:** enemy tiles are **static garrisons** — you choose when and how to assault them. **Beta+ / MP:** Lidium turns active — spreads corruption through connected tiles, builds/repairs anchors, **sallies from tiles to raid or retake**, pressures overextension, runs escalating rituals, creates group emergencies. Challenge from timing/territory/supply/scouting/split-pressure (and coordination in MP) — not huge HP pools.

**Enemy stat blocks** — enemies/bosses use the same four stats + derived formulas, but primaries come from **level-scaled archetype templates** (seed-deterministic), not random rolls → readable archetypes (STR/HP brute, INT imp-caster, AGI flanker). A tile's garrison is combined-arms too (a high-priority brute line, low-priority caster backline, flanking stalkers), pre-positioned on the tile-fight grid by the generator. Bosses = inflated pools + structure + adds/mechanic. Client renders only.

---

# Part V — Solo Campaigns

## Single-Player Experience

A complete game in two states: **Home Base** (prepare) ⇄ **Campaign** (roguelite run).

`Boot → Login → [first time: Onboarding] → Home Base ⇄ Campaign run`

### Home Base (hub)

Persistent HQ, mandatory between runs. Actions:

- **Roster** — review heroes.
- **Craft** — materials → gear.
- **Recruit** — recruit currency → new heroes.
- **Muster** — muster currency → rank-and-file for the next run.
- **Progress** — level + promote heroes.
- **Upgrade** — facilities + perks (below).
- **Barracks** — assemble armies (hero + units, or headless mixes), set priorities, save presets.
- **Campaign select** — choose a Campaign (alpha: one).

### Home Upgrades

Meta-progression; resource-funded, permanent, never lost on a wipe. Two tracks:

- **Facilities** — **Barracks** (assemble armies; raises **army count + size**; saves presets); Crafting Workshop (gear quality/recipes/slots); Recruit Hall (hero generation, recruit-currency value, level floor); **Muster Yard** (rank-and-file archetypes, muster cost/cap); Training Grounds (level cap, XP, bench XP trickle, gates T2 promotion); Storehouse (roster/material capacity); War Table *(beta)* (harder campaigns, pre-run boons, map intel).
- **Perks** — persistent passive bonuses, tiered, global or class-targeted. Stack with levels/gear.

Alpha: Barracks, Workshop, Recruit Hall, Muster Yard, Training Grounds, Storehouse + a few perks. Effects/costs in `shared/config`; all server-validated.

### Session shape

Active ~10–30 min runs. Form company → push the conquest map in real time, managing attrition and reinforcement → bank the haul by extracting or taking the objective / lose the unbanked haul if your army is wiped (roster-safe; earned hero XP is kept either way) → return to Home to spend & strengthen → harder Campaign. **prepare → run → bank → strengthen** is the whole game; the real-time conquest is the payoff.

## Campaign Structure & Roguelite Loop

Pick a **company** (heroes + muster) → enter the **conquest map** → expand in real time from your start tile to the **objective / boss tile** → take it or extract → return to Home. **No base-building.** The map is one combat surface at two scales (Part III): the **conquest map** (the real-time strategic layer you command) and, when you assault a tile, its **tile-fight grid** (the zoom-in tactical layer).

- **Conquest map** — a grid of tiles, 4-directional (N/S/E/W) adjacency. Most of the grid is **impassable terrain** (walls, water, corruption) that shapes the fronts; the rest are **tiles** you can own or contest, forming a branching network from your **start tile** to the **objective/boss tile** far across (~10 tiles on the shortest line). You hold a tile, then **push outward in real time** — you can only attack a tile from an owned adjacent one. Each tile carries a **primary terrain** (alpha: Flatland · Forest · Mountain · Riverlands) that shapes its tile-fight grid (Part III).
- **Fronts, not a single path** — there is **no move budget**; the cost of pushing is your **finite army spread across fronts** plus attrition. Optional spur tiles (treasure, elite, recruit, **muster**, boon) sit off the direct line, trading extra fights and exposure for reward. Reading the map = how many fronts to open, which tiles to take in what order, where to **pincer**, and where to spend muster.
- **Visibility & scouting** — at run start the **layout and tiles are revealed**, most showing **type** (icon) and **primary terrain**. **Mysterious tiles** stay `?` until reached. **Scout** an enemy tile (Part III) before committing to read its garrison.
- **Tile types** (alpha set) — **Start**; **Enemy**; **Elite**; **Boss/Objective**; **Rest** (restore HP / repair attrition on capture or hold); **Cache**; **Event** (a choice with a run-scoped outcome; can key off a deployed hero's **personality**); **Recruit**; **Muster** (rank-and-file or muster currency); **Boon** (run-scoped power); **Mysterious** (`?`). Capturing a tile claims its effect and turns it into a staging point. Contents/spawn rates per campaign in `shared/config`.
- **Attrition** — HP damage **persists across fights within a run**; **Rest** tiles and items restore it. In-fight healing is capped at fight-entry HP (Part III). **Mana does not carry** — per-fight charge, empty each engagement. **Units lost are gone for the run** — a thinned army must be re-mustered. Attrition + a finite army + muster upkeep is the in-run pressure.
- **Extraction & stakes** — roster-safe. The player may **extract** from an owned tile, ending the run and banking everything earned so far; taking the objective/boss tile is the big payout. A **wipe** (army destroyed) forfeits only unbanked run rewards + run-scoped power (heroes, levels, banked loot untouched) — but wiped heroes start the next run **Weary** (small stat penalty, config), cleared by benching them one run or a small Home cost.
- **Power** — run-scoped (boons/temporary) vs permanent (hero levels, promotions, gear, banked materials).
- **Difficulty** — escalates with depth; enemy tile levels scale.
- **Map generation** — alpha **semi-fixed**: hand-designed layouts with light seeded randomization; fully procedural in beta. All generation seeded via `rng.ts` (deterministic, sim-side).
- **Content unlocks** — clearing a Campaign unlocks harder campaigns/difficulty tiers with better drops. Alpha: one campaign + ≥1 harder re-clear tier.

## Story Delivery (solo saga surface)

Three diegetic mechanisms: **Home vignettes** (milestone-triggered scenes); **campaign intro/outro framing** (each campaign ties its boss to the arc); **Event-tile story chains** (personality-keyed fragments, optional). Principle: reveal through play, never exposition dumps.

## Daily Challenge (beta)

One **shared daily seed** for all players: same conquest map, garrisons, events. **Online mode only** (the verified save) — leaderboard ranks **banked haul**; offline can play the seed unranked. Nearly free on the deterministic substrate (replay = input log). Open questions in Part IX.

---

# Part VI — Online Conquest Matches (later)

> **Post-beta (Multiplayer Phase).** Delivered after solo alpha/beta; reuses the solo substrate (same real-time deterministic conquest).
> **⚠️ Under redesign.** The combat rework to **real-time conquest** (Part III) makes MP **real-time co-op** — players matchmake into a shared conquest map and fight enemies together — via **server-relayed deterministic lockstep** (Part VIII). The async, background-friendly, 10–50-player, day-long structure described below is **superseded**; it's kept only as raw goals (objective types, the saga arc) to re-fit to the real-time model. Open questions in Part IX / `realtime-conquest.md` §11.

## Target Match Structure

- **Real-time co-op:** a small party matchmakes into a **shared conquest map** and fights enemies together in real time; PC/Steam. (Player count, match length, and whether larger battles scale up are open — Part IX.)
- **Live presence, not async check-ins** (the real-time model needs players present); coordinated pushes, cross-commander pincers, shared reinforcement of fronts.
- Victory: complete shared objectives before corruption/portal escalation overwhelms the region. Each cleared map advances the saga.

## Match Scope & Loops

- Two playable races (Humans, Beastmen); Elves not playable (appear via ruins/seals/lore).
- **Conquest limit per war phase** — a match divides into phases (~6h for a 1-day match; daily for multi-day); each player gets a per-phase conquest allowance. **Conquest credit** = first entrant who survives the tile fight.
- Loops: **Expansion** (capture toward objectives), **Defense** (hold seal/ritual sites), **Logistics** (move/reinforce, keep routes open), **Discovery** (scout ruins, lore, boss mechanics, seals).

## Objective Design Principles

Require cooperation without needing all 10 online at once: local squad (2–4) objectives; multi-site objectives (no solo carry); per-phase limits; survivor-first credit; global contribution; time-limited escalating rituals; can't-save-everything choices. Avoid pure shared-health-bar bosses — use mechanics/timing/simultaneous pressure.

## Story Arc: The First Wound

Humans opened portals chasing forbidden knowledge; the portals bent to Lidium; lesser demons crossed and now widen the wound via armies, corruption, anchors, rituals. Objective chain: reclaim settlements → discover corrupted land → destroy anchors → recover/activate Elven seals → defend sealing rituals → defeat an archdemon's herald before the portal opens. Reveal: the demons aren't invading — they're building a doorway for something too powerful to cross.

## TBD

Victory/failure/scoring specifics; coordination/social tools (squads, pings, shared markers, attention queue); async play; free-rider/carry & inactive-player handling.

---

# Part VII — Economy, Meta & Product

## Generation & Trading Economy

*TBD:* tie hero recruitment + crafting-with-generation + muster into a non-cash player economy; generation/muster rates; duplicate handling; **trade-only** (swap heroes/items directly — no real-money marketplace); anti-abuse (account farming, dupe funneling, coercion). Trading is **online-mode only** — the offline save has no shared economy (the wall, Part VIII).

## Player Motivation Layers

*(Match.)* Personal (grow army/contribution), local (help neighbors), global (objectives before timer/corruption), story (uncover the world), meta (unlock maps/tools/cosmetics/commanders/lore). Best when login = meaningful choices.

## Business Model & Monetization

*TBD:* commercial model (premium / F2P-cosmetics / campaign DLC). Firm: **no real-money roster power** (no paid rolls/pity/stamina/rerolls, no paid muster power); trading non-monetized. Acceptable = cosmetics, future campaigns.

## Difficulty & Accessibility *(stub)*

- Difficulty tiers per campaign (beta) plus **assist options** independent of difficulty (damage taken −X%, free extract, an **accessibility slow-mode**) that flag the save but never gate content. Real-time command raises motor/attention demands — **online is no-pause; offline has active-pause** — so commit early to generous default pacing, full mouse-only and keyboard-only play, scalable UI text, and colorblind-safe terrain/channel/type coding (never color-only).
- Open: exact assist list; whether assists affect leaderboards (daily: assists = unranked).

## Audio Direction *(stub)*

- Tone: grounded war-camp, not epic-orchestral bombast — the saga is attrition and unease.
- Functional audio carries **multi-front awareness**: distinct cues for a front under pressure, a unit lost, a tile captured, a slot freed — so the player can command across several fights without watching each. Distinct hit/crit/skill/structure cues keep a zoomed-in fight readable by ear.
- Open: music per Home/run/battle/boss; VO (likely none in alpha); budget.

## Telemetry *(product/ops)*

Every fight passes through the authoritative sim — log setup (company, gear, priorities) + the timestamped input log, scouting snapshot, the **internal win-probability estimate** (dev-side only; not shown to players — see Part III), outcome, and **margin (actual vs predicted)** per fight; run-level expansion/extract/wipe/muster events. This is the balancing dataset for beta. Schema in Part IX tooling.

## PC & Platform

Steam/PC first: mouse+keyboard, resizable desktop windows. A compact **real-time war-room command surface** (map view + zoom-into-tile), not phone portrait. Sessions are **active real-time play**, not idle/background; an event log + attention queue surface fronts that need a decision. Steam (achievements, cloud profiles, friend invites) are goals, not alpha-blockers. Mobile/tablet = possible later port (the cell-tap command surface ports reasonably), not the foundation.

