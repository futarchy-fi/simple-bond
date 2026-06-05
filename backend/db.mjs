import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { DB_PATH } from './config.mjs';

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    wallet_address TEXT NOT NULL,
    email TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (wallet_address, chain_id)
  );

  CREATE TABLE IF NOT EXISTS email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_address TEXT,
    chain_id INTEGER,
    bond_id INTEGER,
    event_type TEXT,
    sent_at TEXT DEFAULT (datetime('now')),
    ses_message_id TEXT
  );

  CREATE TABLE IF NOT EXISTS checkpoints (
    chain_id INTEGER PRIMARY KEY,
    last_block INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS judge_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_address TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    statement TEXT NOT NULL DEFAULT '',
    link_url TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE (wallet_address, chain_id)
  );

  -- Indexed read-model of bonds, populated by the watcher's indexing pass.
  -- Lets the frontend list/filter bonds via HTTP instead of scanning
  -- eth_getLogs from the browser (free-tier RPCs cap log ranges).
  CREATE TABLE IF NOT EXISTS bonds (
    chain_id INTEGER NOT NULL,
    bond_id INTEGER NOT NULL,
    poster TEXT NOT NULL,
    judge TEXT NOT NULL,
    judge_profile_id INTEGER,
    token TEXT,
    bond_amount TEXT,
    challenge_amount TEXT,
    judge_fee TEXT,
    acceptance_delay INTEGER,
    ruling_buffer INTEGER,
    max_challenges INTEGER,
    claim_hash TEXT,
    claim_content TEXT DEFAULT '',
    claim_version INTEGER DEFAULT 0,
    pending_count INTEGER DEFAULT 0,
    challenge_count INTEGER DEFAULT 0,
    settled INTEGER DEFAULT 0,
    closed INTEGER DEFAULT 0,
    created_block INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (chain_id, bond_id)
  );
  CREATE INDEX IF NOT EXISTS idx_bonds_poster ON bonds(chain_id, poster);
  CREATE INDEX IF NOT EXISTS idx_bonds_judge  ON bonds(chain_id, judge);

  CREATE TABLE IF NOT EXISTS challenges (
    chain_id INTEGER NOT NULL,
    bond_id INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    challenger TEXT NOT NULL,
    status INTEGER DEFAULT 0,
    content TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (chain_id, bond_id, idx)
  );
  CREATE INDEX IF NOT EXISTS idx_challenges_challenger ON challenges(chain_id, challenger);

  -- Separate cursor from the email 'checkpoints' table so indexing can
  -- backfill from startBlock without re-sending notification emails.
  CREATE TABLE IF NOT EXISTS index_checkpoints (
    chain_id INTEGER PRIMARY KEY,
    last_block INTEGER NOT NULL
  );

  -- Latest chain head the indexer observed per chain, so /health can report
  -- how far behind the read-model is (a stalled indexer must not look healthy).
  CREATE TABLE IF NOT EXISTS chain_heads (
    chain_id INTEGER PRIMARY KEY,
    head_block INTEGER NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Dead-letter queue for log windows that fail getLogs even at the 1-block
  -- floor (a true "poison block"). The checkpoint is NEVER advanced past such a
  -- range (no-skip invariant), so each entry marks a blocked range the indexer
  -- re-attempts on later ticks and clears on success. Surfaced via /health so a
  -- human/monitor can see a read-model that is stuck behind a poison block.
  CREATE TABLE IF NOT EXISTS dead_letters (
    chain_id INTEGER NOT NULL,
    from_block INTEGER NOT NULL,
    to_block INTEGER NOT NULL,
    error TEXT,
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now')),
    attempts INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (chain_id, from_block, to_block)
  );
`);

// --- Subscriptions ---

const upsertSub = db.prepare(`
  INSERT INTO subscriptions (wallet_address, email, chain_id, verified)
  VALUES (?, ?, ?, 0)
  ON CONFLICT(wallet_address, chain_id) DO UPDATE SET email=excluded.email, verified=0, created_at=datetime('now')
`);

const verifySub = db.prepare(`
  UPDATE subscriptions SET verified=1 WHERE wallet_address=? AND chain_id=?
`);

const deleteSub = db.prepare(`
  DELETE FROM subscriptions WHERE wallet_address=? AND chain_id=?
`);

const getSub = db.prepare(`
  SELECT * FROM subscriptions WHERE wallet_address=? AND chain_id=?
`);

const getVerifiedByAddresses = db.prepare(`
  SELECT * FROM subscriptions WHERE chain_id=? AND verified=1 AND wallet_address IN (SELECT value FROM json_each(?))
`);

// --- Checkpoints ---

const getCheckpoint = db.prepare(`
  SELECT last_block FROM checkpoints WHERE chain_id=?
`);

const upsertCheckpoint = db.prepare(`
  INSERT INTO checkpoints (chain_id, last_block) VALUES (?, ?)
  ON CONFLICT(chain_id) DO UPDATE SET last_block=excluded.last_block
`);

// --- Email log ---

const insertLog = db.prepare(`
  INSERT INTO email_log (wallet_address, chain_id, bond_id, event_type, ses_message_id)
  VALUES (?, ?, ?, ?, ?)
`);

// --- Judge profiles ---

const upsertJudgeProfile = db.prepare(`
  INSERT INTO judge_profiles (wallet_address, chain_id, statement, link_url)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(wallet_address, chain_id) DO UPDATE SET
    statement=excluded.statement,
    link_url=excluded.link_url,
    updated_at=datetime('now')
  RETURNING id, wallet_address, chain_id, statement, link_url, created_at, updated_at
`);

const deleteJudgeProfile = db.prepare(`
  DELETE FROM judge_profiles WHERE wallet_address=? AND chain_id=?
`);

const getJudgeProfileByAddress = db.prepare(`
  SELECT id, wallet_address, chain_id, statement, link_url, created_at, updated_at
  FROM judge_profiles
  WHERE wallet_address=? AND chain_id=?
`);

const getJudgeProfileById = db.prepare(`
  SELECT id, wallet_address, chain_id, statement, link_url, created_at, updated_at
  FROM judge_profiles
  WHERE id=?
`);

const getJudgeProfilesByAddresses = db.prepare(`
  SELECT id, wallet_address, chain_id, statement, link_url, created_at, updated_at
  FROM judge_profiles
  WHERE chain_id=? AND wallet_address IN (SELECT value FROM json_each(?))
`);

// --- Index checkpoints (separate from email 'checkpoints') ---

const getIndexCheckpoint = db.prepare(`SELECT last_block FROM index_checkpoints WHERE chain_id=?`);
const upsertIndexCheckpoint = db.prepare(`
  INSERT INTO index_checkpoints (chain_id, last_block) VALUES (?, ?)
  ON CONFLICT(chain_id) DO UPDATE SET last_block=excluded.last_block
`);

const upsertChainHead = db.prepare(`
  INSERT INTO chain_heads (chain_id, head_block, updated_at) VALUES (?, ?, datetime('now'))
  ON CONFLICT(chain_id) DO UPDATE SET head_block=excluded.head_block, updated_at=datetime('now')
`);
const getAllChainHeads = db.prepare(`SELECT chain_id, head_block, updated_at FROM chain_heads`);
const getAllIndexCheckpoints = db.prepare(`SELECT chain_id, last_block FROM index_checkpoints`);

// --- Dead letters (poison-block ranges that fail even at the 1-block floor) ---
const upsertDeadLetterStmt = db.prepare(`
  INSERT INTO dead_letters (chain_id, from_block, to_block, error, attempts)
  VALUES (?, ?, ?, ?, 1)
  ON CONFLICT(chain_id, from_block, to_block) DO UPDATE SET
    error=excluded.error, last_seen=datetime('now'), attempts=dead_letters.attempts+1
`);
const clearDeadLetterStmt = db.prepare(`
  DELETE FROM dead_letters WHERE chain_id=? AND from_block=? AND to_block=?
`);
const getDeadLettersForChainStmt = db.prepare(`
  SELECT chain_id, from_block, to_block, error, first_seen, last_seen, attempts
  FROM dead_letters WHERE chain_id=? ORDER BY from_block ASC
`);
const countDeadLettersByChainStmt = db.prepare(`
  SELECT chain_id, COUNT(*) AS n, MIN(from_block) AS min_from FROM dead_letters GROUP BY chain_id
`);

// --- Bonds read-model ---

const upsertBondStmt = db.prepare(`
  INSERT INTO bonds (
    chain_id, bond_id, poster, judge, judge_profile_id, token,
    bond_amount, challenge_amount, judge_fee, acceptance_delay, ruling_buffer,
    max_challenges, claim_hash, claim_content, claim_version, pending_count,
    challenge_count, settled, closed, created_block, updated_at
  ) VALUES (
    @chain_id, @bond_id, @poster, @judge, @judge_profile_id, @token,
    @bond_amount, @challenge_amount, @judge_fee, @acceptance_delay, @ruling_buffer,
    @max_challenges, @claim_hash, @claim_content, @claim_version, @pending_count,
    @challenge_count, @settled, @closed, @created_block, datetime('now')
  )
  ON CONFLICT(chain_id, bond_id) DO UPDATE SET
    poster=excluded.poster, judge=excluded.judge, judge_profile_id=excluded.judge_profile_id,
    token=excluded.token, bond_amount=excluded.bond_amount, challenge_amount=excluded.challenge_amount,
    judge_fee=excluded.judge_fee, acceptance_delay=excluded.acceptance_delay, ruling_buffer=excluded.ruling_buffer,
    max_challenges=excluded.max_challenges, claim_hash=excluded.claim_hash,
    -- keep an existing non-empty claim_content if the update lacks one
    claim_content=CASE WHEN excluded.claim_content != '' THEN excluded.claim_content ELSE bonds.claim_content END,
    claim_version=excluded.claim_version, pending_count=excluded.pending_count,
    -- preserve prior count when this update couldn't read it (null)
    challenge_count=CASE WHEN excluded.challenge_count IS NULL THEN bonds.challenge_count ELSE excluded.challenge_count END,
    settled=excluded.settled, closed=excluded.closed,
    created_block=COALESCE(bonds.created_block, excluded.created_block), updated_at=datetime('now')
`);
const getBondStmt = db.prepare(`SELECT * FROM bonds WHERE chain_id=? AND bond_id=?`);
const listBondsAll = db.prepare(`SELECT * FROM bonds WHERE chain_id=? ORDER BY bond_id DESC LIMIT ?`);
const listBondsByPoster = db.prepare(`SELECT * FROM bonds WHERE chain_id=? AND poster=? ORDER BY bond_id DESC LIMIT ?`);
const listBondsByJudge = db.prepare(`SELECT * FROM bonds WHERE chain_id=? AND judge=? ORDER BY bond_id DESC LIMIT ?`);
const listBondIdsByChallenger = db.prepare(`SELECT DISTINCT bond_id FROM challenges WHERE chain_id=? AND challenger=?`);

const upsertChallengeStmt = db.prepare(`
  INSERT INTO challenges (chain_id, bond_id, idx, challenger, status, content, updated_at)
  VALUES (@chain_id, @bond_id, @idx, @challenger, @status, @content, datetime('now'))
  ON CONFLICT(chain_id, bond_id, idx) DO UPDATE SET
    challenger=excluded.challenger, status=excluded.status,
    content=CASE WHEN excluded.content != '' THEN excluded.content ELSE challenges.content END,
    updated_at=datetime('now')
`);
const setChallengeStatusStmt = db.prepare(`
  UPDATE challenges SET status=?, updated_at=datetime('now') WHERE chain_id=? AND bond_id=? AND idx=?
`);
const listChallengesStmt = db.prepare(`SELECT * FROM challenges WHERE chain_id=? AND bond_id=? ORDER BY idx ASC`);

// Compute the wall-clock age (seconds) of a SQLite `datetime('now')` string.
// That value is UTC with NO timezone suffix (e.g. "2026-05-31 12:00:00"), so
// JS Date() would parse it as LOCAL time and skew the age by the host's UTC
// offset (hours). We append "Z" (and use "T") to force a UTC parse. Returns
// null for a missing timestamp (the indexer never ticked) or an unparseable
// value. Exported for unit tests of the freshness logic.
export function headAgeSeconds(updatedAt, now = Date.now()) {
  if (!updatedAt) return null;
  const ms = Date.parse(updatedAt.replace(' ', 'T') + 'Z');
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round((now - ms) / 1000));
}

export default {
  upsertSubscription(address, email, chainId) {
    upsertSub.run(address.toLowerCase(), email.toLowerCase(), chainId);
  },

  verifySubscription(address, chainId) {
    return verifySub.run(address.toLowerCase(), chainId);
  },

  deleteSubscription(address, chainId) {
    return deleteSub.run(address.toLowerCase(), chainId);
  },

  getSubscription(address, chainId) {
    return getSub.get(address.toLowerCase(), chainId);
  },

  getVerifiedSubscriptions(chainId, addresses) {
    const lower = addresses.map(a => a.toLowerCase());
    return getVerifiedByAddresses.all(chainId, JSON.stringify(lower));
  },

  getCheckpoint(chainId) {
    const row = getCheckpoint.get(chainId);
    return row ? row.last_block : null;
  },

  setCheckpoint(chainId, block) {
    upsertCheckpoint.run(chainId, block);
  },

  logEmail(address, chainId, bondId, eventType, sesMessageId) {
    insertLog.run(address.toLowerCase(), chainId, bondId, eventType, sesMessageId);
  },

  upsertJudgeProfile(address, chainId, statement, linkUrl) {
    return upsertJudgeProfile.get(address.toLowerCase(), chainId, statement, linkUrl);
  },

  deleteJudgeProfile(address, chainId) {
    return deleteJudgeProfile.run(address.toLowerCase(), chainId);
  },

  getJudgeProfile(address, chainId) {
    return getJudgeProfileByAddress.get(address.toLowerCase(), chainId);
  },

  getJudgeProfileById(id) {
    return getJudgeProfileById.get(id);
  },

  getJudgeProfiles(chainId, addresses) {
    const lower = addresses.map(a => a.toLowerCase());
    return getJudgeProfilesByAddresses.all(chainId, JSON.stringify(lower));
  },

  // --- Index checkpoints ---
  getIndexCheckpoint(chainId) {
    const row = getIndexCheckpoint.get(chainId);
    return row ? row.last_block : null;
  },
  setIndexCheckpoint(chainId, block) {
    upsertIndexCheckpoint.run(chainId, block);
  },
  setChainHead(chainId, headBlock) {
    upsertChainHead.run(chainId, headBlock);
  },
  // Per-chain indexer status: { chainId, indexedThroughBlock, headBlock,
  // blocksBehindHead, headUpdatedAt, headAgeSeconds, deadLetters,
  // blockedFromBlock } for health reporting. `deadLetters` is the count of
  // poison-block ranges that fail even at the 1-block floor; `blockedFromBlock`
  // is the lowest such range start (the cursor cannot advance past it without
  // skipping events) or null. `headAgeSeconds` is the wall-clock age of the
  // last tick (now - chain_heads.updated_at) — the freshness/liveness signal a
  // monitor uses to page a wedged watcher whose block-lag still looks small;
  // null if the indexer never ticked.
  indexerStatus() {
    const heads = {}; for (const r of getAllChainHeads.all()) heads[r.chain_id] = r;
    const cps = {}; for (const r of getAllIndexCheckpoints.all()) cps[r.chain_id] = r.last_block;
    const dls = {}; for (const r of countDeadLettersByChainStmt.all()) dls[r.chain_id] = r;
    const chainIds = new Set([...Object.keys(heads), ...Object.keys(cps), ...Object.keys(dls)].map(Number));
    return [...chainIds].sort((a, b) => a - b).map((chainId) => {
      const head = heads[chainId] ? heads[chainId].head_block : null;
      const indexed = cps[chainId] ?? null;
      const dl = dls[chainId] || null;
      const headUpdatedAt = heads[chainId] ? heads[chainId].updated_at : null;
      return {
        chainId,
        indexedThroughBlock: indexed,
        headBlock: head,
        blocksBehindHead: head != null && indexed != null ? Math.max(0, head - indexed) : null,
        headUpdatedAt,
        headAgeSeconds: headAgeSeconds(headUpdatedAt),
        deadLetters: dl ? dl.n : 0,
        blockedFromBlock: dl ? dl.min_from : null,
      };
    });
  },

  // --- Dead letters ---
  recordDeadLetter(chainId, fromBlock, toBlock, error) {
    upsertDeadLetterStmt.run(chainId, fromBlock, toBlock, String(error ?? '').slice(0, 500));
  },
  clearDeadLetter(chainId, fromBlock, toBlock) {
    clearDeadLetterStmt.run(chainId, fromBlock, toBlock);
  },
  getDeadLetters(chainId) {
    return getDeadLettersForChainStmt.all(chainId);
  },

  // --- Bonds read-model ---
  upsertBond(bond) {
    upsertBondStmt.run({
      chain_id: bond.chain_id,
      bond_id: bond.bond_id,
      poster: (bond.poster || '').toLowerCase(),
      judge: (bond.judge || '').toLowerCase(),
      judge_profile_id: bond.judge_profile_id ?? null,
      token: (bond.token || '').toLowerCase(),
      bond_amount: String(bond.bond_amount ?? ''),
      challenge_amount: String(bond.challenge_amount ?? ''),
      judge_fee: String(bond.judge_fee ?? ''),
      acceptance_delay: bond.acceptance_delay ?? null,
      ruling_buffer: bond.ruling_buffer ?? null,
      max_challenges: bond.max_challenges ?? null,
      claim_hash: bond.claim_hash ?? '',
      claim_content: bond.claim_content ?? '',
      claim_version: bond.claim_version ?? 0,
      pending_count: bond.pending_count ?? 0,
      challenge_count: bond.challenge_count ?? null,
      settled: bond.settled ? 1 : 0,
      closed: bond.closed ? 1 : 0,
      created_block: bond.created_block ?? null,
    });
  },
  getBond(chainId, bondId) {
    return getBondStmt.get(chainId, bondId);
  },
  listBonds(chainId, { poster, judge, challenger, limit = 200 } = {}) {
    if (poster) return listBondsByPoster.all(chainId, poster.toLowerCase(), limit);
    if (judge) return listBondsByJudge.all(chainId, judge.toLowerCase(), limit);
    if (challenger) {
      const ids = listBondIdsByChallenger.all(chainId, challenger.toLowerCase()).map(r => r.bond_id);
      return ids.map(id => getBondStmt.get(chainId, id)).filter(Boolean).sort((a, b) => b.bond_id - a.bond_id);
    }
    return listBondsAll.all(chainId, limit);
  },

  // --- Challenges ---
  upsertChallenge(ch) {
    upsertChallengeStmt.run({
      chain_id: ch.chain_id,
      bond_id: ch.bond_id,
      idx: ch.idx,
      challenger: (ch.challenger || '').toLowerCase(),
      status: ch.status ?? 0,
      content: ch.content ?? '',
    });
  },
  setChallengeStatus(chainId, bondId, idx, status) {
    setChallengeStatusStmt.run(status, chainId, bondId, idx);
  },
  listChallenges(chainId, bondId) {
    return listChallengesStmt.all(chainId, bondId);
  },
};
