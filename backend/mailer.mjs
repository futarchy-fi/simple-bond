import { FROM_EMAIL } from './config.mjs';

// Email delivery via Resend (https://resend.com) — plain HTTPS API, no SDK.
//
// History: the original implementation sent through AWS SES; that account was
// decommissioned during the GCP migration, and sendEmail() was a logged no-op
// until 2026-06-11. Delivery is gated on RESEND_API_KEY: without it (dev, CI,
// tests) sendEmail() stays the same honest no-op, so the API keeps reporting
// "delivery is not yet enabled" instead of claiming mail was sent.
//
// Contract (unchanged): returns the provider message id on success, or null on
// failure / when disabled. Callers (handleRegister, the event watcher) treat
// null as "not delivered" and must stay honest about it.
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_ENABLED = RESEND_API_KEY.length > 0;
const SEND_TIMEOUT_MS = 15_000;

/**
 * Send an HTML email. Returns the Resend message id on success, or null on
 * failure / when disabled. Never throws: the email path must not be able to
 * crash the watcher tick or an API request.
 */
export async function sendEmail(to, subject, htmlBody) {
  if (!EMAIL_ENABLED) {
    console.warn(
      `[mailer] email disabled — skipped send from=${FROM_EMAIL} to=${to} subject=${JSON.stringify(subject)}`
    );
    return null;
  }
  try {
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
      console.error(`[mailer] send failed (${res.status}) to=${to}:`, body.message || body.name || 'unknown error');
      return null;
    }
    return body.id;
  } catch (err) {
    console.error(`[mailer] send error to=${to}:`, err.message);
    return null;
  }
}
