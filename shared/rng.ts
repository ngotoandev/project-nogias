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
