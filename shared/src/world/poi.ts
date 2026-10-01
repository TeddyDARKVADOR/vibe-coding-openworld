/**
 * Special places (points of interest): shrines, ruins, an arena, graveyards,
 * meeting points. Their layout is data (shared/src/data/poi/*.json, built
 * from downloaded KayKit models); their position is a pure function of the
 * world seed:
 *
 *  - the world is divided into POI cells of POI_CELL metres;
 *  - each cell holds at most one place, of a type drawn by weight, at a
 *    random spot that must be open ground (no road, river, lake, mountain or
 *    village nearby), otherwise the cell stays empty;
 *  - the spawn cell always has a meeting point close to the spawn.
 *
 * Client and server get exactly the same places, so the colliders match.
 */
import { CHUNK_SIZE, HEX_WIDTH, SPAWN_CLEAR_RADIUS } from '../constants.ts';
import { rotateXZ } from '../math/angles.ts';
import { Rng, hashFloat, hashInts } from '../math/rng.ts';
import { hexDistance, hexKey, hexToWorld, hexesInRect } from './hex.ts';
import { fbm2 } from './noise.ts';
import { computeNetwork, roadCrossingsNear, type AxialBox } from './network.ts';
import { HILL_THRESHOLD, LAKE_THRESHOLD, NOISE, VILLAGE_CHANCE, VILLAGE_RADIUS } from './seeds.ts';
import type { ColliderSpec, Placement } from './catalog.ts';
import shrine from '../data/poi/shrine.json' with { type: 'json' };
import ruins from '../data/poi/ruins.json' with { type: 'json' };
import arena from '../data/poi/arena.json' with { type: 'json' };
import graveyard from '../data/poi/graveyard.json' with { type: 'json' };
import meeting from '../data/poi/meeting.json' with { type: 'json' };

export interface PoiPiece { model: string; x: number; z: number; rot30?: number; scale?: number }
/** Invisible box (e.g. the legs of an arch, whose convex hull would block the passage). */
export interface PoiBlocker { x: number; z: number; hx: number; hz: number; height: number }

export interface PoiDefinition {
  id: string;
  name: string;
  description: string;
  /** Relative frequency among place types. */
  weight: number;
  /** Metres around the centre kept free of trees, rocks and buildings. */
  radius: number;
  /** Positions in metres relative to the centre, before the place's rotation. */
  pieces: PoiPiece[];
  blockers?: PoiBlocker[];
}

export const POI_TYPES: readonly PoiDefinition[] = [shrine, ruins, arena, graveyard, meeting] as PoiDefinition[];
const BY_ID = new Map(POI_TYPES.map((d) => [d.id, d]));
export const POI_CELL = 384;
const POI_CHANCE = 0.65;

export interface Poi {
  /** Stable id: "<type>@<cell i>,<cell j>". */
  id: string;
  type: PoiDefinition;
  x: number;
  z: number;
  rot30: number;
  radius: number;
}

export function poiDefinition(id: string): PoiDefinition | undefined {
  return BY_ID.get(id);
}

/** Is the disc (x, z, radius) open ground, away from roads, rivers, lakes, mountains and villages? */
export function isOpenGround(x: number, z: number, radius: number): boolean {
  if (Math.hypot(x, z) < SPAWN_CLEAR_RADIUS + radius + 4) return false;
  const reach = radius + 2 * HEX_WIDTH;
  const hexes = hexesInRect(x - reach, z - reach, x + reach, z + reach);
  const box: AxialBox = { qMin: Infinity, qMax: -Infinity, rMin: Infinity, rMax: -Infinity };
  const keys = new Set<string>();
  for (const h of hexes) {
    const [hx, hz] = hexToWorld(h.q, h.r);
    const d = Math.hypot(hx - x, hz - z);
    if (d > reach) continue;
    if (fbm2(NOISE.lake, hx, hz, 320) > LAKE_THRESHOLD) return false;
    if (d <= radius + HEX_WIDTH && fbm2(NOISE.mountain, hx, hz, 520) > HILL_THRESHOLD) return false;
    keys.add(hexKey(h.q, h.r));
    box.qMin = Math.min(box.qMin, h.q); box.qMax = Math.max(box.qMax, h.q);
    box.rMin = Math.min(box.rMin, h.r); box.rMax = Math.max(box.rMax, h.r);
  }
  const net = computeNetwork(box, keys);
  if (net.road.size || net.river.size) return false;
  const villages = roadCrossingsNear(box, VILLAGE_RADIUS + 2).filter(
    (c) => (c.i === 0 && c.j === 0) || hashFloat(NOISE.village, c.i, c.j) < VILLAGE_CHANCE,
  );
  for (const v of villages) {
    for (const h of hexes) {
      if (keys.has(hexKey(h.q, h.r)) && hexDistance(h.q, h.r, v.q, v.r) <= VILLAGE_RADIUS + 1) return false;
    }
  }
  return true;
}

const cellCache = new Map<string, Poi | null>();

/** The special place of POI cell (i, j), if any. Deterministic. */
export function poiInCell(i: number, j: number): Poi | null {
  const key = `${i},${j}`;
  const cached = cellCache.get(key);
  if (cached !== undefined) return cached;
  if (cellCache.size > 4096) cellCache.clear();
  const rng = new Rng(hashInts(NOISE.poi, i, j));
  let poi: Poi | null = null;
  if (i === 0 && j === 0) {
    // Meeting point a short walk from the spawn, so new friends have an obvious landmark.
    const type = BY_ID.get('meeting')!;
    for (let ring = 0; ring < 6 && !poi; ring++) {
      for (let k = 0; k < 12 && !poi; k++) {
        const d = 42 + ring * 14, a = (k * Math.PI) / 6;
        const x = Math.round(Math.sin(a) * d), z = Math.round(-Math.cos(a) * d);
        if (isOpenGround(x, z, type.radius)) poi = { id: `${type.id}@${key}`, type, x, z, rot30: (24 - 2 * k) % 12, radius: type.radius };
      }
    }
  } else if (rng.chance(POI_CHANCE)) {
    let total = 0;
    for (const t of POI_TYPES) total += t.weight;
    let roll = rng.range(0, total);
    let type = POI_TYPES[0];
    for (const t of POI_TYPES) { if ((roll -= t.weight) < 0) { type = t; break; } }
    const rot30 = rng.int(12);
    const m = type.radius + 24;
    for (let attempt = 0; attempt < 4 && !poi; attempt++) {
      const x = Math.round(i * POI_CELL + rng.range(m, POI_CELL - m));
      const z = Math.round(j * POI_CELL + rng.range(m, POI_CELL - m));
      if (isOpenGround(x, z, type.radius)) poi = { id: `${type.id}@${key}`, type, x, z, rot30, radius: type.radius };
    }
  }
  cellCache.set(key, poi);
  return poi;
}

/** Special places whose centre is within `dist` metres (square) of (x, z). */
export function poisNear(x: number, z: number, dist: number): Poi[] {
  const out: Poi[] = [];
  const reach = dist + CHUNK_SIZE; // the spawn meeting point lies slightly outside its cell
  const i0 = Math.floor((x - reach) / POI_CELL), i1 = Math.floor((x + reach) / POI_CELL);
  const j0 = Math.floor((z - reach) / POI_CELL), j1 = Math.floor((z + reach) / POI_CELL);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const p = poiInCell(i, j);
      if (p && Math.abs(p.x - x) <= dist && Math.abs(p.z - z) <= dist) out.push(p);
    }
  }
  return out;
}

/** The special place containing (x, z), if any. */
export function poiAt(x: number, z: number): Poi | null {
  for (const p of poisNear(x, z, 40)) if (Math.hypot(p.x - x, p.z - z) <= p.radius) return p;
  return null;
}

/** World-space model placements and invisible blockers of a place. */
export function poiPieces(poi: Poi): { pieces: Placement[]; blockers: ColliderSpec[] } {
  const pieces = poi.type.pieces.map((p) => {
    const [ox, oz] = rotateXZ(p.x, p.z, poi.rot30);
    return { model: p.model, x: poi.x + ox, y: 0, z: poi.z + oz, rot30: ((p.rot30 ?? 0) + poi.rot30) % 12, scale: p.scale ?? 1 };
  });
  const blockers: ColliderSpec[] = (poi.type.blockers ?? []).map((b) => {
    const [ox, oz] = rotateXZ(b.x, b.z, poi.rot30);
    return { shape: 'cuboid', x: poi.x + ox, y: b.height / 2, z: poi.z + oz, rot30: poi.rot30, hx: b.hx, hy: b.height / 2, hz: b.hz };
  });
  return { pieces, blockers };
}
