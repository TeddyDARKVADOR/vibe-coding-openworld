// Browser test: A summons, targets B (T), attacks (R + click); both see B's HP drop.
// Requires `npm run dev`. usage: node scripts/combat-test.mjs [outDir]
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const BASE = process.env.URL ?? 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0, jsErrors = 0;
const check = (n, ok, info = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${info}`); };
const open = async (name, w, h) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { jsErrors++; console.log(`[${name}]`, e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { jsErrors++; console.log(`[${name} console]`, m.text()); } });
  await page.goto(`${BASE}?radius=1&name=${name}`);
  await page.waitForFunction(() => window.__game?.debugState, null, { timeout: 120000 });
  return { page, state: () => page.evaluate(() => window.__game.debugState) };
};
const until = async (fn, ms) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(500); } return v; };
const A = await open('Alice', 640, 400);
const B = await open('Bob', 400, 260);
await sleep(1500);
const bId = (await B.state()).sessionId;
await A.page.evaluate(() => window.__game.net.sendSummon({ op: 'select', id: 'demon' }));
await A.page.keyboard.press('KeyX');
await until(() => A.page.evaluate(() => !!window.__game.summons.mine()), 60000);
await sleep(1500);
await A.page.keyboard.press('KeyT');
const target = await until(() => A.page.evaluate(() => window.__game.targets.ref), 15000);
check('A targets B with T', target === `p:${bId}`, target);
await A.page.keyboard.press('KeyR');
await A.page.mouse.click(320, 200); // select/lock
await A.page.keyboard.press('KeyE');
const hitB = await until(() => B.page.evaluate((id) => { const p = window.__game.net.room.state.players.get(id); return p.hp < 100 ? p.hp : 0; }, bId), 60000);
check('B lost HP (server-validated)', hitB > 0, `hp=${hitB}`);
const hpSeenByA = await A.page.evaluate((id) => window.__game.net.room.state.players.get(id).hp, bId);
check('A sees the same HP for B', Math.abs(hpSeenByA - hitB) <= 12, `A sees ${hpSeenByA}, B has ${hitB}`);
const cdShown = await A.page.evaluate(() => [...document.querySelectorAll('.ab-cd')].some((e) => e.textContent !== ''));
check('ability cooldown displayed', cdShown);
await sleep(1500);
await A.page.screenshot({ path: `${out}/combat-A.png` });
await B.page.screenshot({ path: `${out}/combat-B.png` });
// The KO lasts 4 s (slow headless pages may miss it): check the chat line that stays.
const ko = await until(() => B.page.evaluate(() => /est K\.O\./.test(document.getElementById('chat-log').textContent)), 60000);
check('B knocked out, both are told', ko === true && await A.page.evaluate(() => /Bob est K\.O\./.test(document.getElementById('chat-log').textContent)));
const respawned = await until(() => B.page.evaluate((id) => { const p = window.__game.net.room.state.players.get(id); return !p.dead && p.hp === 100; }, bId), 20000);
check('B respawned with full HP', respawned === true);
check('no JavaScript error', jsErrors === 0, `${jsErrors}`);
await browser.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
