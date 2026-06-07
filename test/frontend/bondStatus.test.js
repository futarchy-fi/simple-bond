// Unit tests for the pure status-label helper frontend/bond-status.js.
//
// Locks in the contract truth that the helper encodes:
//  - The v0.6 `settled` boolean fans out into FOUR distinct user-facing
//    outcomes, discriminated ONLY by the settle reason the caller supplies
//    (cancelled / withdrawn / timed-out / ruled-challenger), with a generic
//    "Settled" fallback when the reason is unknown.
//  - The ruled-challenger case is recoverable for free from a Won (status 1)
//    challenge when no explicit reason is given.
//  - The per-challenge ChallengeStatus enum (0..5) maps to UNAMBIGUOUS labels:
//    "Won"/"Lost" become "Challenger won"/"Challenger lost" (a poster must never
//    read a bare "Won" and think they won), and "RejectedByJudge" becomes the
//    human "Dismissed (out of scope)".

const { expect } = require("chai");
const { bondStatus, challengeStatusLabel, SETTLE_REASON } = require("../../frontend/bond-status.js");

describe("bond-status helper (pure)", function () {
  it("is a genuinely importable pure module with a stable shape", function () {
    expect(bondStatus).to.be.a("function");
    expect(challengeStatusLabel).to.be.a("function");
    const out = bondStatus({ settled: false, closed: false, pendingCount: 0 });
    expect(out).to.have.all.keys(["label", "cls", "title"]);
    const c = challengeStatusLabel(0);
    expect(c).to.have.all.keys(["label", "cls", "title"]);
    expect(SETTLE_REASON).to.deep.equal({
      CANCELLED: "cancelled", WITHDRAWN: "withdrawn",
      TIMED_OUT: "timed-out", RULED_CHALLENGER: "ruled-challenger",
    });
  });

  describe("bondStatus — non-terminal states", function () {
    it("open: not settled, not closed, no pending", function () {
      const s = bondStatus({ settled: false, closed: false, pendingCount: 0 });
      expect(s.label).to.equal("Open");
      expect(s.cls).to.equal("open");
      expect(s.title).to.match(/challenge/i);
    });
    it("disputed: pending challenges, not closed/settled", function () {
      const s = bondStatus({ settled: false, closed: false, pendingCount: 2 });
      expect(s.label).to.equal("Disputed");
      expect(s.cls).to.equal("disputed");
    });
    it("disputed: tolerates bigint pendingCount", function () {
      const s = bondStatus({ settled: false, closed: false, pendingCount: 1n });
      expect(s.label).to.equal("Disputed");
    });
    it("closed: closed but not settled (closed wins over a pending count)", function () {
      const s = bondStatus({ settled: false, closed: true, pendingCount: 3 });
      expect(s.label).to.equal("Closed");
      expect(s.cls).to.equal("closed");
    });
  });

  describe("bondStatus — settled fans out by settle reason", function () {
    const base = { settled: true, closed: false, pendingCount: 0 };
    it("cancelled (rejectBond / BondRejectedByJudge)", function () {
      const s = bondStatus({ ...base, settleReason: SETTLE_REASON.CANCELLED });
      expect(s.label).to.equal("Cancelled");
      expect(s.cls).to.equal("cancelled");
      expect(s.title).to.match(/void|judge/i);
    });
    it("withdrawn (withdrawBond / BondWithdrawn)", function () {
      const s = bondStatus({ ...base, closed: true, settleReason: SETTLE_REASON.WITHDRAWN });
      expect(s.label).to.equal("Withdrawn");
      expect(s.cls).to.equal("withdrawn");
    });
    it("timed out (claimTimeout / BondTimedOut)", function () {
      const s = bondStatus({ ...base, settleReason: SETTLE_REASON.TIMED_OUT });
      expect(s.label).to.equal("Settled (timed out)");
      expect(s.cls).to.equal("settled");
    });
    it("challenge upheld (ruleForChallenger / RuledForChallenger)", function () {
      const s = bondStatus({ ...base, settleReason: SETTLE_REASON.RULED_CHALLENGER });
      expect(s.label).to.equal("Challenge upheld");
      expect(s.cls).to.equal("upheld");
    });
    it("generic Settled when reason is unknown and nothing can be inferred", function () {
      const s = bondStatus({ ...base });
      expect(s.label).to.equal("Settled");
      expect(s.cls).to.equal("settled");
    });
    it("explicit reason WINS over an inference from challenges", function () {
      // A Won challenge would infer ruled-challenger, but an explicit reason must win.
      const s = bondStatus({ ...base, settleReason: SETTLE_REASON.CANCELLED, challenges: [{ status: 1 }] });
      expect(s.label).to.equal("Cancelled");
    });
  });

  describe("bondStatus — free inference from challenges (no explicit reason)", function () {
    const base = { settled: true, closed: false, pendingCount: 0 };
    it("infers 'Challenge upheld' from a Won (status 1) challenge", function () {
      const s = bondStatus({ ...base, challenges: [{ status: 5 }, { status: 1 }] });
      expect(s.label).to.equal("Challenge upheld");
    });
    it("accepts challenges given as raw status ints too", function () {
      const s = bondStatus({ ...base, challenges: [2, 1] });
      expect(s.label).to.equal("Challenge upheld");
    });
    it("infers from the REAL detail-view shape { i, ch:{status}, timing } the callers pass", function () {
      // Regression: the bond-detail call sites (renderBondDetailPaint /
      // renderBondDetailRpc) build challenges as { i, ch:{status}, timing }, so the
      // inference MUST read the nested ch.status — not a flat top-level .status.
      const s = bondStatus({ ...base, challenges: [{ i: 0, ch: { status: 5 }, timing: null }, { i: 1, ch: { status: 1 }, timing: null }] });
      expect(s.label).to.equal("Challenge upheld");
    });
    it("does NOT infer upheld from the real shape when no challenge is Won", function () {
      const s = bondStatus({ ...base, challenges: [{ i: 0, ch: { status: 2 }, timing: null }] });
      expect(s.label).to.equal("Settled");
    });
    it("does NOT over-claim: Lost/Conceded/Refunded challenges stay generic Settled", function () {
      for (const challenges of [[{ status: 2 }], [{ status: 3 }], [{ status: 5 }], [{ status: 0 }]]) {
        expect(bondStatus({ ...base, challenges }).label, JSON.stringify(challenges)).to.equal("Settled");
      }
    });
  });

  describe("challengeStatusLabel — every ChallengeStatus, unambiguous", function () {
    const expected = [
      [0, "Pending", "pending"],
      [1, "Challenger won", "won"],
      [2, "Challenger lost", "lost"],
      [3, "Conceded", "conceded"],
      [4, "Dismissed (out of scope)", "rejectedbyjudge"],
      [5, "Refunded", "refunded"],
    ];
    for (const [idx, label, cls] of expected) {
      it(`status ${idx} -> "${label}"`, function () {
        const c = challengeStatusLabel(idx);
        expect(c.label).to.equal(label);
        expect(c.cls).to.equal(cls);
      });
    }
    it('never leaks the raw CamelCase "Won"/"Lost"/"RejectedByJudge" identifiers', function () {
      for (const idx of [1, 2, 4]) {
        expect(challengeStatusLabel(idx).label).to.not.equal(["Pending", "Won", "Lost", "Conceded", "RejectedByJudge", "Refunded"][idx]);
      }
    });
    it("coerces a bigint status index", function () {
      expect(challengeStatusLabel(1n).label).to.equal("Challenger won");
    });
  });

  describe("defensive input handling (pure, never throws)", function () {
    it("undefined / empty input → Open", function () {
      expect(bondStatus().label).to.equal("Open");
      expect(bondStatus({}).label).to.equal("Open");
    });
    it("unknown challenge index → stable Unknown", function () {
      expect(challengeStatusLabel(99).label).to.equal("Unknown");
      expect(challengeStatusLabel(undefined).label).to.equal("Unknown");
    });
    it("unknown settleReason on a settled bond → generic Settled", function () {
      expect(bondStatus({ settled: true, settleReason: "bogus" }).label).to.equal("Settled");
    });
  });
});
