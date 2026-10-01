/**
 * Deterministic 2D value noise. Only uses + - * / and Math.floor so results
 * are identical on every JS engine.
 */
import { hashFloat } from '../math/rng.ts';

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [0, 1) with lattice spacing `scale` (in input units). */
export function valueNoise2(seed: number, x: number, z: number, scale: number): number {
  const fx = x / scale, fz = z / scale;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = smooth(fx - ix), tz = smooth(fz - iz);
  const a = hashFloat(seed, ix, iz), b = hashFloat(seed, ix + 1, iz);
  const c = hashFloat(seed, ix, iz + 1), d = hashFloat(seed, ix + 1, iz + 1);
  const ab = a + (b - a) * tx, cd = c + (d - c) * tx;
  return ab + (cd - ab) * tz;
}

/** Two-octave fractal value noise in [0, 1). */
export function fbm2(seed: number, x: number, z: number, scale: number): number {
  return (valueNoise2(seed, x, z, scale) * 2 + valueNoise2(seed ^ 0x5bd1e995, x, z, scale / 2.7)) / 3;
}

/** 1D value noise in [-1, 1). */
export function valueNoise1(seed: number, t: number, scale: number): number {
  const ft = t / scale;
  const it = Math.floor(ft);
  const s = smooth(ft - it);
  const a = hashFloat(seed, it), b = hashFloat(seed, it + 1);
  return (a + (b - a) * s) * 2 - 1;
}
