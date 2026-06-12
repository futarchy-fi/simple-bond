import db, { HEARTBEAT_EVENT_TYPE } from './db.mjs';
import { sendEmail, emailEnabled, providerInUse } from './mailer.mjs';

// Email heartbeat — actually sends a REAL email on a fixed interval so the
// status page can assert "green ⟺ a real send was provider-accepted recently"
// instead of the weaker "a provider key is configured". A successful send is
// logged to email_log (event_type='__heartbeat__'), which is the same liveness
// source as organic event emails, so a quiet period (no organic sends) still
// keeps the signal honestly green — and the moment delivery breaks, the signal
// ages out and goes red within the freshness window.
//
// Self-contained on the backend VM (no inbox round-trip): the liveness proof is
// the provider accepting the message (a returned message id), which is the bar
// the owner set ("we actually have sent an email"). NEVER throws into the caller.

const HEARTBEAT_INTERVAL_MS = parseInt(process.env.BOND_HEARTBEAT_INTERVAL_MS || String(6 * 60 * 60 * 1000), 10);
const HEARTBEAT_TO = process.env.BOND_HEARTBEAT_TO || 'bond-heartbeat@futarchy.ai';

function heartbeatHtml(now) {
  return `<p>ClaimBond delivery heartbeat.</p>
<p>This automated message confirms the bond notification pipeline can send mail.
Provider: <b>${providerInUse() || 'none'}</b>. Sent at ${now}.</p>`;
}

/**
 * Send one heartbeat email now. Returns the provider message id on success, or
 * null when disabled / on failure. On success records an email_log row so the
 * liveness query (MAX(sent_at)) sees it. Never throws.
 */
export async function heartbeatOnce(nowIso) {
  if (!emailEnabled()) {
    // No provider → no attempt. Liveness ages out → bond_email reports degraded
    // (no provider) / red (no recent send), which is the truth.
    return null;
  }
  const stamp = nowIso || new Date().toISOString();
  let msgId = null;
  try {
    msgId = await sendEmail(HEARTBEAT_TO, 'ClaimBond delivery heartbeat', heartbeatHtml(stamp));
  } catch (err) {
    // sendEmail already swallows; belt-and-suspenders so a heartbeat never
    // crashes the interval.
    console.error('[heartbeat] send threw unexpectedly:', err && err.message);
    return null;
  }
  if (msgId) {
    // wallet_address/bond_id null; the non-null message id is what the liveness
    // query keys on.
    db.logEmail('__heartbeat__', 0, null, HEARTBEAT_EVENT_TYPE, msgId);
    console.log(`[heartbeat] delivery heartbeat sent id=${msgId}`);
  } else {
    console.warn('[heartbeat] delivery heartbeat send returned no id (provider rejected)');
  }
  return msgId;
}

/**
 * Start the recurring heartbeat. Fires once shortly after boot (so a freshly
 * deployed, correctly-configured pipeline greens promptly) then every interval.
 * Returns the interval handle (for tests / shutdown).
 */
export function startHeartbeat() {
  if (!emailEnabled()) {
    console.log('[heartbeat] email delivery not configured — heartbeat idle (status will report no recent send)');
  } else {
    console.log(`[heartbeat] enabled via ${providerInUse()} → ${HEARTBEAT_TO} every ${Math.round(HEARTBEAT_INTERVAL_MS / 60000)} min`);
  }
  // Kick once on boot (don't wait a full interval for the first green).
  heartbeatOnce().catch((e) => console.error('[heartbeat] initial send error:', e && e.message));
  const handle = setInterval(() => {
    heartbeatOnce().catch((e) => console.error('[heartbeat] interval send error:', e && e.message));
  }, HEARTBEAT_INTERVAL_MS);
  if (handle && typeof handle.unref === 'function') handle.unref();
  return handle;
}

export const _internals = { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TO };
