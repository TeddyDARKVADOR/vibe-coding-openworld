// Dev helper: opens the game in headless Chromium, optionally holds keys, takes screenshots.
// usage: node scripts/play-test.mjs <out-prefix> [keys=KeyW] [holdMs=2000] [url]
import { chromium } from 'playwright';
const [prefix, keys = '', hold = '2000', url = 'http://localhost:5173/?debug'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: +(process.env.W ?? 1280), height: +(process.env.H ?? 720) } });
page.on('console', (m) => { if (m.type() !== 'debug') console.log('[console]', m.type(), m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => (window).__game, null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${prefix}-0.png` });
console.log(JSON.stringify(await page.evaluate(() => (window).__game.debugState)));
if (keys) {
  for (const k of keys.split('+')) await page.keyboard.down(k);
  await page.waitForTimeout(+hold);
  for (const k of keys.split('+')) await page.keyboard.up(k);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${prefix}-1.png` });
  console.log(JSON.stringify(await page.evaluate(() => (window).__game.debugState)));
}
await browser.close();
