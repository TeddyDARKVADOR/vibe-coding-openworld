import { NodeIO, getBounds } from '@gltf-transform/core';
const io = new NodeIO();
for (const f of process.argv.slice(2)) {
  const d = await io.read(f); const r = d.getRoot(); const b = getBounds(r.listScenes()[0]);
  let tris = 0; for (const m of r.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3;
  console.log(f.split('/').pop(), 'h', (b.max[1]-b.min[1]).toFixed(2), 'w', (b.max[0]-b.min[0]).toFixed(2), 'tris', tris, 'joints', r.listSkins()[0]?.listJoints().length, 'tex', r.listTextures().length);
  console.log('   ', r.listAnimations().map(a => a.getName()).join(', '));
}
