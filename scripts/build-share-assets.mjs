#!/usr/bin/env node
// Render the share/OG card + favicon PNGs from the source SVG/HTML using
// headless chromium. Run in the Playwright docker image (has the browser):
//   docker run --rm -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.60.0-noble \
//     node scripts/build-share-assets.mjs
// Outputs: frontend/img/{og.png, icon-180.png, favicon-32.png}
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const IMG = resolve(ROOT, 'frontend/img');
const favicon = readFileSync(resolve(IMG, 'favicon.svg'), 'utf8');

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--force-color-profile=srgb'] });

// 1) OG share card — 1200x630 (X / WhatsApp / Telegram link preview).
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto('file://' + resolve(IMG, 'og-card.html'), { waitUntil: 'networkidle' });
  await page.screenshot({ path: resolve(IMG, 'og.png') });
  await page.close();
  console.log('✓ og.png (1200x630)');
}

// 2) Favicon PNGs from the SVG (transparent around the rounded tile).
for (const size of [180, 32]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px}svg{display:block;width:${size}px;height:${size}px}</style>${favicon}`,
    { waitUntil: 'networkidle' });
  await page.screenshot({ path: resolve(IMG, size === 180 ? 'icon-180.png' : 'favicon-32.png'), omitBackground: true });
  await page.close();
  console.log(`✓ ${size === 180 ? 'icon-180.png' : 'favicon-32.png'} (${size}x${size})`);
}

await browser.close();
console.log('done');
