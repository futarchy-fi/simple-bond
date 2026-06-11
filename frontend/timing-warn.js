// timingWarning(acceptanceDelay, rulingBuffer) — pure advisory for the create
// wizard's Timing step (audit M6). v0.6 does NOT enforce a minimum ruling
// window, so a poster can set a window too short for any judge to rule in —
// `claimTimeout` then settles every challenge in the poster's favor. v0.7
// enforces MIN_RULING_BUFFER on-chain, but the create UI still serves v6 cores,
// so we warn rather than block.
//
// Returns null when the timing is fine, or { level, text } when it warrants a
// caution. DOM-free / chain-free / ethers-free so it unit-tests from node and
// loads as a plain <script> (window.timingWarning) in the browser.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.timingWarning = api.timingWarning;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const HOUR = 3600;
  // Below this, no honest judge could realistically observe + rule a challenge
  // before the window closes. Mirrors v0.7's on-chain MIN_RULING_BUFFER.
  const MIN_SAFE_RULING = HOUR;
  // A merely tight (but not dangerous) window worth flagging softly.
  const TIGHT_RULING = 6 * HOUR;

  function fmt(sec) {
    if (sec % 86400 === 0) return (sec / 86400) + 'd';
    if (sec % 3600 === 0) return (sec / 3600) + 'h';
    if (sec % 60 === 0) return (sec / 60) + 'm';
    return sec + 's';
  }

  function timingWarning(acceptanceDelay, rulingBuffer) {
    const rb = Number(rulingBuffer);
    if (!Number.isFinite(rb) || rb <= 0) {
      return { level: 'error', text: 'Ruling buffer must be greater than 0.' };
    }
    if (rb < MIN_SAFE_RULING) {
      return {
        level: 'error',
        text: `Ruling buffer is only ${fmt(rb)} — too short for a judge to realistically rule. ` +
          `A challenge would almost always time out in the poster's favor. Use at least 1h (v0.7 enforces this on-chain).`,
      };
    }
    if (rb < TIGHT_RULING) {
      return {
        level: 'warn',
        text: `Ruling buffer of ${fmt(rb)} is tight — make sure your judge can act within it, ` +
          `or honest challenges may time out for the poster.`,
      };
    }
    return null;
  }

  return { timingWarning };
});
