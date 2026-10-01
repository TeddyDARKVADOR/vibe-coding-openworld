import './setup.ts';
/**
 * Long-distance test of the authoritative simulation: a bot runs several km
 * (turning when blocked), across chunk and physics-region borders, including
 * very far from the origin. Chunk colliders must be streamed in and out and
 * the bot must always stay on the ground.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { INPUT_AXIS_MAX, PHYSICS_REGION_SIZE, chunkCoord } from '@openworld/shared';
import { ServerSimulation } from '../src/simulation/ServerSimulation.ts';

await RAPIER.init();

function runBot(startX: number, startZ: number, ticks: number) {
  const sim = new ServerSimulation(RAPIER);
  const p = sim.addPlayer('bot', startX, startZ);
  // Main heading east; when blocked, detour in another direction for a while.
  const S = Math.SQRT1_2;
  const detours = [[S, -S], [S, S], [0, -1], [0, 1], [-S, -S], [-S, S]];
  let dir = [1, 0], detourLeft = 0, detourIdx = 0, lastCheck = { x: startX, z: startZ }, maxChunks = 0, minY = Infinity, maxDist = 0;
  const regions = new Set<string>();
  const chunksVisited = new Set<string>();
  for (let seq = 1; seq <= ticks; seq++) {
    const [dx, dz] = dir;
    sim.queueInput('bot', { seq, mx: Math.round(dx * INPUT_AXIS_MAX), mz: Math.round(dz * INPUT_AXIS_MAX), run: true, jump: seq % 90 === 0 });
    sim.tick();
    if (detourLeft > 0 && --detourLeft === 0) dir = [1, 0];
    if (seq % 15 === 0) {
      // Blocked (house, rock, lake, mountain...) → detour.
      if (Math.hypot(p.state.x - lastCheck.x, p.state.z - lastCheck.z) < 1.5) {
        detourIdx = (detourIdx + 1) % detours.length;
        dir = detours[detourIdx];
        detourLeft = 45 + 30 * (detourIdx % 3);
      }
      lastCheck = { x: p.state.x, z: p.state.z };
    }
    const st = sim.stats;
    maxChunks = Math.max(maxChunks, st.chunks);
    minY = Math.min(minY, p.state.y);
    maxDist = Math.max(maxDist, Math.hypot(p.state.x - startX, p.state.z - startZ));
    regions.add(`${Math.floor(p.state.x / PHYSICS_REGION_SIZE)},${Math.floor(p.state.z / PHYSICS_REGION_SIZE)}`);
    chunksVisited.add(`${chunkCoord(p.state.x)},${chunkCoord(p.state.z)}`);
  }
  return { p, maxChunks, minY, maxDist, regions: regions.size, chunksVisited: chunksVisited.size, stats: sim.stats };
}

test('bot runs for 15 game minutes (km scale): chunks stream, never falls through the ground', () => {
  const t0 = performance.now();
  const r = runBot(0, 0, 27000); // 15 min of game time
  console.log(`  travelled to (${r.p.state.x.toFixed(0)}, ${r.p.state.z.toFixed(0)}), max distance ${r.maxDist.toFixed(0)} m, ${r.chunksVisited} chunks visited, max ${r.maxChunks} collider chunks loaded, ${(performance.now() - t0).toFixed(0)} ms`);
  assert.ok(r.maxDist > 1000, `went far (${r.maxDist.toFixed(0)} m)`);
  assert.ok(r.chunksVisited >= 8, `visited ${r.chunksVisited} chunks`);
  assert.ok(r.maxChunks <= 25, 'colliders of far chunks are freed');
  assert.ok(r.minY > -0.1, `stays on the ground (min y ${r.minY})`);
});

test('works identically very far from the origin (12.5 km and 1000 km)', () => {
  for (const [x, z] of [[12500, -8300], [1_000_000, -1_000_000]]) {
    // Start on a road crossing-free meadow is not guaranteed: just make sure the bot moves and stays grounded.
    const r = runBot(x, z, 3000);
    console.log(`  from (${x}, ${z}): moved ${r.maxDist.toFixed(0)} m, min y ${r.minY.toFixed(3)}`);
    assert.ok(r.maxDist > 100, `moves (${r.maxDist})`);
    assert.ok(r.minY > -0.1, `stays on the ground (${r.minY})`);
  }
});

test('crossing a physics region border keeps the movement continuous', () => {
  // Start 20 m west of a region border and run east.
  const border = PHYSICS_REGION_SIZE;
  const sim = new ServerSimulation(RAPIER);
  const p = sim.addPlayer('bot', border - 20, 40.5);
  let prevX = p.state.x, maxStep = 0;
  for (let seq = 1; seq <= 150; seq++) {
    sim.queueInput('bot', { seq, mx: INPUT_AXIS_MAX, mz: 0, run: true, jump: false });
    sim.tick();
    maxStep = Math.max(maxStep, p.state.x - prevX);
    prevX = p.state.x;
  }
  assert.ok(maxStep < 0.3, `no jump at the border (max step ${maxStep})`);
});
