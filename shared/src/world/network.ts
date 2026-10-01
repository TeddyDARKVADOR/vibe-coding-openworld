/**
 * Roads and rivers.
 *
 * They are defined as infinite families of gently wiggling lines on the hex
 * grid, so they continue seamlessly from one chunk to the next and can be
 * evaluated for any region without knowing the rest of the world:
 *
 *  - ROAD_EW : lines of (nominally) constant r  → run east–west.
 *  - ROAD_DG : lines of (nominally) constant q  → run NW–SE.
 *  - RIVER   : lines of (nominally) constant s = -q-r → run NE–SW.
 *
 * Each line is perfectly straight near its nominal intersections with the
 * other families, so crossings always use the proper KayKit tiles
 * (4-way road junction, river crossing). Away from crossings a 1D noise
 * shifts the line by up to WIGGLE hexes.
 */
import { WORLD_SEED } from '../constants.ts';
import { hashInts, hashString, mod } from '../math/rng.ts';
import { valueNoise1 } from './noise.ts';
import { edgeBetween, hexKey, hexPath } from './hex.ts';

export const ROAD_SPACING = 32; // hexes between parallel roads (~330-380 m)
export const RIVER_SPACING = 64; // hexes between parallel rivers (~665 m)
const ROAD_EW_PHASE = 3; // a road passes ~31 m south of spawn
const ROAD_DG_PHASE = 2; // its crossing with a diagonal road is ~50 m from spawn
const RIVER_PHASE = 32; // rivers stay far from spawn
const WIGGLE = 2; // max lateral offset (hexes)
const FLAT = 6; // half-length (hexes) of the straight section around crossings
const WIGGLE_WAVELENGTH = 14;

const SEED = hashString(WORLD_SEED);
const FAMILY_SEED = { ew: hashInts(SEED, 101), dg: hashInts(SEED, 102), rv: hashInts(SEED, 103) };

/** Distance from t to the nearest member of {c + p*k}. */
function distToProgression(t: number, c: number, p: number): number {
  const d = mod(t - c, p);
  return Math.min(d, p - d);
}

function wiggle(seed: number, line: number, t: number, flatDist: number): number {
  const env = Math.min(1, Math.max(0, (flatDist - FLAT) / 3));
  if (env === 0) return 0;
  return Math.round(WIGGLE * env * valueNoise1(hashInts(seed, line), t, WIGGLE_WAVELENGTH));
}

const riverS = (k: number) => k * RIVER_SPACING + RIVER_PHASE;
const roadEwR = (i: number) => i * ROAD_SPACING + ROAD_EW_PHASE;
const roadDgQ = (j: number) => j * ROAD_SPACING + ROAD_DG_PHASE;

/** r of east–west road i at column q. */
function roadEwAt(i: number, q: number): number {
  const r0 = roadEwR(i);
  const flat = Math.min(
    distToProgression(q, ROAD_DG_PHASE, ROAD_SPACING), // crossings with diagonal roads
    distToProgression(q, -RIVER_PHASE - r0, RIVER_SPACING), // crossings with rivers (s = -q - r0)
  );
  return r0 + wiggle(FAMILY_SEED.ew, i, q, flat);
}

/** q of diagonal road j at row r. */
function roadDgAt(j: number, r: number): number {
  const q0 = roadDgQ(j);
  const flat = Math.min(
    distToProgression(r, ROAD_EW_PHASE, ROAD_SPACING),
    distToProgression(r, -RIVER_PHASE - q0, RIVER_SPACING),
  );
  return q0 + wiggle(FAMILY_SEED.dg, j, r, flat);
}

/** s of river k at column q. */
function riverAt(k: number, q: number): number {
  const s0 = riverS(k);
  const flat = Math.min(
    distToProgression(q, -s0 - ROAD_EW_PHASE, ROAD_SPACING), // r = -s0 - q must be a road row
    distToProgression(q, ROAD_DG_PHASE, ROAD_SPACING),
  );
  return s0 + wiggle(FAMILY_SEED.rv, k, q, flat);
}

export interface NetworkMasks {
  /** 6-bit masks of road / river edges keyed by hexKey. Only hexes of the queried region are present. */
  road: Map<string, number>;
  river: Map<string, number>;
}

/** Axial bounding box (inclusive). */
export interface AxialBox {
  qMin: number; qMax: number; rMin: number; rMax: number;
}

/** Computes road and river edge masks for every hex of `region` (keys) inside `box`. */
export function computeNetwork(box: AxialBox, region: Set<string>): NetworkMasks {
  const road = new Map<string, number>();
  const river = new Map<string, number>();
  const m = WIGGLE + 3;

  const addPath = (target: Map<string, number>, pts: { q: number; r: number }[]) => {
    for (let n = 0; n + 1 < pts.length; n++) {
      const a = pts[n], b = pts[n + 1];
      const seg = hexPath(a.q, a.r, b.q, b.r);
      for (let s = 0; s + 1 < seg.length; s++) {
        const h0 = seg[s], h1 = seg[s + 1];
        const e = edgeBetween(h0.q, h0.r, h1.q, h1.r);
        const k0 = hexKey(h0.q, h0.r), k1 = hexKey(h1.q, h1.r);
        if (region.has(k0)) target.set(k0, (target.get(k0) ?? 0) | (1 << e));
        if (region.has(k1)) target.set(k1, (target.get(k1) ?? 0) | (1 << ((e + 3) % 6)));
      }
    }
  };

  // East–west roads.
  for (let i = Math.floor((box.rMin - m - ROAD_EW_PHASE) / ROAD_SPACING); roadEwR(i) <= box.rMax + m; i++) {
    const pts = [];
    for (let q = box.qMin - m; q <= box.qMax + m; q++) pts.push({ q, r: roadEwAt(i, q) });
    addPath(road, pts);
  }
  // Diagonal roads.
  for (let j = Math.floor((box.qMin - m - ROAD_DG_PHASE) / ROAD_SPACING); roadDgQ(j) <= box.qMax + m; j++) {
    const pts = [];
    for (let r = box.rMin - m; r <= box.rMax + m; r++) pts.push({ q: roadDgAt(j, r), r });
    addPath(road, pts);
  }
  // Rivers: s = -q - r ranges over [-(qMax + rMax), -(qMin + rMin)].
  const sMin = -(box.qMax + box.rMax) - m, sMax = -(box.qMin + box.rMin) + m;
  for (let k = Math.floor((sMin - RIVER_PHASE) / RIVER_SPACING); riverS(k) <= sMax; k++) {
    const pts = [];
    const s0 = riverS(k);
    // Columns where this river can be inside the box rows.
    const q0 = Math.max(box.qMin, -s0 - box.rMax) - m, q1 = Math.min(box.qMax, -s0 - box.rMin) + m;
    for (let q = q0; q <= q1; q++) pts.push({ q, r: -riverAt(k, q) - q });
    addPath(river, pts);
  }
  return { road, river };
}

/** Nominal crossings of an east–west road and a diagonal road (potential village centres) near a box. */
export function roadCrossingsNear(box: AxialBox, margin: number): { q: number; r: number; i: number; j: number }[] {
  const out = [];
  for (let i = Math.floor((box.rMin - margin - ROAD_EW_PHASE) / ROAD_SPACING); roadEwR(i) <= box.rMax + margin; i++) {
    for (let j = Math.floor((box.qMin - margin - ROAD_DG_PHASE) / ROAD_SPACING); roadDgQ(j) <= box.qMax + margin; j++) {
      out.push({ q: roadDgQ(j), r: roadEwR(i), i, j });
    }
  }
  return out;
}
