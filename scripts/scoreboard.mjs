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

if (!process.argv.includes('--no-write')) {
  writeFileSync(METRICS, JSON.stringify(durable, null, 2) + '\n');
}

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(durable, null, 2) + '\n');
  process.exit(0);
}

const g = durable.gates, b = durable.burndown;
const mark = (v) => v === true ? '✅' : v === false ? '❌' : '·';
console.log(`# Scoreboard — iteration ${durable.iteration}  (updated ${durable.updated || 'never'})`);
console.log(`\n## Invariant gates (must all be green)`);
console.log(`  lint        ${mark(g.lint)}`);
console.log(`  hardhat     ${mark(g.hardhat)}`);
console.log(`  e2e (local) ${mark(g.e2e)}`);
console.log(`  deploy-gate ${mark(g.deployGate)}`);
console.log(`  monitor     ${mark(g.monitor)}`);
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

// Exit non-zero only on a KNOWN-failing hard gate (null = unknown = don't block).
const known = Object.values(g).filter(v => v === false).length;
process.exit(known > 0 ? 1 : 0);
