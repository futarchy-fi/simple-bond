import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load secrets from env file if present
const SECRETS_PATH = '/home/ubuntu/.openclaw/workspace/infra/secrets/env/secrets.env';
try {
  const lines = readFileSync(SECRETS_PATH, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

export const PORT = parseInt(process.env.BOND_NOTIFY_PORT || '3200', 10);
export const HOST = process.env.BOND_NOTIFY_HOST || '127.0.0.1';

export const HMAC_SECRET = process.env.BOND_NOTIFY_HMAC_SECRET || 'change-me-in-production';
export const FROM_EMAIL = process.env.BOND_NOTIFY_FROM || 'noreply@futarchy.ai';
export const SES_REGION = 'us-east-1';

function trimTrailingSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

export const NOTIFY_BASE_URL = trimTrailingSlash(process.env.BOND_NOTIFY_BASE_URL || 'https://bond.futarchy.ai');
export const FRONTEND_BASE_URL = trimTrailingSlash(process.env.SIMPLE_BOND_FRONTEND_URL || 'https://bond.futarchy.ai');

// Override with BOND_NOTIFY_DB_PATH (tests use a temp file for isolation).
export const DB_PATH = process.env.BOND_NOTIFY_DB_PATH
  ? resolve(process.env.BOND_NOTIFY_DB_PATH)
  : resolve(__dirname, '..', 'data', 'bond-notify.db');

export const POLL_INTERVAL_MS = 30_000;
export const CONFIRMATION_BLOCKS = { 100: 12, 1: 12, 11155111: 6 };
export const BLOCK_CHUNK = 10_000;
export const TIMESTAMP_WINDOW_SEC = 300; // 5 minutes
export const RATE_LIMIT_MAX = 3; // per IP per hour

// Resolve a chain's RPC endpoint list from env, with graceful fallback.
// Precedence: comma-separated <CHAIN>_RPCS (multi-endpoint, for the watcher's
// FallbackProvider) → single <CHAIN>_RPC (back-compat) → the hardcoded public
// default. Returns a non-empty string[] of de-duped, trimmed URLs. Keys are
// read here on the backend only and never surface to the frontend bundle.
function resolveRpcs(listEnv, singleEnv, fallback) {
  const fromList = String(listEnv || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (fromList.length > 0) return [...new Set(fromList)];
  const single = String(singleEnv || '').trim();
  if (single) return [single];
  return [fallback];
}

// CHAINS is assembled at import time. Gnosis v0.5 stays hardcoded for now
// (will be removed in Phase 11). Mainnet v0.6 and Sepolia v0.6 enter the map
// only when the corresponding env vars are set, so the watcher can run
// safely before the v0.6 deployment.
//
// Each chain config exposes `rpcs` (non-empty string[]) used by the watcher to
// build a multi-RPC FallbackProvider; `rpc` stays as rpcs[0] for back-compat.
const _CHAINS = {
  100: {
    name: 'Gnosis',
    rpcs: ['https://rpc.gnosischain.com'],
    rpc: 'https://rpc.gnosischain.com',
    contract: '0x7dF485C013f8671B656d585f1d1411640B1D2776',
    startBlock: 45569363,
    explorer: 'https://gnosisscan.io',
    bondVersion: 5,
  },
};

if (process.env.MAINNET_V6_CONTRACT) {
  const rpcs = resolveRpcs(process.env.MAINNET_RPCS, process.env.MAINNET_RPC, 'https://eth.llamarpc.com');
  _CHAINS[1] = {
    name: 'Ethereum',
    rpcs,
    rpc: rpcs[0],
    contract: process.env.MAINNET_V6_CONTRACT,
    startBlock: parseInt(process.env.MAINNET_V6_START_BLOCK || '0', 10),
    explorer: 'https://etherscan.io',
    bondVersion: 6,
  };
}

if (process.env.SEPOLIA_V6_CONTRACT) {
  // Sepolia stays on the free publicnode default unless SEPOLIA_RPCS is given.
  const rpcs = resolveRpcs(process.env.SEPOLIA_RPCS, process.env.SEPOLIA_RPC, 'https://ethereum-sepolia-rpc.publicnode.com');
  _CHAINS[11155111] = {
    name: 'Sepolia',
    rpcs,
    rpc: rpcs[0],
    contract: process.env.SEPOLIA_V6_CONTRACT,
    startBlock: parseInt(process.env.SEPOLIA_V6_START_BLOCK || '0', 10),
    explorer: 'https://sepolia.etherscan.io',
    bondVersion: 6,
  };
}

// v0.7 cutover: when SEPOLIA_V7_CONTRACT is set, Sepolia flips to bondVersion 7
// pointing at the new SimpleBondV7 (reusing the v6 registries). Takes precedence
// over the v6 Sepolia entry. Mainnet (chain 1) is intentionally NOT switched
// here — mainnet cutover is a separate later gate.
if (process.env.SEPOLIA_V7_CONTRACT) {
  const rpcs = resolveRpcs(process.env.SEPOLIA_RPCS, process.env.SEPOLIA_RPC, 'https://ethereum-sepolia-rpc.publicnode.com');
  _CHAINS[11155111] = {
    name: 'Sepolia',
    rpcs,
    rpc: rpcs[0],
    contract: process.env.SEPOLIA_V7_CONTRACT,
    startBlock: parseInt(process.env.SEPOLIA_V7_START_BLOCK || '0', 10),
    explorer: 'https://sepolia.etherscan.io',
    bondVersion: 7,
  };
}

// Mainnet v0.7 cutover gate: chain 1 flips to bondVersion 7 ONLY when
// MAINNET_V7_CONTRACT is explicitly set (takes precedence over the v6 entry).
// Cutover runbook (AUDIT-v7-2026-06.md §6, owner decision 2026-06-10: old bonds
// are NOT re-served; judges keep working — judge_profiles and the on-chain
// registries are untouched by the cutover):
//   1. settle/withdraw any live v6 bonds (v6 stays on-chain regardless),
//   2. back up the DB, purge chain-1 rows from bonds/challenges ONLY,
//   3. reset chain-1 checkpoints + index_checkpoints to v7 deployBlock-1,
//   4. set MAINNET_V7_CONTRACT / MAINNET_V7_START_BLOCK and restart.
if (process.env.MAINNET_V7_CONTRACT) {
  const rpcs = resolveRpcs(process.env.MAINNET_RPCS, process.env.MAINNET_RPC, 'https://eth.llamarpc.com');
  _CHAINS[1] = {
    name: 'Ethereum',
    rpcs,
    rpc: rpcs[0],
    contract: process.env.MAINNET_V7_CONTRACT,
    startBlock: parseInt(process.env.MAINNET_V7_START_BLOCK || '0', 10),
    explorer: 'https://etherscan.io',
    bondVersion: 7,
  };
}

export const CHAINS = _CHAINS;

// SimpleBondV5 ABI subset — only events + view functions the email watcher needs.
export const V5_CONTRACT_ABI = [
  "event BondCreated(uint256 indexed bondId, address indexed poster, address indexed judge, address token, uint256 bondAmount, uint256 challengeAmount, uint256 judgeFee, uint256 deadline, uint256 acceptanceDelay, uint256 rulingBuffer, string metadata)",
  "event Challenged(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger, string metadata)",
  "event ClaimConceded(uint256 indexed bondId, address indexed poster, string metadata)",
  "event RuledForChallenger(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger, uint256 feeCharged)",
  "event RuledForPoster(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger, uint256 feeCharged)",
  "event ChallengeRefunded(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger)",
  "event BondWithdrawn(uint256 indexed bondId)",
  "event BondTimedOut(uint256 indexed bondId)",
  "event BondRejectedByJudge(uint256 indexed bondId, address indexed judge)",
  "function bonds(uint256) view returns (address poster, address judge, address token, uint256 bondAmount, uint256 challengeAmount, uint256 judgeFee, uint256 deadline, uint256 acceptanceDelay, uint256 rulingBuffer, string metadata, bool settled, bool conceded, uint256 currentChallenge, uint256 lastChallengeTime)",
  "function getChallengeCount(uint256 bondId) view returns (uint256)",
  "function getChallenge(uint256 bondId, uint256 index) view returns (address challenger, uint8 status, string metadata)",
];

// SimpleBondV6 ABI subset — v0.6 events. Field shapes differ from v0.5
// (BondCreated drops `deadline`, adds judgeProfileId/maxChallenges/claimHash;
// rulings carry content + contentHash; new events for ClaimModified,
// ChallengeRejected, BondClosed, BondOpened.)
export const V6_CONTRACT_ABI = [
  "event BondCreated(uint256 indexed bondId, address indexed poster, address indexed judge, uint256 judgeProfileId, address token, uint256 bondAmount, uint256 challengeAmount, uint256 judgeFee, uint256 acceptanceDelay, uint256 rulingBuffer, uint256 maxChallenges, bytes32 claimHash, string claimContent)",
  "event ClaimModified(uint256 indexed bondId, uint256 oldVersion, uint256 newVersion, bytes32 oldHash, bytes32 newHash, string newContent)",
  "event Challenged(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger, uint256 expectedVersion, bytes32 claimHashAtChallenge, bytes32 metadataHash, string content)",
  "event ClaimConceded(uint256 indexed bondId, uint256 challengeIndex, address indexed poster, bytes32 contentHash, string content)",
  "event RuledForPoster(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger, uint256 feeCharged, bytes32 contentHash, string content)",
  "event RuledForChallenger(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger, uint256 feeCharged, bytes32 contentHash, string content)",
  "event ChallengeRejected(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger, bytes32 contentHash, string content)",
  "event BondRejectedByJudge(uint256 indexed bondId, address indexed judge, bytes32 contentHash, string content)",
  "event BondClosed(uint256 indexed bondId)",
  "event BondOpened(uint256 indexed bondId)",
  "event BondWithdrawn(uint256 indexed bondId)",
  "event BondTimedOut(uint256 indexed bondId, uint256 challengeIndex)",
  "event ChallengeRefunded(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger)",
  // View functions — needed by the watcher to resolve recipients and by the
  // indexing pass to snapshot current bond/challenge state. Must match the
  // on-chain SimpleBondV6 + frontend ABI exactly.
  "function bonds(uint256) view returns (address poster, address judge, address token, uint256 bondAmount, uint256 challengeAmount, uint256 judgeFee, uint256 acceptanceDelay, uint256 rulingBuffer, uint256 maxChallenges, bytes32 claimHash, uint256 claimVersion, uint256 judgeProfileId, uint256 pendingCount, bool settled, bool closed)",
  "function getChallengeCount(uint256 bondId) view returns (uint256)",
  "function getChallenge(uint256 bondId, uint256 index) view returns (tuple(address challenger, uint8 status, uint256 timestamp, uint256 challengeAtVersion, bytes32 claimHashAtChallenge, bytes32 metadataHash, bytes32 rulingMetadataHash))",
];

// SimpleBondV7 ABI subset — v0.7 events + view functions the watcher/indexer need.
// Same surface as v0.6 EXCEPT:
//   • ChallengeRefunded is REMOVED (v0.7 replaces the per-challenge push refund with
//     the C2 credit ledger; refunds now surface as Credited, not ChallengeRefunded).
//   • Two NEW events for the C2 pull-payment ledger:
//       Credited(token, recipient, bondId, challengeIndex, amount) — value accrued to a
//         recipient's claimable balance (carries bondId so the indexer can re-snapshot it).
//       Claimed(token, recipient, amount) — recipient pulled their full credited balance
//         (NO bondId — a per-token aggregate, so the indexer must skip it cleanly).
// The bonds()/getChallengeCount/getChallenge view shapes are IDENTICAL to v0.6
// (the Bond/Challenge structs in SimpleBondV7.sol match SimpleBondV6 field-for-field),
// so indexBondState snapshots a v7 bond unchanged.
export const V7_CONTRACT_ABI = [
  "event BondCreated(uint256 indexed bondId, address indexed poster, address indexed judge, uint256 judgeProfileId, address token, uint256 bondAmount, uint256 challengeAmount, uint256 judgeFee, uint256 acceptanceDelay, uint256 rulingBuffer, uint256 maxChallenges, bytes32 claimHash, string claimContent)",
  "event ClaimModified(uint256 indexed bondId, uint256 oldVersion, uint256 newVersion, bytes32 oldHash, bytes32 newHash, string newContent)",
  "event Challenged(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger, uint256 expectedVersion, bytes32 claimHashAtChallenge, bytes32 metadataHash, string content)",
  "event ClaimConceded(uint256 indexed bondId, uint256 challengeIndex, address indexed poster, bytes32 contentHash, string content)",
  "event RuledForPoster(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger, uint256 feeCharged, bytes32 contentHash, string content)",
  "event RuledForChallenger(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger, uint256 feeCharged, bytes32 contentHash, string content)",
  "event ChallengeRejected(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger, bytes32 contentHash, string content)",
  "event BondRejectedByJudge(uint256 indexed bondId, address indexed judge, bytes32 contentHash, string content)",
  "event BondClosed(uint256 indexed bondId)",
  "event BondOpened(uint256 indexed bondId)",
  "event BondWithdrawn(uint256 indexed bondId)",
  "event BondTimedOut(uint256 indexed bondId, uint256 challengeIndex)",
  // C2 pull-payment ledger events (new in v0.7; replace ChallengeRefunded).
  "event Credited(address indexed token, address indexed recipient, uint256 indexed bondId, uint256 challengeIndex, uint256 amount)",
  "event Claimed(address indexed token, address indexed recipient, uint256 amount)",
  // View functions — same shapes as SimpleBondV6 (confirmed against SimpleBondV7.sol
  // Bond/Challenge structs). The indexer snapshots a v7 bond/challenge unchanged.
  "function bonds(uint256) view returns (address poster, address judge, address token, uint256 bondAmount, uint256 challengeAmount, uint256 judgeFee, uint256 acceptanceDelay, uint256 rulingBuffer, uint256 maxChallenges, bytes32 claimHash, uint256 claimVersion, uint256 judgeProfileId, uint256 pendingCount, bool settled, bool closed)",
  "function getChallengeCount(uint256 bondId) view returns (uint256)",
  "function getChallenge(uint256 bondId, uint256 index) view returns (tuple(address challenger, uint8 status, uint256 timestamp, uint256 challengeAtVersion, bytes32 claimHashAtChallenge, bytes32 metadataHash, bytes32 rulingMetadataHash))",
];

/// Returns the ABI to use for a given chain id.
///
/// Explicit per-version switch (NOT a binary ternary): a chain marked
/// bondVersion:7 MUST resolve to V7 so Credited/Claimed (and all the v6 events)
/// decode. The old `v===6 ? V6 : V5` shape would have silently fallen a v7 chain
/// through to the V5 ABI — see SPEC_V07 "the trap to avoid".
export function abiForChain(chainId) {
  const v = (CHAINS[chainId] || {}).bondVersion || 5;
  if (v === 7) return V7_CONTRACT_ABI;
  if (v === 6) return V6_CONTRACT_ABI;
  return V5_CONTRACT_ABI;
}

// Back-compat: the existing watcher imports `CONTRACT_ABI`. Keep that export
// pointing at v5 so the Gnosis path is unchanged; the watcher should switch to
// `abiForChain(chainId)` per chain in a follow-up.
export const CONTRACT_ABI = V5_CONTRACT_ABI;

// Events we watch and who gets notified. v0.5 and v0.6 share event names where
// possible; v0.6 also emits ClaimModified, ChallengeRejected, BondClosed, BondOpened.
// v0.7: ChallengeRefunded is GONE on-chain but its entry STAYS here — it is keyed by
// event name, so the still-deployed v6 path keeps notifying refunded challengers; a v7
// chain simply never emits it (a harmless unused key). v0.7's new Credited/Claimed
// events are intentionally ABSENT from this map: they are ledger bookkeeping, not
// human-notifiable lifecycle events, so processLogs skips them (no email). The indexer
// still re-snapshots the bond on Credited (see indexLogs).
export const EVENT_RECIPIENTS = {
  BondCreated:        ['judge'],
  Challenged:         ['poster', 'judge'],
  ClaimConceded:      ['challengers', 'judge'],
  ClaimModified:      ['judge'],
  RuledForChallenger: ['poster', 'challenger'],
  RuledForPoster:     ['poster', 'challenger'],
  ChallengeRejected:  ['challenger', 'poster'],
  ChallengeRefunded:  ['challenger'],
  BondWithdrawn:      ['poster'],
  BondTimedOut:       ['poster', 'challengers'],
  BondRejectedByJudge:['poster', 'challengers'],
  BondClosed:         ['judge'],
  BondOpened:         ['judge'],
};
