// refunds.js — PURE, importable refund accounting shared by the SimpleBond v0.6
// frontend (frontend/index.html and frontend/v6/index.html).
//
// Why this file exists: the bond-detail "Refunds" card used to render ALWAYS,
// with a permissionless "Drain refunds" button wired to claimRefunds(). On most
// bonds that button does nothing — claimRefunds() only touches challenges that
// are still Pending on a SETTLED bond, so an always-on card invites a no-op,
// gas-wasting transaction and confuses conceded/rejected challengers (who were
// already refunded). computeRefunds() turns the per-challenge statuses + the
// bond's settled flag into a count of what is ACTUALLY drainable right now, plus
// what the connected viewer is owed, so the UI can hide the drain control unless
// it will do something and show a precise "you are owed $X (N slots)" affordance.
//
// It is deliberately DOM-free and chain-free (no reads, no Date.now, no ethers)
// so it can be unit-tested directly from node. It is loaded as a plain <script>
// in the browser (exposing window.computeRefunds) and required() in tests
// (module.exports), mirroring frontend/phase.js.
//
// ChallengeStatus enum — MUST mirror contracts/core/SimpleBondV6.sol:
//   0 Pending, 1 Won, 2 Lost, 3 Conceded, 4 RejectedByJudge, 5 Refunded
//
// CONTRACT REFUND TRUTH (verified against SimpleBondV6.sol):
//   - claimRefunds(bondId, maxCount) requires `b.settled` and ONLY acts on
//     challenges whose status is Pending(0): it sets them to Refunded(5) and
//     transfers challengeAmount back to the challenger. NOTHING else is drained.
//   - Conceded(3) and RejectedByJudge(4) were ALREADY refunded inline at the
//     moment of concede()/rejectChallenge() — the challenger already holds the
//     money. They are terminal and NOT drainable; counting them would make the
//     drain button a no-op for those slots.
//   - Refunded(5) has already been drained — excluded.
//   - Won(1)/Lost(2) are ruled outcomes, never refunded via claimRefunds.
//
// THEREFORE the ONLY drainable slot is: bond.settled === true AND status === 0
// (Pending). That is exactly what makes the on-chain claimRefunds() do work, and
// exactly when we should surface the drain control. (The task brief's parenthetical
// lumped Conceded/Rejected into "refundable", but those are already paid out and
// claimRefunds() skips them — the contract is the source of truth, and surfacing
// them would resurrect the no-op gas-waste this change is removing.)

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;            // node: require('.../refunds.js')
  }
  if (root) {
    root.computeRefunds = api.computeRefunds;   // browser: window.computeRefunds(...)
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // ChallengeStatus.Pending — the only status claimRefunds() acts on.
  const STATUS_PENDING = 0;

  // Normalise a status that may arrive as a number, bigint, or numeric string
  // (ethers returns bigints for uint8 enums) to a plain Number for comparison.
  // IMPORTANT: ethers v6 Challenge structs are array-like Result proxies where
  // `'status' in ch` is FALSE even though `ch.status` reads fine, so we MUST NOT
  // use the `in` operator to detect the wrapped shape — read `.status` directly
  // and only treat the value as a bare status when `.status` is absent.
  function statusOf(ch) {
    if (ch == null) return -1;
    if (typeof ch === 'object') {
      const v = ch.status;
      return Number(v != null ? v : ch);
    }
    return Number(ch);
  }

  // Normalise an address-ish value to a lowercase string, or '' when absent.
  function addr(a) {
    return a ? String(a).toLowerCase() : '';
  }

  // Coerce a (possibly bigint) amount to bigint; default 0n on anything falsy
  // or unparseable so the caller's USD formatter shows $0.00 rather than NaN.
  function toBig(x) {
    if (typeof x === 'bigint') return x;
    if (x == null || x === '') return 0n;
    try { return BigInt(x); } catch (_) { return 0n; }
  }

  /**
   * Pure refund accounting for a bond's challenge list.
   *
   * A slot is "refundable" (i.e. claimRefunds() would actually move money for it)
   * ONLY when the bond is settled AND the challenge is still Pending(0). See the
   * CONTRACT REFUND TRUTH note above — conceded/rejected/refunded slots are not
   * drainable.
   *
   * @param {Array} challenges  per-challenge entries. Each may be either the raw
   *                            on-chain Challenge ({ challenger, status, ... }) or
   *                            a wrapper ({ ch: Challenge, ... }) as produced by
   *                            renderBondDetailRpc — both shapes are accepted.
   * @param {object} bond       the bond struct; only `settled` is read.
   * @param {string} viewerAddress  the connected account (or null/undefined).
   * @returns {{ refundableSlots: number, viewerOwedSlots: number, viewerOwedShares: bigint }}
   *   - refundableSlots: count of ALL slots anyone could currently drain.
   *   - viewerOwedSlots: subset of those whose challenger === viewerAddress.
   *   - viewerOwedShares: viewerOwedSlots * bond.challengeAmount (in token shares,
   *     bigint), ready for the canonical USD formatter. 0n when nothing is owed.
   */
  function computeRefunds(challenges, bond, viewerAddress) {
    const list = Array.isArray(challenges) ? challenges : [];
    const settled = !!(bond && bond.settled);
    const challengeAmount = toBig(bond && bond.challengeAmount);
    const viewer = addr(viewerAddress);

    let refundableSlots = 0;
    let viewerOwedSlots = 0;

    // Only a settled bond can have drainable Pending slots; on an unsettled bond
    // nothing is drainable (and the contract's require(b.settled) would revert).
    if (settled) {
      for (const entry of list) {
        // Accept both the renderBondDetailRpc wrapper { i, ch, timing } and a raw
        // Challenge. Read `.ch` directly (never `in`, which is unreliable on
        // ethers v6 Result proxies) and fall back to the entry itself.
        const ch = (entry && typeof entry === 'object' && entry.ch != null) ? entry.ch : entry;
        if (statusOf(ch) !== STATUS_PENDING) continue;
        refundableSlots += 1;
        const challenger = addr(ch && ch.challenger);
        if (viewer && challenger && challenger === viewer) viewerOwedSlots += 1;
      }
    }

    return {
      refundableSlots,
      viewerOwedSlots,
      viewerOwedShares: challengeAmount * BigInt(viewerOwedSlots),
    };
  }

  return { computeRefunds, STATUS_PENDING };
});
