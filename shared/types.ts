export type Side = 'A' | 'B';
export type AttackKind = 'melee' | 'ranged' | 'magic';
export type DamageChannel = 'physical' | 'magic';

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
}

export interface UnitSpec {
  id: string;
  side: Side;
  attrs: Attributes;
  attackKind: AttackKind;
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

export type EndReason = 'decisive' | 'wipe' | 'timeout';

export type FightEvent =
  | { t: 'move'; id: string; from: Cell; to: Cell }
  | { t: 'attack'; id: string; target: string; damage: number; crit: boolean; channel: DamageChannel; lethal: boolean }
  | { t: 'miss'; id: string; target: string }
  | { t: 'death'; id: string }
  | { t: 'end'; winner: Side | 'draw'; ticks: number; endReason: EndReason };

export interface FightResult {
  winner: Side | 'draw';
  ticks: number;
  endReason: EndReason;
  survivors: { id: string; side: Side; hp: number }[];
  events: FightEvent[];
  hash: string;
}

export interface ReplayBundle {
  version: 1;          // envelope version; later plans add a `commands` stream
  setup: FightSetup;
  seed: number;
}

export interface ReplayResult {
  hash: string;        // hashFight of the final state — the parity target
  winner: Side | 'draw';
  ticks: number;
  endReason: EndReason;
}
