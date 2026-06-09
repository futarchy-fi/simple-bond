// claim-verify.js — PURE verification that the DISPLAYED claim text actually
// hashes to the bond's ON-CHAIN claimHash. Shared by the SimpleBond v0.6
// frontend (frontend/index.html and the byte-identical-body mirror
// frontend/v6/index.html).
//
// Why this file exists (security finding H3): the bond detail view shows claim
// text supplied by the off-chain INDEXER (it is not re-derived from chain logs),
// while the on-chain `claimHash` is read live via RPC. Nothing checked that the
// shown text matches the hash — so a malicious/compromised indexer could display
// one claim while a challenger stakes against, or a judge rules on, a DIFFERENT
// on-chain claim. This helper lets the UI detect the mismatch and refuse to
// surface challenge/ruling actions until the text is verified.
//
// The contract computes `claimHash = keccak256(bytes(content))`, so the caller
// passes `hashFn = (s) => ethers.keccak256(ethers.toUtf8Bytes(s))`. Kept
// hash-function-injected so this module stays DOM-free, chain-free and
// ethers-free (node-importable + unit-testable).
//
// status:
//   'verified' — text present AND its hash equals the on-chain claimHash (safe).
//   'mismatch' — text present but hash DIFFERS (forged/stale — gate actions, warn).
//   'unknown'  — no text shown, or no valid on-chain hash to compare against, or
//                the hash function threw. Nothing misleading is displayed, so the
//                UI need not gate on it (the raw on-chain hash is still shown).

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;            // node: require('.../claim-verify.js')
  }
  if (root) {
    root.claimVerification = api.claimVerification;   // browser: window.claimVerification(...)
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

  /**
   * @param {string} claimContent  the displayed (indexer-supplied) claim text
   * @param {string} onchainHash   the live on-chain b.claimHash (0x + 64 hex)
   * @param {function} hashFn       (text) -> 0x-hash, e.g. ethers keccak256(utf8)
   * @returns {{ status: 'verified'|'mismatch'|'unknown', computed: string|null }}
   */
  function claimVerification(claimContent, onchainHash, hashFn) {
    const content = claimContent == null ? '' : String(claimContent);
    const onchain = onchainHash == null ? '' : String(onchainHash);
    if (content === '' || !HASH_RE.test(onchain)) return { status: 'unknown', computed: null };
    if (typeof hashFn !== 'function') return { status: 'unknown', computed: null };
    let computed = null;
    try { computed = String(hashFn(content)); } catch (_) { return { status: 'unknown', computed: null }; }
    if (!HASH_RE.test(computed)) return { status: 'unknown', computed: null };
    return { status: computed.toLowerCase() === onchain.toLowerCase() ? 'verified' : 'mismatch', computed };
  }

  return { claimVerification };
});
