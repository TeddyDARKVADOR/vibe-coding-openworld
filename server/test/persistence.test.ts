/**
 * Position persistence: walk far, quit, come back → same place (global
 * coordinates, same chunk). Invalid saved data falls back to the spawn.
 */
import './setup.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { defineRoom, defineServer, matchMaker } from 'colyseus';
import { Client } from '@colyseus/sdk';
import { MsgType, ROOM_NAME, chunkCoord } from '@openworld/shared';
import { WorldRoom } from '../src/rooms/WorldRoom.ts';
import { playerStore } from '../src/services.ts';

const PORT = 27670 + Math.floor(Math.random() * 1000);
const server = defineServer({ rooms: { [ROOM_NAME]: defineRoom(WorldRoom) } });
await server.listen(PORT);
after(() => server.gracefullyShutdown(false));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const join = async (opts: object) => {
  const room = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, opts);
  const profile = new Promise<any>((r) => room.onMessage(MsgType.Profile, r));
  return { room, profile };
};
const me = (room: any) => room.state.players.get(room.sessionId);

test('position survives a reconnection (global coords, far chunk)', async () => {
  const playerId = 'test-player-0001';
  const a = await join({ playerId, name: 'Alice' });
  const prof = await a.profile;
  assert.match(prof.friendCode, /^FRIEND-[A-Z2-9]{4}$/);
  assert.equal(prof.restored, false);
  await sleep(200);

  // "Walk very far": move the authoritative character to a remote place (server side).
  const worldRoom = matchMaker.getLocalRoomById(a.room.roomId) as any;
  const sp = worldRoom.sim.getPlayer(a.room.sessionId);
  sp.state.x = 1542.3; sp.state.z = -832.7; sp.state.y = 0.02; sp.state.yaw = 1.2;
  await sleep(150);
  await a.room.leave();
  await sleep(200);
  await playerStore.flush();
  const file = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR!, 'players.json'), 'utf8'));
  assert.equal(file[0].lastPosition.x, 1542.3, 'saved to disk in global coordinates');

  const b = await join({ playerId, name: 'Alice' });
  const prof2 = await b.profile;
  await sleep(200);
  const p = me(b.room);
  assert.equal(prof2.restored, true);
  assert.equal(prof2.friendCode, prof.friendCode, 'same friend code');
  assert.ok(Math.hypot(p.x - 1542.3, p.z + 832.7) < 3, `restored near the saved position (${p.x}, ${p.z})`);
  assert.equal(chunkCoord(p.x), chunkCoord(1542.3));
  assert.equal(chunkCoord(p.z), chunkCoord(-832.7), 'same chunk');
  await b.room.leave();
});

test('invalid saved positions and ids fall back safely', async () => {
  const playerId = 'test-player-0002';
  const a = await join({ playerId });
  await a.profile;
  await a.room.leave();
  await sleep(150);
  playerStore.get(playerId)!.lastPosition = { x: 1e12, y: 0, z: Number.NaN };
  const b = await join({ playerId });
  assert.equal((await b.profile).restored, false);
  await sleep(150);
  const p = me(b.room);
  assert.ok(Math.hypot(p.x, p.z) < 60, 'spawned at the start area');
  await b.room.leave();

  // Bad ids → guest: plays normally but receives no profile and nothing is saved.
  const g = await join({ playerId: '../../etc/passwd' });
  await sleep(300);
  assert.ok(me(g.room), 'guest can play');
  assert.equal(playerStore.get('../../etc/passwd'), undefined);
  await g.room.leave();
});

test('same player connecting twice replaces the old session', async () => {
  const playerId = 'test-player-0003';
  const a = await join({ playerId, name: 'Twin' });
  await a.profile;
  let aLeft = 0;
  a.room.onLeave((code: number) => { aLeft = code; });
  const b = await join({ playerId, name: 'Twin' });
  await b.profile;
  await sleep(300);
  const names = [...b.room.state.players.values()].filter((p: any) => p.name === 'Twin');
  assert.equal(names.length, 1, 'only one character for that player');
  assert.equal(aLeft, 4100, 'old session told why it was closed');
  await b.room.leave();
});
