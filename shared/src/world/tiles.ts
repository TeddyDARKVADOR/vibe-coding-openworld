/**
 * Mapping between edge masks and KayKit Medieval Hexagon tiles.
 *
 * Masks were read from the models with the asset inspector
 * (client/inspect.html?set=roads|rivers|coast): bit e set = the road/river
 * leaves the tile through edge e (0=E, 1=NE, 2=NW, 3=W, 4=SW, 5=SE) when the
 * model has no rotation. Rotating by k*60° maps edge e to (e+k)%6.
 */

const m = (...edges: number[]) => edges.reduce((acc, e) => acc | (1 << e), 0);

const ROAD_TILES: [string, number][] = [
  ['hex_road_M', m(3)], // dead end
  ['hex_road_A', m(0, 3)],
  ['hex_road_B', m(1, 3)],
  ['hex_road_C', m(2, 3)],
  ['hex_road_D', m(1, 3, 5)],
  ['hex_road_E', m(0, 1, 3)],
  ['hex_road_F', m(0, 3, 5)],
  ['hex_road_G', m(2, 3, 4)],
  ['hex_road_H', m(0, 2, 3, 4)],
  ['hex_road_I', m(1, 2, 4, 5)],
  ['hex_road_J', m(0, 3, 4, 5)],
  ['hex_road_K', m(1, 2, 3, 4, 5)],
  ['hex_road_L', m(0, 1, 2, 3, 4, 5)],
];

const RIVER_TILES: [string, number][] = [
  ['hex_river_A', m(0, 3)],
  ['hex_river_B', m(1, 3)],
  ['hex_river_C', m(2, 3)],
  ['hex_river_D', m(1, 3, 5)],
  ['hex_river_E', m(0, 1, 3)],
  ['hex_river_F', m(0, 3, 5)],
  ['hex_river_G', m(2, 3, 4)],
  ['hex_river_H', m(0, 2, 3, 4)],
  ['hex_river_I', m(1, 2, 4, 5)],
  ['hex_river_J', m(0, 3, 4, 5)],
  ['hex_river_K', m(1, 2, 3, 4, 5)],
  ['hex_river_L', m(0, 1, 2, 3, 4, 5)],
];

/** Coast tiles: mask = edges touching water. */
const COAST_TILES: [string, number][] = [
  ['hex_coast_A', m(5)],
  ['hex_coast_B', m(4, 5)],
  ['hex_coast_C', m(0, 4, 5)],
  ['hex_coast_D', m(0, 1, 4, 5)],
];

/** River crossings: river along 0-3; road along 2-5 (A) or 1-4 (B). */
const CROSSING_TILES: [string, number, number][] = [
  ['hex_river_crossing_A', m(0, 3), m(2, 5)],
  ['hex_river_crossing_B', m(0, 3), m(1, 4)],
];

export function rotateMask(mask: number, k: number): number {
  k = ((k % 6) + 6) % 6;
  return ((mask << k) | (mask >> (6 - k))) & 63;
}

export interface TileChoice {
  model: string;
  /** Rotation in multiples of 60°. */
  rot60: number;
}

function buildTable(tiles: [string, number][]): Map<number, TileChoice> {
  const table = new Map<number, TileChoice>();
  for (const [model, mask] of tiles) {
    for (let k = 0; k < 6; k++) {
      const rm = rotateMask(mask, k);
      if (!table.has(rm)) table.set(rm, { model, rot60: k });
    }
  }
  return table;
}

const ROAD_TABLE = buildTable(ROAD_TILES);
const RIVER_TABLE = buildTable(RIVER_TILES);
const COAST_TABLE = buildTable(COAST_TILES);

export function roadTile(mask: number): TileChoice | null {
  return ROAD_TABLE.get(mask) ?? null;
}

export function riverTile(mask: number): TileChoice | null {
  return RIVER_TABLE.get(mask) ?? null;
}

/** Coast tile for a land hex whose water neighbours are given by `mask`. Uses the longest contiguous run. */
export function coastTile(mask: number): TileChoice | null {
  if (mask === 0 || mask === 63) return null;
  let bestStart = 0, bestLen = 0;
  for (let s = 0; s < 6; s++) {
    if (!(mask & (1 << s)) || mask & (1 << ((s + 5) % 6))) continue; // run must start here
    let len = 0;
    while (len < 6 && mask & (1 << ((s + len) % 6))) len++;
    if (len > bestLen) { bestLen = len; bestStart = s; }
  }
  const len = Math.min(bestLen, 4);
  let run = 0;
  for (let i = 0; i < len; i++) run |= 1 << ((bestStart + i) % 6);
  return COAST_TABLE.get(run) ?? null;
}

/** Crossing tile when a straight river and a straight road share a hex. */
export function crossingTile(riverMask: number, roadMask: number): TileChoice | null {
  for (const [model, rm, dm] of CROSSING_TILES) {
    for (let k = 0; k < 6; k++) {
      if (rotateMask(rm, k) === riverMask && rotateMask(dm, k) === roadMask) return { model, rot60: k };
    }
  }
  return null;
}
