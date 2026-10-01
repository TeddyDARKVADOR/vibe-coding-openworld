/**
 * Deterministic hashing / random helpers.
 *
 * Everything here only uses integer ops (Math.imul, shifts) and exact float
 * ops, so results are bit-identical in every JS engine (Node server, Chrome,
 * Firefox, Safari). Never use Math.random() for world content.
 */

/** 32-bit FNV-1a hash of a string. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Final avalanche (murmur3 fmix32). */
function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash of a seed and up to 4 integers → uint32. Inputs must be safe integers. */
export function hashInts(seed: number, a: number, b = 0, c = 0, d = 0): number {
  let h = seed >>> 0;
  h = fmix(h ^ Math.imul(a | 0, 0x9e3779b1));
  h = fmix(h ^ Math.imul(b | 0, 0x85ebca77));
  h = fmix(h ^ Math.imul(c | 0, 0xc2b2ae3d));
  h = fmix(h ^ Math.imul(d | 0, 0x27d4eb2f));
  return h;
}

/** Hash → float in [0, 1). */
export function hashFloat(seed: number, a: number, b = 0, c = 0, d = 0): number {
  return hashInts(seed, a, b, c, d) / 4294967296;
}

/** Small seeded PRNG (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  /** Float in [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** Mathematical modulo (always >= 0 for m > 0). */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}
