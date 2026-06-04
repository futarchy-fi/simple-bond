#!/usr/bin/env node
// Guardrail linter — zero-dependency static checks that lock in the fixes for
// the production incidents (RC1 silent fallback, RC4 unguarded writes, RC2
// browser getLogs). The frontend is a single inline-<script> HTML file, so a
// bespoke checker fits better than ESLint + an HTML plugin.
//
// Enforcement is a COUNT-BASED RATCHET against scripts/.lint-baseline.json:
// a rule/file pair may not exceed its baseline count, so existing debt is
// tolerated but NEW violations fail. Zero-baseline rules fail on any hit.
// Burn down by fixing a site and lowering its baseline.
//
//   node scripts/lint-guardrails.mjs                 # check (exit 1 on regression)
//   node scripts/lint-guardrails.mjs --update-baseline  # snapshot current counts
//
// Rules:
//   G1  empty/no-op catch bodies and .catch(()=>literal)  (RC1)
//   G2  fabricated 1:1 sUSDS rate object literals          (RC1/I1)
//   G3  signer-bound contracts/factories outside the sanctioned write factories (RC4/I4)
//   G4  direct getLogs/queryFilter in the frontend outside queryFilterChunked (RC2/I9)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASELINE_PATH = resolve(__dirname, '.lint-baseline.json');

const FRONTEND = 'frontend/index.html';
const BACKEND = ['backend/watcher.mjs', 'backend/api-server.mjs', 'backend/db.mjs', 'backend/config.mjs', 'backend/server.mjs'];

// Functions allowed to bind a signer to a contract / deploy (the choke-point).
const WRITE_FACTORIES = new Set([
  'bondWriteContract', 'judgeRegWrite', 'manualJudgeContract', 'erc20Contract', 'writeContract',
]);
const DEPLOY_ALLOWED = new Set(['deployFreshJudge']);

// Extract the inline <script> bodies from an HTML file, returning the text
// with non-script regions blanked out so reported line numbers stay accurate.
function scriptOnly(html) {
  const lines = html.split('\n');
  let inScript = false;
  return lines.map(line => {
    const lower = line.toLowerCase();
    if (!inScript && /<script\b[^>]*>/.test(lower) && !/src=/.test(lower)) {
      inScript = true;
      // keep anything after the opening tag on the same line
      return line.replace(/.*<script\b[^>]*>/i, '');
    }
    if (inScript && lower.includes('</script>')) {
      inScript = false;
      return line.replace(/<\/script>.*/i, '');
    }
    return inScript ? line : '';
  });
}

// Track the nearest enclosing `function NAME(` for a given line index.
function enclosingFns(lines) {
  const fnAt = new Array(lines.length).fill(null);
  let current = null;
  const fnRe = /^\s*(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(fnRe);
    if (m) current = m[1];
    fnAt[i] = current;
  }
  return fnAt;
}

// Pure core: lint a source string for a given (file) label. Exported so tests
// can feed known-bad snippets without touching the tree.
export function lintSource(file, raw) {
  const isHtml = file.endsWith('.html');
  const lines = isHtml ? scriptOnly(raw) : raw.split('\n');
  const fnAt = enclosingFns(lines);
  const violations = [];
  const add = (rule, line, text) => violations.push({ rule, file, line: line + 1, text: text.trim().slice(0, 100) });

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // G1a — .catch(()=>literal) / .catch(()=>[]) one-liners that swallow.
    if (/\.catch\(\s*\(\s*[\w]*\s*\)\s*=>\s*(\[\]|\{\}|0n?|null|undefined|''|""|1\b)/.test(line)) {
      add('G1', i, line);
    }
    // G1b — empty or comment-only catch block bodies: `catch (x) {` followed by
    // only whitespace/comments until `}`.
    const cm = line.match(/catch\s*\([^)]*\)\s*\{(.*)$/);
    if (cm) {
      let body = cm[1];
      let j = i;
      // gather until the matching close on the same logical block (cheap: until a line with `}`)
      while (!body.includes('}') && j < lines.length - 1) { j++; body += '\n' + lines[j]; }
      const inner = body.slice(0, body.indexOf('}'));
      const stripped = inner.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (stripped === '') add('G1', i, line);
    }

    // G2 — fabricated 1:1 rate object literal.
    if (/sharesPerAsset:\s*1\b[\s,]*assetsPerShare:\s*1\b/.test(line)) {
      add('G2', i, line);
    }

    // G3 — signer-bound contract / factory outside the sanctioned functions.
    if (/new\s+ethers\.Contract\([^;]*,\s*signer\s*\)/.test(line)) {
      if (!WRITE_FACTORIES.has(fnAt[i])) add('G3', i, line);
    }
    if (/new\s+ethers\.ContractFactory/.test(line)) {
      if (!DEPLOY_ALLOWED.has(fnAt[i])) add('G3', i, line);
    }
    if (/\.connect\(\s*signer\s*\)|signer\.sendTransaction\b/.test(line)) {
      if (!WRITE_FACTORIES.has(fnAt[i]) && !DEPLOY_ALLOWED.has(fnAt[i])) add('G3', i, line);
    }

    // G4 — direct getLogs/queryFilter in the FRONTEND outside queryFilterChunked.
    if (isHtml && /\.(getLogs|queryFilter)\s*\(/.test(line)) {
      if (fnAt[i] !== 'queryFilterChunked') add('G4', i, line);
    }
  }
  return violations;
}

function check(file) {
  return lintSource(file, readFileSync(resolve(ROOT, file), 'utf8'));
}

// G5 — a keyed RPC/provider URL must NEVER appear in a publicly-served frontend
// file (static bundle = exfiltratable key + billing-drain). Keyed RPCs live
// backend-only. Scans the whole frontend/ surface, not just index.html.
const FRONTEND_FILES = ['frontend/index.html', 'frontend/runtime-config.js', 'frontend/v6/index.html'];
export function detectKeyLeak(text) {
  const patterns = [
    /[a-z0-9-]*\.g\.alchemy\.com\/v2\/[A-Za-z0-9_-]{8,}/i,
    /[a-z0-9-]*\.infura\.io\/v3\/[A-Za-z0-9]{8,}/i,
    /[a-z0-9-]+\.quiknode\.pro\/[A-Za-z0-9]{8,}/i,
    /[a-z0-9-]*\.chainstack\.com\/[A-Za-z0-9]{8,}/i,
  ];
  return patterns.some((re) => re.test(text));
}
function checkKeyLeak() {
  const v = [];
  for (const f of FRONTEND_FILES) {
    const abs = resolve(ROOT, f);
    if (!existsSync(abs)) continue;
    const raw = readFileSync(abs, 'utf8');
    raw.split('\n').forEach((line, i) => {
      if (detectKeyLeak(line)) v.push({ rule: 'G5', file: f, line: i + 1, text: '(keyed provider URL redacted)' });
    });
  }
  return v;
}

function countsFrom(violations) {
  const c = {};
  for (const v of violations) {
    const key = `${v.rule}:${v.file}`;
    c[key] = (c[key] || 0) + 1;
  }
  return c;
}

function main() {
const files = [FRONTEND, ...BACKEND].filter(f => existsSync(resolve(ROOT, f)));
const all = [...files.flatMap(check), ...checkKeyLeak()];
const counts = countsFrom(all);

if (process.argv.includes('--update-baseline')) {
  writeFileSync(BASELINE_PATH, JSON.stringify(counts, null, 2) + '\n');
  console.log(`Baseline written: ${BASELINE_PATH}`);
  console.log(JSON.stringify(counts, null, 2));
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {};
let failed = false;
const RULE_DESC = {
  G1: 'silent/empty catch (RC1) — surface the error or return an explicit error state',
  G2: 'fabricated 1:1 sUSDS rate (RC1/I1) — return {unavailable:true} on transport failure',
  G3: 'signer bound outside a write factory (RC4/I4) — route through writeContract/*WriteContract',
  G4: 'direct getLogs/queryFilter in frontend (RC2/I9) — use queryFilterChunked or the indexer',
  G5: 'keyed RPC/provider URL in a public frontend file — keep keyed RPCs backend-only',
};

// Report regressions (count over baseline).
const keys = new Set([...Object.keys(counts), ...Object.keys(baseline)]);
for (const key of [...keys].sort()) {
  const now = counts[key] || 0;
  const max = baseline[key] || 0;
  if (now > max) {
    failed = true;
    const [rule] = key.split(':');
    console.error(`✗ ${key}: ${now} violations, baseline ${max}. ${RULE_DESC[rule] || ''}`);
    for (const v of all.filter(v => `${v.rule}:${v.file}` === key)) {
      console.error(`    ${v.file}:${v.line}  ${v.text}`);
    }
  }
}

if (failed) {
  console.error('\nGuardrail regression. Fix the new violation, or if intentional run --update-baseline (with review).');
  process.exit(1);
}
console.log(`Guardrails OK — ${all.length} known violations within baseline across ${files.length} files.`);
for (const key of Object.keys(counts).sort()) console.log(`  ${key}: ${counts[key]}`);
}

// Run the CLI only when executed directly, not when imported by a test.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
