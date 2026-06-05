// PRIMARY pure unit test for computeRefunds() (frontend/refunds.js).
//
// computeRefunds turns a bond's per-challenge statuses + the bond's `settled`
// flag into (a) how many slots anyone could drain right now via claimRefunds()
// and (b) how many / how much the connected viewer is owed. It is DOM-free and
// chain-free so we exercise it directly here — a genuine importable pure
// function — with no browser and no harness.
//
// CONTRACT REFUND TRUTH (verified against SimpleBondV6.sol):
//   claimRefunds(bondId, maxCount) requires `b.settled` and ONLY acts on
//   challenges whose status is Pending(0): it flips them to Refunded(5) and
//   returns challengeAmount to the challenger. Conceded(3) and RejectedByJudge(4)
//   were ALREADY refunded inline at concede()/rejectChallenge() time, so they
//   are terminal and NOT drainable. Refunded(5) is already drained. Won(1)/
//   Lost(2) are ruled outcomes, never drained. Therefore the ONLY drainable slot
//   is: settled === true AND status === Pending(0).
//
// ChallengeStatus enum mirrors contracts/core/SimpleBondV6.sol:
//   0 Pending, 1 Won, 2 Lost, 3 Conceded, 4 RejectedByJudge, 5 Refunded
const { expect } = require("chai");
const { computeRefunds, STATUS_PENDING } = require("../../frontend/refunds.js");

// Canonical actors. Mixed case on purpose — computeRefunds must compare
// addresses case-insensitively (on-chain addresses come back checksummed).
const VIEWER = "0xAbC0000000000000000000000000000000000001";
const OTHER = "0x00000000000000000000000000000000000000FF";

// challengeAmount in token shares (bigint), like the on-chain uint256.
const CHALLENGE_AMOUNT = 1_000_000_000_000_000_000n; // 1e18

// Build a raw on-chain-shaped challenge. status accepts a number; we also test
// the bigint form (ethers returns uint8 enums as bigint) separately below.
function ch(status, challenger) {
    return { challenger, status, timestamp: 0, challengeAtVersion: 1 };
}

function bond(settled, challengeAmount = CHALLENGE_AMOUNT) {
    return { settled, challengeAmount };
}

describe("computeRefunds — pure refund accounting", function () {
    it("is a genuinely importable pure function with a stable shape", function () {
        expect(computeRefunds).to.be.a("function");
        expect(STATUS_PENDING).to.equal(0);
        const out = computeRefunds([], bond(true), VIEWER);
        expect(out).to.have.all.keys(["refundableSlots", "viewerOwedSlots", "viewerOwedShares"]);
        expect(out.refundableSlots).to.equal(0);
        expect(out.viewerOwedSlots).to.equal(0);
        expect(out.viewerOwedShares).to.equal(0n);
    });

    describe("nothing refundable", function () {
        it("empty challenge list -> 0", function () {
            const out = computeRefunds([], bond(true), VIEWER);
            expect(out.refundableSlots).to.equal(0);
            expect(out.viewerOwedSlots).to.equal(0);
            expect(out.viewerOwedShares).to.equal(0n);
        });

        it("unsettled bond with a Pending challenge -> 0 (claimRefunds requires settled)", function () {
            const out = computeRefunds([ch(0, VIEWER)], bond(false), VIEWER);
            expect(out.refundableSlots).to.equal(0);
            expect(out.viewerOwedSlots).to.equal(0);
            expect(out.viewerOwedShares).to.equal(0n);
        });

        it("settled bond with only ruled outcomes (Won/Lost) -> 0", function () {
            const out = computeRefunds([ch(1, VIEWER), ch(2, OTHER)], bond(true), VIEWER);
            expect(out.refundableSlots).to.equal(0);
        });

        it("Conceded(3) is NOT drainable — challenger was already refunded inline", function () {
            const out = computeRefunds([ch(3, VIEWER)], bond(true), VIEWER);
            expect(out.refundableSlots).to.equal(0);
            expect(out.viewerOwedSlots).to.equal(0);
            expect(out.viewerOwedShares).to.equal(0n);
        });

        it("RejectedByJudge(4) is NOT drainable — challenger was already refunded inline", function () {
            const out = computeRefunds([ch(4, VIEWER)], bond(true), VIEWER);
            expect(out.refundableSlots).to.equal(0);
            expect(out.viewerOwedSlots).to.equal(0);
        });

        it("already-Refunded(5) is excluded", function () {
            const out = computeRefunds([ch(5, VIEWER)], bond(true), VIEWER);
            expect(out.refundableSlots).to.equal(0);
            expect(out.viewerOwedSlots).to.equal(0);
        });
    });

    describe("settled bond with Pending challenges (the only drainable case)", function () {
        it("one settled Pending -> 1 refundable; viewer owed when challenger matches", function () {
            const out = computeRefunds([ch(0, VIEWER)], bond(true), VIEWER);
            expect(out.refundableSlots).to.equal(1);
            expect(out.viewerOwedSlots).to.equal(1);
            expect(out.viewerOwedShares).to.equal(CHALLENGE_AMOUNT);
        });

        it("one settled Pending by SOMEONE ELSE -> 1 refundable, viewer owed 0", function () {
            const out = computeRefunds([ch(0, OTHER)], bond(true), VIEWER);
            expect(out.refundableSlots).to.equal(1);
            expect(out.viewerOwedSlots).to.equal(0);
            expect(out.viewerOwedShares).to.equal(0n);
        });

        it("address compare is case-insensitive", function () {
            const out = computeRefunds([ch(0, VIEWER.toLowerCase())], bond(true), VIEWER.toUpperCase());
            expect(out.viewerOwedSlots).to.equal(1);
        });

        it("multiple viewer-owed slots sum shares = N * challengeAmount", function () {
            const out = computeRefunds(
                [ch(0, VIEWER), ch(0, VIEWER), ch(0, OTHER)],
                bond(true),
                VIEWER
            );
            expect(out.refundableSlots).to.equal(3);
            expect(out.viewerOwedSlots).to.equal(2);
            expect(out.viewerOwedShares).to.equal(2n * CHALLENGE_AMOUNT);
        });
    });

    describe("mixed status matrix on a settled bond", function () {
        // Pending(viewer), Conceded(viewer), Refunded(viewer), Pending(other),
        // RejectedByJudge(other), Won(viewer). Only the two Pending count; only
        // the first (viewer's Pending) is owed to the viewer.
        const challenges = [
            ch(0, VIEWER), // refundable + owed
            ch(3, VIEWER), // already refunded inline -> excluded
            ch(5, VIEWER), // already drained -> excluded
            ch(0, OTHER), // refundable, not owed to viewer
            ch(4, OTHER), // already refunded inline -> excluded
            ch(1, VIEWER), // ruled outcome -> excluded
        ];

        it("counts only settled+Pending across the mix", function () {
            const out = computeRefunds(challenges, bond(true), VIEWER);
            expect(out.refundableSlots).to.equal(2);
            expect(out.viewerOwedSlots).to.equal(1);
            expect(out.viewerOwedShares).to.equal(CHALLENGE_AMOUNT);
        });

        it("same mix while UNSETTLED -> nothing drainable", function () {
            const out = computeRefunds(challenges, bond(false), VIEWER);
            expect(out.refundableSlots).to.equal(0);
            expect(out.viewerOwedSlots).to.equal(0);
            expect(out.viewerOwedShares).to.equal(0n);
        });
    });

    describe("input-shape robustness (matches renderBondDetailRpc data)", function () {
        it("accepts the { i, ch, timing } wrapper shape used by the detail page", function () {
            const wrapped = [
                { i: 0, ch: ch(0, VIEWER), timing: null },
                { i: 1, ch: ch(0, OTHER), timing: null },
            ];
            const out = computeRefunds(wrapped, bond(true), VIEWER);
            expect(out.refundableSlots).to.equal(2);
            expect(out.viewerOwedSlots).to.equal(1);
            expect(out.viewerOwedShares).to.equal(CHALLENGE_AMOUNT);
        });

        it("accepts bigint status values (as ethers returns uint8 enums)", function () {
            const wrapped = [{ ch: ch(0n, VIEWER), timing: null }];
            const out = computeRefunds(wrapped, bond(true), VIEWER);
            expect(out.refundableSlots).to.equal(1);
            expect(out.viewerOwedSlots).to.equal(1);
        });

        it("no connected viewer (null address) -> refundable counted, owed 0", function () {
            const out = computeRefunds([ch(0, VIEWER)], bond(true), null);
            expect(out.refundableSlots).to.equal(1);
            expect(out.viewerOwedSlots).to.equal(0);
            expect(out.viewerOwedShares).to.equal(0n);
        });

        it("missing/garbage bond -> 0 (no throw)", function () {
            const out = computeRefunds([ch(0, VIEWER)], null, VIEWER);
            expect(out.refundableSlots).to.equal(0);
            expect(out.viewerOwedShares).to.equal(0n);
        });

        it("non-array challenges -> 0 (no throw)", function () {
            const out = computeRefunds(undefined, bond(true), VIEWER);
            expect(out.refundableSlots).to.equal(0);
        });
    });
});
