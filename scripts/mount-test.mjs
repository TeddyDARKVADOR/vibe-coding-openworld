// Browser test: get on the horse, gallop (faster, predicted without corrections), seen by the other player.
// Requires `npm run dev`. usage: node scripts/mount-test.mjs [outDir]
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const BASE = process.env.URL ?? 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0, jsErrors = 0;
const check = (n, ok, info = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${info}`); };
const open = async (name, w = 520, h = 340) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { jsErrors++; console.log(`[${name}]`, e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { jsErrors++; console.log(`[${name} console]`, m.text()); } });
  await page.goto(`${BASE}?radius=1&name=${name}`);
  await page.waitForFunction(() => window.__game?.debugState, null, { timeout: 120000 });
  return { ctx, page, state: () => page.evaluate(() => window.__game.debugState) };
};
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(300); } return false; };

const A = await open('Cavalier', 800, 500);
const B = await open('Témoin');
await sleep(1500);
const aId = (await A.state()).sessionId;
// Speed while running for `ms`, per simulated tick (headless rendering may be too slow to keep 30 ticks/s).
const seq = () => A.page.evaluate(() => window.__game.player.seq);
const runFor = async (ms) => {
  const s0 = await A.state(); const q0 = await seq();
  await A.page.keyboard.down('ShiftLeft'); await A.page.keyboard.down('KeyW');
  await sleep(ms);
  await A.page.keyboard.up('KeyW'); await A.page.keyboard.up('ShiftLeft');
  const s1 = await A.state();
  return Math.hypot(s1.x - s0.x, s1.z - s0.z) / (((await seq()) - q0) / 30);
};
const foot = await runFor(2000);
await A.page.keyboard.press('KeyG');
check('A rides the horse', await until(async () => (await A.state()).riding, 60000));
check('B sees A on the horse', await until(async () => (await B.state()).remotes.some((r) => r.id === aId && r.riding), 60000));
const c0 = (await A.state()).corrections;
const horse = await runFor(2500);
await A.page.screenshot({ path: `${out}/mount-gallop.png` });
await sleep(1000);
const st = await A.state();
console.log(`speed on foot ${foot.toFixed(1)} m/s, on horse ${horse.toFixed(1)} m/s, corrections while galloping ${st.corrections - c0} (last ${(st.lastCorrection * 100).toFixed(1)} cm)`);
check('gallop is much faster than running', horse > foot * 1.4);
check('prediction stays exact on horseback', st.corrections - c0 <= 3 || st.lastCorrection < 0.05);
await sleep(1200);
await A.page.keyboard.press('KeyG');
check('A gets off', await until(async () => !(await A.state()).riding && (await A.state()).mount === 0, 10000));
check('B sees A on foot', await until(async () => (await B.state()).remotes.some((r) => r.id === aId && !r.riding), 10000));
check('no JS errors', jsErrors === 0, `${jsErrors}`);
await browser.close();
console.log(failed ? `${failed} check(s) FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
