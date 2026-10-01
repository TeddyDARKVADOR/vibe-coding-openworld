/**
 * Deterministic chunk generation.
 *
 * generateChunk(cx, cz) only *selects and positions* KayKit models; no
 * geometry is created here. The result depends solely on WORLD_SEED and the
 * chunk coordinates, so the server (colliders) and every client (visuals +
 * colliders) obtain exactly the same chunk.
 *
 * Large-scale features (roads, rivers, lakes, forests, mountains, villages)
 * are functions of *world* coordinates, not of the chunk, so they flow
 * continuously across chunk borders.
 */
import { CHUNK_SIZE, HEX_RADIUS, HEX_SCALE, HEX_WIDTH, SPAWN_CLEAR_RADIUS, WORLD_SEED } from '../constants.ts';
import { cos30, sin30 } from '../math/angles.ts';
import { Rng, hashFloat, hashInts, hashString } from '../math/rng.ts';
import { HEX_DIRS, hexDistance, hexKey, hexToWorld, hexesInRect, type Hex } from './hex.ts';
import { fbm2 } from './noise.ts';
import { computeNetwork, roadCrossingsNear, type AxialBox } from './network.ts';
import { coastTile, crossingTile, riverTile, roadTile } from './tiles.ts';
import { colliderForPlacement, type ColliderSpec, type Placement } from './catalog.ts';

const SEED = hashString(WORLD_SEED);
const NOISE = {
  lake: hashInts(SEED, 201),
  mountain: hashInts(SEED, 202),
  forest: hashInts(SEED, 203),
  village: hashInts(SEED, 204),
};

export interface ChunkData {
  cx: number;
  cz: number;
  key: string;
  placements: Placement[];
  colliders: ColliderSpec[];
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function chunkCoord(x: number): number {
  return Math.floor(x / CHUNK_SIZE);
}

/** Per-chunk seed, e.g. for anything that must be random but stable. */
export function seedForChunk(cx: number, cz: number): number {
  return hashInts(SEED, 1, cx, cz);
}

const VILLAGE_RADIUS = 3;
const COLORS = ['blue', 'red', 'green', 'yellow'] as const;
const CENTRE_BUILDINGS = ['tavern', 'market', 'church', 'blacksmith', 'well', 'tavern', 'home_A'];
const OUTER_BUILDINGS = ['home_A', 'home_B', 'home_A', 'home_B', 'home_A', 'windmill', 'lumbermill', 'home_B', 'barracks', 'archeryrange', 'tower_A'];
const PROPS = ['barrel', 'crate_A_big', 'crate_B_small', 'crate_long_A', 'sack', 'wheelbarrow', 'resource_lumber', 'resource_stone', 'tent', 'bucket_water'];
const MOUNTAINS = ['mountain_A', 'mountain_B', 'mountain_C', 'mountain_A_grass', 'mountain_B_grass', 'mountain_C_grass', 'mountain_A_grass_trees', 'mountain_B_grass_trees', 'mountain_C_grass_trees'];
const HILLS = ['hills_A', 'hills_B', 'hills_C', 'hills_A_trees', 'hills_B_trees', 'hills_C_trees'];
const FORESTS = ['trees_A_large', 'trees_A_medium', 'trees_B_large', 'trees_B_medium', 'trees_A_small', 'trees_B_small'];
const SINGLE_TREES = ['tree_single_A', 'tree_single_B'];
const ROCKS = ['rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E'];
const ROCK_SCALES = [1, 1.25, 1.5, 1.75, 2];
const TREE_SCALES = [0.9, 1, 1.1, 1.2];

/** Pointy-top hex prism (vertices at 30° + k·60°) used to block water and rivers. */
function hexPrism(x: number, z: number): ColliderSpec {
  const points: number[] = [];
  for (let k = 1; k < 12; k += 2) {
    const vx = cos30(k) * HEX_RADIUS, vz = -sin30(k) * HEX_RADIUS;
    points.push(vx, -2, vz, vx, 3, vz);
  }
  return { shape: 'hull', x, y: 0, z, rot30: 0, points };
}

export function generateChunk(cx: number, cz: number): ChunkData {
  const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
  const own = hexesInRect(x0, z0, x0 + CHUNK_SIZE, z0 + CHUNK_SIZE);

  // Region = chunk + margin, so neighbour-dependent features (coasts) are seamless.
  const margin = 3 * HEX_WIDTH;
  const region = hexesInRect(x0 - margin, z0 - margin, x0 + CHUNK_SIZE + margin, z0 + CHUNK_SIZE + margin);
  const regionKeys = new Set(region.map((h) => hexKey(h.q, h.r)));
  const box: AxialBox = { qMin: Infinity, qMax: -Infinity, rMin: Infinity, rMax: -Infinity };
  for (const h of region) {
    box.qMin = Math.min(box.qMin, h.q); box.qMax = Math.max(box.qMax, h.q);
    box.rMin = Math.min(box.rMin, h.r); box.rMax = Math.max(box.rMax, h.r);
  }
  const net = computeNetwork(box, regionKeys);
  const villages = roadCrossingsNear(box, VILLAGE_RADIUS + 1).filter(
    (c) => (c.i === 0 && c.j === 0) || hashFloat(NOISE.village, c.i, c.j) < 0.6,
  );

  const isNetwork = (q: number, r: number) => net.road.has(hexKey(q, r)) || net.river.has(hexKey(q, r));
  const nearVillage = (h: Hex) => {
    for (const v of villages) {
      const d = hexDistance(h.q, h.r, v.q, v.r);
      if (d <= VILLAGE_RADIUS) return { v, d };
    }
    return null;
  };
  const spawnDistance = (x: number, z: number) => Math.sqrt(x * x + z * z);

  const waterCache = new Map<string, boolean>();
  const isWater = (q: number, r: number): boolean => {
    const k = hexKey(q, r);
    let w = waterCache.get(k);
    if (w !== undefined) return w;
    const [x, z] = hexToWorld(q, r);
    w = fbm2(NOISE.lake, x, z, 320) > 0.7 && spawnDistance(x, z) > 90 && !isNetwork(q, r) && !nearVillage({ q, r });
    if (w) for (const [dq, dr] of HEX_DIRS) if (isNetwork(q + dq, r + dr)) { w = false; break; }
    waterCache.set(k, w);
    return w;
  };

  const placements: Placement[] = [];
  // Flat ground slab (top at y = 0). One per chunk: a single huge box loses float32 precision in Rapier.
  const half = CHUNK_SIZE / 2;
  const colliders: ColliderSpec[] = [{ shape: 'cuboid', x: x0 + half, y: -1, z: z0 + half, rot30: 0, hx: half, hy: 1, hz: half }];
  const place = (p: Placement) => {
    placements.push(p);
    const c = colliderForPlacement(p);
    if (c) colliders.push(c);
  };

  for (const h of own) {
    const { q, r } = h;
    const k = hexKey(q, r);
    const [x, z] = hexToWorld(q, r);
    const rng = new Rng(hashInts(SEED, 2, q, r));
    const tile = (model: string, rot60: number) => place({ model, x, y: 0, z, rot30: rot60 * 2, scale: HEX_SCALE });
    const randomRot60 = rng.int(6);

    const riverMask = net.river.get(k) ?? 0;
    const roadMask = net.road.get(k) ?? 0;

    if (riverMask) {
      const crossing = roadMask ? crossingTile(riverMask, roadMask) : null;
      if (crossing) {
        tile(crossing.model, crossing.rot60);
        // Road axis edge b → bridge (modelled along +Z) rotated by 60b - 90 degrees.
        let b = 0;
        while (!(roadMask & (1 << b))) b++;
        const rot30 = 2 * b - 3;
        place({ model: 'building_bridge_A', x, y: 0, z, rot30, scale: HEX_SCALE });
        // Invisible parapets so nobody walks off the bridge into the river.
        for (const side of [-1, 1]) {
          const ox = side * 4.3;
          colliders.push({
            shape: 'cuboid', x: x + ox * cos30(rot30), y: 1.5, z: z - ox * sin30(rot30), rot30,
            hx: 0.25, hy: 2.5, hz: HEX_RADIUS,
          });
        }
      } else {
        const t = riverTile(riverMask) ?? { model: 'hex_river_A', rot60: 0 };
        tile(t.model, t.rot60);
        colliders.push(hexPrism(x, z));
        if (rng.chance(0.3)) place({ model: rng.pick(['waterlily_A', 'waterlily_B']), x: x + rng.range(-1, 1), y: -1.15, z: z + rng.range(-1, 1), rot30: rng.int(12), scale: HEX_SCALE });
      }
      continue;
    }

    if (roadMask) {
      const t = roadTile(roadMask) ?? { model: 'hex_road_A', rot60: 0 };
      tile(t.model, t.rot60);
      continue;
    }

    if (isWater(q, r)) {
      tile('hex_water', 0);
      colliders.push(hexPrism(x, z));
      if (rng.chance(0.25)) place({ model: rng.pick(['waterlily_A', 'waterlily_B', 'waterplant_A', 'waterplant_B']), x: x + rng.range(-3, 3), y: -1.2, z: z + rng.range(-3, 3), rot30: rng.int(12), scale: HEX_SCALE });
      continue;
    }

    let waterMask = 0;
    for (let e = 0; e < 6; e++) if (isWater(q + HEX_DIRS[e][0], r + HEX_DIRS[e][1])) waterMask |= 1 << e;
    if (waterMask) {
      const t = coastTile(waterMask);
      if (t) { tile(t.model, t.rot60); continue; }
    }

    tile('hex_grass', randomRot60);
    if (spawnDistance(x, z) < SPAWN_CLEAR_RADIUS + HEX_RADIUS) continue; // keep the spawn meadow clear

    // ---- Villages around road crossings.
    const village = nearVillage(h);
    if (village) {
      const { v, d } = village;
      const color = COLORS[hashInts(NOISE.village, v.i, v.j, 9) % 4];
      // Face the first adjacent road (KayKit buildings have their front towards +Z).
      let face = -1;
      for (let e = 0; e < 6 && face < 0; e++) if (net.road.has(hexKey(q + HEX_DIRS[e][0], r + HEX_DIRS[e][1]))) face = e;
      const rot30 = face >= 0 ? 2 * face + 3 : randomRot60 * 2;
      const p = d === 1 ? 0.9 : d === 2 ? 0.7 : 0.4;
      if (rng.chance(p)) {
        const type = d === 1 ? rng.pick(CENTRE_BUILDINGS) : rng.pick(OUTER_BUILDINGS);
        place({ model: `building_${type}_${color}`, x, y: 0, z, rot30, scale: HEX_SCALE });
      } else if (d === 3 && rng.chance(0.5)) {
        place({ model: 'building_grain', x, y: 0, z, rot30: randomRot60 * 2, scale: HEX_SCALE });
      } else {
        const n = 1 + rng.int(3);
        for (let i = 0; i < n; i++) {
          place({ model: rng.pick(PROPS), x: x + rng.range(-3.5, 3.5), y: 0, z: z + rng.range(-3.5, 3.5), rot30: rng.int(12), scale: HEX_SCALE });
        }
        if (rng.chance(0.3)) place({ model: `flag_${color}`, x: x + rng.range(-2, 2), y: 0, z: z + rng.range(-2, 2), rot30: rng.int(12), scale: HEX_SCALE });
      }
      continue;
    }

    // ---- Nature.
    const mountain = fbm2(NOISE.mountain, x, z, 520);
    const forest = fbm2(NOISE.forest, x, z, 300);
    const roadside = HEX_DIRS.some(([dq, dr]) => isNetwork(q + dq, r + dr));

    if (mountain > 0.68 && !roadside) {
      place({ model: rng.pick(MOUNTAINS), x, y: 0, z, rot30: randomRot60 * 2, scale: HEX_SCALE });
    } else if (mountain > 0.62 && !roadside) {
      place({ model: rng.pick(HILLS), x, y: 0, z, rot30: randomRot60 * 2, scale: HEX_SCALE });
    } else if (forest > 0.6 && !roadside) {
      place({ model: rng.pick(FORESTS), x, y: 0, z, rot30: randomRot60 * 2, scale: HEX_SCALE });
    } else {
      // Meadow / forest edge: a few single trees and rocks at random offsets.
      const trees = forest > 0.5 ? 1 + rng.int(3) : rng.chance(0.22) ? 1 : 0;
      for (let i = 0; i < trees; i++) {
        place({
          model: rng.pick(SINGLE_TREES), x: x + rng.range(-3.8, 3.8), y: 0, z: z + rng.range(-3.8, 3.8),
          rot30: rng.int(12), scale: HEX_SCALE * rng.pick(TREE_SCALES),
        });
      }
      if (rng.chance(0.1)) {
        place({ model: rng.pick(ROCKS), x: x + rng.range(-3, 3), y: 0, z: z + rng.range(-3, 3), rot30: rng.int(12), scale: HEX_SCALE * rng.pick(ROCK_SCALES) });
      } else if (!roadside && rng.chance(0.03)) {
        place({ model: rng.pick(['hill_single_A', 'hill_single_B', 'hill_single_C']), x, y: 0, z, rot30: rng.int(12), scale: HEX_SCALE });
      }
    }
  }

  // A few decorative clouds high in the sky (no collision).
  const crng = new Rng(seedForChunk(cx, cz));
  if (crng.chance(0.35)) {
    placements.push({
      model: crng.pick(['cloud_big', 'cloud_small']), x: x0 + crng.range(0, CHUNK_SIZE), y: crng.range(55, 80),
      z: z0 + crng.range(0, CHUNK_SIZE), rot30: crng.int(12), scale: crng.pick([8, 10, 12]),
    });
  }

  return { cx, cz, key: chunkKey(cx, cz), placements, colliders };
}
