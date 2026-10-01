#!/usr/bin/env node
/**
 * Prepares the game-system assets (summons, mount, points of interest, VFX,
 * audio) from .asset-cache/ (see fetch-assets.sh) into client/public/assets.
 * Every source is CC0; see ASSETS.md for provenance.
 *
 *  - glTF files with external .bin/.png are packed into self-contained .glb
 *    (geometry, skins, animations and textures unchanged).
 *  - The horse keeps one copy of each clip (the source duplicates every
 *    animation under an "AnimalArmature|" prefix).
 *  - Bounding boxes / hull points of POI models are written to
 *    shared/src/world/poiBounds.generated.ts for server-side colliders.
 */
import { NodeIO, getBounds } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.asset-cache');
const OUT = path.join(ROOT, 'client/public/assets');
const io = new NodeIO();
const mk = (d) => fs.mkdirSync(path.join(OUT, d), { recursive: true });
const kb = (f) => `${(fs.statSync(f).size / 1024).toFixed(0)} KB`;

// ------------------------------------------------------------------ summons
const MONSTERS = ['yeti', 'demon', 'mushroom-king', 'dino', 'orc', 'alien', 'evolved-dragon'];
mk('summons');
for (const name of MONSTERS) {
  const doc = await io.read(path.join(CACHE, 'bomberfan/assets/characters', `${name}.gltf`));
  const out = path.join(OUT, 'summons', `${name}.glb`);
  await io.write(out, doc);
  console.log(`summon ${name}: ${kb(out)}, clips ${doc.getRoot().listAnimations().map((a) => a.getName()).join(', ')}`);
}
fs.copyFileSync(path.join(CACHE, 'bomberfan/assets/characters/LICENSE.txt'), path.join(OUT, 'summons/LICENSE.txt'));

// -------------------------------------------------------------------- mount
mk('mounts');
{
  const doc = await io.read(path.join(CACHE, 'lfs/horse.glb'));
  for (const a of doc.getRoot().listAnimations()) {
    if (a.getName().includes('|')) { a.listChannels().forEach((c) => c.dispose()); a.listSamplers().forEach((s) => s.dispose()); a.dispose(); }
  }
  for (const acc of doc.getRoot().listAccessors()) if (acc.listParents().every((p) => p.propertyType === 'Root')) acc.dispose();
  await doc.transform(prune({ keepAttributes: true }));
  const out = path.join(OUT, 'mounts/horse.glb');
  await io.write(out, doc);
  const b = getBounds(doc.getRoot().listScenes()[0]);
  console.log(`mount horse: ${kb(out)}, bounds ${b.min.map((v) => v.toFixed(2))} → ${b.max.map((v) => v.toFixed(2))}, clips ${doc.getRoot().listAnimations().map((a) => a.getName()).join(', ')}`);
}

// ---------------------------------------------------------- points of interest
const DUNGEON = path.join(CACHE, 'KayKit-Dungeon-Remastered-1.0/addons/kaykit_dungeon_remastered/Assets/gltf');
const HALLOWEEN = path.join(CACHE, 'KayKit-Halloween-Bits-1.0/addons/kaykit_halloween_bits/Assets/gltf');
const POI_MODELS = {
  [DUNGEON]: ['pillar', 'pillar_decorated', 'column', 'wall_broken', 'wall_arched', 'wall_half', 'rubble_large', 'rubble_half',
    'floor_tile_large', 'floor_tile_large_rocks', 'banner_patternA_red', 'banner_patternB_blue', 'torch_lit', 'chest_gold',
    'sword_shield_gold', 'barrier_column', 'stairs_wide'],
  [HALLOWEEN]: ['shrine', 'shrine_candles', 'arch', 'arch_gate', 'crypt', 'gravestone', 'grave_A', 'gravemarker_A', 'fence_pillar',
    'fence', 'lantern_standing', 'tree_dead_large', 'skull_candle', 'plaque_candles', 'post_lantern'],
};
mk('poi');
const bounds = {};
for (const [dir, names] of Object.entries(POI_MODELS)) {
  for (const name of names) {
    const src = fs.existsSync(path.join(dir, `${name}.gltf.glb`)) ? path.join(dir, `${name}.gltf.glb`)
      : fs.existsSync(path.join(dir, `${name}.glb`)) ? path.join(dir, `${name}.glb`) : path.join(dir, `${name}.gltf`);
    const doc = await io.read(src);
    const out = path.join(OUT, 'poi', `${name}.glb`);
    await io.write(out, doc);
    const scene = doc.getRoot().listScenes()[0];
    const b = getBounds(scene);
    const pts = [];
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const m = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION'), v = [0, 0, 0];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, v);
          pts.push([m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]);
        }
      }
    });
    bounds[`poi/${name}`] = { min: b.min.map((x) => +x.toFixed(4)), max: b.max.map((x) => +x.toFixed(4)), hull: reduceHull(pts) };
  }
}
fs.copyFileSync(path.join(CACHE, 'KayKit-Dungeon-Remastered-1.0/LICENSE.txt'), path.join(OUT, 'poi/LICENSE-dungeon.txt'));
fs.copyFileSync(path.join(CACHE, 'KayKit-Halloween-Bits-1.0/LICENSE.txt'), path.join(OUT, 'poi/LICENSE-halloween.txt'));
fs.writeFileSync(path.join(ROOT, 'shared/src/world/poiBounds.generated.ts'), `// AUTO-GENERATED by scripts/prepare-game-assets.mjs — do not edit by hand.
// Bounds and reduced hull points of KayKit POI models (model space, unscaled).
import type { AssetBounds } from './assetBounds.generated.ts';
export const POI_BOUNDS: Record<string, AssetBounds> = ${JSON.stringify(bounds)};
`);
console.log(`poi: ${Object.keys(bounds).length} models`);

function reduceHull(points) {
  const dirs = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) dirs.push([x, y, z]);
  for (let a = 0; a < 16; a++) for (const y of [-0.3, 0.3, 1]) dirs.push([Math.cos((a * Math.PI) / 8), y, Math.sin((a * Math.PI) / 8)]);
  const picked = new Set();
  for (const d of dirs) {
    let best = -Infinity, bi = 0;
    points.forEach((p, i) => { const s = p[0] * d[0] + p[1] * d[1] + p[2] * d[2]; if (s > best) { best = s; bi = i; } });
    picked.add(bi);
  }
  return [...picked].map((i) => points[i].map((x) => +x.toFixed(3)));
}

// --------------------------------------------------------------------- vfx
mk('vfx');
const PARTICLES = path.join(CACHE, 'kenney-particle-pack/addons/kenney_particle_pack');
const particleDir = fs.existsSync(PARTICLES) ? PARTICLES : findDir(path.join(CACHE, 'kenney-particle-pack/addons'), 'circle_05.png');
for (const n of ['circle_05', 'magic_02', 'magic_05', 'spark_05', 'star_07', 'smoke_05', 'flare_01', 'light_01', 'twirl_02', 'slash_03', 'scorch_02', 'dirt_02']) {
  fs.copyFileSync(path.join(particleDir, `${n}.png`), path.join(OUT, 'vfx', `${n}.png`));
}
fs.copyFileSync(path.join(CACHE, 'kenney-particle-pack/LICENSE.txt'), path.join(OUT, 'vfx/LICENSE.txt'));
console.log('vfx: 12 textures');

function findDir(dir, file) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name === file) return dir;
    if (e.isDirectory()) { const r = findDir(p, file); if (r) return r; }
  }
  return null;
}

// -------------------------------------------------------------------- audio
mk('audio');
const SFX = path.join(CACHE, 'open-game-sfx-index/audio');
const AUDIO = {
  'summon.wav': 'oga-levelup-powerup/Rise03.wav',
  'unlock.wav': 'oga-levelup-powerup/Upper01.wav',
  'hit.ogg': 'impact-sounds/impactPunch_medium_000.ogg',
  'hit_heavy.ogg': 'impact-sounds/impactPunch_heavy_000.ogg',
  'swing.wav': 'oga-battle/battle_sound_effects/swish_2.wav',
  'dash.wav': 'oga-battle/battle_sound_effects/swish_4.wav',
  'projectile.wav': 'oga-rpg-pack/RPG Sound Pack/battle/magic1.wav',
  'buff.wav': 'oga-rpg-pack/RPG Sound Pack/battle/spell.wav',
  'aoe.ogg': 'sci-fi-sounds/lowFrequency_explosion_000.ogg',
  'death.wav': 'oga-rpg-pack/RPG Sound Pack/NPC/giant/giant3.wav',
  'hurt.ogg': 'impact-sounds/impactSoft_heavy_000.ogg',
  'click.ogg': 'interface-sounds/click_002.ogg',
  'notify.ogg': 'interface-sounds/confirmation_002.ogg',
  'mount.ogg': 'rpg-audio/cloth2.ogg',
  'dismount.ogg': 'rpg-audio/dropLeather.ogg',
};
for (const [out, src] of Object.entries(AUDIO)) fs.copyFileSync(path.join(SFX, src), path.join(OUT, 'audio', out));
fs.copyFileSync(path.join(CACHE, 'lfs/meadow_birds.ogg'), path.join(OUT, 'audio/ambience_birds.ogg'));
console.log(`audio: ${Object.keys(AUDIO).length + 1} files`);
