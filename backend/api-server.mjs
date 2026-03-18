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
import { sendEmail } from './mailer.mjs';
import { verificationEmail, parseToken } from './templates.mjs';

const rateBuckets = new Map(); // ip -> { count, resetAt }

function checkRateLimit(ip) {
  const now = Date.now();
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
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
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

  json(res, 200, { ok: true, message: 'Verification email sent. Check your inbox.' });
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

function handleHealth(req, res) {
  json(res, 200, { status: 'ok', uptime: process.uptime() });
}

export function createApiServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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
