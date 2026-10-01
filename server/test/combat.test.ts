import './setup.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { defineRoom, defineServer } from 'colyseus';
import { Client } from '@colyseus/sdk';
import { MsgType, PLAYER_MAX_HP, ROOM_NAME, SummonMode } from '@openworld/shared';
import { WorldRoom } from '../src/rooms/WorldRoom.ts';

const PORT = 29670 + Math.floor(Math.random() * 1000);
const server = defineServer({ rooms: { [ROOM_NAME]: defineRoom(WorldRoom) } });
await server.listen(PORT);
after(() => server.gracefullyShutdown(false));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms: number) => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await sleep(100); return cond(); };

async function join(playerId: string) {
  const room = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, { playerId, name: playerId.slice(-4) });
  const ev = { fx: [] as any[], dmg: [] as any[], death: [] as any[] };
  room.onMessage(MsgType.AbilityFx, (e: any) => ev.fx.push(e));
  room.onMessage(MsgType.Damage, (e: any) => ev.dmg.push(e));
  room.onMessage(MsgType.Death, (e: any) => ev.death.push(e));
  room.onMessage('*', () => {});
  await sleep(300);
  return { room, ev };
}

test('summon vs player: target, attack, damage seen by both, death and respawn', async () => {
  const a = await join('combat-test-aaaa');
  const b = await join('combat-test-bbbb');
  const bRef = `p:${b.room.sessionId}`;
  a.room.send(MsgType.Summon, { op: 'select', id: 'demon' });
  a.room.send(MsgType.Summon, { op: 'call' });
  await sleep(1400); // arrival

  // Invalid requests are ignored.
  a.room.send(MsgType.Target, `p:${a.room.sessionId}`); // self
  a.room.send(MsgType.Ability, 0);
  await sleep(300);
  assert.equal(a.ev.fx.length, 0, 'cannot attack yourself / without target');
  a.room.send(MsgType.Ability, 99);

  a.room.send(MsgType.Target, bRef);
  a.room.send(MsgType.Ability, 0);
  assert.ok(await until(() => b.ev.dmg.some((d) => d.target === bRef), 8000), 'B is hit');
  const hit = b.ev.dmg.find((d) => d.target === bRef);
  assert.ok(a.ev.dmg.some((d) => d.target === bRef && d.amount === hit.amount), 'A sees the same damage event');
  assert.ok(b.room.state.players.get(b.room.sessionId).hp < PLAYER_MAX_HP, 'B hp synced');
  // Spamming the basic attack cannot beat its cooldown (1 s).
  for (let i = 0; i < 20; i++) a.room.send(MsgType.Ability, 0);
  const t0 = a.ev.fx.length;
  await sleep(2000);
  assert.ok(a.ev.fx.length - t0 <= 3, `cooldown respected (${a.ev.fx.length - t0} uses in 2 s)`);

  // Ultimate (AoE) + keep attacking until B is knocked out.
  a.room.send(MsgType.Ability, 3);
  assert.ok(await until(() => b.ev.death.some((d) => d.target === bRef), 30000), 'B knocked out');
  assert.equal(b.room.state.players.get(b.room.sessionId).dead, true);
  assert.ok(await until(() => !b.room.state.players.get(b.room.sessionId).dead, 6000), 'B respawns');
  const pb = b.room.state.players.get(b.room.sessionId);
  assert.equal(pb.hp, PLAYER_MAX_HP);
  assert.ok(Math.hypot(pb.x, pb.z) < 40, 'respawned at the start area');
  await Promise.all([a.room.leave(), b.room.leave()]);
});

test('summon vs summon: a summon can be defeated, then re-summoned after a delay', async () => {
  const a = await join('combat-test-cccc');
  const b = await join('combat-test-dddd');
  a.room.send(MsgType.Summon, { op: 'select', id: 'demon' });
  a.room.send(MsgType.Summon, { op: 'call' });
  b.room.send(MsgType.Summon, { op: 'select', id: 'mushroom-king' });
  b.room.send(MsgType.Summon, { op: 'call' });
  await sleep(1500);
  const bSummon = `s:${b.room.sessionId}`;
  a.room.send(MsgType.Target, bSummon);
  a.room.send(MsgType.Ability, 0);
  // B's summon fights back automatically.
  assert.ok(await until(() => a.ev.dmg.some((d) => d.target === `s:${a.room.sessionId}`), 10000), 'retaliation');
  a.room.send(MsgType.Ability, 2); // rage buff
  a.room.send(MsgType.Ability, 3); // aoe
  assert.ok(await until(() => a.ev.death.some((d) => d.target === bSummon), 40000), 'B\'s summon defeated');
  assert.ok(await until(() => b.room.state.summons.get(b.room.sessionId)?.mode === SummonMode.Dead || !b.room.state.summons.get(b.room.sessionId), 2000));
  await until(() => !b.room.state.summons.get(b.room.sessionId), 5000);
  b.room.send(MsgType.Summon, { op: 'call' });
  await sleep(500);
  assert.equal(b.room.state.summons.get(b.room.sessionId), undefined, 'cannot re-summon immediately');
  await sleep(8000);
  b.room.send(MsgType.Summon, { op: 'call' });
  assert.ok(await until(() => !!b.room.state.summons.get(b.room.sessionId), 2000), 're-summoned after the delay');
  await Promise.all([a.room.leave(), b.room.leave()]);
});
