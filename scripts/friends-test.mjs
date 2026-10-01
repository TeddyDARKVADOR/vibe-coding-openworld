// Browser test: friend codes through the UI, request / accept, online status, JOIN (server-placed),
// then the joined position survives a reload (persistence).
// Requires `npm run dev`. usage: node scripts/friends-test.mjs [outDir]
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const BASE = process.env.URL ?? 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0, jsErrors = 0;
const check = (n, ok, info = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${info}`); };
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(300); } return false; };
const open = async (name, w = 640, h = 420) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } }); // own localStorage = own player
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { jsErrors++; console.log(`[${name}]`, e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { jsErrors++; console.log(`[${name} console]`, m.text()); } });
  const go = async () => {
    await page.goto(`${BASE}?radius=1&name=${name}`);
    await page.waitForFunction(() => window.__game?.debugState, null, { timeout: 120000 });
  };
  await go();
  return { ctx, page, go, state: () => page.evaluate(() => window.__game.debugState) };
};
const text = (p, sel) => p.page.locator(sel).first().innerText().catch(() => '');

const A = await open('Alice');
const B = await open('Bruno');
await sleep(1500);
// Alice runs away so a JOIN is a real move.
const seq = () => A.page.evaluate(() => window.__game.player.seq);
const q0 = await seq();
await A.page.keyboard.down('ShiftLeft'); await A.page.keyboard.down('KeyW');
await until(async () => (await seq()) - q0 > 150, 60000);
await A.page.keyboard.up('KeyW'); await A.page.keyboard.up('ShiftLeft');
await sleep(1500);

await A.page.keyboard.press('KeyF');
check('Alice has a friend code', await until(async () => /^FRIEND-[A-Z2-9]{4}$/.test(await text(A, '.fp-code')), 10000));
const code = await text(A, '.fp-code');
await B.page.keyboard.press('KeyF');
await B.page.fill('.fp-input', 'FRIEND-0000');
await B.page.click('.fp-add');
check('unknown code is refused', await until(async () => /introuvable|inconnu|aucun/i.test(await text(B, '.fp-feedback')), 8000), await text(B, '.fp-feedback'));
await B.page.fill('.fp-input', code);
await B.page.click('.fp-add');
check('Bruno sees the pending request', await until(async () => /demande envoyée/.test(await text(B, '.fp-list')), 8000));
check('Alice receives the request', await until(async () => /veut être ton ami/.test(await text(A, '.fp-list')), 8000));
await A.page.click('.fp-list button.primary');
check('Bruno sees Alice ONLINE', await until(async () => /EN LIGNE/.test(await text(B, '.fp-list')), 8000));
check('Alice sees Bruno ONLINE', await until(async () => /EN LIGNE/.test(await text(A, '.fp-list')), 8000));
await A.page.keyboard.press('Escape');

const a = await A.state(), b0 = await B.state();
const d0 = Math.hypot(a.x - b0.x, a.z - b0.z);
await B.page.click('.fp-list button.primary'); // REJOINDRE
check('Bruno is placed next to Alice by the server', await until(async () => { const b = await B.state(); return Math.hypot(a.x - b.x, a.z - b.z) < 6; }, 10000), `(was ${d0.toFixed(0)} m away)`);
await sleep(1500);
const b1 = await B.state();
check('Alice sees Bruno next to her', (await A.state()).remotes.some((r) => r.name === 'Bruno' && Math.hypot(r.x - a.x, r.z - a.z) < 8));
await B.page.screenshot({ path: `${out}/friends-join.png` });

// Persistence: reload after the autosave, Bruno comes back at the same place with the same friend.
await sleep(6000);
await B.go();
await sleep(1500);
const b2 = await B.state();
check('Bruno restored at his saved position', Math.hypot(b2.x - b1.x, b2.z - b1.z) < 3, `(${b2.x.toFixed(1)}, ${b2.z.toFixed(1)})`);
await B.page.keyboard.press('KeyF');
check('friendship survives the reload', await until(async () => /Alice/.test(await text(B, '.fp-list')), 8000));
// Offline friend: status only, never a position.
await A.ctx.close();
// A closed tab counts as a network drop: the server keeps the seat 20 s for a reconnection.
check('Alice shows OFFLINE', await until(async () => /HORS LIGNE/.test(await text(B, '.fp-list')), 40000));
check('no JOIN button for an offline friend', !(await B.page.locator('.fp-list button.primary').count()));
check('no JS errors', jsErrors === 0, `${jsErrors}`);
await browser.close();
console.log(failed ? `${failed} check(s) FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
