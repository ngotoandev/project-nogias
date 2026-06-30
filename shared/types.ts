export type Side = 'A' | 'B';
export type AttackKind = 'melee' | 'ranged' | 'magic';
export type DamageChannel = 'physical' | 'magic';
export type SkillId = 'heavyStrike' | 'cleave';
export type TraitId = 'reckless' | 'slowStarter' | 'bloodthirsty' | 'loyal'
  | 'coward' | 'headstrong' | 'stupid' | 'luckyFool';
export type Temperament = 'brave' | 'cautious' | 'hotheaded' | 'stoic';
export type Edge = 'N' | 'S' | 'E' | 'W';

export interface Cell { x: number; y: number; }

export interface Attributes { str: number; agi: number; int: number; lck: number; }

export interface DerivedStats {
  maxHp: number;
  atk: number;            // effective attack for the unit's attackKind
  channel: DamageChannel; // melee/ranged -> physical, magic -> magic
  physDef: number;
  magicResist: number;
  accuracyBp: number;     // basis points (10000 = 1.00)
  evasionBp: number;      // basis points
  critChanceBp: number;   // basis points
  critMultX100: number;   // x100 (125 = 1.25)
  tempoRate: number;
  moveRange: number;
  attackRange: number;
  maxMana: number;
  manaChargeBp: number;   // INT-scaled charge multiplier (basis points)
}

export interface UnitSpec {
  id: string;
  side: Side;
  attrs: Attributes;
  attackKind: AttackKind;
  skill?: SkillId;
  traits?: TraitId[];
  priority: number;    // higher = more forward + more aggro
  pos: Cell;
  personality?: { temperament: Temperament };
  startHp?: number;    // opt-in entry HP; clamped to [1, maxHp]; absent ⇒ maxHp
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
  mana: number;           // current; starts 0; no carry between fights
  skill?: SkillId;        // optional active (copied from the spec)
  traits: TraitId[];
  kills: number;
  stallSinceTick: number;
  fleeingSinceTick: number;
  temperament?: Temperament;
  retreating?: Edge;      // set by orderRetreat; unit moves toward this exit edge
  exited?: boolean;       // true once unit reaches the exit edge and leaves the field
}

export interface GridSpec { width: number; height: number; blocked: Cell[]; }

export interface FightSetup { grid: GridSpec; units: UnitSpec[]; }

export type EndReason = 'decisive' | 'wipe' | 'timeout';

export type FightEvent =
  | { t: 'move'; id: string; from: Cell; to: Cell }
  | { t: 'attack'; id: string; target: string; damage: number; crit: boolean; channel: DamageChannel; lethal: boolean; skill?: SkillId }
  | { t: 'miss'; id: string; target: string }
  | { t: 'misfire'; id: string; target: string }
  | { t: 'death'; id: string }
  | { t: 'end'; winner: Side | 'draw'; ticks: number; endReason: EndReason };

export interface FightResult {
  winner: Side | 'draw';
  ticks: number;
  endReason: EndReason;
  survivors: { id: string; side: Side; hp: number; retreated?: boolean }[];
  events: FightEvent[];
  hash: string;
}

export interface ReplayBundle {
  version: 1;          // envelope version; later plans add a `commands` stream
  setup: FightSetup;
  seed: number;
}

export type FightScriptAction =
  | { atActivation: number; kind: 'join'; specs: UnitSpec[] }
  | { atActivation: number; kind: 'retreat'; unitId: string; exitEdge: Edge };

export interface ScriptedFightBundle {
  version: 2;
  setup: FightSetup;
  seed: number;
  script: FightScriptAction[];
}

export interface ReplayResult {
  hash: string;        // hashFight of the final state — the parity target
  winner?: Side | 'draw';
  ticks: number;
  endReason?: EndReason;
}

// ── Conquest-map types (Plan 6) ──────────────────────────────────────────────
export type MapEdge = 'N' | 'S' | 'E' | 'W';
export type TileOwner = 'player' | 'enemy' | 'neutral';
export type TileType = 'start' | 'enemy' | 'elite' | 'boss' | 'rest' | 'cache' | 'event' | 'recruit' | 'muster' | 'boon' | 'mysterious';
export interface BoonSpec { attr: 'str' | 'agi' | 'int' | 'lck'; amount: number; }
export interface MapTile { id: string; type: TileType; owner: TileOwner; neighbors: { N?: string; S?: string; E?: string; W?: string }; garrison: UnitSpec[]; muster?: UnitSpec[]; boon?: BoonSpec; effectClaimed?: boolean; }
export type ArmyState = 'garrisoned' | 'travelling' | 'contested' | 'retreating';
export interface Army { id: string; units: UnitSpec[]; tile: string; state: ArmyState; target?: string; route?: string[]; travelGauge: number; gate?: MapEdge; retreatOrdered?: boolean; /* transient — NOT hashed */ }
export interface MapSetup { tiles: MapTile[]; armies: { id: string; units: UnitSpec[]; tile: string }[]; }
export type MapEvent =
  | { t: 'dispatched'; armyId: string; toTile: string }
  | { t: 'hopped'; armyId: string; from: string; to: string }
  | { t: 'captured'; tile: string; by: string }
  | { t: 'retreated'; armyId: string; to: string }
  | { t: 'slotFreed'; tile: string; armyId: string }
  | { t: 'rejected'; armyId: string; reason: string }
  | { t: 'battleOpened'; tile: string; attackers: string[] }
  | { t: 'reinforced'; tile: string; armyId: string }
  | { t: 'repelled'; tile: string };
export type MapCommand = { t: 'dispatch'; armyId: string; toTile: string; gate?: MapEdge } | { t: 'retreat'; armyId: string };
export type RunCommand = MapCommand | { t: 'extract' };
export interface ConquestBundle { version: 3; setup: MapSetup; seed: number; script: { atTick: number; commands: MapCommand[] }[]; }
export interface RunBundle { version: 4; setup: MapSetup; seed: number; script: { atTick: number; commands: RunCommand[] }[]; }
