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

// Marker for a failure in the indexLogs/DB layer (a bonds() read or a SQLite
// write) as distinct from a getLogs-layer failure. Sub-chunking a block range
// only helps a getLogs "too large / transient on a big range" failure; halving
// will never fix a contract.bonds() RPC miss or a DB error, so these must
// surface and break the tick (no-skip: checkpoint held, retried next tick)
// rather than being misclassified as a poison block and dead-lettered (B2).
class IndexLayerError extends Error {
  constructor(cause) {
    super(cause?.message || String(cause));
    this.name = 'IndexLayerError';
    this.cause = cause;
  }
}

// Snapshot one bond's current state from chain into the read-model. `claim`
// carries claim text pulled from the triggering event (the struct only has a
// hash); pass undefined to leave any stored text untouched.
async function indexBondState(contract, chainId, bondId, claim) {
  let b;
  try {
    b = await contract.bonds(bondId);
  } catch (err) {
    // A transient bonds() miss must NOT be silently dropped (it would leave the
    // bond unindexed until a later event re-triggers it — a latent RC1-class
    // gap). Surface it AND throw so the scan breaks WITHOUT advancing the
    // checkpoint past this window: the next tick re-reads the same range and
    // retries this bond. Tagged IndexLayerError so it is not sub-chunked.
    console.error(`[index] chain ${chainId} bond ${bondId} read failed:`, err.message);
    throw new IndexLayerError(err);
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
//
// v0.7 C2 ledger events:
//   • Credited carries an indexed `bondId` → it flows through the snapshot path
//     below exactly like any other bond event, re-reading bonds()/challenges so
//     the credited-out state (settled/closed/pendingCount/challenge statuses) is
//     fresh. No bespoke handling needed; no crash.
//   • Claimed has NO `bondId` (it is a per-token aggregate pull) → the
//     `parsed.args.bondId == null` guard below skips it cleanly. There is no bond
//     to re-snapshot from a Claimed event, so skipping is correct and crash-free.
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

// Marker the recovery scan throws when even a single block fails getLogs after
// retries — a true poison block. Carries the floor range + underlying error so
// the caller can dead-letter it and stop without advancing the checkpoint.
class PoisonBlockError extends Error {
  constructor(fromBlock, toBlock, cause) {
    super(`poison block range ${fromBlock}-${toBlock}: ${cause?.message || cause}`);
    this.name = 'PoisonBlockError';
    this.fromBlock = fromBlock;
    this.toBlock = toBlock;
    this.cause = cause;
  }
}

// Scan one [fromBlock..toBlock] range, recovering from "too large / transient on
// a big range" failures by HALVING the window and retrying each half recursively
// down to a 1-block floor. getLogsWithRetry (B1 bounded retry) absorbs short
// blips; only when a half still fails after retries do we sub-chunk further.
// Ordering is preserved (lower half processed before the upper half) and each
// successful sub-range is fed through the existing indexLogs path immediately.
// A range that fails even at the 1-block floor is a true poison block and is
// re-thrown as a PoisonBlockError so the caller can dead-letter it (no-skip).
async function scanWindowRecovering(provider, contract, chainId, iface, fromBlock, toBlock, sleep) {
  let logs;
  try {
    // ONLY the getLogs layer is eligible for sub-chunk/dead-letter recovery: a
    // "too large / transient on a big range" failure is what halving fixes.
    logs = await getLogsWithRetry(provider, { address: CHAINS[chainId].contract, fromBlock, toBlock }, sleep);
  } catch (err) {
    if (fromBlock >= toBlock) {
      // 1-block floor reached and still failing — a genuine poison block.
      throw new PoisonBlockError(fromBlock, toBlock, err);
    }
    console.warn(`[index] chain ${chainId} window ${fromBlock}-${toBlock} failed after retries; sub-chunking:`, err.message);
    const mid = Math.floor((fromBlock + toBlock) / 2);
    // Process lower half first to preserve event ordering, then the upper half.
    await scanWindowRecovering(provider, contract, chainId, iface, fromBlock, mid, sleep);
    await scanWindowRecovering(provider, contract, chainId, iface, mid + 1, toBlock, sleep);
    return;
  }

  // indexLogs is the DB/RPC-read layer. A failure here (a contract.bonds() miss
  // or a SQLite write error) is NOT helped by halving the block range, so it
  // must NOT be sub-chunked or dead-lettered as a poison block. Surface it as an
  // IndexLayerError so the caller breaks the tick WITHOUT advancing the
  // checkpoint (no-skip: the next tick re-reads this window) (B2).
  if (logs.length > 0) {
    try {
      await indexLogs(contract, chainId, logs, iface);
    } catch (err) {
      if (err instanceof IndexLayerError) throw err;
      throw new IndexLayerError(err);
    }
  }
  return;
}

// Cursor-based indexing pass, mirroring pollChain but DB-only and using a
// separate checkpoint so it can backfill from startBlock without re-emailing.
async function indexChain(chainId, provider, contract, iface, opts = {}) {
  // Read-model covers the modern struct shape (bondVersion 6 AND 7 — their Bond /
  // Challenge view shapes are identical). v0.5 (Gnosis) keeps its legacy struct and
  // is retired from the UI, so it is not indexed.
  const bv = (CHAINS[chainId] || {}).bondVersion;
  if (bv !== 6 && bv !== 7) return;
  const sleep = opts.sleep;
  const confirmations = CONFIRMATION_BLOCKS[chainId] || 12;
  let latestBlock;
  try { latestBlock = await provider.getBlockNumber(); }
  catch (err) { console.error(`[index] chain ${chainId} block number failed:`, err.message); return; }

  // Record the observed head so /health can report indexer lag even when
  // there's nothing new to scan.
  db.setChainHead(chainId, latestBlock);

  const safeBlock = latestBlock - confirmations;

  // Re-attempt any previously dead-lettered ranges first: a poison block is
  // often transient infra, so retry it on a later tick and clear the entry when
  // it finally succeeds. A dead-letter that is still poison stays recorded and
  // the cursor below will not advance past it (no-skip invariant preserved).
  let blocked = false;
  for (const dl of db.getDeadLetters(chainId)) {
    try {
      await scanWindowRecovering(provider, contract, chainId, iface, dl.from_block, dl.to_block, sleep);
      db.clearDeadLetter(chainId, dl.from_block, dl.to_block);
      console.log(`[index] chain ${chainId} dead-letter ${dl.from_block}-${dl.to_block} recovered and cleared`);
    } catch (err) {
      const p = err instanceof PoisonBlockError ? err : null;
      db.recordDeadLetter(chainId, dl.from_block, dl.to_block, (p ? p.cause : err)?.message || String(err));
      console.error(`[index] chain ${chainId} dead-letter ${dl.from_block}-${dl.to_block} still failing:`, err.message);
      blocked = true;
    }
  }

  const checkpoint = db.getIndexCheckpoint(chainId);
  const fromBlock = checkpoint !== null ? checkpoint + 1 : CHAINS[chainId].startBlock;
  if (fromBlock > safeBlock) return;

  let cursor = fromBlock;
  while (cursor <= safeBlock) {
    const toBlock = Math.min(cursor + BLOCK_CHUNK - 1, safeBlock);
    try {
      // Recover from large/transient window failures by sub-chunking; only a
      // 1-block-floor failure surfaces as a PoisonBlockError.
      await scanWindowRecovering(provider, contract, chainId, iface, cursor, toBlock, sleep);
      db.setIndexCheckpoint(chainId, toBlock);
    } catch (err) {
      if (err instanceof PoisonBlockError) {
        // A true poison block: record it and STOP this tick WITHOUT advancing
        // the checkpoint past it, so no events are ever silently skipped. The
        // dead-letter surfaces the blocked range via /health for a human/monitor
        // and is re-attempted on a later tick (poison is often transient infra).
        db.recordDeadLetter(chainId, err.fromBlock, err.toBlock, err.cause?.message || String(err.cause));
        console.error(`[index] chain ${chainId} poison block ${err.fromBlock}-${err.toBlock} dead-lettered (checkpoint held):`, err.cause?.message || err.message);
      } else if (err instanceof IndexLayerError) {
        // A DB/read-layer failure (e.g. a transient contract.bonds() miss or a
        // SQLite write error). Halving the range would not help, so it is NOT
        // dead-lettered as a poison block. Surface it and hold the checkpoint —
        // the next tick re-reads this same window and retries (no-skip).
        console.error(`[index] chain ${chainId} index/DB layer error scanning ${cursor}–${toBlock} (checkpoint held, will retry):`, err.message);
      } else {
        console.error(`[index] chain ${chainId} scan ${cursor}–${toBlock} failed:`, err.message);
      }
      // Stop this tick without advancing — next tick resumes from `cursor`.
      break;
    }
    cursor = toBlock + 1;
  }
  if (blocked) return; // keep the blocked indicator surfaced for the monitor
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
