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
