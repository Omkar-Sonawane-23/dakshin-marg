import { bootstrap } from './bootstrap.mjs';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('/tmp/vidgen/cards', { recursive: true });
const exe = await bootstrap();
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox','--disable-setuid-sandbox','--no-zygote','--single-process','--font-render-hinting=none','--hide-scrollbars'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })).newPage();
for (const name of ['title', 'end']) {
  await page.goto(`file:///tmp/vidgen/card_${name}.html`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `/tmp/vidgen/cards/${name}.png` });
  console.log('rendered', name);
}
await browser.close();
