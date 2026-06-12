import { createHmac, timingSafeEqual } from 'crypto';
import { NOTIFY_BASE_URL, FRONTEND_BASE_URL, HMAC_SECRET } from './config.mjs';

function hmacToken(data) {
  return createHmac('sha256', HMAC_SECRET).update(data).digest('hex');
}

// Constant-time hex comparison (audit AUDIT-v7 §6 B8): `!==` short-circuits on
// the first differing byte, leaking match-prefix length to a timing oracle.
function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try { return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); }
  catch (_) { return false; }
}

export function verifyToken(address, chainId) {
  const payload = `verify:${address.toLowerCase()}:${chainId}`;
  return `${payload}:${hmacToken(payload)}`;
}

export function unsubToken(address, chainId) {
  const payload = `unsub:${address.toLowerCase()}:${chainId}`;
  return `${payload}:${hmacToken(payload)}`;
}

export function parseToken(token) {
  const parts = token.split(':');
  if (parts.length !== 4) return null;
  const [action, address, chainIdStr, sig] = parts;
  const payload = `${action}:${address}:${chainIdStr}`;
  if (!safeEqualHex(hmacToken(payload), sig)) return null;
  return { action, address, chainId: parseInt(chainIdStr, 10) };
}

const CHAIN_NAMES = { 1: 'Ethereum', 100: 'Gnosis', 137: 'Polygon', 11155111: 'Sepolia' };
const FRONTEND_LABEL = FRONTEND_BASE_URL.replace(/^https?:\/\//, '');

function layout(content) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #222;">
  ${content}
  <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0 15px;">
  <p style="font-size: 12px; color: #999;">ClaimBond Notifications &mdash; <a href="${FRONTEND_BASE_URL}">${FRONTEND_LABEL}</a></p>
</body>
</html>`;
}

export function verificationEmail(address, chainId) {
  const token = verifyToken(address, chainId);
  const chain = CHAIN_NAMES[chainId] || `Chain ${chainId}`;
  const link = `${NOTIFY_BASE_URL}/api/notify/verify?token=${encodeURIComponent(token)}`;

  return {
    subject: `Verify your ClaimBond notifications (${chain})`,
    html: layout(`
      <h2>Confirm your email</h2>
      <p>You requested notifications for ClaimBond events on <strong>${chain}</strong> for wallet <code>${address}</code>.</p>
      <p><a href="${link}" style="display: inline-block; padding: 10px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">Verify Email</a></p>
      <p style="font-size: 13px; color: #666;">If you didn't request this, ignore this email.</p>
    `),
  };
}

export function eventEmail(eventType, bondId, chainId, metadata, address) {
  const chain = CHAIN_NAMES[chainId] || `Chain ${chainId}`;
  const bondLink = `${FRONTEND_BASE_URL}?chain=${chainId}&bond=${bondId}`;
  const unsubLink = `${NOTIFY_BASE_URL}/api/notify/unsubscribe?token=${encodeURIComponent(unsubToken(address, chainId))}`;

  const claim = metadata
    ? (metadata.length > 200 ? metadata.slice(0, 200) + '...' : metadata)
    : '(no metadata)';

  const descriptions = {
    BondCreated: 'You have been named as <strong>judge</strong> for a new bond.',
    Challenged: 'A bond you are involved with has been <strong>challenged</strong>.',
    ClaimConceded: 'The poster has <strong>conceded</strong> their claim.',
    RuledForChallenger: 'The judge ruled <strong>in favor of the challenger</strong>.',
    RuledForPoster: 'The judge ruled <strong>in favor of the poster</strong>.',
    ChallengeRefunded: 'Your challenge deposit has been <strong>refunded</strong>.',
    BondWithdrawn: 'Your bond has been <strong>withdrawn</strong> successfully.',
    BondTimedOut: 'The bond has <strong>timed out</strong> (judge missed the ruling deadline).',
    BondRejectedByJudge: 'The judge has <strong>rejected</strong> this bond. All parties refunded.',
    ClaimModified: 'The poster has <strong>modified</strong> their claim.',
    ChallengeRejected: 'A challenge was <strong>rejected as out-of-scope</strong> by the judge — the challenger has been refunded.',
    BondClosed: 'A bond you judge has been <strong>closed</strong> to new challenges.',
    BondOpened: 'A bond you judge has been <strong>re-opened</strong> for challenges.',
  };

  const desc = descriptions[eventType] || `Event: ${eventType}`;

  return {
    subject: `[ClaimBond] ${eventType} — Bond #${bondId} (${chain})`,
    html: layout(`
      <h2>Bond #${bondId} on ${chain}</h2>
      <p>${desc}</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 6px 0; color: #666; width: 100px;">Bond ID</td><td><strong>#${bondId}</strong></td></tr>
        <tr><td style="padding: 6px 0; color: #666;">Chain</td><td>${chain}</td></tr>
        <tr><td style="padding: 6px 0; color: #666;">Event</td><td>${eventType}</td></tr>
        <tr><td style="padding: 6px 0; color: #666;">Claim</td><td style="font-size: 13px;">${escapeHtml(claim)}</td></tr>
      </table>
      <p><a href="${bondLink}" style="display: inline-block; padding: 10px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">View Bond</a></p>
      <p style="font-size: 12px; color: #999; margin-top: 24px;"><a href="${unsubLink}" style="color: #999;">Unsubscribe</a></p>
    `),
  };
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
