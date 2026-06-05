// allowance-key.js — PURE, importable allowance-cache key builder shared by the
// SimpleBond frontend (frontend/index.html and frontend/v6/index.html).
//
// Why this file exists (RCA gap #5 — allowanceCache not keyed by account): the
// ERC-20 allowance cache was keyed only by `${token}:${spender}`, with NO
// account and NO chainId. allowance() is read PER ACCOUNT on-chain, so the
// account-less key was wrong: connect account A (which approved the bond
// contract), then switch MetaMask to account B (which has NOT). The cache served
// A's allowance under the shared key, the UI SKIPPED the Approve step, and B's
// createBond/challenge tx REVERTED for insufficient allowance (and the reverse
// mis-fires too). allowanceKey() makes the cache key uniquely identify the
// (chainId, account, token, spender) tuple the allowance was actually read for,
// so a stored value can only ever be served back to the SAME account on the
// SAME chain.
//
// This module owns only the PURE key construction. It is deliberately DOM-free,
// chain-free and I/O-free (no provider, no reads, no Date.now) so it can be
// unit-tested directly from node. It is loaded as a plain <script> in the
// browser (exposing window.allowanceKey) and required() in tests
// (module.exports), mirroring frontend/phase.js / frontend/contract-probe.js.
//
// KEY SHAPE: `${chainId}:${account}:${token}:${spender}` — chainId coerced to a
// string; account/token/spender lowercased so case-different-but-equal inputs
// collapse to one key (addresses are case-insensitive). A null/undefined account
// is mapped to the literal 'noaccount' so the builder NEVER throws (e.g. if it
// is ever called before a wallet is connected); that sentinel is intentionally
// NOT a valid lowercased 0x address, so it can never collide with a real
// account's key.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;            // node: require('.../allowance-key.js')
  }
  if (root) {
    root.allowanceKey = api.allowanceKey;   // browser: window.allowanceKey(...)
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // Sentinel used when no account is connected. NOT a valid 0x address, so it
  // can never collide with a real (lowercased) account key.
  const NO_ACCOUNT = 'noaccount';

  // Lowercase a value that should be an address-like string. null/undefined/''
  // collapse to the NO_ACCOUNT sentinel (never throws); anything else is
  // String()-coerced then lowercased so a non-string (defensive) can't blow up.
  function lc(v) {
    if (v == null || v === '') return NO_ACCOUNT;
    return String(v).toLowerCase();
  }

  /**
   * Build the deterministic allowance-cache key for a (chainId, account, token,
   * spender) tuple. PURE.
   *
   * @param {object} args
   * @param {string|number} [args.chainId]  the active chain id (coerced to string).
   * @param {string} [args.account]   the connected account whose allowance was read.
   *                                   null/undefined => the 'noaccount' sentinel.
   * @param {string} args.token       the ERC-20 token address (lowercased).
   * @param {string} args.spender     the spender address (lowercased).
   * @returns {string}  `${chainId}:${account}:${token}:${spender}` — distinct per
   *   account and per chainId; identical for case-different-but-equal inputs.
   */
  function allowanceKey(args) {
    const a = args || {};
    const chainId = a.chainId == null ? '' : String(a.chainId);
    const account = a.account == null || a.account === '' ? NO_ACCOUNT : String(a.account).toLowerCase();
    const token = lc(a.token);
    const spender = lc(a.spender);
    return `${chainId}:${account}:${token}:${spender}`;
  }

  return { allowanceKey, NO_ACCOUNT };
});
