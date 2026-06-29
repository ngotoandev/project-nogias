// Tunable combat constants — the single balance source (integers only).
// Starting values; to be balanced via the /tools Monte-Carlo instrument.
// Correctness does not depend on these values, only the formulas.
export const HP_BASE = 20;
export const HP_PER_STR = 5;
export const WEAPON_BASE = 2;     // flat atk base (stands in for gear, not modeled yet)
export const FOCUS_BASE = 2;
export const ARMOR_BASE = 0;      // flat defense base
export const RESIST_BASE = 0;
export const MITIGATION_K = 24;   // mitigation curve constant
export const SQRT_SCALE = 1000;   // sqrtFP returns sqrt(x) * SQRT_SCALE
export const ACC_BASE_BP = 10000; // accuracy baseline (1.00)
export const ACC_COEF = 300;      // bp per sqrt(INT)
export const EVA_COEF = 450;      // bp per sqrt(2*AGI+LCK)
export const EVA_CAP_BP = 7500;
export const CRIT_COEF = 900;     // bp per sqrt(LCK)
export const CRIT_CAP_BP = 9000;
export const CRITMULT_BASE_X100 = 125;
export const CRITMULT_COEF = 15;  // x100 per sqrt(LCK)
export const HIT_MIN_BP = 1000;
export const HIT_MAX_BP = 10000;
// Unchanged from Plan 1:
export const TEMPO_BASE = 10;
export const MOVE_RANGE = 3;
export const MELEE_RANGE = 1;
export const RANGED_RANGE = 4;
export const MAGIC_RANGE = 3;
// Mana & skills (Plan 5):
export const MANA_MAX = 100;
export const MANA_BASE_BP = 10000;  // charge-rate baseline (1.00) + the bp denominator
export const MANA_INT_COEF = 400;   // +bp of charge rate per INT
export const M_HIT = 14;            // flat charge when a basic attack lands
export const M_TAKEN = 30;          // charge scale when taking damage
export const M_TAKEN_CAP = 22;      // per-hit cap on charge-from-taken
export const HEAVY_STRIKE_COST = 70;
export const HEAVY_STRIKE_MULT = 180; // x100 (1.80)
// Dynamic-stat traits (Plan 6):
export const RECKLESS_ATK_BP = 6000;   // +atk fraction at 0 HP (basis points of atk)
export const RECKLESS_DEF_BP = 2500;   // flat physDef penalty (always-on downside)
export const SLOW_STARTER_RAMP_TICKS = 300;
export const SLOW_STARTER_EARLY_BP = 2000; // −20% at t=0
export const SLOW_STARTER_LATE_BP = 2000;  // +20% at full ramp
export const BLOODTHIRSTY_ATK_PER_KILL = 4;
export const LEADER_RADIUS = 2;
export const LOYAL_FAR_RADIUS = 5;
export const LOYAL_NEAR_BP = 1500;
export const LOYAL_FAR_BP = 1500;
export const COWARD_FLEE_BP = 3000;        // flee at <= 30% HP
export const COWARD_FLEE_MOVE_BONUS = 1;   // +moveRange while fleeing
export const RALLY_TICKS = 200;            // time-valve: rally (permanently) after this long fleeing
// RNG action hooks (Plan 6, Task 4):
export const STUPID_MISFIRE_BP = 1000;     // 10% basic-attack misfire
export const LUCKY_FOOL_BP = 500;          // 5% retarget to reachable foe
