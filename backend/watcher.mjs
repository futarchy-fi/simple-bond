import { ethers } from 'ethers';
import { CHAINS, abiForChain, CONFIRMATION_BLOCKS, BLOCK_CHUNK, POLL_INTERVAL_MS, EVENT_RECIPIENTS } from './config.mjs';
import db from './db.mjs';
import { sendEmail } from './mailer.mjs';
import { eventEmail } from './templates.mjs';

// ─── Indexing (read-model) ────────────────────────────────────────────────
// Separate from the email path: snapshots bond + challenge state into SQLite
// so the frontend can list/filter via HTTP instead of scanning eth_getLogs.
// Only runs for v0.6 chains (the v0.5 Gnosis struct shape differs and that
// line is retired from the UI).

// Snapshot one bond's current state from chain into the read-model. `claim`
// carries claim text pulled from the triggering event (the struct only has a
// hash); pass undefined to leave any stored text untouched.
async function indexBondState(contract, chainId, bondId, claim) {
  let b;
  try {
    b = await contract.bonds(bondId);
  } catch (err) {
    console.error(`[index] chain ${chainId} bond ${bondId} read failed:`, err.message);
    return;
  }
  // challenge_count is a SECONDARY read. If it fails, pass null so the upsert
  // preserves the prior good value rather than clobbering an active bond's
  // count to 0 (incident I9/I10 class — a failed read must not look like
  // "zero challenges").
  let challengeCount = null;
  try { challengeCount = Number(await contract.getChallengeCount(bondId)); } catch {}

  db.upsertBond({
    chain_id: chainId,
    bond_id: bondId,
    poster: b.poster,
    judge: b.judge,
    judge_profile_id: Number(b.judgeProfileId ?? 0),
    token: b.token,
    bond_amount: b.bondAmount?.toString(),
    challenge_amount: b.challengeAmount?.toString(),
    judge_fee: b.judgeFee?.toString(),
    acceptance_delay: Number(b.acceptanceDelay ?? 0),
    ruling_buffer: Number(b.rulingBuffer ?? 0),
    max_challenges: Number(b.maxChallenges ?? 0),
    claim_hash: b.claimHash,
    claim_content: claim ?? '',
    claim_version: Number(b.claimVersion ?? 0),
    pending_count: Number(b.pendingCount ?? 0),
    challenge_count: challengeCount,
    settled: b.settled,
    closed: b.closed,
  });

  // Refresh challenge rows + statuses from chain (skip if count unknown).
  for (let i = 0; i < (challengeCount || 0); i++) {
    try {
      const c = await contract.getChallenge(bondId, i);
      db.upsertChallenge({
        chain_id: chainId,
        bond_id: bondId,
        idx: i,
        challenger: c.challenger,
        status: Number(c.status ?? 0),
        content: '', // preserved if already stored from the Challenged event
      });
    } catch {}
  }
}

// Index a batch of logs into the read-model (no emails). For each event we
// re-snapshot the affected bond; the Challenged event additionally carries the
// challenge's content, which we persist explicitly.
async function indexLogs(contract, chainId, logs, iface) {
  for (const log of logs) {
    let parsed;
    try { parsed = iface.parseLog({ topics: log.topics, data: log.data }); } catch { continue; }
    if (!parsed || parsed.args.bondId == null) continue;
    const bondId = Number(parsed.args.bondId);

    // Claim text lives in events, not the struct.
    let claim;
    if (parsed.name === 'BondCreated') claim = String(parsed.args.claimContent || '');
    else if (parsed.name === 'ClaimModified') claim = String(parsed.args.newContent || '');

    await indexBondState(contract, chainId, bondId, claim);

    if (parsed.name === 'Challenged') {
      db.upsertChallenge({
        chain_id: chainId,
        bond_id: bondId,
        idx: Number(parsed.args.challengeIndex),
        challenger: parsed.args.challenger,
        status: 0,
        content: String(parsed.args.content || ''),
      });
    }
  }
}

const LOG_WINDOW_RETRIES = 3;

// getLogs for one window with bounded retry/backoff. Absorbs a transient
// free-tier blip (the 408/5xx that used to stall the whole tick) without
// advancing the checkpoint past an unread window — so no events are ever
// silently skipped (a skip-and-advance would lose data). `sleep` is injectable
// for tests. Throws after the last attempt; the caller leaves the checkpoint
// before the failed window so the next tick retries it.
async function getLogsWithRetry(provider, params, sleep = ms => new Promise(r => setTimeout(r, ms))) {
  let lastErr;
  for (let attempt = 0; attempt < LOG_WINDOW_RETRIES; attempt++) {
    try { return await provider.getLogs(params); }
    catch (err) { lastErr = err; if (attempt < LOG_WINDOW_RETRIES - 1) await sleep(250 * (attempt + 1)); }
  }
  throw lastErr;
}

// Cursor-based indexing pass, mirroring pollChain but DB-only and using a
// separate checkpoint so it can backfill from startBlock without re-emailing.
async function indexChain(chainId, provider, contract, iface, opts = {}) {
  if ((CHAINS[chainId] || {}).bondVersion !== 6) return; // v6 read-model only
  const sleep = opts.sleep;
  const confirmations = CONFIRMATION_BLOCKS[chainId] || 12;
  let latestBlock;
  try { latestBlock = await provider.getBlockNumber(); }
  catch (err) { console.error(`[index] chain ${chainId} block number failed:`, err.message); return; }

  // Record the observed head so /health can report indexer lag even when
  // there's nothing new to scan.
  db.setChainHead(chainId, latestBlock);

  const safeBlock = latestBlock - confirmations;
  const checkpoint = db.getIndexCheckpoint(chainId);
  const fromBlock = checkpoint !== null ? checkpoint + 1 : CHAINS[chainId].startBlock;
  if (fromBlock > safeBlock) return;

  let cursor = fromBlock;
  while (cursor <= safeBlock) {
    const toBlock = Math.min(cursor + BLOCK_CHUNK - 1, safeBlock);
    try {
      const logs = await getLogsWithRetry(provider, { address: CHAINS[chainId].contract, fromBlock: cursor, toBlock }, sleep);
      if (logs.length > 0) await indexLogs(contract, chainId, logs, iface);
      db.setIndexCheckpoint(chainId, toBlock);
    } catch (err) {
      // Window still failing after retries — stop this tick WITHOUT advancing
      // the checkpoint so the next tick resumes from here. No data is skipped;
      // a persistent stall is surfaced via the health lag signal (tier d).
      console.error(`[index] chain ${chainId} scan ${cursor}–${toBlock} failed after retries:`, err.message);
      break;
    }
    cursor = toBlock + 1;
  }
}

// Build the read provider for a chain. A single RPC yields a hardened
// JsonRpcProvider (static network avoids a per-call eth_chainId; small batch
// cap keeps free-tier endpoints happy). Two or more RPCs yield an
// ethers.FallbackProvider with quorum:1 so a single healthy endpoint serves
// reads — browse/detail/notifications keep flowing through a single-RPC outage
// instead of going blank/stale (RCA gap #1). Endpoints are tried in ascending
// priority (rpcs[0] preferred), and each child uses staticNetwork so it never
// probes the chain id at runtime.
function buildProvider(chainId, cfg) {
  const rpcs = (cfg.rpcs && cfg.rpcs.length) ? cfg.rpcs : [cfg.rpc];
  const network = ethers.Network.from(chainId);
  if (rpcs.length === 1) {
    return new ethers.JsonRpcProvider(rpcs[0], network, { staticNetwork: true, batchMaxCount: 3 });
  }
  const configs = rpcs.map((url, i) => ({
    provider: new ethers.JsonRpcProvider(url, network, { staticNetwork: true, batchMaxCount: 3 }),
    priority: i + 1, // ascending: rpcs[0] is preferred
    stallTimeout: 2000,
    weight: 1,
  }));
  return new ethers.FallbackProvider(configs, network, { quorum: 1 });
}

export { indexChain, indexLogs, indexBondState, getLogsWithRetry, buildProvider };

/**
 * For a given event, resolve the set of wallet addresses that should be notified.
 */
async function resolveRecipients(contract, eventName, parsedLog, bondId) {
  const addresses = new Set();
  const roles = EVENT_RECIPIENTS[eventName] || [];

  let bond;
  try {
    bond = await contract.bonds(bondId);
  } catch (err) {
    console.error(`[watcher] Failed to read bond ${bondId}:`, err.message);
    return [];
  }

  for (const role of roles) {
    if (role === 'poster') {
      if (bond.poster) addresses.add(bond.poster.toLowerCase());
    } else if (role === 'judge') {
      if (bond.judge) addresses.add(bond.judge.toLowerCase());
    } else if (role === 'challenger') {
      // Single challenger from event args
      const challenger = parsedLog.args.challenger;
      if (challenger) addresses.add(challenger.toLowerCase());
    } else if (role === 'challengers') {
      // All challengers for this bond
      try {
        const count = await contract.getChallengeCount(bondId);
        for (let i = 0; i < Number(count); i++) {
          const ch = await contract.getChallenge(bondId, i);
          if (ch.challenger) addresses.add(ch.challenger.toLowerCase());
        }
      } catch (err) {
        console.error(`[watcher] Failed to read challenges for bond ${bondId}:`, err.message);
      }
    }
  }

  return [...addresses];
}

/**
 * Process a batch of logs from a single chain.
 */
async function processLogs(contract, chainId, logs, iface) {
  for (const log of logs) {
    let parsed;
    try {
      parsed = iface.parseLog({ topics: log.topics, data: log.data });
    } catch {
      continue; // skip unrecognized logs
    }
    if (!parsed) continue; // ethers v6 returns null for unmatched logs

    const eventName = parsed.name;
    if (!EVENT_RECIPIENTS[eventName]) continue;

    const bondId = Number(parsed.args.bondId);
    const recipients = await resolveRecipients(contract, eventName, parsed, bondId);
    if (recipients.length === 0) continue;

    // Get bond metadata for email. v0.5 bonds expose a `metadata` string;
    // v0.6 bonds expose `claimHash` (bytes32) with raw content emitted only in
    // events. Fall back to the event content/contentHash when available.
    let metadata = '';
    try {
      const bond = await contract.bonds(bondId);
      if (bond.metadata) metadata = bond.metadata;
      else if (parsed.args.content) metadata = parsed.args.content;
      else if (parsed.args.claimContent) metadata = parsed.args.claimContent;
      else if (bond.claimHash) metadata = bond.claimHash;
    } catch {
      if (parsed.args.content) metadata = parsed.args.content;
      else if (parsed.args.claimContent) metadata = parsed.args.claimContent;
    }

    // Look up verified subscriptions for these addresses
    const subs = db.getVerifiedSubscriptions(chainId, recipients);
    if (subs.length === 0) continue;

    for (const sub of subs) {
      const { subject, html } = eventEmail(eventName, bondId, chainId, metadata, sub.wallet_address);
      const msgId = await sendEmail(sub.email, subject, html);
      if (msgId) {
        db.logEmail(sub.wallet_address, chainId, bondId, eventName, msgId);
        console.log(`[watcher] Sent ${eventName} email to ${sub.email} for bond #${bondId} on chain ${chainId}`);
      }
    }
  }
}

/**
 * Poll a single chain for new events.
 */
async function pollChain(chainId, provider, contract, iface) {
  const confirmations = CONFIRMATION_BLOCKS[chainId] || 12;

  let latestBlock;
  try {
    latestBlock = await provider.getBlockNumber();
  } catch (err) {
    console.error(`[watcher] Failed to get block number for chain ${chainId}:`, err.message);
    return;
  }

  const safeBlock = latestBlock - confirmations;
  const checkpoint = db.getCheckpoint(chainId);
  const fromBlock = checkpoint !== null ? checkpoint + 1 : CHAINS[chainId].startBlock;

  if (fromBlock > safeBlock) return; // nothing new

  // Process in chunks
  let cursor = fromBlock;
  while (cursor <= safeBlock) {
    const toBlock = Math.min(cursor + BLOCK_CHUNK - 1, safeBlock);
    console.log(`[watcher] Chain ${chainId}: scanning blocks ${cursor}–${toBlock}`);

    try {
      const logs = await provider.getLogs({
        address: CHAINS[chainId].contract,
        fromBlock: cursor,
        toBlock,
      });

      if (logs.length > 0) {
        await processLogs(contract, chainId, logs, iface);
      }

      db.setCheckpoint(chainId, toBlock);
    } catch (err) {
      console.error(`[watcher] Chain ${chainId} error scanning ${cursor}–${toBlock}:`, err.message);
      break; // retry next poll
    }

    cursor = toBlock + 1;
  }
}

/**
 * Start the event watcher for all configured chains.
 */
// `providers` is an optional chainId->provider map (mirrors how `sleep` is
// threaded into getLogsWithRetry/indexChain): tests inject fakes; production
// leaves it empty and gets a per-chain FallbackProvider from buildProvider.
export function startWatcher(providers = {}) {
  const chainEntries = Object.entries(CHAINS).map(([id, cfg]) => {
    const chainId = parseInt(id, 10);
    const abi = abiForChain(chainId);
    const provider = providers[chainId] || buildProvider(chainId, cfg);
    const contract = new ethers.Contract(cfg.contract, abi, provider);
    const iface = new ethers.Interface(abi);
    return { chainId, provider, contract, iface };
  });

  console.log(`[watcher] Starting event watcher for chains: ${chainEntries.map(c => c.chainId).join(', ')}`);

  async function tick() {
    for (const { chainId, provider, contract, iface } of chainEntries) {
      // Index first so the read-model is fresh, then emails. Index errors
      // must not block the email path (and vice-versa).
      try { await indexChain(chainId, provider, contract, iface); }
      catch (err) { console.error(`[index] chain ${chainId} tick error:`, err.message); }
      await pollChain(chainId, provider, contract, iface);
    }
  }

  // Initial poll
  tick().catch(err => console.error('[watcher] Initial poll error:', err.message));

  // Recurring
  setInterval(() => {
    tick().catch(err => console.error('[watcher] Poll error:', err.message));
  }, POLL_INTERVAL_MS);
}
