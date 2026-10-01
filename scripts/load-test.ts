// Load test: N bot players (default 10) wander, run, ride, summon and fight for D seconds
// against a running server, then report the server's tick cost and what clients receive.
// usage: npx tsx scripts/load-test.ts [players=10] [seconds=60]   (server: npm run dev -w server)
import { Client, type Room } from '@colyseus/sdk';
import { INPUT_AXIS_MAX, MsgType, ROOM_NAME, TICK_DT, encodeInput } from '@openworld/shared';

const N = Number(process.argv[2] ?? 10), SECONDS = Number(process.argv[3] ?? 60);
const HTTP = process.env.SERVER_HTTP ?? 'http://localhost:2567', WS = HTTP.replace(/^http/, 'ws');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Bot { room: Room; seq: number; dir: number; run: boolean; patches: number; bytes: number; seen: number }
const bots: Bot[] = [];
for (let i = 0; i < N; i++) {
  const room = await new Client(WS).joinOrCreate(ROOM_NAME, { playerId: `loadtest-bot-${String(i).padStart(4, '0')}`, name: `Bot${i}` });
  const bot: Bot = { room, seq: 0, dir: Math.random() * Math.PI * 2, run: false, patches: 0, bytes: 0, seen: 0 };
  room.onMessage('*', () => {});
  room.onStateChange(() => { bot.patches++; bot.seen = room.state.players.size; });
  // Count raw bytes received (patches + messages).
  const ws = (room as any).connection?.transport?.ws as WebSocket | undefined;
  ws?.addEventListener('message', (e: MessageEvent) => { bot.bytes += (e.data as ArrayBuffer).byteLength ?? 0; });
  bots.push(bot);
}
await sleep(1000);
await fetch(`${HTTP}/stats?reset=1`);
console.log(`${N} bots connected; running ${SECONDS} s...`);

const t0 = Date.now();
let tick = 0;
while (Date.now() - t0 < SECONDS * 1000) {
  tick++;
  for (const [i, b] of bots.entries()) {
    if (Math.random() < 0.02) b.dir += (Math.random() - 0.5) * 2;
    if (Math.random() < 0.01) b.run = !b.run;
    const moving = (tick + i * 37) % 300 < 240; // pauses now and then
    b.room.send(MsgType.Input, encodeInput({
      seq: ++b.seq, mx: moving ? Math.round(Math.sin(b.dir) * INPUT_AXIS_MAX) : 0, mz: moving ? Math.round(Math.cos(b.dir) * INPUT_AXIS_MAX) : 0,
      run: b.run, jump: Math.random() < 0.005,
    }));
    if (tick === 30 && i % 2 === 0) b.room.send(MsgType.Summon, { op: 'call' });
    if (tick === 45 && i % 3 === 0) b.room.send(MsgType.Mount, true);
    if (tick % 60 === 0 && i % 2 === 0) {
      const target = bots[(i + 1) % N];
      b.room.send(MsgType.Target, `p:${target.room.sessionId}`);
      b.room.send(MsgType.Ability, (tick / 60) % 4);
    }
    if (tick % 300 === 0 && i === 1) b.room.send(MsgType.Chat, 'coucou');
  }
  await sleep(TICK_DT * 1000);
}
const stats = await (await fetch(`${HTTP}/stats`)).json();
const avg = (f: (b: Bot) => number) => bots.reduce((s, b) => s + f(b), 0) / N;
console.log('server:', JSON.stringify(stats));
console.log(`per client: ${(avg((b) => b.patches) / SECONDS).toFixed(1)} state updates/s, ${(avg((b) => b.bytes) / SECONDS / 1024).toFixed(1)} KiB/s received, sees ${Math.min(...bots.map((b) => b.seen))}-${Math.max(...bots.map((b) => b.seen))} players`);
const budgetMs = TICK_DT * 1000;
const ok = stats.avgMs < budgetMs * 0.5 && bots.every((b) => b.seen >= N);
console.log(ok ? `OK: average tick ${stats.avgMs} ms of a ${budgetMs.toFixed(1)} ms budget` : 'FAIL');
for (const b of bots) await b.room.leave();
process.exit(ok ? 0 : 1);
