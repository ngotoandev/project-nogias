// Deterministic integer math primitives. goja-safe: integer ops only (no
// Math.sqrt, no floats), so V8 and goja agree bit-for-bit.

// Floor of the square root of n. Newton's method via integer division
// (Math.floor(n/x) is correctly-rounded float64 then floored — exact and
// identical across engines). Non-positive input -> 0.
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = n;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(n / x)) / 2);
  }
  return x;
}

// Fixed-point square root scaled by 1000: floor(sqrt(x) * 1000).
export function sqrtFP(x: number): number {
  return isqrt(x * 1_000_000);
}
