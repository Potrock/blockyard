// Development: screenshot the preview page. `node shot.mjs <out.png> "<query>" [width] [height]`
import { createRequire } from 'node:module';
const require = createRequire('/home/user/blockyard/');
const { chromium } = require('playwright');
const [out, query, w = '1600', h = '900'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: Number(process.env.DSF ?? 1) });
page.on('console', (m) => m.type() === 'error' && console.log('page:', m.text()));
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5183}/src/games/blocktaceous/tools/quadrupeds/preview.html?${query}`);
await page.waitForFunction('window.__ready === true', null, { timeout: 60000 });
await page.waitForTimeout(300);
await page.screenshot({ path: out });
await browser.close();
