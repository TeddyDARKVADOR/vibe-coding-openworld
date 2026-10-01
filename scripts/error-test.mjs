// Checks that failures show a useful message instead of a dead page.
// Requires the Vite client on :5173 (npm run dev). usage: node scripts/error-test.mjs [outDir]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const out = process.argv[2] ?? '.';
const BASE = 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
let failed = 0;
const check = (name, ok, info = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); };
const errorText = (page) => page.evaluate(() => {
  const el = document.getElementById('error');
  return el && !el.classList.contains('hidden') ? document.getElementById('error-title').textContent + ' — ' + document.getElementById('error-text').textContent : null;
});
const waitError = async (page, ms = 120000) => { const t = Date.now(); while (Date.now() - t < ms) { const e = await errorText(page); if (e) return e; await sleep(500); } return null; };

// 1. Server unavailable.
{
  const b = await chromium.launch({ args: GL });
  const page = await b.newPage();
  await page.goto(`${BASE}?server=ws://localhost:2999`);
  const e = await waitError(page);
  check('server unavailable → message', e?.startsWith('Serveur indisponible'), JSON.stringify(e?.slice(0, 90)));
  await page.screenshot({ path: `${out}/error-server.png` });
  await b.close();
}
// 2. WebGL unavailable.
{
  const b = await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] });
  const page = await b.newPage();
  await page.goto(BASE);
  const e = await waitError(page, 30000);
  check('WebGL unavailable → message', e?.startsWith('WebGL indisponible'), JSON.stringify(e?.slice(0, 60)));
  await b.close();
}
// 3. Missing asset (character GLB request fails).
{
  const b = await chromium.launch({ args: GL });
  const page = await b.newPage();
  await page.route('**/assets/characters/*.glb', (r) => r.fulfill({ status: 404, body: 'not found' }));
  await page.goto(`${BASE}?radius=1`);
  const e = await waitError(page);
  check('missing GLB → message', e?.startsWith('Ressource introuvable') && /characters\/.*\.glb/.test(e), JSON.stringify(e?.slice(0, 120)));
  await b.close();
}
// 4. Connection lost while playing (dedicated server on :2601 dies abruptly).
{
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env: { ...process.env, PORT: '2601' }, stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await fetch('http://localhost:2601/health').then(() => true, () => false)); i++) await sleep(500);
  const b = await chromium.launch({ args: GL });
  const page = await b.newPage({ viewport: { width: 400, height: 260 } });
  await page.goto(`${BASE}?server=ws://localhost:2601&radius=1`);
  await page.waitForFunction(() => window.__game?.debugState, null, { timeout: 180000 });
  await sleep(6000); // the SDK only auto-reconnects rooms that have been up for 5 s
  server.kill('SIGKILL'); // abrupt: like a network cut (a clean shutdown closes with a "server stopped" code)
  let status = '';
  for (let i = 0; i < 60 && !status.includes('reconnexion'); i++) { await sleep(500); status = await page.evaluate(() => document.getElementById('status').textContent); }
  check('connection lost → "reconnexion…" status', status.includes('reconnexion'), JSON.stringify(status));
  const e = await waitError(page, 180000);
  check('reconnection impossible → message', e?.startsWith('Connexion perdue'), JSON.stringify(e?.slice(0, 80)));
  await b.close();
}
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
