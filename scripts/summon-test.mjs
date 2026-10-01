// Browser test: summons seen by both players, panel, free summon.
// Requires `npm run dev`. usage: node scripts/summon-test.mjs [outDir]
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
const A = await open('Alice', +(process.env.AW ?? 900), +(process.env.AH ?? 560));
const B = await open('Bob');
await sleep(1500);
await A.page.keyboard.press('KeyX');
const aId = (await A.state()).sessionId;
const t0 = Date.now();
let sumA = [], sumB = [];
for (let i = 0; i < 30; i++) {
  await sleep(500);
  sumA = await A.page.evaluate(() => [...window.__game.summonsState()]);
  sumB = await B.page.evaluate(() => [...window.__game.summonsState()]);
  if (sumA.some((s) => s.ownerId === aId && s.loaded) && sumB.some((s) => s.ownerId === aId && s.loaded)) break;
}
console.log(`summon visible on both screens after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
check('A sees her summon', sumA.some((s) => s.ownerId === aId && s.loaded), JSON.stringify(sumA));
check('B sees A\'s summon', sumB.some((s) => s.ownerId === aId && s.loaded), JSON.stringify(sumB));
await A.page.screenshot({ path: `${out}/summon-world.png` });
// Walk: the summon follows.
await A.page.keyboard.down('KeyW'); await sleep(5000); await A.page.keyboard.up('KeyW');
await sleep(3000);
const st = await A.state();
const s2 = (await A.page.evaluate(() => [...window.__game.summonsState()])).find((s) => s.ownerId === aId);
check('summon follows its owner', s2 && Math.hypot(s2.x - st.x, s2.z - st.z) < 6, s2 ? `distance ${Math.hypot(s2.x - st.x, s2.z - st.z).toFixed(1)} m` : 'missing');
// Panel + free summon.
await A.page.keyboard.press('KeyB');
await sleep(1500);
await A.page.click('.sp-draw');
await sleep(2500);
const reveal = await A.page.evaluate(() => document.querySelector('.sp-reveal')?.textContent ?? '');
check('free summon revealed', /créature|collection/.test(reveal), JSON.stringify(reveal));
await A.page.screenshot({ path: `${out}/summon-panel.png` });
check('no JavaScript error', jsErrors === 0, `${jsErrors}`);
await browser.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
