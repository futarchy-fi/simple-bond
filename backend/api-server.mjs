import http from 'http';
import { ethers } from 'ethers';
import {
  PORT,
  HOST,
  TIMESTAMP_WINDOW_SEC,
  RATE_LIMIT_MAX,
  FRONTEND_BASE_URL,
} from './config.mjs';
import db from './db.mjs';
import { sendEmail, emailEnabled } from './mailer.mjs';
import { verificationEmail, parseToken } from './templates.mjs';

const rateBuckets = new Map(); // ip -> { count, resetAt }

function checkRateLimit(ip) {
  const now = Date.now();
  // Bound the bucket map (audit AUDIT-v7 §6 B4): a caller cycling spoofed
  // identities must not grow memory without limit between sweeps.
  if (rateBuckets.size >= 50_000 && !rateBuckets.has(ip)) {
    for (const [k, b] of rateBuckets) if (now > b.resetAt) rateBuckets.delete(k);
    if (rateBuckets.size >= 50_000) return false; // fail closed for NEW identities under flood
  }
  let bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 3600_000 };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= RATE_LIMIT_MAX;
}

// Clean up stale buckets every 10 minutes.
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now > bucket.resetAt) rateBuckets.delete(ip);
  }
}, 600_000).unref();

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function redirect(res, url) {
  res.writeHead(302, { Location: url });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 10_000) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function getClientIp(req) {
  // Take the LAST X-Forwarded-For entry (audit AUDIT-v7 §6 B4): Caddy APPENDS the
  // address it saw, so the rightmost hop is proxy-attested; the first entry is
  // client-supplied and lets a caller mint fresh rate-limit buckets per request.
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const parts = xff.split(',');
    const last = parts[parts.length - 1]?.trim();
    if (last) return last;
  }
  return req.socket.remoteAddress;
}

function buildJudgeProfileMessage({ address, chainId, statement, linkUrl, timestamp }) {
  return JSON.stringify({
    action: 'simplebond-judge-profile-v1',
    address: String(address || '').toLowerCase(),
    chainId: Number(chainId),
    statement: statement || '',
    linkUrl: linkUrl || '',
    timestamp: Number(timestamp),
  });
}

function normalizeJudgeProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    address: row.wallet_address,
    chainId: row.chain_id,
    statement: row.statement || '',
    linkUrl: row.link_url || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    url: `${FRONTEND_BASE_URL}/judge/${row.id}`,
  };
}

function parseJudgeProfileBody(body) {
  const statement = typeof body.statement === 'string' ? body.statement.trim() : '';
  const linkUrl = typeof body.linkUrl === 'string' ? body.linkUrl.trim() : '';

  if (statement.length > 4000) {
    throw new Error('Statement is too long');
  }
  if (linkUrl.length > 500) {
    throw new Error('Link URL is too long');
  }
  if (linkUrl) {
    let parsed;
    try {
      parsed = new URL(linkUrl);
    } catch {
      throw new Error('Link must be a valid URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Link must start with http:// or https://');
    }
  }

  return { statement, linkUrl };
}

async function handleRegister(req, res) {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return json(res, 429, { error: 'Rate limit exceeded. Try again later.' });
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const { address, email, chainId, signature, timestamp } = body;
  if (!address || !email || chainId == null || !signature || timestamp == null) {
    return json(res, 400, { error: 'Missing required fields: address, email, chainId, signature, timestamp' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(res, 400, { error: 'Invalid email format' });
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > TIMESTAMP_WINDOW_SEC) {
    return json(res, 400, { error: 'Timestamp expired. Please try again.' });
  }

  const message = `Enable SimpleBond notifications for ${email} on chain ${chainId}. Timestamp: ${timestamp}`;
  let recovered;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch {
    return json(res, 400, { error: 'Invalid signature' });
  }

  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return json(res, 403, { error: 'Signature does not match address' });
  }

  db.upsertSubscription(address, email, chainId);

  const { subject, html } = verificationEmail(address, chainId);
  const msgId = await sendEmail(email, subject, html);
  if (msgId) {
    db.logEmail(address, chainId, null, 'verification', msgId);
  }

  // Be honest about delivery: sendEmail returns null when email is disabled or
  // the send failed (no message id). Don't claim an email was sent in that case
  // — say the subscription was recorded and delivery isn't enabled yet. When a
  // real message id comes back, the verification-email copy is accurate.
  const responseMessage = msgId
    ? 'Verification email sent. Check your inbox.'
    : 'Subscription recorded. Email delivery is not yet enabled, so no verification email was sent.';
  json(res, 200, { ok: true, message: responseMessage });
}

function handleVerify(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  if (!token) return json(res, 400, { error: 'Missing token' });

  const parsed = parseToken(token);
  if (!parsed || parsed.action !== 'verify') {
    return json(res, 400, { error: 'Invalid or expired token' });
  }

  const result = db.verifySubscription(parsed.address, parsed.chainId);
  if (result.changes === 0) {
    return json(res, 404, { error: 'Subscription not found' });
  }

  redirect(res, `${FRONTEND_BASE_URL}?notify=verified`);
}

function handleStatus(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const address = url.searchParams.get('address');
  const chain = url.searchParams.get('chain');
  if (!address || !chain) {
    return json(res, 400, { error: 'Missing address or chain parameter' });
  }

  const sub = db.getSubscription(address, parseInt(chain, 10));
  if (!sub) {
    return json(res, 200, { registered: false });
  }

  json(res, 200, {
    registered: true,
    verified: !!sub.verified,
    email: sub.email.replace(/^(.).*@/, '$1***@'),
  });
}

function handleUnsubscribe(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  if (!token) return json(res, 400, { error: 'Missing token' });

  const parsed = parseToken(token);
  if (!parsed || parsed.action !== 'unsub') {
    return json(res, 400, { error: 'Invalid token' });
  }

  db.deleteSubscription(parsed.address, parsed.chainId);
  redirect(res, `${FRONTEND_BASE_URL}?notify=unsubscribed`);
}

// Env-overridable health thresholds, mirroring scripts/monitor.mjs defaults so
// the endpoint and the synthetic monitor agree on what "unhealthy" means.
//   HEALTH_LAG_THRESHOLD       — max acceptable blocksBehindHead (default 200)
//   HEALTH_TICK_AGE_THRESHOLD  — max acceptable headAgeSeconds (default 180);
//                                a wedged watcher freezes BOTH head + checkpoint
//                                together on an RPC outage, so lag stays small
//                                and tick age is the real frozen-indexer signal.
export const HEALTH_LAG_THRESHOLD = Number(process.env.HEALTH_LAG_THRESHOLD || 200);
export const HEALTH_TICK_AGE_THRESHOLD = Number(process.env.HEALTH_TICK_AGE_THRESHOLD || 180);

// Pure, unit-testable status logic. Takes the db.indexerStatus() entries and
// returns { status, indexer } where `indexer` is the SAME entries with an
// additive { healthy, reasons } pair on each (existing fields are preserved so
// scripts/monitor.mjs + the frontend keep reading chainId/blocksBehindHead/
// deadLetters/headAgeSeconds/... unchanged). Overall status:
//   "down"     — no entries at all, OR any chain has a null head / never ticked
//                (the indexer is not even producing a heartbeat).
//   "degraded" — every chain has a head + has ticked, but at least one is over a
//                lag/tick threshold or has a dead-letter.
//   "ok"       — every chain is fresh, within lag budget, and dead-letter-free.
export function healthFromIndexer(entries, { lagThreshold = HEALTH_LAG_THRESHOLD, tickThreshold = HEALTH_TICK_AGE_THRESHOLD } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  let anyDown = false;
  let anyUnhealthy = false;

  const indexer = list.map((e) => {
    const reasons = [];
    let down = false; // a "down"-class condition (no head / never ticked)

    // Never ticked (no head timestamp) — the indexer is not producing a
    // heartbeat at all; this is a down-class signal, not merely degraded.
    if (e.headAgeSeconds == null) {
      reasons.push('never ticked (no head timestamp)');
      down = true;
    } else if (e.headAgeSeconds > tickThreshold) {
      // Stale tick — the watcher is wedged (e.g. RPC 429): head + checkpoint
      // both freeze, so lag looks small while the tick ages out.
      reasons.push(`stale tick: headAgeSeconds ${e.headAgeSeconds} > ${tickThreshold}`);
    }

    // Lag unknown means we cannot even compute distance-from-head (missing head
    // or checkpoint) — treat as down-class, like a missing heartbeat. EXCEPT a
    // fresh chain whose watcher is demonstrably alive (recent head write) but
    // hasn't written its first checkpoint yet: that's "starting", a degraded
    // state, not a hard-down 503 page (audit AUDIT-v7 §6 B6).
    if (e.blocksBehindHead == null) {
      const tickFresh = e.headAgeSeconds != null && e.headAgeSeconds <= tickThreshold;
      if (tickFresh && e.headBlock != null && e.indexedThroughBlock == null) {
        reasons.push('starting: first checkpoint not yet written');
      } else {
        reasons.push('lag unknown (head/checkpoint missing)');
        down = true;
      }
    } else if (e.blocksBehindHead > lagThreshold) {
      reasons.push(`lag ${e.blocksBehindHead} > ${lagThreshold}`);
    }

    // Email-notification cursor stalling behind the read-model cursor is a real
    // degradation even while indexing looks healthy (audit AUDIT-v7 §6 B2).
    if (e.emailLagBlocks != null && e.emailLagBlocks > lagThreshold) {
      reasons.push(`email cursor lag ${e.emailLagBlocks} > ${lagThreshold}`);
    }

    // Dead-lettered (poison-block) ranges freeze the read-model behind them —
    // THE bug: a dead-letter must never read as ok.
    if ((e.deadLetters || 0) > 0) {
      reasons.push(`${e.deadLetters} dead-lettered range(s) from block ${e.blockedFromBlock}`);
    }

    const healthy = reasons.length === 0;
    if (!healthy) anyUnhealthy = true;
    if (down) anyDown = true;
    return { ...e, healthy, reasons };
  });

  let status;
  if (list.length === 0 || anyDown) status = 'down';
  else if (anyUnhealthy) status = 'degraded';
  else status = 'ok';

  return { status, indexer };
}

function handleHealth(req, res) {
  // Per-chain indexer lag + dead-letter count + tick freshness so a monitor can
  // alert on a stalled read-model (a stalled indexer USED to be served as a
  // healthy HTTP 200 — a monitor that lies). Each indexer entry carries
  // `deadLetters` (poison-block ranges that fail even at the 1-block floor),
  // `blockedFromBlock` (the lowest blocked range start) and `headAgeSeconds`
  // (wall-clock tick age) so a single poison block or a frozen watcher can't
  // silently freeze the read-model. We now derive an HONEST overall `status`
  // from those fields instead of hardcoding "ok".
  let entries = [];
  try { entries = db.indexerStatus(); } catch (_) { entries = []; }
  const thresholds = { lagThreshold: HEALTH_LAG_THRESHOLD, tickThreshold: HEALTH_TICK_AGE_THRESHOLD };
  const { status, indexer } = healthFromIndexer(entries, thresholds);
  // Keep HTTP 200 for ok/degraded so existing r.ok consumers and
  // scripts/monitor.mjs keep working; only a fully "down" indexer returns 503.
  const httpStatus = status === 'down' ? 503 : 200;
  // email.enabled lets the status page render "Bond Email Delivery" honestly
  // (delivery is provider-key-gated; per-chain emailLagBlocks live in indexer[]).
  json(res, httpStatus, { status, uptime: process.uptime(), email: { enabled: emailEnabled() }, indexer, thresholds });
}

function handleJudgeProfileGet(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const id = url.searchParams.get('id');
  const address = url.searchParams.get('address');
  const chain = url.searchParams.get('chain');

  let profile = null;
  if (id) {
    const numericId = parseInt(id, 10);
    if (!Number.isFinite(numericId)) {
      return json(res, 400, { error: 'Invalid judge profile id' });
    }
    profile = normalizeJudgeProfile(db.getJudgeProfileById(numericId));
  } else if (address && chain) {
    const chainId = parseInt(chain, 10);
    if (!Number.isFinite(chainId)) {
      return json(res, 400, { error: 'Invalid chain parameter' });
    }
    profile = normalizeJudgeProfile(db.getJudgeProfile(address, chainId));
  } else {
    return json(res, 400, { error: 'Provide either id or address+chain' });
  }

  if (!profile) {
    return json(res, 404, { error: 'Judge profile not found' });
  }

  json(res, 200, { profile });
}

function handleJudgeProfilesGet(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const chain = url.searchParams.get('chain');
  const rawAddresses = url.searchParams.get('addresses');
  if (!chain) {
    return json(res, 400, { error: 'Missing chain parameter' });
  }
  const chainId = parseInt(chain, 10);
  if (!Number.isFinite(chainId)) {
    return json(res, 400, { error: 'Invalid chain parameter' });
  }
  const addresses = String(rawAddresses || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (addresses.length === 0) {
    return json(res, 200, { profiles: [] });
  }
  const profiles = db.getJudgeProfiles(chainId, addresses).map(normalizeJudgeProfile);
  json(res, 200, { profiles });
}

async function handleJudgeProfileUpsert(req, res) {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return json(res, 429, { error: 'Rate limit exceeded. Try again later.' });
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const { address, chainId, signature, timestamp } = body;
  if (!address || chainId == null || !signature || timestamp == null) {
    return json(res, 400, { error: 'Missing required fields: address, chainId, signature, timestamp' });
  }

  if (!ethers.isAddress(address)) {
    return json(res, 400, { error: 'Invalid wallet address' });
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > TIMESTAMP_WINDOW_SEC) {
    return json(res, 400, { error: 'Timestamp expired. Please try again.' });
  }

  let profileInput;
  try {
    profileInput = parseJudgeProfileBody(body);
  } catch (err) {
    return json(res, 400, { error: err.message });
  }

  const message = buildJudgeProfileMessage({
    address,
    chainId,
    statement: profileInput.statement,
    linkUrl: profileInput.linkUrl,
    timestamp,
  });

  let recovered;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch {
    return json(res, 400, { error: 'Invalid signature' });
  }

  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return json(res, 403, { error: 'Signature does not match address' });
  }

  if (!profileInput.statement && !profileInput.linkUrl) {
    db.deleteJudgeProfile(address, Number(chainId));
    return json(res, 200, { ok: true, deleted: true });
  }

  const profile = normalizeJudgeProfile(
    db.upsertJudgeProfile(address, Number(chainId), profileInput.statement, profileInput.linkUrl)
  );
  json(res, 200, { ok: true, profile });
}

// ─── Bonds read-model API ──────────────────────────────────────────────────
// Serialize a DB bond row into the shape the frontend expects. Amounts stay
// as decimal strings (wei) so the client keeps full BigInt precision.
function serializeBond(row) {
  if (!row) return null;
  return {
    chainId: row.chain_id,
    bondId: row.bond_id,
    poster: row.poster,
    judge: row.judge,
    judgeProfileId: row.judge_profile_id,
    token: row.token,
    bondAmount: row.bond_amount,
    challengeAmount: row.challenge_amount,
    judgeFee: row.judge_fee,
    acceptanceDelay: row.acceptance_delay,
    rulingBuffer: row.ruling_buffer,
    maxChallenges: row.max_challenges,
    claimHash: row.claim_hash,
    claimContent: row.claim_content,
    claimVersion: row.claim_version,
    pendingCount: row.pending_count,
    challengeCount: row.challenge_count,
    settled: !!row.settled,
    closed: !!row.closed,
    // Only meaningful once settled — a stale reason row (e.g. reorg artifact)
    // must not label a live bond (audit AUDIT-v7 §6 B9).
    settleReason: row.settled ? (row.settle_reason || null) : null,
    updatedAt: row.updated_at,
  };
}

function handleBondsList(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const chainId = parseInt(url.searchParams.get('chainId') || '', 10);
  if (!Number.isFinite(chainId)) return json(res, 400, { error: 'Missing or invalid chainId' });
  const poster = url.searchParams.get('poster') || undefined;
  const judge = url.searchParams.get('judge') || undefined;
  const challenger = url.searchParams.get('challenger') || undefined;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 500);
  const rows = db.listBonds(chainId, { poster, judge, challenger, limit });
  // Attach indexer lag for this chain so the client can warn when the list
  // may be stale and fall back to a direct read past a threshold.
  let meta = null;
  try { meta = (db.indexerStatus() || []).find((s) => s.chainId === chainId) || null; }
  catch (e) { console.warn('[api] indexer meta unavailable:', e.message); }
  json(res, 200, { bonds: rows.map(serializeBond), meta });
}

function handleBondGet(req, res, bondId) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const chainId = parseInt(url.searchParams.get('chainId') || '', 10);
  if (!Number.isFinite(chainId)) return json(res, 400, { error: 'Missing or invalid chainId' });
  const bond = serializeBond(db.getBond(chainId, bondId));
  if (!bond) return json(res, 404, { error: 'Bond not found' });
  const challenges = db.listChallenges(chainId, bondId).map(c => ({
    idx: c.idx, challenger: c.challenger, status: c.status, content: c.content,
  }));
  json(res, 200, { bond, challenges });
}

export function createApiServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    try {
      if (req.method === 'POST' && path === '/api/notify/register') {
        await handleRegister(req, res);
      } else if (req.method === 'GET' && path === '/api/notify/verify') {
        handleVerify(req, res);
      } else if (req.method === 'GET' && path === '/api/notify/status') {
        handleStatus(req, res);
      } else if (req.method === 'DELETE' && path === '/api/notify/unsubscribe') {
        handleUnsubscribe(req, res);
      } else if (req.method === 'GET' && path === '/api/notify/unsubscribe') {
        handleUnsubscribe(req, res);
      } else if (req.method === 'GET' && path === '/api/notify/health') {
        handleHealth(req, res);
      } else if (req.method === 'GET' && path === '/api/judges/profile') {
        handleJudgeProfileGet(req, res);
      } else if (req.method === 'GET' && path === '/api/judges/profiles') {
        handleJudgeProfilesGet(req, res);
      } else if ((req.method === 'POST' || req.method === 'PUT') && path === '/api/judges/profile') {
        await handleJudgeProfileUpsert(req, res);
      } else if (req.method === 'GET' && path === '/api/bonds') {
        handleBondsList(req, res);
      } else if (req.method === 'GET' && /^\/api\/bonds\/\d+$/.test(path)) {
        handleBondGet(req, res, parseInt(path.split('/').pop(), 10));
      } else {
        json(res, 404, { error: 'Not found' });
      }
    } catch (err) {
      console.error('[server] Request error:', err);
      json(res, 500, { error: 'Internal server error' });
    }
  });
}

export function startApiServer({ port = PORT, host = HOST, onListen } = {}) {
  const server = createApiServer();
  server.listen(port, host, () => {
    console.log(`[bond-notify-api] HTTP server listening on ${host}:${port}`);
    if (typeof onListen === 'function') onListen(server);
  });
  return server;
}
