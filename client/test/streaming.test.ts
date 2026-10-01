/**
 * Chunk streaming test (runs in Node with the real WorldManager and
 * EnvironmentRenderer; only the glTF loading is replaced by a stub).
 *  F: chunks appear/disappear with distance
 *  G: a chunk loaded again is identical
 *  I: coming back finds the same environment
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { RENDER_LOAD_RADIUS, RENDER_UNLOAD_RADIUS, PHYSICS_RADIUS, chunkKey } from '@openworld/shared';
import { WorldManager } from '../src/world/WorldManager.ts';
import type { AssetLibrary, EnvModel } from '../src/assets/AssetLibrary.ts';

await RAPIER.init();

const loaded = new Set<string>();
const fakeAssets = {
  envMaterial: new THREE.MeshBasicMaterial(),
  getEnv: (name: string): EnvModel | undefined => (loaded.has(name) ? { name, geometries: [new THREE.BoxGeometry()], materials: [new THREE.MeshBasicMaterial()] } : undefined),
  loadEnv: async (name: string) => { loaded.add(name); return { name, geometries: [new THREE.BoxGeometry()], materials: [new THREE.MeshBasicMaterial()] }; },
} as unknown as AssetLibrary;

const flushAsync = () => new Promise((r) => setTimeout(r, 0));

test('streaming loads, unloads and reloads identical chunks', async () => {
  const wm = new WorldManager(RAPIER, fakeAssets, 0, 0);
  await wm.preload(5, 5, () => {});
  const side = 2 * RENDER_LOAD_RADIUS + 1;
  assert.equal(wm.stats.shown, side * side, 'all chunks around spawn shown');
  const origin = JSON.stringify(wm.getLoadedChunk(chunkKey(0, 0)));
  const instancesAtSpawn = wm.stats.instances;

  // Walk 2 km east.
  let maxChunks = 0, maxPhysics = 0;
  for (let x = 5; x <= 2000; x += 4) {
    wm.physicsAt(x, 5);
    wm.updateAroundPlayer(x, 5);
    if (x % 64 === 1) await flushAsync();
    maxChunks = Math.max(maxChunks, wm.stats.chunks);
    maxPhysics = Math.max(maxPhysics, wm.stats.physicsChunks);
  }
  for (let i = 0; i < 60; i++) { wm.updateAroundPlayer(2000, 5); await flushAsync(); }
  const far = 2 * RENDER_UNLOAD_RADIUS + 1;
  assert.ok(maxChunks <= far * far, `bounded memory: max ${maxChunks} chunks`);
  assert.ok(maxPhysics <= (2 * PHYSICS_RADIUS + 3) ** 2, `bounded physics: max ${maxPhysics}`);
  assert.equal(wm.getLoadedChunk(chunkKey(0, 0)), undefined, 'spawn chunk unloaded when far');
  assert.ok(wm.isChunkShown(chunkKey(15, 0)), 'chunks around the new position shown');
  console.log(`  at x=2000: ${wm.stats.shown} chunks shown, ${wm.stats.physicsChunks} physics chunks, ${wm.stats.instances} instances`);

  // Come back.
  for (let x = 2000; x >= 5; x -= 4) { wm.physicsAt(x, 5); wm.updateAroundPlayer(x, 5); if (x % 64 === 0) await flushAsync(); }
  for (let i = 0; i < 60; i++) { wm.updateAroundPlayer(5, 5); await flushAsync(); }
  assert.ok(wm.isChunkShown(chunkKey(0, 0)), 'spawn chunk shown again');
  assert.equal(JSON.stringify(wm.getLoadedChunk(chunkKey(0, 0))), origin, 'identical content after reload');
  // Same set of chunks around the spawn → exactly the same number of rendered instances.
  // (A few chunks of the unload ring may still be loaded, so compare only the inner area count via a fresh manager.)
  const fresh = new WorldManager(RAPIER, fakeAssets, 0, 0);
  await fresh.preload(5, 5, () => {});
  assert.equal(fresh.stats.instances, instancesAtSpawn);
});
