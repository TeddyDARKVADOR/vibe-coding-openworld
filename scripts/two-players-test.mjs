// End-to-end test with two real browser windows (A and B) on the same server.
// Requires `npm run dev` running. usage: node scripts/two-players-test.mjs [outDir]
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const URL = process.env.URL ?? 'http://localhost:5173/?debug&radius=1';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const open = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 300 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name} pageerror]`, e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[${name} console]`, m.text()); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__game?.debugState, null, { timeout: 120000 });
  return { name, ctx, page, state: () => page.evaluate(() => window.__game.debugState) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); };
const hold = async (p, keys, ms) => { for (const k of keys) await p.page.keyboard.down(k); await sleep(ms); for (const k of keys) await p.page.keyboard.up(k); };

const A = await open('A');
const B = await open('B');
await sleep(2500);
let a = await A.state(), b = await B.state();
check('C: A sees B', a.remotes.some((r) => r.id === b.sessionId && r.visible), JSON.stringify(a.remotes));
check('C: B sees A', b.remotes.some((r) => r.id === a.sessionId && r.visible), JSON.stringify(b.remotes));
check('C: same global coordinates', Math.abs(a.players.find((p) => p.id === b.sessionId).x - b.x) < 0.01, `B.x on A=${a.players.find((p) => p.id === b.sessionId).x} own=${b.x}`);
await A.page.screenshot({ path: `${out}/two-A-start.png` });
await B.page.screenshot({ path: `${out}/two-B-start.png` });

// D: A walks, B stays still.
const a0 = await A.state();
await A.page.keyboard.down('KeyW');
await A.page.keyboard.down('ShiftLeft');
for (let i = 0; i < 3; i++) { await A.page.keyboard.press('Space'); await sleep(1300); }
await A.page.keyboard.up('ShiftLeft');
await A.page.keyboard.up('KeyW');
await sleep(4000);
a = await A.state(); b = await B.state();
const remoteA = b.remotes.find((r) => r.id === a.sessionId);
const moved = Math.hypot(a.x - a0.x, a.z - a0.z);
check('D: A moved', moved > 0.5, `moved ${moved.toFixed(2)} m`);
const serverA = b.players.find((p) => p.id === a.sessionId);
check('D: server state of A received by B = A\'s own position', Math.hypot(serverA.x - a.x, serverA.z - a.z) < 0.01, `err ${Math.hypot(serverA.x - a.x, serverA.z - a.z).toFixed(4)} m`);
check('D: B renders A at A\'s position', remoteA && Math.hypot(remoteA.x - a.x, remoteA.z - a.z) < 0.3, remoteA ? `err ${Math.hypot(remoteA.x - a.x, remoteA.z - a.z).toFixed(3)} m` : 'missing');

// D bis: B walks, A sees it.
const b0 = await B.state();
await hold(B, ['KeyD'], 3000);
await sleep(1500);
a = await A.state(); b = await B.state();
const remoteB = a.remotes.find((r) => r.id === b.sessionId);
check('D: B moved', Math.hypot(b.x - b0.x, b.z - b0.z) > 0.5);
check('D: A sees B at B\'s position', remoteB && Math.hypot(remoteB.x - b.x, remoteB.z - b.z) < 0.3, remoteB ? `err ${Math.hypot(remoteB.x - b.x, remoteB.z - b.z).toFixed(3)} m` : 'missing');
// Client prediction runs the same code on the same physics origin: corrections should be absent or sub-centimetre.
check('prediction matches server (corrections < 1 cm)', a.lastCorrection < 0.01 && b.lastCorrection < 0.01, `A ${a.corrections} (last ${(a.lastCorrection * 1000).toFixed(1)} mm), B ${b.corrections} (last ${(b.lastCorrection * 1000).toFixed(1)} mm)`);
await A.page.screenshot({ path: `${out}/two-A-moved.png` });
await B.page.screenshot({ path: `${out}/two-B-moved.png` });

// E: B closes its tab → disappears from A right away.
await B.page.close({ runBeforeUnload: true });
await sleep(2500);
a = await A.state();
check('E: B (tab closed) disappeared from A', !a.remotes.some((r) => r.id === b.sessionId) && a.players.length === 1, `players=${a.players.length}`);

// E bis: a third player whose connection dies (no clean leave) is removed after the reconnection window.
const C = await open('C');
await sleep(2000);
const c = await C.state();
a = await A.state();
check('C joined, A sees C', a.remotes.some((r) => r.id === c.sessionId));
await C.ctx.close(); // abrupt
await sleep(24000);
a = await A.state();
check('E: C (connection lost) removed after the reconnection window', !a.remotes.some((r) => r.id === c.sessionId) && a.players.length === 1, `players=${a.players.length}`);
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
