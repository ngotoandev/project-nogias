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
