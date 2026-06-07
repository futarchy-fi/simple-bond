// bond-status.js — PURE, importable status-label logic shared by the SimpleBond
// v0.6 frontend (frontend/index.html and the byte-identical-body mirror
// frontend/v6/index.html).
//
// Why this file exists: the v0.6 contract collapses FOUR different bond endings
// into a single `settled` boolean (judge-void via rejectBond, poster reclaim via
// withdrawBond, ruling-window timeout via claimTimeout, and a merits ruling for
// the challenger via ruleForChallenger). The badge used to print the raw flag as
// "settled" for all of them, so a bond the judge VOIDED read identically to one
// that was contested and resolved. Likewise the per-challenge badge printed the
// raw ChallengeStatus enum — "Won"/"Lost" (ambiguous: a poster reading "Won"
// assumes THEY won, but Won means the CHALLENGER won) and the CamelCase
// "RejectedByJudge" identifier leaked straight to users.
//
// bondStatus() turns the on-chain flags + an OPTIONAL discriminated settle
// reason (which the caller derives from the settle events — see
// deriveSettleReason in index.html, the reason is NOT on the struct or in the
// indexer read model) into a precise badge label + a CSS class + a plain-English
// tooltip. challengeStatusLabel() maps the ChallengeStatus enum to unambiguous
// per-challenge labels.
//
// It is deliberately DOM-free, chain-free and ethers-free (no reads, no Date.now)
// so it can be unit-tested directly from node. It is loaded as a plain <script>
// in the browser (exposing window.bondStatus / window.challengeStatusLabel) and
// required() in tests (module.exports).
//
// ChallengeStatus enum — MUST mirror contracts/core/SimpleBondV6.sol:
//   0 Pending, 1 Won, 2 Lost, 3 Conceded, 4 RejectedByJudge, 5 Refunded
// (Won = ruleForChallenger; Lost = ruleForPoster.)
//
// SETTLE REASON vocabulary — one per settled() path in SimpleBondV6.sol:
//   'cancelled'        rejectBond        BondRejectedByJudge   (judge voids the bond; poster refunded)
//   'withdrawn'        withdrawBond      BondWithdrawn         (poster reclaims after closing, 0 pending)
//   'timed-out'        claimTimeout      BondTimedOut          (judge missed ruling window; poster refunded)
//   'ruled-challenger' ruleForChallenger RuledForChallenger    (merits ruling for challenger; bond lost)

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;            // node: require('.../bond-status.js')
  }
  if (root) {
    root.bondStatus = api.bondStatus;                   // browser: window.bondStatus(...)
    root.challengeStatusLabel = api.challengeStatusLabel;
    root.SETTLE_REASON = api.SETTLE_REASON;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // The discriminated settle reasons (mirrors the four settled() paths above).
  const SETTLE_REASON = Object.freeze({
    CANCELLED: 'cancelled',
    WITHDRAWN: 'withdrawn',
    TIMED_OUT: 'timed-out',
    RULED_CHALLENGER: 'ruled-challenger',
  });

  function mk(label, cls, title) { return { label: label, cls: cls, title: title }; }

  // ChallengeStatus enum → unambiguous per-challenge badge. `cls` is the CSS
  // suffix (status-${cls}); kept identical to the historical class names so the
  // existing badge colours are preserved. Only the human LABELS change.
  const CHALLENGE = Object.freeze([
    mk('Pending', 'pending', 'Filed and awaiting the concession window or a judge ruling.'),
    mk('Challenger won', 'won', 'The judge ruled for the challenger; the bond was lost.'),
    mk('Challenger lost', 'lost', 'The judge ruled for the poster; this challenge was dismissed.'),
    mk('Conceded', 'conceded', 'The poster conceded this challenge; the challenger was refunded.'),
    mk('Dismissed (out of scope)', 'rejectedbyjudge', 'The judge rejected this challenge as out-of-scope; the challenger was refunded.'),
    mk('Refunded', 'refunded', 'This challenge was still pending when the bond settled; the challenger was refunded.'),
  ]);

  // Map a numeric ChallengeStatus to { label, cls, title }. Defensive: any
  // out-of-range / non-numeric index returns a stable "Unknown" shape (never throws).
  function challengeStatusLabel(statusIdx) {
    const n = Number(statusIdx);
    return CHALLENGE[n] || mk('Unknown', 'pending', 'Unrecognised challenge status.');
  }

  // When the caller could not derive an explicit settle reason, we can still
  // recover the merits-ruling case for FREE from the per-challenge statuses we
  // already loaded: any challenge marked Won (1) means the bond settled via
  // ruleForChallenger. (cancelled / withdrawn / timed-out cannot be told apart
  // from challenge statuses alone — they need the settle event.)
  function inferReasonFromChallenges(challenges) {
    if (!Array.isArray(challenges)) return null;
    for (const c of challenges) {
      // Accept a raw status int, a flat { status }, OR the detail-view shape
      // { i, ch: { status }, timing } that the bond-detail callers actually pass.
      const s = (c && typeof c === 'object')
        ? Number(c.status != null ? c.status : (c.ch && c.ch.status))
        : Number(c);
      if (s === 1) return SETTLE_REASON.RULED_CHALLENGER;
    }
    return null;
  }

  /**
   * Pure bond-level status classifier.
   *
   * @param {object} input
   *   - settled {bool}        on-chain b.settled
   *   - closed  {bool}        on-chain b.closed
   *   - pendingCount {number|bigint} on-chain b.pendingCount
   *   - settleReason {string} OPTIONAL — one of SETTLE_REASON.* (derived by the
   *                           caller from the settle events). Wins over inference.
   *   - challenges {Array}    OPTIONAL — per-challenge {status} (or status ints),
   *                           used only to infer the ruled-challenger case for free.
   * @returns {{ label: string, cls: string, title: string }}
   *   - label: badge text shown to the user.
   *   - cls:   CSS suffix for `status-${cls}`.
   *   - title: plain-English tooltip explaining the state.
   */
  function bondStatus(input) {
    const i = input || {};
    const settled = !!i.settled;
    const closed = !!i.closed;
    const pending = Number(i.pendingCount || 0);

    if (settled) {
      const reason = i.settleReason || inferReasonFromChallenges(i.challenges);
      switch (reason) {
        case SETTLE_REASON.CANCELLED:
          return mk('Cancelled', 'cancelled', 'Voided by the judge — the bond was annulled and the poster refunded.');
        case SETTLE_REASON.WITHDRAWN:
          return mk('Withdrawn', 'withdrawn', 'The poster closed the bond and reclaimed it after all challenges resolved.');
        case SETTLE_REASON.TIMED_OUT:
          return mk('Settled (timed out)', 'settled', 'The judge missed the ruling window; the bond settled and the poster was refunded.');
        case SETTLE_REASON.RULED_CHALLENGER:
          return mk('Challenge upheld', 'upheld', 'The judge ruled for the challenger — the bond was lost.');
        default:
          return mk('Settled', 'settled', 'This bond is resolved.');
      }
    }
    if (closed) return mk('Closed', 'closed', 'No new challenges accepted; existing disputes still resolve, and the poster can reopen or withdraw.');
    if (pending > 0) return mk('Disputed', 'disputed', 'One or more challenges are open and under review.');
    return mk('Open', 'open', 'Live — anyone can challenge this claim.');
  }

  return { bondStatus, challengeStatusLabel, SETTLE_REASON };
});
