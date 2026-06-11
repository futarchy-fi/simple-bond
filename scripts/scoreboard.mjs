#!/usr/bin/env node
// Autonomous-loop scoreboard. Recomputes the cheap, authoritative metrics live
// (lint + G1 baseline) and merges the durable counters/capabilities the loop
// maintains in docs/autoloop/metrics.json. Prints a markdown table and exits
// non-zero if a hard invariant gate is known-failing — so an iteration can
// gate on it. Heavy suites (hardhat/e2e) are run by the iteration workflow and
// recorded into metrics.json; this gives a fast snapshot.
//
//   node scripts/scoreboard.mjs            # render + exit 0/1 on gates
//   node scripts/scoreboard.mjs --json     # machine-readable

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const METRICS = resolve(ROOT, 'docs', 'autoloop', 'metrics.json');

function runLint() {
  const r = spawnSync(process.execPath, [resolve(__dirname, 'lint-guardrails.mjs')], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0;
}
// A gate value read from metrics.json (hardhat/e2e/deployGate/monitor — the
// heavy suites this script does NOT live-run) is only trustworthy if the file
// was written AT OR AFTER the latest source change. If source moved since, those
// cached booleans are FOSSILS and must NOT read as green. 2026-06-11: a cached
// "e2e ✅" from iteration 33 / 2026-06-06 masked a blank-page SyntaxError pushed
// 2026-06-11, because the scoreboard echoed the fossil instead of flagging it.
const GATE_SRC = ['contracts', 'backend', 'frontend', 'test', 'tests', 'hardhat.config.js'];
function metricsStale() {
  try {
    const dirty = spawnSync('git', ['status', '--porcelain', '--', ...GATE_SRC], { cwd: ROOT, encoding: 'utf8' });
    if ((dirty.stdout || '').trim()) return { stale: true, reason: 'uncommitted changes in tracked source (contracts/backend/frontend/test/tests)' };
    const src = spawnSync('git', ['log', '-1', '--format=%ct', '--', ...GATE_SRC], { cwd: ROOT, encoding: 'utf8' });
    const met = spawnSync('git', ['log', '-1', '--format=%ct', '--', METRICS], { cwd: ROOT, encoding: 'utf8' });
    const srcT = parseInt((src.stdout || '').trim() || '0', 10);
    const metT = parseInt((met.stdout || '').trim() || '0', 10);
    if (srcT > metT) return { stale: true, reason: `source last changed after metrics.json was written (gates reflect an older tree)` };
    return { stale: false, reason: '' };
  } catch (e) {
    // If git can't answer, be conservative: treat as stale rather than claim green.
    return { stale: true, reason: `staleness undeterminable (${e.message})` };
  }
}
function g1Baseline() {
  try {
    const b = JSON.parse(readFileSync(resolve(__dirname, '.lint-baseline.json'), 'utf8'));
    return b['G1:frontend/index.html'] ?? null;
  } catch { return null; }
}

const durable = existsSync(METRICS) ? JSON.parse(readFileSync(METRICS, 'utf8')) : {
  iteration: 0, updated: null,
  gates: { lint: null, hardhat: null, e2e: null, deployGate: null, monitor: null },
  burndown: { g1EmptyCatch: null, rcaOpenGaps: null, brokenWikiLinks: null, docDrift: null },
  capabilities: {}, adversarialScore: null, runDeadline: null,
};

// Live recompute of the cheap authoritative signals.
const lintPass = runLint();
durable.gates.lint = lintPass;
durable.burndown.g1EmptyCatch = g1Baseline();

// Are the cached (non-live) gates fossils relative to current source?
const staleness = metricsStale();
durable.cachedGatesStale = staleness.stale;
durable.cachedGatesStaleReason = staleness.reason;

if (!process.argv.includes('--no-write')) {
  writeFileSync(METRICS, JSON.stringify(durable, null, 2) + '\n');
}

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(durable, null, 2) + '\n');
  process.exit(0);
}

const g = durable.gates, b = durable.burndown;
const mark = (v) => v === true ? '✅' : v === false ? '❌' : '·';
// Cached gates can't claim green when the cache is stale — show the fossil but
// label it, so a stale ✅ can never be mistaken for a live pass again.
const cmark = (v) => staleness.stale ? `⚠ STALE (was ${mark(v)})` : mark(v);
console.log(`# Scoreboard — iteration ${durable.iteration}  (updated ${durable.updated || 'never'})`);
if (staleness.stale) {
  console.log(`\n⚠️  CACHED GATES ARE STALE — ${staleness.reason}.`);
  console.log(`    hardhat/e2e/deploy-gate/monitor below are from metrics.json (iteration ${durable.iteration}, ${durable.updated}),`);
  console.log(`    NOT a run against current code. Re-run the heavy suites (npx hardhat test; the e2e suite) before trusting green.`);
}
console.log(`\n## Invariant gates (must all be green)`);
console.log(`  lint        ${mark(g.lint)}`);   // live
console.log(`  hardhat     ${cmark(g.hardhat)}`);
console.log(`  e2e (local) ${cmark(g.e2e)}`);
console.log(`  deploy-gate ${cmark(g.deployGate)}`);
console.log(`  monitor     ${cmark(g.monitor)}`);
console.log(`\n## Burn-down (lower is better)`);
console.log(`  g1 empty-catch   ${b.g1EmptyCatch ?? '?'}`);
console.log(`  RCA open gaps    ${b.rcaOpenGaps ?? '?'}`);
console.log(`  broken wiki links ${b.brokenWikiLinks ?? '?'}`);
console.log(`  doc drift        ${b.docDrift ?? '?'}`);
console.log(`\n## Capabilities (green journeys)`);
const caps = Object.entries(durable.capabilities || {});
if (caps.length === 0) console.log('  (none recorded yet)');
for (const [k, v] of caps) console.log(`  ${k.padEnd(16)} ${mark(v)}`);
console.log(`\n## Adversarial quality score: ${durable.adversarialScore ?? 'n/a'}`);
console.log(`Run deadline: ${durable.runDeadline || 'unset'}`);

// Exit non-zero on a KNOWN-failing hard gate OR when the cached gates are stale
// (a fossil green must never read as a pass — that's the regression this guards).
const known = Object.values(g).filter(v => v === false).length;
process.exit((known > 0 || staleness.stale) ? 1 : 0);
