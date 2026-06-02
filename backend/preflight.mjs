// Boot-time configuration guard. The watcher/API silently ran misconfigured
// in the past (no v6 chain registered → empty read-model served as HTTP 200;
// startBlock 0 → a full-chain backfill; default HMAC). This refuses to boot in
// production on a dangerous misconfig, and warns on a soft one (unkeyed RPC).
//
// Production is signalled by BOND_NOTIFY_ENV=production (set in the VM env so
// dev and tests, which don't set it, only get warnings — never a hard exit).

import { CHAINS, HMAC_SECRET } from './config.mjs';

const FREE_RPC_HOSTS = [
  'publicnode.com', 'llamarpc.com', 'rpc.ankr.com', 'cloudflare-eth.com',
  'drpc.org', '1rpc.io', 'rpc.gnosischain.com', 'sepolia-rpc',
];

export function collectConfigIssues(chains = CHAINS) {
  const hard = [];
  const soft = [];

  const v6 = Object.entries(chains).filter(([, c]) => c.bondVersion === 6);
  if (v6.length === 0) {
    hard.push('No v0.6 chain registered (MAINNET_V6_CONTRACT / SEPOLIA_V6_CONTRACT unset) — the read-model would be empty.');
  }
  for (const [id, c] of v6) {
    if (!c.startBlock || c.startBlock === 0) {
      hard.push(`chain ${id}: startBlock is 0 — indexing would scan from genesis. Set MAINNET_V6_START_BLOCK / SEPOLIA_V6_START_BLOCK.`);
    }
    const host = (() => { try { return new URL(c.rpc).host; } catch { return c.rpc; } })();
    if (FREE_RPC_HOSTS.some(h => host.includes(h))) {
      soft.push(`chain ${id}: RPC ${host} is an unkeyed free endpoint — rate/range/timeout limits caused incidents I2/I3/I9/I10. Provision a keyed RPC.`);
    }
  }
  if ((HMAC_SECRET || '') === 'change-me-in-production') {
    hard.push('BOND_NOTIFY_HMAC_SECRET is still the default placeholder.');
  }
  return { hard, soft };
}

// Enforce at boot. Returns the issues; exits the process on a hard issue in prod.
export function assertBootConfig({ chains = CHAINS, env = process.env, exit = true } = {}) {
  const isProd = env.BOND_NOTIFY_ENV === 'production' || env.NODE_ENV === 'production';
  const { hard, soft } = collectConfigIssues(chains);
  for (const s of soft) console.warn(`[preflight] WARN: ${s}`);
  for (const h of hard) console.error(`[preflight] ${isProd ? 'FATAL' : 'WARN'}: ${h}`);
  if (hard.length && isProd) {
    console.error('[preflight] Refusing to boot in production with the above misconfiguration.');
    if (exit) process.exit(1);
  }
  return { hard, soft, isProd };
}
