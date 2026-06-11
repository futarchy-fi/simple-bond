#!/usr/bin/env node
// Parse-gate for inline page scripts. The frontend ships one ~220KB inline
// <script> per HTML page; nothing in the suite ever PARSED it, so a duplicate
// `const` (a load-time SyntaxError that blanks the page) sailed to production
// behind "1168 passing" + a cached "e2e ✅". This extracts every inline (no-src)
// <script> and runs `node --check` on it — catching the entire class of
// parse-time errors (dup declarations, stray brackets, bad syntax) in ms, with
// no browser. Runtime references to window/document are NOT flagged (--check is
// syntax-only), which is exactly right here.
//
// Usage: node scripts/check-inline-scripts.mjs [file.html ...]
// Exit 0 = all inline scripts parse; non-zero = at least one SyntaxError.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const DEFAULT_FILES = ['frontend/index.html', 'frontend/v6/index.html'];
const files = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES)
  .map((f) => resolve(process.cwd(), f));

// Extract inline <script>…</script> bodies (skip any tag carrying a src=).
function inlineScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, attrs, body] = m;
    if (/\bsrc\s*=/.test(attrs)) continue;
    // Line where this block starts, for a useful error location.
    const startLine = html.slice(0, m.index).split('\n').length;
    out.push({ body, startLine, isModule: /\btype\s*=\s*["']module["']/.test(attrs) });
  }
  return out;
}

const tmp = mkdtempSync(join(tmpdir(), 'inline-parse-'));
let failures = 0;
let checked = 0;

for (const file of files) {
  let html;
  try { html = readFileSync(file, 'utf8'); }
  catch (e) { console.error(`✗ cannot read ${file}: ${e.message}`); failures++; continue; }

  const blocks = inlineScripts(html);
  for (let i = 0; i < blocks.length; i++) {
    const { body, startLine, isModule } = blocks[i];
    checked++;
    const ext = isModule ? 'mjs' : 'js';
    const tf = join(tmp, `b${failures}_${i}.${ext}`);
    // Pad with leading newlines so node's reported line numbers map back onto
    // the HTML file's line numbers.
    writeFileSync(tf, '\n'.repeat(startLine - 1) + body);
    const r = spawnSync(process.execPath, ['--check', tf], { encoding: 'utf8' });
    if (r.status !== 0) {
      failures++;
      const err = (r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(0, 4).join('\n  ');
      console.error(`✗ ${file} inline <script> #${i} (starts ~line ${startLine}) FAILED to parse:\n  ${err}`);
    } else {
      console.log(`✓ ${file} inline <script> #${i} (line ${startLine}, ${body.length} bytes) parses`);
    }
  }
}

rmSync(tmp, { recursive: true, force: true });
console.log(`\nchecked ${checked} inline script block(s); ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
