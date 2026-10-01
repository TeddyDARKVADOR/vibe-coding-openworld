// Browser test: walk, close the tab, reopen in the same browser → restored at the same place.
// Requires `npm run dev`. usage: node scripts/save-test.mjs
import { chromium } from 'playwright';
const URL = (process.env.URL ?? 'http://localhost:5173/') + '?radius=1&name=Sauvegarde';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 400, height: 260 } }); // same context = same localStorage
let failed = 0;
const check = (n, ok, info = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${info}`); };
const open = async () => {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { failed++; console.log('[pageerror]', e.message); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__game?.debugState, null, { timeout: 120000 });
  return page;
};
let page = await open();
const id1 = await page.evaluate(() => localStorage.getItem('openworld.playerId'));
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
await sleep(8000);
await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
await sleep(1500);
const before = await page.evaluate(() => window.__game.debugState);
check('walked away from the spawn', Math.hypot(before.x, before.z) > 3, `(${before.x.toFixed(1)}, ${before.z.toFixed(1)})`);
await page.close({ runBeforeUnload: true });
await sleep(1500);
page = await open();
await sleep(1500);
const after = await page.evaluate(() => window.__game.debugState);
const id2 = await page.evaluate(() => localStorage.getItem('openworld.playerId'));
check('same playerId', id1 && id1 === id2);
check('restored at the previous position', Math.hypot(after.x - before.x, after.z - before.z) < 2, `before (${before.x.toFixed(1)}, ${before.z.toFixed(1)}) after (${after.x.toFixed(1)}, ${after.z.toFixed(1)})`);
const chat = await page.evaluate(() => document.getElementById('chat-log').textContent);
check('player told about it', chat.includes('Position précédente restaurée'));
await browser.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
