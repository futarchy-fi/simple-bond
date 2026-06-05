// contract-probe.js — PURE, importable contract-presence logic shared by the
// SimpleBond frontend (frontend/index.html and frontend/v6/index.html).
//
// Why this file exists (RCA gap #6 — getCode page-chain probe): a real user
// landed on a chain where the configured bondContract address had NO bytecode
// (wrong network selected, or a stale/misconfigured address). Every read came
// back empty and every write hit a cryptic, low-level revert ("No contract code
// at 0x… on Ethereum" / silent empty reads) with nothing telling the user WHY.
// We now probe provider.getCode(bondContract) once per chain and, on genuine
// absence, fail CLOSED with a clear message and block writes — but a flaky RPC
// (getCode threw) must NOT brick a real deployment, so that case is transient.
//
// This module owns only the PURE classification + user-facing copy. It is
// deliberately DOM-free, chain-free and I/O-free (no provider, no getCode call,
// no Date.now) so it can be unit-tested directly from node. The actual getCode
// call + per-(chainId,address) caching + write-blocking live in index.html,
// which feeds the raw code string (or a thrown-error sentinel) in here.
//
// It is loaded as a plain <script> in the browser (exposing
// window.classifyContractCode / window.contractPresenceMessage) and required()
// in tests (module.exports), mirroring frontend/phase.js.
//
// STATES returned by classifyContractCode():
//   'present' — a hex string with real deployed bytecode at the address.
//   'absent'  — null/undefined/empty/'0x'/'0X'/'0x0' (case-insensitive, trimmed):
//               eth_getCode returns '0x' for an address with no code. This is the
//               genuine-absence signal we fail closed on.
//   'unknown' — the input is not a string at all (e.g. a thrown-error sentinel
//               the caller passes in when getCode rejected). Treated as a
//               transport/RPC problem, NOT a confirmed absence — never hard-block.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;            // node: require('.../contract-probe.js')
  }
  if (root) {
    // browser: window.classifyContractCode(...) / window.contractPresenceMessage(...)
    root.classifyContractCode = api.classifyContractCode;
    root.contractPresenceMessage = api.contractPresenceMessage;
    root.CONTRACT_PRESENCE = api.CONTRACT_PRESENCE;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const CONTRACT_PRESENCE = Object.freeze({
    PRESENT: 'present',
    ABSENT: 'absent',
    UNKNOWN: 'unknown',
  });

  /**
   * Classify the result of an eth_getCode call into a presence state. PURE.
   *
   * @param {*} code  Either the hex string returned by provider.getCode(addr),
   *                  or a NON-string sentinel (e.g. an Error / null-ish marker)
   *                  the caller passes when getCode threw. Note: getCode never
   *                  resolves to null/undefined in practice — those are folded
   *                  into 'absent' defensively, while a non-string (which only
   *                  happens when the caller hands us a thrown sentinel) is the
   *                  'unknown'/transport signal.
   * @returns {'present'|'absent'|'unknown'}
   */
  function classifyContractCode(code) {
    // A real getCode result is always a hex string. Anything that is not a
    // string at all means the caller is signalling a transport failure (it
    // passed us the thrown error / a non-string sentinel) — that is 'unknown',
    // NOT a confirmed absence, so callers must not hard-block on it.
    if (typeof code !== 'string') {
      // null / undefined are the one exception: defensively treat a missing
      // string the same as an empty-code answer ('absent') rather than as a
      // transport error, since a provider that resolves to nullish is still a
      // resolved (non-throwing) read.
      if (code == null) return CONTRACT_PRESENCE.ABSENT;
      return CONTRACT_PRESENCE.UNKNOWN;
    }
    const trimmed = code.trim().toLowerCase();
    // eth_getCode returns '0x' for an address with no deployed bytecode. Also
    // fold the empty string and the degenerate '0x0' into absence.
    if (trimmed === '' || trimmed === '0x' || trimmed === '0x0') {
      return CONTRACT_PRESENCE.ABSENT;
    }
    return CONTRACT_PRESENCE.PRESENT;
  }

  /**
   * User-facing message for a probe verdict. PURE.
   *
   * @param {object} args
   * @param {'present'|'absent'|'unknown'} args.state  verdict from classifyContractCode.
   * @param {string} [args.address]    the configured bondContract address.
   * @param {string} [args.chainName]  human chain name (e.g. 'Ethereum', 'Sepolia').
   * @returns {string}  '' for 'present'; an explicit fail-closed message for
   *                    'absent'; a transient transport message for 'unknown'.
   */
  function contractPresenceMessage(args) {
    const a = args || {};
    const address = a.address ? String(a.address) : 'the configured address';
    const chainName = a.chainName ? String(a.chainName) : 'this network';
    switch (a.state) {
      case CONTRACT_PRESENCE.ABSENT:
        return `No SimpleBond contract found at ${address} on ${chainName}. `
          + `You may be on the wrong network, or the app is misconfigured.`;
      case CONTRACT_PRESENCE.UNKNOWN:
        return `Could not verify the SimpleBond contract at ${address} on ${chainName} — `
          + `network/RPC issue. This is usually transient; try again.`;
      case CONTRACT_PRESENCE.PRESENT:
      default:
        return '';
    }
  }

  return { classifyContractCode, contractPresenceMessage, CONTRACT_PRESENCE };
});
