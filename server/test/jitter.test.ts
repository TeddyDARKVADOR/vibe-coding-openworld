import './setup.ts';
/**
 * Regression test for "the character steps back when it stops": with jittery
 * networks inputs arrive in bursts. The server must process every input
 * (never drop what the client already predicted), so the final authoritative
 * position equals the client's prediction exactly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { INPUT_AXIS_MAX, PhysicsWorld, chunkKey, chunkCoord, createCharacterState, generateChunk, physicsRegionOf, stepCharacter, type PlayerInput } from '@openworld/shared';
import { ServerSimulation } from '../src/simulation/ServerSimulation.ts';

await RAPIER.init();

test('bursty inputs are all processed: server ends exactly where the client predicted', () => {
  const sim = new ServerSimulation(RAPIER);
  const p = sim.addPlayer('a', 0, 0);
  // Client-side prediction with its own physics world (same region origin, like the browser).
  const region = physicsRegionOf(p.state.x, p.state.z);
  const world = new PhysicsWorld(RAPIER, region.originX, region.originZ, true);
  const local = createCharacterState(p.state.x, p.state.z);
  local.y = p.state.y;
  const col = world.createCharacterCollider();

  // 20 s of walking/running with network bursts: packets of 0..8 inputs, 1 per tick on average.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const pending: PlayerInput[] = [];
  let seq = 0;
  for (let tick = 0; tick < 600; tick++) {
    const moving = tick < 560;
    const input: PlayerInput = { seq: ++seq, mx: moving ? INPUT_AXIS_MAX : 0, mz: moving ? Math.round(INPUT_AXIS_MAX * 0.3) : 0, run: tick % 200 < 100, jump: false };
    const cx = chunkCoord(local.x), cz = chunkCoord(local.z);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) world.addChunk(chunkKey(cx + dx, cz + dz), generateChunk(cx + dx, cz + dz).colliders);
    stepCharacter(world, col, local, input);
    pending.push(input);
    // Deliver a random burst (sometimes nothing for several ticks, then everything at once).
    if (rnd() < 0.25 || tick === 599) { for (const i of pending) sim.queueInput('a', i); pending.length = 0; }
    sim.tick();
  }
  for (let i = 0; i < 120; i++) sim.tick(); // drain
  assert.equal(p.lastSeq, seq, 'every input processed');
  const err = Math.hypot(p.state.x - local.x, p.state.y - local.y, p.state.z - local.z);
  assert.ok(err < 1e-6, `server position = predicted position (error ${err} m)`);
  assert.ok(Math.hypot(local.x, local.z) > 50, 'actually moved');
});
