// rule-fee.js — PURE, importable judge-ruling fee parser shared by the SimpleBond
// v0.6 frontend (frontend/index.html and the byte-identical-body mirror
// frontend/v6/index.html).
//
// Why this file exists (MED-3 — doRule parsed the fee with HARDCODED 18 decimals):
// the per-challenge ruling form renders the fee input with the TOKEN's REAL
// decimals — challengeHtml() uses ethers.formatUnits(b.judgeFee, tokenDec) and the
// default value ethers.formatUnits(b.judgeFee, tokenDec). But doRule() parsed that
// same string back with a HARDCODED 18:
//     let fee = ethers.parseUnits(feeStr, 18);
//     if (fee > b.judgeFee) fee = b.judgeFee;   // silent clamp
// For any non-18-decimal token this corrupts the on-chain amount. Example — a
// 6-decimal token, judgeFee 0.5 (== 500000 base units, 0.5e6):
//   - rendered default = formatUnits(500000, 6) = "0.5"
//   - OLD parse        = parseUnits("0.5", 18) = 500000000000000000 (0.5e18)
//     -> 0.5e18 >> b.judgeFee (500000), so the clamp silently capped it to the
//        FULL judgeFee; the operator could not charge a SMALLER fee, and the
//        figure the wallet showed bore no relation to the "0.5" they typed.
//   - CORRECT parse    = parseUnits("0.5", 6) = 500000 == b.judgeFee (exact).
//
// parseRuleFee() does the version-correct parse + the SAME clamp, using the token's
// real decimals — the SAME decimals the input was rendered with. It is deliberately
// DOM-free, chain-free and I/O-free (it takes ethers' parseUnits as an injected
// dependency so it stays node-importable without bundling ethers). It is loaded as
// a plain <script> in the browser (exposing window.parseRuleFee) and required() in
// tests (module.exports), mirroring frontend/phase.js / banner.js /
// challenge-capacity.js / credits-banner.js.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;                 // node: require('.../rule-fee.js')
  }
  if (root) {
    root.parseRuleFee = api.parseRuleFee; // browser: window.parseRuleFee(...)
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  /**
   * Parse a judge-ruling fee string into the on-chain base-unit amount, using the
   * TOKEN's real decimals (the SAME decimals the input was rendered with), then
   * clamp to judgeFee. PURE.
   *
   * @param {object} args
   * @param {string} args.feeStr      the (possibly empty) fee input string. When
   *   empty/undefined, falls back to the full judgeFee (formatted+reparsed with the
   *   same decimals, i.e. exactly judgeFee).
   * @param {bigint} args.judgeFee    b.judgeFee — the on-chain cap, in base units.
   * @param {number} args.tokenDec    the token's decimals (the SAME value the input
   *   was rendered with via formatUnits). Coerced to an integer; defaults to 18 only
   *   when missing/non-finite.
   * @param {function} args.parseUnits  ethers.parseUnits (injected so this stays
   *   node-importable without bundling ethers). (value: string, decimals: number)
   *   => bigint.
   * @returns {bigint}  the fee to send: parseUnits(feeStr, tokenDec), clamped so it
   *   never exceeds judgeFee. Never NaN/undefined.
   */
  function parseRuleFee(args) {
    const a = args || {};
    const parseUnits = a.parseUnits;
    if (typeof parseUnits !== 'function') {
      throw new Error('parseRuleFee requires an injected ethers.parseUnits');
    }
    const judgeFee = typeof a.judgeFee === 'bigint' ? a.judgeFee : BigInt(a.judgeFee || 0);
    let dec = Number(a.tokenDec);
    if (!Number.isFinite(dec)) dec = 18;
    dec = Math.trunc(dec);
    // Fallback to the full judgeFee when no input was given — formatted+reparsed
    // with the SAME decimals so it round-trips to exactly judgeFee.
    const feeStr = (a.feeStr === undefined || a.feeStr === null || a.feeStr === '')
      ? null
      : String(a.feeStr);
    let fee = feeStr === null ? judgeFee : parseUnits(feeStr, dec);
    if (fee > judgeFee) fee = judgeFee;
    return fee;
  }

  return { parseRuleFee };
});
