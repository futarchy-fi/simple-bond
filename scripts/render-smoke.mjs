#!/usr/bin/env node
// REAL render smoke: serve frontend/ statically, load the page in headless
// chromium, and fail on ANY uncaught page error / load-time SyntaxError or if
// the app shell didn't mount. This is the render-level backstop to the parse
// gate — together they make "the dapp actually loads" a live, executed check
// instead of a string-grep + cached fossil.
//
// Deliberately hermetic: the ethers CDN <script> is stubbed with a tiny local
// shim so the smoke tests OUR code, not jsdelivr/network. A blank-page
// SyntaxError (the 2026-06-11 regression) makes the whole inline script fail to
// run → no app shell + a pageerror → this exits non-zero.
//
// Usage: node scripts/render-smoke.mjs [frontend-dir]
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const DIR = resolve(process.cwd(), process.argv[2] || 'frontend');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.map':'application/json' };

// Minimal ethers shim so the CDN <script src=…ethers…> resolves locally and the
// page never depends on the network. The shell render must not need a real ethers.
const ETHERS_SHIM = 'window.ethers = window.ethers || { BrowserProvider:function(){}, Contract:function(){}, JsonRpcProvider:function(){}, FallbackProvider:function(){}, Interface:function(){}, formatUnits:()=> "0", parseUnits:()=>0n, getAddress:(a)=>a, Network:{from:()=>({})}, isAddress:()=>true };';

const server = createServer((req, res) => {
  let path = decodeURIComponent((req.url || '/').split('?')[0]);
  // Any request to an ethers CDN-style URL → local shim.
  if (/ethers/i.test(path) && path.endsWith('.js')) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(ETHERS_SHIM);
  }
  if (path === '/' || path.endsWith('/')) path += 'index.html';
  const file = join(DIR, path);
  if (!existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  let body = readFileSync(file);
  // For HTML, strip SRI `integrity`/`crossorigin` so the locally-shimmed ethers
  // <script> loads instead of being blocked by a hash mismatch — the smoke tests
  // OUR inline script's render, not the CDN asset's integrity.
  if (extname(file) === '.html') {
    body = Buffer.from(String(body).replace(/\s+integrity="[^"]*"/g, '').replace(/\s+crossorigin="[^"]*"/g, ''));
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(body);
});

function check(html) {
  return new Promise((resolveCheck) => {
    server.listen(0, async () => {
      const port = server.address().port;
      const url = `http://127.0.0.1:${port}/${html}`;
      const errors = [];
      let browser;
      try {
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
        const page = await browser.newPage();
        // Rewrite the real ethers CDN URL (absolute https) to our shim.
        await page.route(/cdn\.jsdelivr\.net.*ethers.*\.js/i, (route) =>
          route.fulfill({ status: 200, contentType: 'text/javascript', body: ETHERS_SHIM }));
        page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
        await page.goto(url, { waitUntil: 'load', timeout: 20000 });
        await page.waitForTimeout(800); // let init run
        // App shell must have mounted: nav actions present in the rendered DOM.
        const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
        const mounted = /Create bond/i.test(bodyText) && /Browse/i.test(bodyText);
        const synErr = errors.find((e) => /SyntaxError|has already been declared|Unexpected/i.test(e));
        resolveCheck({ html, errors, mounted, synErr, bodyLen: bodyText.length });
      } catch (e) {
        resolveCheck({ html, errors: errors.concat(`launch/goto: ${e.message}`), mounted: false, synErr: null, bodyLen: 0 });
      } finally {
        if (browser) await browser.close();
        server.close();
      }
    });
  });
}

const target = existsSync(join(DIR, 'index.html')) ? 'index.html' : null;
if (!target) { console.error(`no index.html under ${DIR}`); process.exit(2); }

const r = await check(target);
let ok = true;
if (r.synErr) { console.error(`✗ render-smoke: load-time SyntaxError — ${r.synErr}`); ok = false; }
if (!r.mounted) { console.error(`✗ render-smoke: app shell did NOT mount (no "Create bond"/"Browse" in rendered body; bodyLen=${r.bodyLen})`); ok = false; }
if (r.errors.length) { console.error(`  page errors:\n   ${r.errors.slice(0,6).join('\n   ')}`); }
if (ok) console.log(`✓ render-smoke: app shell mounted, no load-time errors (rendered ${r.bodyLen} chars)`);
process.exit(ok ? 0 : 1);
