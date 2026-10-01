/**
 * Pointy-top hex grid in axial coordinates (q, r), matching the KayKit
 * Medieval Hexagon tiles (2 units flat-to-flat along X, points along ±Z).
 *
 *   x = HEX_WIDTH * (q + r/2)      z = HEX_ROW * r
 *
 * Edge indices follow the angle of the edge midpoint measured from +X towards
 * -Z (i.e. counter-clockwise seen from above, "north" = -Z):
 *   0 = E, 1 = NE, 2 = NW, 3 = W, 4 = SW, 5 = SE.
 * A model rotated by rotation.y = k*60° moves its edge e to edge (e + k) % 6.
 */
import { HEX_ROW, HEX_WIDTH } from '../constants.ts';

export interface Hex {
  q: number;
  r: number;
}

/** Axial offset of the neighbour across edge e. */
export const HEX_DIRS: readonly (readonly [number, number])[] = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

export function hexKey(q: number, r: number): string {
  return `${q},${r}`;
}

export function hexToWorld(q: number, r: number): [number, number] {
  return [HEX_WIDTH * (q + r / 2), HEX_ROW * r];
}

export function hexDistance(aq: number, ar: number, bq: number, br: number): number {
  const dq = aq - bq, dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Hex containing world point (x, z). */
export function worldToHex(x: number, z: number): Hex {
  const rf = z / HEX_ROW;
  const qf = x / HEX_WIDTH - rf / 2;
  return hexRound(qf, rf);
}

function hexRound(qf: number, rf: number): Hex {
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

/** Edge index from a to its neighbour b, or -1 if not adjacent. */
export function edgeBetween(aq: number, ar: number, bq: number, br: number): number {
  const dq = bq - aq, dr = br - ar;
  for (let e = 0; e < 6; e++) if (HEX_DIRS[e][0] === dq && HEX_DIRS[e][1] === dr) return e;
  return -1;
}

/**
 * Deterministic hex path from a to b (inclusive). Used to connect successive
 * anchor hexes of roads and rivers. Greedy: at each step take the neighbour
 * that most reduces the distance (lowest edge index on ties).
 */
export function hexPath(aq: number, ar: number, bq: number, br: number): Hex[] {
  const path: Hex[] = [{ q: aq, r: ar }];
  let q = aq, r = ar;
  let guard = 0;
  while ((q !== bq || r !== br) && guard++ < 64) {
    let best = -1, bestD = Infinity;
    for (let e = 0; e < 6; e++) {
      const d = hexDistance(q + HEX_DIRS[e][0], r + HEX_DIRS[e][1], bq, br);
      if (d < bestD) { bestD = d; best = e; }
    }
    q += HEX_DIRS[best][0];
    r += HEX_DIRS[best][1];
    path.push({ q, r });
  }
  return path;
}

/** All hexes whose centre lies inside the axis-aligned world rectangle [x0,x1) × [z0,z1). */
export function hexesInRect(x0: number, z0: number, x1: number, z1: number): Hex[] {
  const out: Hex[] = [];
  const r0 = Math.ceil(z0 / HEX_ROW), r1 = Math.ceil(z1 / HEX_ROW) - 1;
  for (let r = r0; r <= r1; r++) {
    const q0 = Math.ceil(x0 / HEX_WIDTH - r / 2), q1 = Math.ceil(x1 / HEX_WIDTH - r / 2) - 1;
    for (let q = q0; q <= q1; q++) out.push({ q, r });
  }
  return out;
}
