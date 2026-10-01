// Dev helper: screenshot a page with headless Chromium (Playwright).
// usage: node scripts/screenshot.mjs <url> <out.png> [width] [height] [waitTitle]
import { chromium } from 'playwright';
const [url, out, w = '1400', h = '900', waitTitle = 'ready'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => console.log('[console]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction((t) => document.title === t, waitTitle, { timeout: 60000 }).catch(() => console.log('timeout waiting for title'));
await page.screenshot({ path: out });
await browser.close();
