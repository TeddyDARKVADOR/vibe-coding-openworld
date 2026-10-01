import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_SIZE, POI_TYPES, chunkCoord, colliderForPlacement, generateChunk, isOpenGround, poiInCell, poiPieces, poisNear,
} from '../src/index.ts';

test('special places: deterministic, on open ground, with real POI models', () => {
  const a = poisNear(2000, -1500, 2500).map((p) => `${p.id}:${p.x},${p.z},${p.rot30}`);
  assert.ok(a.length > 30, `only ${a.length} places`);
  const types = new Set(poisNear(2000, -1500, 2500).map((p) => p.type.id));
  assert.equal(types.size, POI_TYPES.length, 'every place type appears');
  for (const p of poisNear(2000, -1500, 2500)) assert.ok(isOpenGround(p.x, p.z, p.radius), p.id);
  // Same world far away and recomputed from scratch.
  assert.deepEqual(poisNear(1_000_000, 1_000_000, 800).map((p) => p.id), poisNear(1_000_000, 1_000_000, 800).map((p) => p.id));
  const spawn = poiInCell(0, 0);
  assert.ok(spawn && spawn.type.id === 'meeting' && Math.hypot(spawn.x, spawn.z) < 130, 'meeting point near spawn');
});

test('each piece of a place is generated in exactly one chunk, with its colliders', () => {
  for (const poi of poisNear(0, 0, 1200).slice(0, 12)) {
    const { pieces } = poiPieces(poi);
    const chunks = new Map<string, ReturnType<typeof generateChunk>>();
    for (const p of pieces) {
      const k = `${chunkCoord(p.x)},${chunkCoord(p.z)}`;
      if (!chunks.has(k)) chunks.set(k, generateChunk(chunkCoord(p.x), chunkCoord(p.z)));
    }
    for (const p of pieces) {
      const c = chunks.get(`${chunkCoord(p.x)},${chunkCoord(p.z)}`)!;
      const found = c.placements.filter((q) => q.model === p.model && q.x === p.x && q.z === p.z);
      assert.equal(found.length, 1, `${poi.id} ${p.model}`);
      const col = colliderForPlacement(p);
      if (col) assert.ok(c.colliders.some((q) => q.x === col.x && q.z === col.z), `collider of ${p.model}`);
    }
    // Nothing but ground tiles (and the place itself) inside its radius.
    for (const c of chunks.values()) {
      for (const q of c.placements) {
        if (q.model.startsWith('hex_') || q.model.startsWith('poi/') || q.model.startsWith('cloud')) continue;
        assert.ok(Math.hypot(q.x - poi.x, q.z - poi.z) > poi.radius, `${q.model} inside ${poi.id}`);
      }
    }
  }
  assert.ok(CHUNK_SIZE > 0);
});
