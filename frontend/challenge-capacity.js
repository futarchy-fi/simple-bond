// challenge-capacity.js — PURE, importable challenge-capacity gate shared by the
// SimpleBond frontend (frontend/index.html and frontend/v6/index.html).
//
// Why this file exists (backlog #1 — challenge-capacity gate is wrong on the LIVE
// mainnet v6 chain): the two contracts cap challenge() DIFFERENTLY:
//   - SimpleBondV6.sol (LIVE on mainnet): require(challenges[bondId].length <
//     b.maxChallenges, "Max challenges reached") — caps on TOTAL-EVER filed.
//   - SimpleBondV7.sol (Sepolia): require(b.pendingCount < b.maxChallenges, "Max
//     pending challenges reached") — caps on the LIVE pending set.
// The frontend used to gate BOTH on pendingCount, so on a v6 bond where
// maxChallenges challenges had already been filed-and-resolved (pendingCount back
// to 0, but challenges[].length == maxChallenges) the UI STILL showed the full
// Challenge card — the user paid a real ERC-20 approve tx and a challenge() tx
// that then reverted "Max challenges reached". Real wasted gas on production.
//
// hasChallengeCapacity() encodes the version-correct gate so the UI matches the
// contract that is actually live on the active chain:
//   - v7  => Number(pendingCount)   < Number(maxChallenges)  (pending-at-once cap)
//   - v6  => Number(challengeCount) < Number(maxChallenges)  (total-ever cap)
// (challengeCount == challenges[].length == getChallengeCount(bondId)).
//
// This module owns only the PURE gate. It is deliberately DOM-free, chain-free
// and I/O-free (no provider, no reads, no Date.now) so it can be unit-tested
// directly from node. It is loaded as a plain <script> in the browser (exposing
// window.hasChallengeCapacity) and required() in tests (module.exports),
// mirroring frontend/phase.js / frontend/async-util.js / frontend/allowance-key.js.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;                       // node: require('.../challenge-capacity.js')
  }
  if (root) {
    root.hasChallengeCapacity = api.hasChallengeCapacity;   // browser: window.hasChallengeCapacity(...)
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  /**
   * Is there room to file another challenge on this bond? VERSION-AWARE so the UI
   * gate matches the contract that is LIVE on the active chain. PURE.
   *
   * @param {object} args
   * @param {number|string} [args.bondVersion]   active chain bondVersion. 7 => v0.7
   *   (pending-at-once cap); anything else (6 / undefined / null) => v0.6 default
   *   (total-ever-filed cap). Coerced via Number.
   * @param {number|string|bigint} [args.pendingCount]    b.pendingCount — the LIVE
   *   pending challenge count. Used as the v7 gate input.
   * @param {number|string|bigint} [args.challengeCount]  challenges[].length (==
   *   getChallengeCount(bondId)) — TOTAL ever filed. Used as the v6 gate input.
   * @param {number|string|bigint} [args.maxChallenges]   b.maxChallenges — the cap.
   *   Missing/undefined coerces (via Number) to 0 => NO capacity (returns false),
   *   so a failed read can never wrongly show the Challenge card.
   * @returns {boolean}  true iff another challenge may be filed under the active
   *   chain's contract rule.
   */
  function hasChallengeCapacity(args) {
    const a = args || {};
    const max = Number(a.maxChallenges);
    // Missing / non-numeric max => no capacity. Never throws; fails CLOSED.
    if (!Number.isFinite(max) || max <= 0) return false;
    if (Number(a.bondVersion) === 7) {
      // v0.7 (Sepolia): cap on the LIVE pending set.
      return Number(a.pendingCount) < max;
    }
    // v0.6 (mainnet, LIVE) / default: cap on TOTAL ever filed.
    return Number(a.challengeCount) < max;
  }

  return { hasChallengeCapacity };
});
