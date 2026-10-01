/**
 * Integration test: boots a real Colyseus server with WorldRoom and connects
 * two real SDK clients (same code path as the browser).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { defineRoom, defineServer } from 'colyseus';
import { Client } from '@colyseus/sdk';
import { MsgType, ROOM_NAME, encodeInput, INPUT_AXIS_MAX, TICK_DT } from '@openworld/shared';
import { WorldRoom } from '../src/rooms/WorldRoom.ts';

const PORT = 25670 + Math.floor(Math.random() * 1000);
const server = defineServer({ rooms: { [ROOM_NAME]: defineRoom(WorldRoom) } });
await server.listen(PORT);
after(() => server.gracefullyShutdown(false));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const players = (room: any) => room.state.players as Map<string, any>;

test('two players share the world, see each other move, and leave cleanly', async () => {
  const a = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME);
  const b = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME);
  assert.equal(a.roomId, b.roomId, 'same room instance');
  await sleep(300);

  // Both see both.
  assert.equal(players(a).size, 2);
  assert.equal(players(b).size, 2);
  const aOnB0 = players(b).get(a.sessionId);
  const bOnA0 = players(a).get(b.sessionId);
  assert.ok(aOnB0 && bOnA0);
  const ax0 = aOnB0.x, az0 = aOnB0.z;
  assert.ok(Math.abs(players(a).get(a.sessionId).x - players(b).get(b.sessionId).x) >= 2.9, 'spawned with an offset');

  // A walks north (-Z) for 1 s of inputs; B stays idle.
  for (let seq = 1; seq <= 30; seq++) {
    a.send(MsgType.Input, encodeInput({ seq, mx: 0, mz: -INPUT_AXIS_MAX, run: false, jump: false }));
    await sleep(TICK_DT * 1000);
  }
  await sleep(400);
  const aOnB = players(b).get(a.sessionId);
  assert.ok(az0 - aOnB.z > 2.5, `A moved on B's screen (dz=${(az0 - aOnB.z).toFixed(2)})`);
  assert.ok(Math.abs(aOnB.x - ax0) < 0.2);
  assert.equal(players(a).get(a.sessionId).ack, 30, 'server acknowledged all inputs');
  assert.equal(aOnB.anim, 0, 'idle again after stopping');

  // Positions are identical on both clients (same global coordinates).
  assert.equal(players(a).get(a.sessionId).z, aOnB.z);

  // Cheating: a client sending 200 inputs at once cannot move faster than the tick budget allows.
  const before = players(b).get(a.sessionId).z;
  for (let seq = 31; seq <= 230; seq++) a.send(MsgType.Input, encodeInput({ seq, mx: 0, mz: -INPUT_AXIS_MAX, run: true, jump: false }));
  await sleep(500);
  const moved = before - players(b).get(a.sessionId).z;
  assert.ok(moved < 12 * 6.8 / 30 + 0.5, `input flood is capped (moved ${moved.toFixed(2)} m)`);

  // B leaves → disappears from A.
  await b.leave();
  await sleep(300);
  assert.equal(players(a).size, 1);
  assert.ok(!players(a).has(b.sessionId));
  await a.leave();
});
