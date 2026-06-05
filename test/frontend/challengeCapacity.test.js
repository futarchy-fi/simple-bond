// PRIMARY pure unit test for the challenge-capacity gate
// (frontend/challenge-capacity.js).
//
// backlog #1 — challenge-capacity gate is wrong on the LIVE mainnet v6 chain.
// The two contracts cap challenge() DIFFERENTLY:
//   - SimpleBondV6.sol (LIVE on mainnet): challenges[bondId].length <
//     b.maxChallenges  — caps on TOTAL-EVER filed.
//   - SimpleBondV7.sol (Sepolia): b.pendingCount < b.maxChallenges — caps on the
//     LIVE pending set.
// The frontend used to gate BOTH on pendingCount, so on a v6 bond where
// maxChallenges challenges had already been filed-and-resolved (pendingCount back
// to 0, but challenges[].length == maxChallenges) the UI STILL showed the full
// Challenge card and the user wasted real gas on a challenge() tx that reverted.
//
// hasChallengeCapacity({ bondVersion, pendingCount, challengeCount, maxChallenges })
// encodes the version-correct gate. It is a DOM-free, chain-free, I/O-free pure
// function exercised directly here (no browser, no provider).
const { expect } = require("chai");
const { hasChallengeCapacity } = require("../../frontend/challenge-capacity.js");

describe("challenge-capacity — hasChallengeCapacity", function () {
  it("is exported as a function", function () {
    expect(hasChallengeCapacity).to.be.a("function");
  });

  describe("v6 (bondVersion 6) — caps on TOTAL-EVER filed (challengeCount)", function () {
    it("true when challengeCount < maxChallenges", function () {
      expect(hasChallengeCapacity({ bondVersion: 6, pendingCount: 0, challengeCount: 2, maxChallenges: 3 })).to.equal(true);
    });

    it("false when challengeCount === maxChallenges EVEN IF pendingCount is 0 (THE production bug)", function () {
      // maxChallenges challenges already filed-and-resolved: pendingCount back to
      // 0 but challenges[].length == maxChallenges. The contract reverts; the UI
      // must NOT offer the Challenge card. The OLD pendingCount-only gate would
      // have returned true here (0 < 3) — that is the wasted-gas bug.
      expect(hasChallengeCapacity({ bondVersion: 6, pendingCount: 0, challengeCount: 3, maxChallenges: 3 })).to.equal(false);
    });

    it("false when challengeCount exceeds maxChallenges (defensive)", function () {
      expect(hasChallengeCapacity({ bondVersion: 6, pendingCount: 0, challengeCount: 5, maxChallenges: 3 })).to.equal(false);
    });

    it("ignores pendingCount entirely on v6 (gate is challengeCount-based)", function () {
      // pendingCount high but challengeCount below cap => capacity exists.
      expect(hasChallengeCapacity({ bondVersion: 6, pendingCount: 99, challengeCount: 1, maxChallenges: 3 })).to.equal(true);
      // pendingCount 0 but challengeCount at cap => no capacity (the bug case).
      expect(hasChallengeCapacity({ bondVersion: 6, pendingCount: 0, challengeCount: 3, maxChallenges: 3 })).to.equal(false);
    });
  });

  describe("default / undefined bondVersion behaves like v6 (mainnet is LIVE v6)", function () {
    it("true when challengeCount < maxChallenges with no bondVersion", function () {
      expect(hasChallengeCapacity({ pendingCount: 0, challengeCount: 1, maxChallenges: 3 })).to.equal(true);
    });

    it("false at the cap with pendingCount 0 and no bondVersion (the production bug, default branch)", function () {
      expect(hasChallengeCapacity({ pendingCount: 0, challengeCount: 3, maxChallenges: 3 })).to.equal(false);
    });

    it("null bondVersion falls to the v6 branch (challengeCount-based)", function () {
      expect(hasChallengeCapacity({ bondVersion: null, pendingCount: 0, challengeCount: 3, maxChallenges: 3 })).to.equal(false);
      expect(hasChallengeCapacity({ bondVersion: null, pendingCount: 0, challengeCount: 1, maxChallenges: 3 })).to.equal(true);
    });

    it("a non-7 numeric version (e.g. 5) still uses the v6 default branch", function () {
      expect(hasChallengeCapacity({ bondVersion: 5, pendingCount: 0, challengeCount: 3, maxChallenges: 3 })).to.equal(false);
    });
  });

  describe("v7 (bondVersion 7) — caps on the LIVE pending set (pendingCount)", function () {
    it("true when pendingCount < maxChallenges", function () {
      expect(hasChallengeCapacity({ bondVersion: 7, pendingCount: 1, challengeCount: 1, maxChallenges: 3 })).to.equal(true);
    });

    it("true when pendingCount < max even if challengeCount is far below max (gate is pendingCount-based)", function () {
      // challengeCount is irrelevant on v7: pending 1 < 3 so there IS room.
      expect(hasChallengeCapacity({ bondVersion: 7, pendingCount: 1, challengeCount: 9, maxChallenges: 3 })).to.equal(true);
    });

    it("false at pendingCount === maxChallenges even if challengeCount is below max", function () {
      // pending set full (2 == 2) -> no room, regardless of total-ever count.
      expect(hasChallengeCapacity({ bondVersion: 7, pendingCount: 2, challengeCount: 0, maxChallenges: 2 })).to.equal(false);
    });

    it("ignores total-ever (challengeCount) on v7", function () {
      // total-ever way past max but pending below max => capacity exists.
      expect(hasChallengeCapacity({ bondVersion: 7, pendingCount: 0, challengeCount: 100, maxChallenges: 1 })).to.equal(true);
    });

    it("accepts the string '7' (Number coercion)", function () {
      expect(hasChallengeCapacity({ bondVersion: "7", pendingCount: 0, challengeCount: 50, maxChallenges: 1 })).to.equal(true);
      expect(hasChallengeCapacity({ bondVersion: "7", pendingCount: 1, challengeCount: 0, maxChallenges: 1 })).to.equal(false);
    });
  });

  describe("missing / undefined maxChallenges => no capacity (fail closed)", function () {
    it("false when maxChallenges is undefined (v6)", function () {
      expect(hasChallengeCapacity({ bondVersion: 6, pendingCount: 0, challengeCount: 0 })).to.equal(false);
    });

    it("false when maxChallenges is undefined (v7)", function () {
      expect(hasChallengeCapacity({ bondVersion: 7, pendingCount: 0, challengeCount: 0 })).to.equal(false);
    });

    it("false when maxChallenges is 0", function () {
      expect(hasChallengeCapacity({ bondVersion: 6, pendingCount: 0, challengeCount: 0, maxChallenges: 0 })).to.equal(false);
    });

    it("false when maxChallenges is null", function () {
      // Number(null) === 0 => no capacity.
      expect(hasChallengeCapacity({ bondVersion: 7, pendingCount: 0, challengeCount: 0, maxChallenges: null })).to.equal(false);
    });

    it("false when maxChallenges is non-numeric garbage", function () {
      expect(hasChallengeCapacity({ bondVersion: 6, pendingCount: 0, challengeCount: 0, maxChallenges: "abc" })).to.equal(false);
    });
  });

  describe("never throws on no / empty args (defensive)", function () {
    it("returns false for undefined args", function () {
      expect(hasChallengeCapacity()).to.equal(false);
    });

    it("returns false for an empty object", function () {
      expect(hasChallengeCapacity({})).to.equal(false);
    });
  });

  describe("coercion: bigint / string counts behave like their numeric value", function () {
    it("coerces bigint counts (on-chain values arrive as bigint)", function () {
      // v6: challengeCount 3n at cap 3 => false.
      expect(hasChallengeCapacity({ bondVersion: 6, pendingCount: 0n, challengeCount: 3n, maxChallenges: 3n })).to.equal(false);
      // v6: challengeCount 2n below cap 3 => true.
      expect(hasChallengeCapacity({ bondVersion: 6, pendingCount: 0n, challengeCount: 2n, maxChallenges: 3n })).to.equal(true);
      // v7: pendingCount 1n below cap 3 => true (challengeCount 9n irrelevant).
      expect(hasChallengeCapacity({ bondVersion: 7, pendingCount: 1n, challengeCount: 9n, maxChallenges: 3n })).to.equal(true);
    });

    it("coerces string counts", function () {
      expect(hasChallengeCapacity({ bondVersion: 6, pendingCount: "0", challengeCount: "3", maxChallenges: "3" })).to.equal(false);
      expect(hasChallengeCapacity({ bondVersion: 7, pendingCount: "1", challengeCount: "9", maxChallenges: "3" })).to.equal(true);
    });
  });

  describe("boundary cases", function () {
    it("v6: challengeCount === max - 1 is true; === max is false", function () {
      expect(hasChallengeCapacity({ bondVersion: 6, pendingCount: 0, challengeCount: 2, maxChallenges: 3 })).to.equal(true);
      expect(hasChallengeCapacity({ bondVersion: 6, pendingCount: 0, challengeCount: 3, maxChallenges: 3 })).to.equal(false);
    });

    it("v7: pendingCount === max - 1 is true; === max is false", function () {
      expect(hasChallengeCapacity({ bondVersion: 7, pendingCount: 2, challengeCount: 0, maxChallenges: 3 })).to.equal(true);
      expect(hasChallengeCapacity({ bondVersion: 7, pendingCount: 3, challengeCount: 0, maxChallenges: 3 })).to.equal(false);
    });

    it("maxChallenges 1: v6 true at challengeCount 0, false at 1", function () {
      expect(hasChallengeCapacity({ bondVersion: 6, pendingCount: 0, challengeCount: 0, maxChallenges: 1 })).to.equal(true);
      expect(hasChallengeCapacity({ bondVersion: 6, pendingCount: 0, challengeCount: 1, maxChallenges: 1 })).to.equal(false);
    });
  });
});
