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
};
