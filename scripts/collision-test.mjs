// Browser collision test: walk straight into the nearest house, then the nearest big rock.
// Requires `npm run dev`. usage: node scripts/collision-test.mjs [outDir]
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 400, height: 260 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(process.env.URL ?? 'http://localhost:5173/?debug&radius=2&name=Collision');
await page.waitForFunction(() => window.__game?.debugState, null, { timeout: 120000 });
const state = () => page.evaluate(() => window.__game.debugState);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;

async function walkInto(prefix, maxDist, minClearance) {
  const target = await page.evaluate(([p, m]) => window.__game.nearestVisible(p, m), [prefix, maxDist]);
  if (!target) { console.log(`SKIP  no ${prefix} in line of sight within ${maxDist} m`); return; }
  console.log(`target ${target.model} at ${target.d.toFixed(1)} m (first collider on the way at ${target.firstHit.toFixed(1)} m)`);
  await page.evaluate((y) => window.__game.setCameraYaw(y), target.yaw);
  // Aim at the centre and walk: without collision we'd pass through it (distance → 0).
  // With collision the character is stopped at the wall, then slides along it.
  await page.keyboard.down('KeyW');
  let minD = Infinity, shot = false, still = 0, last = await state();
  for (let i = 0; i < 400; i++) {
    await sleep(700);
    const s = await state();
    const d = Math.hypot(s.x - target.x, s.z - target.z);
    minD = Math.min(minD, d);
    if (!shot && d < minClearance + 1.2) { await page.screenshot({ path: `${out}/collision-${prefix.replace(/_$/, '')}.png` }); shot = true; }
    if (d > minD + 3) { console.log('  slid past it'); break; }
    // Keep aiming at the centre so we keep pushing against it.
    await page.evaluate(({ x, z }) => { const g = window.__game, st = g.debugState; g.setCameraYaw(Math.atan2(-(x - st.x), -(z - st.z))); }, target);
    still = Math.hypot(s.x - last.x, s.z - last.z) < 0.03 ? still + 1 : 0;
    last = s;
    if (still >= 6) { console.log('  pinned against it'); break; }
  }
  await page.keyboard.up('KeyW');
  const ok = minD > minClearance;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${target.model}: closest approach ${minD.toFixed(2)} m from its centre (collider clearance ${minClearance} m)`);
  // Back off a little.
  await page.evaluate((y) => window.__game.setCameraYaw(y + Math.PI), target.yaw);
  await page.keyboard.down('KeyW'); await sleep(3000); await page.keyboard.up('KeyW');
}

await walkInto('building_home', 120, 2.2); // house box >= 2.2 m half-size + capsule radius
await walkInto('rock_single', 110, 0.6); // big rock hull + capsule radius
await browser.close();
process.exit(failed ? 1 : 0);
