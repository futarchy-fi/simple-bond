import { FROM_EMAIL } from './config.mjs';

// Email delivery — provider-agnostic, selected by environment:
//
//   SMTP_HOST set        -> SMTP via nodemailer (self-hosted MTA, a Google
//                           Workspace app password, or any provider's relay).
//                           SMTP_PORT (default 587), SMTP_USER/SMTP_PASS
//                           (optional — omit for an unauthenticated private
//                           relay), SMTP_SECURE=1 for implicit TLS (465).
//   RESEND_API_KEY set   -> Resend HTTPS API (https://resend.com), no SDK.
//   neither              -> honest logged no-op: sendEmail() returns null and
//                           the API keeps reporting "delivery not enabled".
//
// SMTP wins when both are configured (explicit infrastructure beats a vendor
// key left in the env). History: AWS SES originally, decommissioned in the GCP
// migration; stubbed until 2026-06-11.
//
// Contract (unchanged): returns the provider message id on success, or null on
// failure / when disabled. NEVER throws — the email path runs inside the
// watcher tick and API handlers.
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_SECURE = process.env.SMTP_SECURE === '1' || SMTP_PORT === 465;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SEND_TIMEOUT_MS = 15_000;

/** Which delivery provider the environment selects: 'smtp' | 'resend' | null. */
export function providerInUse() {
  if (SMTP_HOST) return 'smtp';
  if (RESEND_API_KEY) return 'resend';
  return null;
}

/** Whether a delivery provider is configured — surfaced by /api/notify/health
 *  so the status page can show "Bond Email Delivery" honestly. */
export function emailEnabled() {
  return providerInUse() !== null;
}

// ─── SMTP (nodemailer) ─────────────────────────────────────────────────────
// Lazy singleton so the import + connection pool only exist when SMTP is the
// selected provider. The factory is swappable for tests (child processes can't
// intercept a dynamic import).
let _transporter = null;
let _transportFactory = async () => {
  const { default: nodemailer } = await import('nodemailer');
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    connectionTimeout: SEND_TIMEOUT_MS,
    greetingTimeout: SEND_TIMEOUT_MS,
    socketTimeout: SEND_TIMEOUT_MS,
  });
};

export function _setTransportFactoryForTests(f) {
  _transportFactory = f;
  _transporter = null;
}

async function sendViaSmtp(to, subject, htmlBody) {
  if (!_transporter) _transporter = await _transportFactory();
  const info = await _transporter.sendMail({
    from: `SimpleBond <${FROM_EMAIL}>`,
    to,
    subject,
    html: htmlBody,
  });
  return info && info.messageId ? info.messageId : null;
}

// ─── Resend (HTTPS API) ────────────────────────────────────────────────────
async function sendViaResend(to, subject, htmlBody) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `SimpleBond <${FROM_EMAIL}>`,
      to: [to],
      subject,
      html: htmlBody,
    }),
    // A hung provider must not wedge the watcher's email pass.
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.id) {
    console.error(`[mailer] resend send failed (${res.status}) to=${to}:`, body.message || body.name || 'unknown error');
    return null;
  }
  return body.id;
}

/**
 * Send an HTML email through the configured provider. Returns the provider
 * message id on success, or null on failure / when disabled. Never throws.
 */
export async function sendEmail(to, subject, htmlBody) {
  const provider = providerInUse();
  if (!provider) {
    console.warn(
      `[mailer] email disabled — skipped send from=${FROM_EMAIL} to=${to} subject=${JSON.stringify(subject)}`
    );
    return null;
  }
  try {
    const id = provider === 'smtp'
      ? await sendViaSmtp(to, subject, htmlBody)
      : await sendViaResend(to, subject, htmlBody);
    if (id) console.log(`[mailer] sent via ${provider} to=${to} id=${id}`);
    return id;
  } catch (err) {
    console.error(`[mailer] ${provider} send error to=${to}:`, err.message);
    return null;
  }
}
