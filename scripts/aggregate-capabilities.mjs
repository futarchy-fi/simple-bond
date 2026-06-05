#!/usr/bin/env node
// Capability aggregator — the ONLY writer of the `capabilities` map in
// docs/autoloop/metrics.json. It consumes a Playwright JSON report and turns
// the user-facing e2e journeys (poster C*, judge E*, challenger D*) into
// boolean capability flags, so the autonomous loop's headline metric is
// "did the end-to-end journey actually work" rather than cosmetic churn
// (CHARTER section 3).
//
// GAMING-RESISTANCE INVARIANT (the whole point):
//   A flag is set TRUE only if EVERY mapped spec for that journey has a
//   computed status of 'passed'. A skipped, failed, timed-out, interrupted,
//   or MISSING (not present in the report) test can NEVER make a flag true.
//   A skipped/host-gated/missing journey is recorded as absent — we do not
//   downgrade it to a hard `false` (it was simply not exercised), but we also
//   never lie and call it green. A journey with at least one mapped test that
//   actually ran and did NOT pass is recorded as `false`.
//
//   node scripts/aggregate-capabilities.mjs [report.json]
//   PLAYWRIGHT_JSON_OUTPUT_NAME=report.json node scripts/aggregate-capabilities.mjs
//
// Flags marked --no-write skip the metrics.json merge (used by the unit test,
// which asserts on the printed JSON instead).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const METRICS = resolve(ROOT, 'docs', 'autoloop', 'metrics.json');

// Authoritative target-flag -> spec-code map. Each flag is proven by the
// passing of EVERY code listed. Codes are the stable leading tokens of the
// Playwright spec titles in tests/e2e/*.spec.js (e.g. "C1 — create bond ...").
// A target journey with no existing test is intentionally absent from this
// map — we never invent a passing flag for an unwritten journey.
export const CAPABILITY_MAP = {
  // Poster creates a bond end-to-end (wizard -> BondCreated).
  createBond: ['C1'],
  // A caller deploys/becomes a ManualJudgeV6 operator.
  becomeJudge: ['E2'],
  // A challenge is filed AND ruled on (full dispute cycle, settles the bond).
  challengeAndRule: ['D1', 'E4'],
  // Poster concedes a specific challenge.
  concede: ['C3'],
  // Poster withdraws after close (no pending challenges).
  withdraw: ['C6'],
  // Refunds are drained after a bond-wide settlement.
  drainRefunds: ['D2'],
  // Anyone triggers claimTimeout after the ruling window passes.
  claimTimeout: ['D3'],
};

// Leading stable code of a spec title, e.g. "C1 — create bond ..." -> "C1".
// Returns null when a title has no such code (those specs are ignored here).
export function codeOf(title) {
  const m = String(title || '').match(/^([A-Z]\d+)\b/);
  return m ? m[1] : null;
}

// Collapse a single spec's per-result statuses into one journey status.
// Playwright result statuses: 'passed' | 'failed' | 'timedOut' |
// 'interrupted' | 'skipped'. Anything that is not an unambiguous pass is a
// non-pass. A spec with NO results at all counts as skipped (it never ran).
export function specStatus(spec) {
  const statuses = [];
  for (const t of spec.tests || []) {
    for (const r of t.results || []) {
      if (r.status) statuses.push(r.status);
    }
    // Some report shapes carry a roll-up `status` on the test
    // ('expected'|'unexpected'|'flaky'|'skipped') — fold it in defensively.
    if ((!t.results || t.results.length === 0) && t.status) {
      statuses.push(t.status === 'expected' ? 'passed' : t.status);
    }
  }
  if (statuses.length === 0) return 'skipped';
  if (statuses.every((s) => s === 'skipped')) return 'skipped';
  // A pass requires every non-skipped result to be 'passed'. Any failure,
  // timeout, or interruption taints the whole journey.
  const ran = statuses.filter((s) => s !== 'skipped');
  return ran.every((s) => s === 'passed') ? 'passed' : 'failed';
}

// Walk the nested Playwright suite/spec tree and return a Map<code, status>.
// If the same code appears more than once, a non-pass wins (conservative).
export function collectStatuses(report) {
  const byCode = new Map();
  const record = (code, status) => {
    if (!code) return;
    const prev = byCode.get(code);
    if (prev === undefined) { byCode.set(code, status); return; }
    // Combine: passed only stays passed if both passed; failed dominates;
    // skipped yields to anything that actually ran.
    if (prev === 'failed' || status === 'failed') { byCode.set(code, 'failed'); return; }
    if (prev === 'passed' || status === 'passed') { byCode.set(code, 'passed'); return; }
    byCode.set(code, 'skipped');
  };
  const walkSuite = (suite) => {
    for (const spec of suite.specs || []) {
      record(codeOf(spec.title), specStatus(spec));
    }
    for (const child of suite.suites || []) walkSuite(child);
  };
  for (const suite of report.suites || []) walkSuite(suite);
  return byCode;
}

// Build the capability map from the collected per-code statuses.
// TRUE  -> every mapped code is present AND 'passed'.
// FALSE -> at least one mapped code is present and ran but did not pass.
// ABSENT (omitted) -> the journey was not exercised: a mapped code is missing
//          from the report or only ever skipped. NEVER reported as true.
export function buildCapabilities(byCode, map = CAPABILITY_MAP) {
  const caps = {};
  for (const [flag, codes] of Object.entries(map)) {
    const seen = codes.map((c) => ({ code: c, status: byCode.get(c) }));
    const anyMissing = seen.some((s) => s.status === undefined);
    const anySkipped = seen.some((s) => s.status === 'skipped');
    const anyNonPass = seen.some((s) => s.status === 'failed');
    if (anyNonPass) { caps[flag] = false; continue; }
    if (anyMissing || anySkipped) continue; // absent — not exercised
    if (seen.every((s) => s.status === 'passed')) caps[flag] = true;
    // (no else: only reachable state left is all-passed)
  }
  return caps;
}

export function aggregate(report, map = CAPABILITY_MAP) {
  return buildCapabilities(collectStatuses(report), map);
}

// ---- CLI ----------------------------------------------------------------
function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const args = process.argv.slice(2);
  const noWrite = args.includes('--no-write');
  const positional = args.filter((a) => !a.startsWith('--'));
  const reportPath = positional[0] || process.env.PLAYWRIGHT_JSON_OUTPUT_NAME;

  if (!reportPath) {
    process.stderr.write('aggregate-capabilities: no report path (arg or PLAYWRIGHT_JSON_OUTPUT_NAME)\n');
    process.exit(2);
  }
  if (!existsSync(reportPath)) {
    process.stderr.write(`aggregate-capabilities: report not found: ${reportPath}\n`);
    process.exit(2);
  }

  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (e) {
    process.stderr.write(`aggregate-capabilities: bad JSON report: ${e.message}\n`);
    process.exit(2);
  }

  const capabilities = aggregate(report);

  if (noWrite) {
    process.stdout.write(JSON.stringify(capabilities, null, 2) + '\n');
    process.exit(0);
  }

  // Read-modify-write merge: preserve every other key, replace only
  // `capabilities`, bump `updated`. The aggregator is the sole writer of caps.
  const durable = existsSync(METRICS)
    ? JSON.parse(readFileSync(METRICS, 'utf8'))
    : {
        iteration: 0, updated: null,
        gates: {}, burndown: {}, capabilities: {}, adversarialScore: null, runDeadline: null,
      };
  durable.capabilities = capabilities;
  durable.updated = new Date().toISOString().slice(0, 10);
  writeFileSync(METRICS, JSON.stringify(durable, null, 2) + '\n');

  process.stdout.write(
    `aggregate-capabilities: wrote ${Object.keys(capabilities).length} flag(s) to ${METRICS}\n` +
    JSON.stringify(capabilities, null, 2) + '\n'
  );
  process.exit(0);
}
