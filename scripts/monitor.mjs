#!/usr/bin/env node
// Synthetic monitor — run on a cron (every few minutes) to catch the failure
// classes that are invisible from a single HTTP 200: a stalled indexer, an
// empty read-model, or a fabricated 1:1 sUSDS rate served live. Prints one
// ALERT line per breach and exits non-zero so the cron wrapper can page.
//
//   node scripts/monitor.mjs                         # defaults to prod
//   API=https://api.bond.futarchy.ai SITE=https://bond.futarchy.ai \
//     RPC=https://eth.drpc.org LAG_THRESHOLD=200 node scripts/monitor.mjs
//
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

// M1 — indexer lag: a stalled read-model is the silent-regression risk.
async function checkIndexerLag() {
  try {
    const h = await getJson(`${API}/api/notify/health`);
    const s = (h.indexer || []).find((x) => x.chainId === CHAIN_ID);
    if (!s) return alert(`health has no indexer status for chain ${CHAIN_ID}`);
    if (s.blocksBehindHead == null) return alert(`chain ${CHAIN_ID} lag unknown (head/checkpoint missing)`);
    if (s.blocksBehindHead > LAG_THRESHOLD) {
      alert(`indexer lag ${s.blocksBehindHead} blocks > ${LAG_THRESHOLD} (chain ${CHAIN_ID})`);
    } else {
      ok(`indexer lag ${s.blocksBehindHead} blocks (chain ${CHAIN_ID})`);
    }
  } catch (e) { alert(`health probe failed: ${e.message}`); }
}

// M5 — dead-lettered (poison-block) ranges: the indexer holds the checkpoint
// before a window that fails even at the 1-block floor (no-skip), so the
// read-model freezes behind it. A non-zero dead-letter count means a human
// must look — page on it.
async function checkDeadLetters() {
  try {
    const h = await getJson(`${API}/api/notify/health`);
    const s = (h.indexer || []).find((x) => x.chainId === CHAIN_ID);
    if (!s) return; // M1 already alerts on a missing indexer status.
    const n = s.deadLetters || 0;
    if (n > 0) {
      alert(`indexer has ${n} dead-lettered range(s), blocked from block ${s.blockedFromBlock} (chain ${CHAIN_ID})`);
    } else {
      ok(`no dead-lettered ranges (chain ${CHAIN_ID})`);
    }
  } catch (e) { alert(`dead-letter probe failed: ${e.message}`); }
}

// M6 — tick freshness/liveness: a fully-stopped watcher whose block-lag happens
// to look small still serves stale HTTP 200s. The last-tick age (now -
// chain_heads.updated_at) catches it: alert when the active chain hasn't ticked
// within TICK_AGE_THRESHOLD, or when it never ticked (no head timestamp).
async function checkTickAge() {
  try {
    const h = await getJson(`${API}/api/notify/health`);
    const s = (h.indexer || []).find((x) => x.chainId === CHAIN_ID);
    if (!s) return; // M1 already alerts on a missing indexer status.
    const age = s.headAgeSeconds;
    if (isTickStale(age, TICK_AGE_THRESHOLD)) {
      if (age == null) alert(`indexer never ticked (no head timestamp) for chain ${CHAIN_ID}`);
      else alert(`indexer tick age ${age}s > ${TICK_AGE_THRESHOLD}s (chain ${CHAIN_ID}) — watcher stalled?`);
    } else {
      ok(`indexer tick age ${age}s (chain ${CHAIN_ID})`);
    }
  } catch (e) { alert(`tick-age probe failed: ${e.message}`); }
}

// M2 — read-model non-empty (lists silently showing 0 was I9).
async function checkBondsNonEmpty() {
  try {
    const j = await getJson(`${API}/api/bonds?chainId=${CHAIN_ID}`);
    if (!Array.isArray(j.bonds)) return alert('bonds response malformed');
    if (j.bonds.length === 0) alert(`/api/bonds returned 0 bonds for chain ${CHAIN_ID}`);
    else ok(`/api/bonds returned ${j.bonds.length} bonds`);
  } catch (e) { alert(`/api/bonds probe failed: ${e.message}`); }
}

// M4 — live sUSDS rate must not be a 1:1 fabrication (I1).
async function checkRateNotFabricated() {
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
    checkIndexerLag(),
    checkTickAge(),
    checkDeadLetters(),
    checkBondsNonEmpty(),
    checkRateNotFabricated(),
  ]);

  if (alerts.length) {
    console.error(`\n${alerts.length} alert(s).`);
    process.exit(1);
  }
  console.log('\nAll monitor probes healthy.');
}
