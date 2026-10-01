import './setup.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { defineRoom, defineServer } from 'colyseus';
import { Client } from '@colyseus/sdk';
import { INPUT_AXIS_MAX, MOUNTS, MsgType, ROOM_NAME, RUN_SPEED, TICK_DT, encodeInput } from '@openworld/shared';
import { WorldRoom } from '../src/rooms/WorldRoom.ts';

const PORT = 31670 + Math.floor(Math.random() * 1000);
const server = defineServer({ rooms: { [ROOM_NAME]: defineRoom(WorldRoom) } });
await server.listen(PORT);
after(() => server.gracefullyShutdown(false));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('mount: validated by the server, synced to others, faster and predictable', async () => {
  const a = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, { playerId: 'mount-test-aaaa', name: 'Rider' });
  const b = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, { playerId: 'mount-test-bbbb', name: 'Watcher' });
  for (const r of [a, b]) r.onMessage('*', () => {});
  await sleep(500);
  const me = () => a.state.players.get(a.sessionId);
  const seenByB = () => b.state.players.get(a.sessionId);

  // Garbage is ignored.
  a.send(MsgType.Mount, 'yes');
  a.send(MsgType.Mount, 1);
  await sleep(300);
  assert.equal(me().mount, 0);

  a.send(MsgType.Mount, true);
  a.send(MsgType.Mount, false); // within the cooldown: ignored
  await sleep(300);
  assert.equal(me().mount, 1, 'mounted');
  assert.equal(seenByB().mount, 1, 'the other player sees the horse');

  let seq = 0;
  const run = async (ticks: number) => {
    const x0 = me().x, z0 = me().z;
    for (let i = 0; i < ticks; i++) { a.send(MsgType.Input, encodeInput({ seq: ++seq, mx: 0, mz: -INPUT_AXIS_MAX, run: true, jump: false })); await sleep(TICK_DT * 1000); }
    await sleep(400);
    return Math.hypot(me().x - x0, me().z - z0);
  };
  const horse = MOUNTS[0];
  const dHorse = await run(45);
  assert.ok(Math.abs(dHorse - 45 * TICK_DT * horse.runSpeed) < 1.5, `galloped ${dHorse.toFixed(2)} m`);

  await sleep(800);
  a.send(MsgType.Mount, false);
  await sleep(300);
  assert.equal(me().mount, 0, 'dismounted');
  assert.equal(seenByB().mount, 0);
  const dFoot = await run(30);
  assert.ok(Math.abs(dFoot - 30 * TICK_DT * RUN_SPEED) < 1, `ran ${dFoot.toFixed(2)} m on foot`);

  a.leave(); b.leave();
  await sleep(300);
});
