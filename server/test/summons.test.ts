import './setup.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { defineRoom, defineServer } from 'colyseus';
import { Client } from '@colyseus/sdk';
import { FREE_SUMMONS_PER_DAY, INPUT_AXIS_MAX, MsgType, ROOM_NAME, STARTER_SUMMONS, SummonMode, TICK_DT, encodeInput } from '@openworld/shared';
import { WorldRoom } from '../src/rooms/WorldRoom.ts';

const PORT = 28670 + Math.floor(Math.random() * 1000);
const server = defineServer({ rooms: { [ROOM_NAME]: defineRoom(WorldRoom) } });
await server.listen(PORT);
after(() => server.gracefullyShutdown(false));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function join(playerId: string) {
  const room = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, { playerId, name: playerId.slice(-4) });
  const collections: any[] = [];
  room.onMessage(MsgType.Collection, (c: any) => collections.push(c));
  room.onMessage(MsgType.Profile, () => {});
  await sleep(300);
  return { room, collections };
}

test('summon lifecycle: collection, call, visible to others, follow, swap, dismiss, free draw', async () => {
  const a = await join('summon-test-aaaa');
  const b = await join('summon-test-bbbb');
  const col = a.collections.at(-1);
  assert.deepEqual(col.owned, STARTER_SUMMONS, 'starter collection');
  assert.equal(col.active, STARTER_SUMMONS[0]);

  a.room.send(MsgType.Summon, { op: 'call' });
  await sleep(300);
  const sA = b.room.state.summons.get(a.room.sessionId);
  assert.ok(sA, 'B sees A\'s summon');
  assert.equal(sA.kind, 'yeti');
  assert.equal(sA.hp, sA.maxHp);
  await sleep(1200);
  assert.ok([SummonMode.Idle, SummonMode.Follow].includes(b.room.state.summons.get(a.room.sessionId).mode), 'active after the arrival');

  // A walks 3 s east: the summon follows.
  for (let seq = 1; seq <= 90; seq++) { a.room.send(MsgType.Input, encodeInput({ seq, mx: INPUT_AXIS_MAX, mz: 0, run: false, jump: false })); await sleep(TICK_DT * 1000); }
  await sleep(1500);
  const pa = b.room.state.players.get(a.room.sessionId), s2 = b.room.state.summons.get(a.room.sessionId);
  assert.ok(pa.x > 8, `A moved (${pa.x})`);
  assert.ok(Math.hypot(s2.x - pa.x, s2.z - pa.z) < 5, `summon followed (distance ${Math.hypot(s2.x - pa.x, s2.z - pa.z).toFixed(1)})`);

  // Swap while out → the other creature replaces it.
  a.room.send(MsgType.Summon, { op: 'select', id: 'demon' });
  await sleep(300);
  assert.equal(b.room.state.summons.get(a.room.sessionId).kind, 'demon');
  a.room.send(MsgType.Summon, { op: 'select', id: 'alien' }); // not owned
  await sleep(200);
  assert.equal(a.collections.at(-1).active, 'demon', 'cannot select a locked summon');

  a.room.send(MsgType.Summon, { op: 'dismiss' });
  await sleep(300);
  assert.equal(b.room.state.summons.get(a.room.sessionId), undefined, 'dismissed');

  // Free summons: limited per day, results added to the collection.
  for (let i = 0; i < FREE_SUMMONS_PER_DAY + 2; i++) a.room.send(MsgType.Summon, { op: 'draw' });
  await sleep(500);
  const draws = a.collections.filter((c) => c.draw);
  assert.equal(draws.length, FREE_SUMMONS_PER_DAY, 'limited number of free summons');
  assert.equal(a.collections.at(-1).freeLeft, 0);
  for (const d of draws) assert.ok(a.collections.at(-1).owned.includes(d.draw.id));

  // Leaving removes the summon.
  a.room.send(MsgType.Summon, { op: 'call' });
  await sleep(300);
  await a.room.leave();
  await sleep(300);
  assert.equal(b.room.state.summons.size, 0);
  await b.room.leave();
});
