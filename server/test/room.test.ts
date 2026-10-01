import './setup.ts';
/**
 * Integration test: boots a real Colyseus server with WorldRoom and connects
 * two real SDK clients (same code path as the browser).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { defineRoom, defineServer } from 'colyseus';
import { Client } from '@colyseus/sdk';
import { MsgType, ROOM_NAME, encodeInput, INPUT_AXIS_MAX, RUN_SPEED, TICK_DT } from '@openworld/shared';
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

  // Cheating: a client sending 200 inputs at once (6.7 s of running) can't move faster than
  // real time: at most the 1 s of catch-up slack + the ticks elapsed while we wait (0.5 s).
  const before = players(b).get(a.sessionId).z;
  for (let seq = 31; seq <= 230; seq++) a.send(MsgType.Input, encodeInput({ seq, mx: 0, mz: -INPUT_AXIS_MAX, run: true, jump: false }));
  await sleep(500);
  const moved = before - players(b).get(a.sessionId).z;
  assert.ok(moved < RUN_SPEED * 1.7, `input flood is capped (moved ${moved.toFixed(2)} m)`);

  // B leaves → disappears from A.
  await b.leave();
  await sleep(300);
  assert.equal(players(a).size, 1);
  assert.ok(!players(a).has(b.sessionId));
  await a.leave();
});

test('names, chosen characters, chat and emotes', async () => {
  const { Emote } = await import('@openworld/shared');
  const a = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, { name: '  Alice\u0007  la   Grande ', character: 2 });
  const b = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, { name: 'x'.repeat(50), character: 99 });
  const c = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, {});
  await sleep(300);
  const pa = players(b).get(a.sessionId), pb = players(a).get(b.sessionId), pc = players(a).get(c.sessionId);
  assert.equal(pa.name, 'Alice la Grande', 'name cleaned');
  assert.equal(pa.character, 2, 'chosen character');
  assert.equal(pb.name.length, 16, 'name truncated');
  assert.ok(pb.character >= 0 && pb.character < 5, 'invalid character replaced');
  assert.match(pc.name, /^Voyageur \d+$/, 'default name');

  // Chat: broadcast to everybody with the author's name; spam is limited.
  const received: any[] = [];
  b.onMessage(MsgType.Chat, (m: any) => received.push(m));
  a.send(MsgType.Chat, '  Salut   tout le monde ! ');
  a.send(MsgType.Chat, 'spam immédiat');
  a.send(MsgType.Chat, 42);
  await sleep(300);
  assert.deepEqual(received, [{ id: a.sessionId, name: 'Alice la Grande', text: 'Salut tout le monde !' }]);

  // Emote while idle, cancelled by moving.
  a.send(MsgType.Emote, Emote.Sit);
  await sleep(200);
  assert.equal(players(b).get(a.sessionId).emote, Emote.Sit);
  for (let seq = 1; seq <= 10; seq++) { a.send(MsgType.Input, encodeInput({ seq, mx: INPUT_AXIS_MAX, mz: 0, run: false, jump: false })); await sleep(TICK_DT * 1000); }
  await sleep(300);
  assert.equal(players(b).get(a.sessionId).emote, Emote.None, 'moving cancels the emote');
  a.send(MsgType.Emote, 77);
  await sleep(150);
  assert.equal(players(b).get(a.sessionId).emote, Emote.None, 'invalid emote ignored');
  await Promise.all([a.leave(), b.leave(), c.leave()]);
});
