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

export const DB_PATH = resolve(__dirname, '..', 'data', 'bond-notify.db');

export const POLL_INTERVAL_MS = 30_000;
export const CONFIRMATION_BLOCKS = { 100: 12 };
export const BLOCK_CHUNK = 10_000;
export const TIMESTAMP_WINDOW_SEC = 300; // 5 minutes
export const RATE_LIMIT_MAX = 3; // per IP per hour

export const CHAINS = {
  100: {
    name: 'Gnosis',
    rpc: 'https://rpc.gnosischain.com',
    contract: '0x7dF485C013f8671B656d585f1d1411640B1D2776',
    startBlock: 45569363,
    explorer: 'https://gnosisscan.io',
  },
};

// SimpleBondV5 ABI subset — only events + view functions the email watcher needs.
export const CONTRACT_ABI = [
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

// Events we watch and who gets notified
export const EVENT_RECIPIENTS = {
  BondCreated:        ['judge'],
  Challenged:         ['poster', 'judge'],
  ClaimConceded:      ['challengers', 'judge'],
  RuledForChallenger: ['poster', 'challenger'],
  RuledForPoster:     ['poster', 'challenger'],
  ChallengeRefunded:  ['challenger'],
  BondWithdrawn:      ['poster'],
  BondTimedOut:       ['poster', 'challengers'],
  BondRejectedByJudge:['poster', 'challengers'],
};
