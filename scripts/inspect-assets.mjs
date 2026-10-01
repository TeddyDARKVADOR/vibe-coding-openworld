#!/usr/bin/env node
/**
 * Prints what the game's KayKit files contain: bounds (scale / origin / feet),
 * animation clips, mesh & triangle counts, textures and external references.
 * Visual check of orientation / tile edges: open http://localhost:5173/inspect.html
 *
 * usage: node scripts/inspect-assets.mjs [filter]
 */
import { NodeIO, getBounds } from '@gltf-transform/core';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIRS = ['client/public/assets/characters', 'client/public/assets/environment/hexagon'];
const filter = process.argv[2] ?? '';
const io = new NodeIO();
const f = (v) => v.map((x) => x.toFixed(2)).join(', ');

for (const dir of DIRS) {
  const files = fs.readdirSync(path.join(ROOT, dir)).filter((n) => /\.(glb|gltf)$/.test(n) && n.includes(filter)).sort();
  for (const name of files) {
    const file = path.join(ROOT, dir, name);
    const doc = await io.read(file);
    const root = doc.getRoot();
    const b = getBounds(root.getDefaultScene() ?? root.listScenes()[0]);
    let tris = 0;
    for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
    const anims = root.listAnimations().map((a) => a.getName());
    const tex = root.listTextures().map((t) => t.getURI() || `${t.getName() || 'embedded'}`);
    const kb = (fs.statSync(file).size / 1024).toFixed(0);
    console.log(`${dir.split('/').pop()}/${name}  ${kb} KB  meshes ${root.listMeshes().length}  tris ${tris}  skins ${root.listSkins().length}`);
    console.log(`    bounds min (${f(b.min)}) max (${f(b.max)})  size (${f(b.max.map((v, i) => v - b.min[i]))})`);
    if (anims.length) console.log(`    animations: ${anims.join(', ')}`);
    if (tex.length) console.log(`    textures: ${[...new Set(tex)].join(', ')}`);
  }
}
