// notify.js — PURE, importable helpers for the opt-in notification flow shared by
// the SimpleBond v0.6 frontend (frontend/index.html and frontend/v6/index.html).
//
// Why this file exists: the notify bell POSTs to the existing backend at
// POST /api/notify/register and reads GET /api/notify/status. The exact
// request/response contract is defined ONCE here so the UI and its unit test
// can't drift from the backend (backend/api-server.mjs handleRegister/handleStatus).
//
// It is deliberately DOM-free, chain-free and fetch-free (no reads, no network,
// no Date.now baked in) so it can be unit-tested directly from node. It is loaded
// as a plain <script> in the browser (exposing window.SimpleBondNotify) and
// required() in tests (module.exports).
//
// CONTRACT TRUTH (verified against backend/api-server.mjs):
//   POST /api/notify/register  body: { address, email, chainId, signature, timestamp }
//     - timestamp is UNIX SECONDS and must be within TIMESTAMP_WINDOW_SEC of now.
//     - signature is a personal_sign over the EXACT message string below.
//     - the signed message is:
//         `Enable SimpleBond notifications for ${email} on chain ${chainId}. Timestamp: ${timestamp}`
//     - the recovered signer MUST equal `address` (case-insensitive).
//     - 200 -> { ok: true, message }. Note: the backend's message string says a
//       verification email was "sent", but email delivery is STUBBED today
//       (backend/mailer.mjs EMAIL_ENABLED=false) — so the UI MUST NOT echo that
//       as a delivery promise. We treat 200 as "subscription recorded".
//
//   GET /api/notify/status?address=<addr>&chain=<chainId>
//     - not subscribed -> { registered: false }
//     - subscribed     -> { registered: true, verified: <bool>, email: "<masked>" }

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;            // node: require('.../notify.js')
  }
  if (root) {
    root.SimpleBondNotify = api;     // browser: window.SimpleBondNotify
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // Build the EXACT message string the backend re-derives and verifies the
  // signature against. Any drift here makes every signature fail with a 403, so
  // this is the single source of truth mirrored from handleRegister().
  function notifyRegisterMessage(email, chainId, timestamp) {
    return `Enable SimpleBond notifications for ${email} on chain ${chainId}. Timestamp: ${timestamp}`;
  }

  // Lightweight client-side email sanity check. The backend is authoritative
  // (it re-validates with the same shape), but checking here lets us show an
  // honest inline error before asking the wallet to sign.
  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
  }

  // Assemble the POST /api/notify/register body. Throws on missing fields so a
  // malformed request can never be sent silently. chainId is coerced to Number
  // and timestamp to an integer (unix seconds) to match the backend's checks.
  function buildNotifyRegisterPayload({ address, email, chainId, signature, timestamp }) {
    const e = String(email || '').trim();
    if (!address) throw new Error('Missing wallet address');
    if (!e) throw new Error('Missing email');
    if (chainId == null || chainId === '') throw new Error('Missing chainId');
    if (!signature) throw new Error('Missing signature');
    if (timestamp == null || timestamp === '') throw new Error('Missing timestamp');
    if (!isValidEmail(e)) throw new Error('Invalid email format');
    return {
      address: String(address),
      email: e,
      chainId: Number(chainId),
      signature: String(signature),
      timestamp: Math.floor(Number(timestamp)),
    };
  }

  // Interpret GET /api/notify/status (or a 200 register response we want to
  // reflect optimistically) into a small UI state object. Pure — no copy with a
  // false email-delivery promise lives here; callers own the user-facing strings.
  //   state: 'none' | 'subscribed' | 'verified'
  function interpretNotifyStatus(json) {
    if (!json || typeof json !== 'object' || !json.registered) {
      return { state: 'none', registered: false, verified: false, email: '' };
    }
    const verified = !!json.verified;
    return {
      state: verified ? 'verified' : 'subscribed',
      registered: true,
      verified,
      email: typeof json.email === 'string' ? json.email : '',
    };
  }

  return {
    notifyRegisterMessage,
    isValidEmail,
    buildNotifyRegisterPayload,
    interpretNotifyStatus,
  };
});
