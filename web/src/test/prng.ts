// A small seeded PRNG for property tests (mulberry32): the same seed gives the same sequence, so a
// failing case can be replayed from its seed. No dependency.
export function prng(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  return {
    /** An integer in [0, n). */
    int: (n: number): number => Math.floor(next() * n),
    pick: <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T,
  };
}
