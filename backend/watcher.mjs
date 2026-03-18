import { ethers } from 'ethers';
import { CHAINS, CONTRACT_ABI, CONFIRMATION_BLOCKS, BLOCK_CHUNK, POLL_INTERVAL_MS, EVENT_RECIPIENTS } from './config.mjs';
import db from './db.mjs';
import { sendEmail } from './mailer.mjs';
import { eventEmail } from './templates.mjs';

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
      addresses.add(bond.poster.toLowerCase());
    } else if (role === 'judge') {
      addresses.add(bond.judge.toLowerCase());
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
          addresses.add(ch.challenger.toLowerCase());
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

    // Get bond metadata for email
    let metadata = '';
    try {
      const bond = await contract.bonds(bondId);
      metadata = bond.metadata || '';
    } catch {}

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
export function startWatcher() {
  const iface = new ethers.Interface(CONTRACT_ABI);
  const chainEntries = Object.entries(CHAINS).map(([id, cfg]) => {
    const chainId = parseInt(id, 10);
    const provider = new ethers.JsonRpcProvider(cfg.rpc);
    const contract = new ethers.Contract(cfg.contract, CONTRACT_ABI, provider);
    return { chainId, provider, contract };
  });

  console.log(`[watcher] Starting event watcher for chains: ${chainEntries.map(c => c.chainId).join(', ')}`);

  async function tick() {
    for (const { chainId, provider, contract } of chainEntries) {
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
