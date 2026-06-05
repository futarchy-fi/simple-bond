#!/usr/bin/env node
// Synthetic monitor — run on a cron (every few minutes) to catch the failure
// classes that are invisible from a single HTTP 200: a stalled indexer, an
// empty read-model, or a fabricated 1:1 sUSDS rate served live. Prints one
// ALERT line per breach and exits non-zero so the cron wrapper can page.
//
//   node scripts/monitor.mjs                         # defaults to prod (chain 1)
//   API=https://api.bond.futarchy.ai SITE=https://bond.futarchy.ai \
//     RPC=https://eth.drpc.org LAG_THRESHOLD=200 node scripts/monitor.mjs
//
//   # Sepolia / v0.7 staging (mock token, may legitimately have no bonds yet):
//   CHAIN_ID=11155111 RPC=https://ethereum-sepolia-rpc.publicnode.com \
//     MIN_BONDS=0 SKIP_RATE_CHECK=1 node scripts/monitor.mjs
//
// monitor.mjs is single-chain per run (CHAIN_ID) — run it once per served chain.
// NOTE: not yet scheduled in deploy. Wiring it to a cron + a real alert sink
// (email/Slack) is an operator decision — the email path is currently stubbed
// (EMAIL_ENABLED=false), so there is no destination yet. See docs/autoloop.
// Each probe is independent; one failing probe doesn't mask the others.

import { ethers } from 'ethers';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const API = (process.env.API || 'https://api.bond.futarchy.ai').replace(/\/+$/, '');
const RPC = process.env.RPC || 'https://eth.drpc.org';
const SUSDS = process.env.SUSDS || '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD';
const CHAIN_ID = Number(process.env.CHAIN_ID || 1);
const LAG_THRESHOLD = Number(process.env.LAG_THRESHOLD || 200);
// Freshness/liveness budget: the watcher ticks every POLL_INTERVAL_MS (30s), so
// 180s = 6 missed polls is a comfortable margin that pages a crashed/wedged
// watcher within minutes rather than waiting for block-lag to creep up.
const TICK_AGE_THRESHOLD = Number(process.env.TICK_AGE_THRESHOLD || 180);
// Per-chain safety knobs so a staging/Sepolia run won't false-alarm: MIN_BONDS is
// the minimum non-empty read-model size (set 0 for a chain that may legitimately
// have no bonds yet); SKIP_RATE_CHECK=1 skips the sUSDS-rate probe for chains whose
// approved token is a mock without a real convertToShares vault.
const MIN_BONDS = Number(process.env.MIN_BONDS ?? 1);
const SKIP_RATE_CHECK = process.env.SKIP_RATE_CHECK === '1' || process.env.SKIP_RATE_CHECK === 'true';

// Pure staleness decision, unit-testable without a server. A null/undefined age
// (the indexer never ticked, or no timestamp) is stale; otherwise stale when the
// last tick is older than the threshold.
export function isTickStale(ageSeconds, thresholdSeconds) {
  if (ageSeconds == null) return true;
  return ageSeconds > thresholdSeconds;
}

const alerts = [];
const alert = (m) => { alerts.push(m); console.error(`ALERT: ${m}`); };
const ok = (m) => console.log(`ok: ${m}`);

async function getJson(url, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// Pure evaluation of ONE chain's indexer health (M1 lag, M5 dead-letters, M6 tick
// freshness) from an injected /health payload — no network, unit-testable. Returns
// the alert + ok lines so e.g. a stale Sepolia entry alerts even when mainnet (a
// different chainId in the same payload) is green.
export function evaluateHealth(health, { chainId, lagThreshold, tickThreshold }) {
  const out = { alerts: [], oks: [] };
  const s = ((health && health.indexer) || []).find((x) => x.chainId === chainId);
  if (!s) { out.alerts.push(`health has no indexer status for chain ${chainId}`); return out; }
  // M1 — indexer lag (a stalled read-model is the silent-regression risk).
  if (s.blocksBehindHead == null) out.alerts.push(`chain ${chainId} lag unknown (head/checkpoint missing)`);
  else if (s.blocksBehindHead > lagThreshold) out.alerts.push(`indexer lag ${s.blocksBehindHead} blocks > ${lagThreshold} (chain ${chainId})`);
  else out.oks.push(`indexer lag ${s.blocksBehindHead} blocks (chain ${chainId})`);
  // M5 — dead-lettered (poison-block) ranges freeze the read-model behind them.
  const n = s.deadLetters || 0;
  if (n > 0) out.alerts.push(`indexer has ${n} dead-lettered range(s), blocked from block ${s.blockedFromBlock} (chain ${chainId})`);
  else out.oks.push(`no dead-lettered ranges (chain ${chainId})`);
  // M6 — tick freshness/liveness: a wedged watcher still serves stale HTTP 200s.
  const age = s.headAgeSeconds;
  if (isTickStale(age, tickThreshold)) {
    if (age == null) out.alerts.push(`indexer never ticked (no head timestamp) for chain ${chainId}`);
    else out.alerts.push(`indexer tick age ${age}s > ${tickThreshold}s (chain ${chainId}) — watcher stalled?`);
  } else out.oks.push(`indexer tick age ${age}s (chain ${chainId})`);
  return out;
}

// M1+M5+M6 live: fetch /health once and evaluate the active chain.
async function checkIndexerHealth() {
  let h;
  try { h = await getJson(`${API}/api/notify/health`); }
  catch (e) { return alert(`health probe failed: ${e.message}`); }
  const { alerts: a, oks: o } = evaluateHealth(h, { chainId: CHAIN_ID, lagThreshold: LAG_THRESHOLD, tickThreshold: TICK_AGE_THRESHOLD });
  a.forEach(alert); o.forEach(ok);
}

// M2 — read-model non-empty (lists silently showing 0 was I9).
async function checkBondsNonEmpty() {
  try {
    const j = await getJson(`${API}/api/bonds?chainId=${CHAIN_ID}`);
    if (!Array.isArray(j.bonds)) return alert('bonds response malformed');
    if (j.bonds.length < MIN_BONDS) alert(`/api/bonds returned ${j.bonds.length} bonds (< MIN_BONDS=${MIN_BONDS}) for chain ${CHAIN_ID}`);
    else ok(`/api/bonds returned ${j.bonds.length} bonds`);
  } catch (e) { alert(`/api/bonds probe failed: ${e.message}`); }
}

// M4 — live sUSDS rate must not be a 1:1 fabrication (I1).
async function checkRateNotFabricated() {
  if (SKIP_RATE_CHECK) { ok('sUSDS rate check skipped (SKIP_RATE_CHECK)'); return; }
  try {
    const p = new ethers.JsonRpcProvider(RPC, ethers.Network.from(CHAIN_ID), { staticNetwork: true });
    const c = new ethers.Contract(SUSDS, ['function convertToShares(uint256) view returns (uint256)'], p);
    const shares = await c.convertToShares(10n ** 18n);
    const rate = Number(ethers.formatUnits(shares, 18));
    if (rate === 1 || rate > 0.999) alert(`sUSDS rate looks like a 1:1 fabrication: ${rate}`);
    else ok(`sUSDS rate ${rate.toFixed(6)} (healthy, < 1.0)`);
  } catch (e) {
    // Transport failure here is infra, not a product bug — warn, don't page.
    console.warn(`warn: rate probe inconclusive: ${e.message}`);
  }
}

// Run the probes only when executed directly, not when imported by a test
// (importing must not fire network probes or exit the process).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await Promise.all([
    checkIndexerHealth(),
    checkBondsNonEmpty(),
    checkRateNotFabricated(),
  ]);

  if (alerts.length) {
    console.error(`\n${alerts.length} alert(s).`);
    process.exit(1);
  }
  console.log('\nAll monitor probes healthy.');
}
