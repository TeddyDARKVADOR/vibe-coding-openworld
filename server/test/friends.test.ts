import './setup.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { defineRoom, defineServer, matchMaker } from 'colyseus';
import { Client } from '@colyseus/sdk';
import { MsgType, ROOM_NAME } from '@openworld/shared';
import { WorldRoom } from '../src/rooms/WorldRoom.ts';

const PORT = 30670 + Math.floor(Math.random() * 1000);
const server = defineServer({ rooms: { [ROOM_NAME]: defineRoom(WorldRoom) } });
await server.listen(PORT);
after(() => server.gracefullyShutdown(false));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function join(playerId: string, name: string) {
  const room = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, { playerId, name });
  const s = { code: '', lists: [] as any[], fb: [] as any[] };
  room.onMessage(MsgType.Profile, (p: any) => { s.code = p.friendCode; });
  room.onMessage(MsgType.Friends, (l: any) => s.lists.push(l));
  room.onMessage(MsgType.FriendFeedback, (f: any) => s.fb.push(f));
  room.onMessage('*', () => {});
  await sleep(300);
  return { room, s, last: () => s.lists.at(-1)?.friends ?? [] };
}

test('friend codes, requests, online status, join friend, remove', async () => {
  const a = await join('friend-test-alice', 'Alice');
  const b = await join('friend-test-bob00', 'Bob');
  const c = await join('friend-test-carol', 'Carol');
  assert.match(a.s.code, /^FRIEND-/);

  // B adds A by code; A sees an incoming request and accepts.
  b.room.send(MsgType.Friend, { op: 'add', code: a.s.code.toLowerCase() });
  await sleep(300);
  assert.equal(b.s.fb.at(-1).ok, true);
  assert.deepEqual(a.last().map((f: any) => [f.name, f.status]), [['Bob', 'incoming']]);
  a.room.send(MsgType.Friend, { op: 'accept', code: b.s.code });
  await sleep(300);
  assert.deepEqual(b.last().map((f: any) => [f.name, f.status, f.online]), [['Alice', 'friend', true]]);
  assert.ok(!JSON.stringify(b.s.lists).includes('friend-test-alice'), 'private playerId never sent');

  // A goes far away (1.5 km); B joins her: placed next to her.
  const room = matchMaker.getLocalRoomById(a.room.roomId) as any;
  const sa = room.sim.getPlayer(a.room.sessionId);
  room.sim.teleport(sa, 1520, -840);
  await sleep(200);
  b.room.send(MsgType.Friend, { op: 'join', code: a.s.code });
  await sleep(400);
  const pa = c.room.state.players.get(a.room.sessionId), pb = c.room.state.players.get(b.room.sessionId);
  const d = Math.hypot(pa.x - pb.x, pa.z - pb.z);
  assert.ok(d < 15 && d > 0.5, `B appears near A (distance ${d.toFixed(1)} m)`);
  assert.equal(b.s.fb.at(-1).text, 'Tu as rejoint Alice !');
  assert.ok(a.s.fb.some((f: any) => f.text.includes('vient de te rejoindre')));

  // Cooldown, non-friends and bad codes are refused.
  b.room.send(MsgType.Friend, { op: 'join', code: a.s.code });
  await sleep(200);
  assert.equal(b.s.fb.at(-1).ok, false, 'join cooldown');
  c.room.send(MsgType.Friend, { op: 'join', code: a.s.code });
  await sleep(200);
  assert.equal(c.s.fb.at(-1).ok, false, 'only friends can join');
  c.room.send(MsgType.Friend, { op: 'add', code: 'FRIEND-ZZZZ' });
  await sleep(200);
  assert.equal(c.s.fb.at(-1).ok, false, 'unknown code');

  // Offline status when A leaves, then remove.
  await a.room.leave();
  await sleep(300);
  assert.equal(b.last()[0].online, false, 'A shown offline');
  b.room.send(MsgType.Friend, { op: 'remove', code: a.s.code });
  await sleep(200);
  assert.equal(b.last().length, 0, 'removed');
  await Promise.all([b.room.leave(), c.room.leave()]);
});
