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

// CHAINS is assembled at import time. Gnosis v0.5 stays hardcoded for now
// (will be removed in Phase 11). Mainnet v0.6 and Sepolia v0.6 enter the map
// only when the corresponding env vars are set, so the watcher can run
// safely before the v0.6 deployment.
const _CHAINS = {
  100: {
    name: 'Gnosis',
    rpc: 'https://rpc.gnosischain.com',
    contract: '0x7dF485C013f8671B656d585f1d1411640B1D2776',
    startBlock: 45569363,
    explorer: 'https://gnosisscan.io',
    bondVersion: 5,
  },
};

if (process.env.MAINNET_V6_CONTRACT) {
  _CHAINS[1] = {
    name: 'Ethereum',
    rpc: process.env.MAINNET_RPC || 'https://eth.llamarpc.com',
    contract: process.env.MAINNET_V6_CONTRACT,
    startBlock: parseInt(process.env.MAINNET_V6_START_BLOCK || '0', 10),
    explorer: 'https://etherscan.io',
    bondVersion: 6,
  };
}

if (process.env.SEPOLIA_V6_CONTRACT) {
  _CHAINS[11155111] = {
    name: 'Sepolia',
    rpc: process.env.SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com',
    contract: process.env.SEPOLIA_V6_CONTRACT,
    startBlock: parseInt(process.env.SEPOLIA_V6_START_BLOCK || '0', 10),
    explorer: 'https://sepolia.etherscan.io',
    bondVersion: 6,
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

/// Returns the ABI to use for a given chain id.
export function abiForChain(chainId) {
  const v = (CHAINS[chainId] || {}).bondVersion || 5;
  return v === 6 ? V6_CONTRACT_ABI : V5_CONTRACT_ABI;
}

// Back-compat: the existing watcher imports `CONTRACT_ABI`. Keep that export
// pointing at v5 so the Gnosis path is unchanged; the watcher should switch to
// `abiForChain(chainId)` per chain in a follow-up.
export const CONTRACT_ABI = V5_CONTRACT_ABI;

// Events we watch and who gets notified. v0.5 and v0.6 share event names where
// possible; v0.6 also emits ClaimModified, ChallengeRejected, BondClosed, BondOpened.
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
