#!/usr/bin/env node
/**
 * Copies the KayKit models used by the game from .asset-cache/ (see
 * fetch-assets.sh) to client/public/assets and generates the collision
 * metadata shared by client and server.
 *
 *  - Environment models (Medieval Hexagon pack) are copied unmodified
 *    (.gltf + .bin + shared atlas texture).
 *  - Character GLBs are re-exported keeping only the animation clips the game
 *    uses (the originals ship 76 clips, ~3.6 MB each). Meshes, skeleton,
 *    materials and textures are untouched.
 *  - shared/src/world/assetBounds.generated.ts receives the bounding box and a
 *    reduced convex hull point cloud of each environment model, so the server
 *    can build simple colliders without loading any 3D file.
 */
import { NodeIO, getBounds } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.asset-cache');
const ADV = path.join(CACHE, 'KayKit-Character-Pack-Adventures-1.0/addons/kaykit_character_pack_adventures');
const HEX = path.join(CACHE, 'KayKit-Medieval-Hexagon-Pack-1.0/addons/kaykit_medieval_hexagon_pack');
const OUT = path.join(ROOT, 'client/public/assets');

if (!fs.existsSync(ADV) || !fs.existsSync(HEX)) {
  console.error('Asset cache missing. Run ./scripts/fetch-assets.sh first.');
  process.exit(1);
}

const CHARACTERS = ['Knight', 'Barbarian', 'Mage', 'Rogue', 'Rogue_Hooded'];
const KEEP_CLIPS = ['Idle', 'Walking_A', 'Running_A', 'Jump_Start', 'Jump_Idle', 'Jump_Land', 'Cheer', 'Sit_Floor_Down', 'Sit_Floor_Idle', 'Lie_Down', 'Lie_Idle', 'Hit_A', 'Death_A', 'Dodge_Forward', 'Spellcast_Shoot', 'Sit_Chair_Idle'];

// Environment models used by the world generator (path relative to Assets/gltf).
const ENV = [
  'tiles/base/hex_grass', 'tiles/base/hex_water',
  ...'ABCDEFGHIJKLM'.split('').map((l) => `tiles/roads/hex_road_${l}`),
  ...'ABCDEFGHIJKL'.split('').map((l) => `tiles/rivers/hex_river_${l}`),
  'tiles/rivers/hex_river_A_curvy', 'tiles/rivers/hex_river_crossing_A', 'tiles/rivers/hex_river_crossing_B',
  ...'ABCDE'.split('').map((l) => `tiles/coast/hex_coast_${l}`),
  ...['blue', 'red', 'green', 'yellow'].flatMap((c) =>
    ['home_A', 'home_B', 'tavern', 'church', 'market', 'well', 'windmill', 'blacksmith', 'lumbermill', 'tower_A', 'barracks', 'archeryrange', 'watermill']
      .map((b) => `buildings/${c}/building_${b}_${c}`)),
  'buildings/neutral/building_bridge_A', 'buildings/neutral/building_bridge_B', 'buildings/neutral/building_grain',
  'buildings/neutral/fence_wood_straight', 'buildings/neutral/building_stage_A',
  ...['A', 'B', 'C'].flatMap((l) => [`decoration/nature/mountain_${l}`, `decoration/nature/mountain_${l}_grass`, `decoration/nature/mountain_${l}_grass_trees`,
    `decoration/nature/hills_${l}`, `decoration/nature/hills_${l}_trees`, `decoration/nature/hill_single_${l}`]),
  ...'ABCDE'.split('').map((l) => `decoration/nature/rock_single_${l}`),
  'decoration/nature/tree_single_A', 'decoration/nature/tree_single_B', 'decoration/nature/tree_single_A_cut',
  ...['A', 'B'].flatMap((l) => ['small', 'medium', 'large', 'cut'].map((s) => `decoration/nature/trees_${l}_${s}`)),
  'decoration/nature/waterlily_A', 'decoration/nature/waterlily_B', 'decoration/nature/waterplant_A', 'decoration/nature/waterplant_B',
  'decoration/nature/cloud_big', 'decoration/nature/cloud_small',
  ...['barrel', 'crate_A_big', 'crate_B_small', 'crate_long_A', 'sack', 'tent', 'wheelbarrow', 'bucket_water', 'resource_lumber', 'resource_stone', 'pallet', 'flag_blue', 'flag_red', 'flag_green', 'flag_yellow']
    .map((p) => `decoration/props/${p}`),
];

const io = new NodeIO();

// ---------------------------------------------------------------- characters
fs.mkdirSync(path.join(OUT, 'characters'), { recursive: true });
for (const name of CHARACTERS) {
  const doc = await io.read(path.join(ADV, 'Characters/gltf', `${name}.glb`));
  for (const anim of doc.getRoot().listAnimations()) {
    if (!KEEP_CLIPS.includes(anim.getName())) {
      for (const sampler of anim.listSamplers()) sampler.dispose();
      for (const channel of anim.listChannels()) channel.dispose();
      anim.dispose();
    }
  }
  // Keyframe accessors only referenced by the removed clips are now orphans.
  for (const acc of doc.getRoot().listAccessors()) {
    if (acc.listParents().every((p) => p.propertyType === 'Root')) acc.dispose();
  }
  await doc.transform(prune({ keepAttributes: true }));
  const out = path.join(OUT, 'characters', `${name}.glb`);
  await io.write(out, doc);
  console.log(`character ${name}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB, clips: ${doc.getRoot().listAnimations().map((a) => a.getName()).join(', ')}`);
}
fs.copyFileSync(path.join(ADV, 'LICENSE.txt'), path.join(OUT, 'characters', 'LICENSE.txt'));

// --------------------------------------------------------------- environment
const envOut = path.join(OUT, 'environment/hexagon');
fs.mkdirSync(envOut, { recursive: true });
fs.copyFileSync(path.join(HEX, 'Textures/hexagons_medieval.png'), path.join(envOut, 'hexagons_medieval.png'));
fs.copyFileSync(path.join(HEX, 'LICENSE.txt'), path.join(envOut, 'LICENSE.txt'));

const bounds = {};
for (const rel of ENV) {
  const base = path.basename(rel);
  const src = path.join(HEX, 'Assets/gltf', rel);
  const json = JSON.parse(fs.readFileSync(`${src}.gltf`, 'utf8'));
  for (const buf of json.buffers ?? []) fs.copyFileSync(path.join(path.dirname(src), buf.uri), path.join(envOut, buf.uri));
  for (const img of json.images ?? []) {
    if (img.uri !== 'hexagons_medieval.png') throw new Error(`unexpected texture ${img.uri} in ${rel}`);
  }
  fs.copyFileSync(`${src}.gltf`, path.join(envOut, `${base}.gltf`));

  const doc = await io.read(`${src}.gltf`);
  const scene = doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  // Gather world-space vertices (nodes are flat in this pack but apply matrices anyway).
  const pts = [];
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        pts.push([
          m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
          m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
          m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
        ]);
      }
    }
  });
  bounds[base] = {
    min: b.min.map((x) => +x.toFixed(4)),
    max: b.max.map((x) => +x.toFixed(4)),
    hull: reduceHull(pts),
  };
}

/** Keeps a small, well-spread subset of points (extremes along 26 directions + a coarse grid) for convex hull colliders. */
function reduceHull(points) {
  const dirs = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) dirs.push([x, y, z]);
  // Extra horizontal directions so round shapes (mountains) keep a nice silhouette.
  for (let a = 0; a < 16; a++) for (const y of [-0.3, 0.3, 1]) dirs.push([Math.cos((a * Math.PI) / 8), y, Math.sin((a * Math.PI) / 8)]);
  const picked = new Set();
  for (const d of dirs) {
    let best = -Infinity, bi = 0;
    points.forEach((p, i) => {
      const s = p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
      if (s > best) { best = s; bi = i; }
    });
    picked.add(bi);
  }
  return [...picked].map((i) => points[i].map((x) => +x.toFixed(3)));
}

const ts = `// AUTO-GENERATED by scripts/prepare-assets.mjs — do not edit by hand.
// Bounding boxes and reduced hull points of the KayKit environment models
// (model space, unscaled). Used to build simple colliders on client and server.
export interface AssetBounds { min: [number, number, number]; max: [number, number, number]; hull: [number, number, number][] }
export const ASSET_BOUNDS: Record<string, AssetBounds> = ${JSON.stringify(bounds)};
`;
fs.writeFileSync(path.join(ROOT, 'shared/src/world/assetBounds.generated.ts'), ts);
console.log(`environment: ${ENV.length} models copied, bounds written`);
