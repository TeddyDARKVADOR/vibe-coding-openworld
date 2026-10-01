// Takes screenshots of a few places of the world (dev helper for docs / visual checks).
// Requires the Vite client (`npm run dev -w client` or `npm run dev`). Starts its own
// game server on port 2601 for each viewpoint with DEBUG_SPAWN.
// usage: node scripts/tour-screenshots.mjs <outDir> [name ...]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const out = process.argv[2] ?? '.';
const only = process.argv.slice(3);
const VIEWS = [
  { name: 'spawn', spawn: [0, 0], look: [42, 31], pitch: 0.28, dist: 9 },
  { name: 'village', spawn: [70, 20], look: [42, 31], pitch: 0.35, dist: 11 },
  { name: 'lake', spawn: [-24, -205], look: [-24, -260], pitch: 0.3, dist: 9 },
  { name: 'bridge', spawn: [204, 285], look: [204, 312], pitch: 0.4, dist: 9 },
  { name: 'mountains', spawn: [-216, -200], look: [-216, -260], pitch: 0.25, dist: 9 },
  { name: 'far', spawn: [12500, -8300], look: [12500, -8400], pitch: 0.3, dist: 9 },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const v of VIEWS.filter((v) => !only.length || only.includes(v.name))) {
  if (await fetch('http://localhost:2601/health').then(() => true, () => false)) throw new Error('port 2601 already in use');
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env: { ...process.env, PORT: '2601', DEBUG_SPAWN: v.spawn.join(',') }, stdio: 'ignore' });
  process.on('exit', () => server.kill());
  for (let i = 0; i < 60 && !(await fetch('http://localhost:2601/health').then(() => true, () => false)); i++) await sleep(500);
  try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:5173/?server=ws://localhost:2601');
  await page.waitForFunction(() => window.__game?.debugState, null, { timeout: 180000 });
  const s = await page.evaluate(([lx, lz, pitch, dist]) => {
    const g = window.__game, st = g.debugState;
    g.orbit.yaw = Math.atan2(-(lx - st.x), -(lz - st.z));
    g.orbit.pitch = pitch; g.orbit.distance = dist;
    return st;
  }, [...v.look, v.pitch, v.dist]);
  await sleep(6000);
  await page.screenshot({ path: `${out}/${v.name}.png`, timeout: 240000 });
  const st = await page.evaluate(() => window.__game.debugState);
  console.log(`${v.name}: player at (${st.x.toFixed(1)}, ${st.z.toFixed(1)}), origin ${st.origin}, ${st.world.shown} chunks, spawned at (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`);
  await page.close();
  } finally {
    server.kill();
    await sleep(1500);
  }
}
await browser.close();
