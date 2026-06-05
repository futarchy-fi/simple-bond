// async-util.js — PURE, importable async-timeout helper shared by the SimpleBond
// frontend (frontend/index.html and frontend/v6/index.html).
//
// Why this file exists (RCA gap #3 — a timeout/error masquerades as "empty"):
// the frontend's withTimeout(promise, ms, fallback) races a promise against a
// timer that RESOLVES to a caller-supplied fallback. On timeout it silently
// resolves to that fallback, so the caller cannot tell a timed-out read from a
// genuinely empty one. For the list-DETERMINING reads (BROWSE nextBondId, MY
// BONDS event scans, BONDS JUDGED event scan) that meant a timed-out network
// read returned 0n / [] and the UI rendered a misleading "no bonds" empty state
// instead of a visible, retryable error.
//
// withTimeoutResult(promise, ms) fixes that by NEVER collapsing the three
// outcomes together. It resolves (never rejects) to a TAGGED object so the
// caller can branch on what actually happened:
//   { status: 'ok', value }      — the promise resolved first.
//   { status: 'error', error }   — the promise rejected first.
//   { status: 'timeout' }        — ms elapsed before the promise settled.
//
// The promise outcome always WINS over the timer when it settles first: we race
// a wrapper promise that maps resolve -> {ok}/reject -> {error} against a timer
// that resolves to {timeout}; whichever settles first wins the Promise.race, and
// because the wrapper never rejects, withTimeoutResult itself never rejects.
//
// This module owns only the PURE classification. It is deliberately DOM-free,
// chain-free and I/O-free (no provider, no reads, no Date.now / clock access) so
// it can be unit-tested directly from node with small ms. It is loaded as a
// plain <script> in the browser (exposing window.withTimeoutResult) and
// required() in tests (module.exports), mirroring frontend/phase.js /
// frontend/contract-probe.js / frontend/allowance-key.js.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;            // node: require('.../async-util.js')
  }
  if (root) {
    root.withTimeoutResult = api.withTimeoutResult;   // browser: window.withTimeoutResult(...)
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  /**
   * Race a promise against a timeout, returning a TAGGED result that
   * distinguishes resolve / reject / timeout. NEVER rejects.
   *
   * @param {Promise<*>} promise  the work to await (e.g. an on-chain read).
   * @param {number} ms           the timeout budget in milliseconds.
   * @returns {Promise<{status:'ok',value:*}|{status:'error',error:*}|{status:'timeout'}>}
   *   - { status: 'ok', value }    if `promise` resolves before the timer.
   *   - { status: 'error', error } if `promise` rejects before the timer.
   *   - { status: 'timeout' }      if `ms` elapses before `promise` settles.
   *   The promise outcome wins whenever it settles first; the returned promise
   *   never rejects (a rejection is reported as { status:'error' }).
   */
  function withTimeoutResult(promise, ms) {
    // Wrap the work so its settlement maps to a tagged object and can never
    // reject — that way it always wins the race when it settles first, and
    // withTimeoutResult itself never rejects.
    const wrapped = Promise.resolve(promise).then(
      (value) => ({ status: 'ok', value }),
      (error) => ({ status: 'error', error })
    );
    const timer = new Promise((resolve) => {
      setTimeout(() => resolve({ status: 'timeout' }), ms);
    });
    return Promise.race([wrapped, timer]);
  }

  return { withTimeoutResult };
});
