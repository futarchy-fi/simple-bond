// credits-banner.js — PURE, importable My-Bonds claimable-credits banner markup
// decision shared by the SimpleBond frontend (frontend/index.html and the
// byte-identical-body mirror frontend/v6/index.html).
//
// Why this file exists (backlog #2 — v0.7 pull-payment is undiscoverable): on
// SimpleBondV7.sol (Sepolia/staging) the C2 change replaced PUSHED refunds with a
// PULL ledger — every refund/payout is credited to credits[recipient][token] and
// drained by claim(token). Because nothing is pushed any more, a user owed credit
// only discovers it by revisiting the EXACT per-bond detail page while connected
// (and the email prompt is stubbed). That is the central UX regression of the
// push->pull switch.
//
// The fix surfaces a GLOBAL "you have $X claimable" banner on the My Bonds page
// for v0.7 chains. myCreditsBannerHtml() is the PURE markup-decision core: given a
// credit amount (in token shares, bigint) and the already-formatted USD string, it
// returns "" when there is nothing to claim (credit <= 0) and otherwise the
// msg-success banner HTML with a Claim affordance. It is deliberately DOM-free,
// chain-free and I/O-free (no provider, no reads, no Date.now, no ethers) so it can
// be unit-tested directly from node and NEVER throws.
//
// On v0.6 (mainnet, LIVE) NONE of this runs — refunds are still pushed inline, so
// the My Bonds caller never invokes this helper and the v6 behaviour is byte-identical.
//
// It is loaded as a plain <script> in the browser (exposing window.myCreditsBannerHtml)
// and required() in tests (module.exports), mirroring frontend/phase.js /
// async-util.js / allowance-key.js / challenge-capacity.js.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;                       // node: require('.../credits-banner.js')
  }
  if (root) {
    root.myCreditsBannerHtml = api.myCreditsBannerHtml;   // browser: window.myCreditsBannerHtml(...)
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // Coerce a (possibly bigint / numeric-string / number) credit to bigint;
  // anything falsy or unparseable becomes 0n so the banner stays hidden rather
  // than throwing on a malformed read. NEVER throws.
  function toBig(x) {
    if (typeof x === 'bigint') return x;
    if (x == null || x === '') return 0n;
    try { return BigInt(x); } catch (_) { return 0n; }
  }

  /**
   * Pure My-Bonds claimable-credits banner markup decision (v0.7 only). PURE.
   *
   * @param {object} args
   * @param {bigint|number|string} [args.creditWei]  the connected account's credit
   *   for the chain's canonical token (in token shares). <= 0 => no banner ("").
   * @param {string} [args.usdStr]  the ALREADY-formatted USD display string (the
   *   caller routes creditWei through the canonical susdsBigIntToUsdString so the
   *   dollars agree with every other view; on a rate miss this is the shared "—"
   *   placeholder). Rendered verbatim into the banner copy and the button label.
   * @returns {string}  "" when there is nothing claimable (creditWei <= 0n),
   *   otherwise the msg-success banner HTML carrying a #myCreditsClaimBtn affordance.
   */
  function myCreditsBannerHtml(args) {
    const a = args || {};
    const credit = toBig(a.creditWei);
    // Nothing owed (or a negative/garbage read) => render no banner at all.
    if (credit <= 0n) return '';
    const usd = (a.usdStr == null) ? '—' : String(a.usdStr);
    return `<div class="msg msg-success" id="myCreditsBannerInner" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
        <span>You have ~$${usd} claimable across your bonds.</span>
        <button class="secondary" id="myCreditsClaimBtn">Claim ~$${usd}</button>
      </div>
      <div id="myCreditsMsg"></div>`;
  }

  return { myCreditsBannerHtml, toBig };
});
