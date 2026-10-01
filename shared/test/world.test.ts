import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  CHUNK_SIZE, PhysicsWorld, createCharacterState, generateChunk, stepCharacter, hexesInRect, worldToHex, hexToWorld,
  computeNetwork, hexKey, roadTile, riverTile, rotateMask, colliderForPlacement, INPUT_AXIS_MAX,
} from '../src/index.ts';

test('chunk generation is deterministic', () => {
  for (const [cx, cz] of [[0, 0], [10, 5], [-7, 3], [1234, -987], [-50000, 40000]]) {
    const a = JSON.stringify(generateChunk(cx, cz));
    const b = JSON.stringify(generateChunk(cx, cz));
    assert.equal(a, b);
  }
});

test('every hex of a chunk gets exactly one ground tile', () => {
  for (const [cx, cz] of [[0, 0], [3, -2], [-9, 14], [200, 200]]) {
    const c = generateChunk(cx, cz);
    const hexes = hexesInRect(cx * CHUNK_SIZE, cz * CHUNK_SIZE, (cx + 1) * CHUNK_SIZE, (cz + 1) * CHUNK_SIZE);
    const tiles = c.placements.filter((p) => p.model.startsWith('hex_'));
    assert.equal(tiles.length, hexes.length, `chunk ${cx},${cz}`);
  }
});

test('hexes partition the plane (no gaps/duplicates between chunks)', () => {
  const seen = new Set<string>();
  let n = 0;
  for (let cx = -2; cx < 2; cx++) for (let cz = -2; cz < 2; cz++) {
    for (const h of hexesInRect(cx * CHUNK_SIZE, cz * CHUNK_SIZE, (cx + 1) * CHUNK_SIZE, (cz + 1) * CHUNK_SIZE)) {
      const k = hexKey(h.q, h.r);
      assert.ok(!seen.has(k), `duplicate ${k}`);
      seen.add(k); n++;
    }
  }
  const all = hexesInRect(-2 * CHUNK_SIZE, -2 * CHUNK_SIZE, 2 * CHUNK_SIZE, 2 * CHUNK_SIZE);
  assert.equal(all.length, n);
  const h = worldToHex(...hexToWorld(17, -4));
  assert.deepEqual([h.q, h.r], [17, -4]);
});

test('road and river masks always map to a real tile and are consistent across chunk borders', () => {
  const box = { qMin: -200, qMax: 200, rMin: -200, rMax: 200 };
  const region = new Set<string>();
  for (let q = box.qMin; q <= box.qMax; q++) for (let r = box.rMin; r <= box.rMax; r++) region.add(hexKey(q, r));
  const net = computeNetwork(box, region);
  let roads = 0, rivers = 0, crossings = 0;
  for (const [k, m] of net.road) {
    roads++;
    if (net.river.has(k)) { crossings++; continue; }
    assert.ok(roadTile(m), `road mask ${m.toString(2)} at ${k}`);
  }
  for (const [, m] of net.river) { rivers++; assert.ok(riverTile(m), `river mask ${m.toString(2)}`); }
  assert.ok(roads > 1000 && rivers > 300 && crossings > 0, `${roads} ${rivers} ${crossings}`);
  // Edge symmetry: if A has an edge towards B, B has the edge back.
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  for (const map of [net.road, net.river]) {
    for (const [k, m] of map) {
      const [q, r] = k.split(',').map(Number);
      for (let e = 0; e < 6; e++) if (m & (1 << e)) {
        const nk = hexKey(q + dirs[e][0], r + dirs[e][1]);
        if (!region.has(nk)) continue;
        assert.ok(((map.get(nk) ?? 0) >> ((e + 3) % 6)) & 1, `asymmetric edge ${k} -> ${nk}`);
      }
    }
  }
  assert.equal(rotateMask(0b000001, 1), 0b000010);
  assert.equal(rotateMask(0b100000, 1), 0b000001);
});

test('spawn area is free of obstacles', () => {
  const c = generateChunk(0, 0), c2 = generateChunk(-1, 0), c3 = generateChunk(0, -1), c4 = generateChunk(-1, -1);
  for (const ch of [c, c2, c3, c4]) {
    for (const p of ch.placements) {
      const col = colliderForPlacement(p);
      if (col) assert.ok(Math.hypot(p.x, p.z) > 15, `${p.model} at ${p.x},${p.z}`);
    }
    for (const col of ch.colliders) assert.ok(Math.hypot(col.x, col.z) > 15);
  }
});

test('character walks, collides and stays on the ground', async () => {
  await RAPIER.init();
  const world = new PhysicsWorld(RAPIER, 0, 0);
  // Wall 5 m east of the spawn.
  world.addChunk('wall', [
    { shape: 'cuboid', x: 0, y: -1, z: 0, rot30: 0, hx: 64, hy: 1, hz: 64 },
    { shape: 'cuboid', x: 5, y: 2, z: 0, rot30: 0, hx: 0.5, hy: 2, hz: 5 },
  ]);
  const col = world.createCharacterCollider();
  const s = createCharacterState(0, 0);
  for (let i = 0; i < 120; i++) stepCharacter(world, col, s, { seq: i, mx: INPUT_AXIS_MAX, mz: 0, run: false, jump: false });
  assert.ok(s.x > 4 && s.x < 4.5, `blocked by the wall, x=${s.x}`);
  assert.ok(Math.abs(s.y) < 0.05 && s.grounded, `on the ground, y=${s.y}`);
  // Slides along the wall when moving diagonally.
  const z0 = s.z;
  for (let i = 0; i < 30; i++) stepCharacter(world, col, s, { seq: i, mx: INPUT_AXIS_MAX, mz: INPUT_AXIS_MAX, run: false, jump: false });
  assert.ok(s.z - z0 > 1, 'slides along the wall');
  // Jump goes up then lands.
  stepCharacter(world, col, s, { seq: 0, mx: 0, mz: 0, run: false, jump: true });
  let maxY = 0;
  for (let i = 0; i < 60; i++) { stepCharacter(world, col, s, { seq: 0, mx: 0, mz: 0, run: false, jump: false }); maxY = Math.max(maxY, s.y); }
  assert.ok(maxY > 0.6 && s.grounded && Math.abs(s.y) < 0.05, `jump maxY=${maxY}`);
});

test('real chunk colliders block movement (walk into a building)', async () => {
  await RAPIER.init();
  // Find a chunk with a building near the spawn village.
  for (const [cx, cz] of [[0, 0], [0, -1], [-1, 0], [1, 0], [0, 1], [1, 1]]) {
    const chunk = generateChunk(cx, cz);
    const b = chunk.placements.find((p) => p.model.startsWith('building_home'));
    if (!b) continue;
    const world = new PhysicsWorld(RAPIER, 0, 0);
    world.addChunk(chunk.key, chunk.colliders);
    const col = world.createCharacterCollider();
    const s = createCharacterState(b.x - 12, b.z);
    for (let i = 0; i < 150; i++) stepCharacter(world, col, s, { seq: i, mx: INPUT_AXIS_MAX, mz: 0, run: false, jump: false });
    assert.ok(s.x < b.x - 1.5, `stopped before the house centre (x=${s.x.toFixed(2)}, house=${b.x.toFixed(2)})`);
    return;
  }
  assert.fail('no house found near spawn');
});
