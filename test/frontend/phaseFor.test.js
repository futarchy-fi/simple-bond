// PRIMARY pure unit test for phaseFor() (frontend/phase.js).
//
// phaseFor turns the on-chain per-challenge timing + ChallengeStatus into a
// phase timeline bucket + a full-sentence "why no action / when it changes"
// reason. It is DOM-free and chain-free so we exercise it directly here, with no
// browser and no harness — a genuine importable pure function.
//
// CONTRACT TIMING TRUTH (SimpleBondV6.sol): concessionDeadline == rulingWindowStart
// == T0 (ts + acceptanceDelay), ALWAYS. So the pending timeline has exactly TWO
// adjacent sub-phases meeting at T0 (concession then ruling) and then a
// timeout-claimable zone — there is NO gap phase between concession and ruling.
// rejectChallenge() has NO timing gate, so the JUDGE can reject-as-out-of-scope
// at any pending instant (concession, ruling, AND after rulingDeadline). The
// reason a viewer sees must match the buttons gated for that viewer.
//
// ChallengeStatus enum mirrors contracts/core/SimpleBondV6.sol:
//   0 Pending, 1 Won, 2 Lost, 3 Conceded, 4 RejectedByJudge, 5 Refunded
const { expect } = require("chai");
const { phaseFor, PHASE, ROLES } = require("../../frontend/phase.js");

// Fixed timing boundaries. concessionDeadline === rulingWindowStart === T0, per
// the contract — they are the SAME instant, not a gap.
const T0 = 1000;
const TIMING = { concessionDeadline: T0, rulingWindowStart: T0, rulingDeadline: 3000 };

// One representative `now` per real timing bucket (no gap bucket exists).
const NOW = {
    beforeT0: 500,             // < T0 -> concession
    atT0: 1000,               // == T0 -> ruling (boundary choice)
    insideRulingWindow: 2500,  // T0 < now <= rulingDeadline -> ruling
    afterRulingEnd: 3500,      // > rulingDeadline -> timeout-claimable
};

// Resolved (non-Pending) statuses and the sub-label phaseFor must report.
const RESOLVED = [
    { status: 1, sub: "ruled for challenger", reasonIncludes: "ruled for the challenger" },
    { status: 2, sub: "ruled for poster", reasonIncludes: "ruled for the poster" },
    { status: 3, sub: "conceded", reasonIncludes: "poster conceded" },
    { status: 4, sub: "rejected as out-of-scope", reasonIncludes: "out-of-scope" },
    { status: 5, sub: "refunded", reasonIncludes: "refunded after the bond settled" },
];

describe("phaseFor — pure per-challenge phase classifier", function () {
    it("is a genuinely importable pure function", function () {
        expect(phaseFor).to.be.a("function");
        expect(PHASE).to.be.an("object");
        // No hidden DOM/chain dependency: a frozen-input call returns a plain object.
        const out = phaseFor(TIMING, 0, NOW.beforeT0);
        expect(out).to.have.all.keys(["phase", "label", "subLabel", "reason", "activeWindow"]);
    });

    describe("Pending (status 0): exactly TWO adjacent sub-phases meeting at T0, then timeout", function () {
        it("before T0 -> pending-concession; only poster can concede; says when ruling opens", function () {
            const out = phaseFor(TIMING, 0, NOW.beforeT0);
            expect(out.phase).to.equal(PHASE.PENDING_CONCESSION);
            expect(out.phase).to.equal("pending-concession");
            expect(out.label).to.equal("Concession");
            expect(out.subLabel).to.equal("");
            expect(out.activeWindow).to.equal("pending-concession");
            expect(out.reason).to.match(/^In the concession window until /);
            expect(out.reason).to.include("only the poster can concede");
            expect(out.reason).to.include("the judge ruling window opens");
        });

        it("inside ruling window -> pending-ruling; only judge can rule; timeout after", function () {
            const out = phaseFor(TIMING, 0, NOW.insideRulingWindow);
            expect(out.phase).to.equal(PHASE.PENDING_RULING);
            expect(out.phase).to.equal("pending-ruling");
            expect(out.label).to.equal("Ruling");
            expect(out.activeWindow).to.equal("pending-ruling");
            expect(out.reason).to.include("In the ruling window until");
            expect(out.reason).to.include("only the assigned judge can rule");
            expect(out.reason).to.include("anyone can claim the timeout refund");
        });

        it("after ruling end -> timeout-claimable; anyone can claim the timeout refund", function () {
            const out = phaseFor(TIMING, 0, NOW.afterRulingEnd);
            expect(out.phase).to.equal(PHASE.TIMEOUT_CLAIMABLE);
            expect(out.phase).to.equal("timeout-claimable");
            expect(out.label).to.equal("Timeout");
            expect(out.activeWindow).to.equal("timeout-claimable");
            expect(out.reason).to.include("Ruling window passed");
            expect(out.reason).to.include("anyone can now claim the timeout refund");
        });

        it("NO gap phase: concession is the LAST instant before T0, ruling begins AT T0 (handled once)", function () {
            // now == T0-1 is still concession; now == T0 flips straight to ruling.
            // There is no intermediate "awaiting ruling, opens later" phase.
            expect(phaseFor(TIMING, 0, T0 - 1).phase).to.equal(PHASE.PENDING_CONCESSION);
            expect(phaseFor(TIMING, 0, T0).phase).to.equal(PHASE.PENDING_RULING);
            // The dead "Concession window closed; awaiting the judge ruling, which
            // opens <later>" wording must NOT appear at any pending `now`.
            for (const now of [T0 - 1, T0, T0 + 1, 2000, 3000, 3001]) {
                const r = phaseFor(TIMING, 0, now).reason;
                expect(r).to.not.match(/awaiting the judge ruling, which opens/);
            }
        });

        it("boundary exactness at T0: now == T0 is ruling (not concession); now == T0-1 is concession", function () {
            expect(phaseFor(TIMING, 0, T0 - 1).phase).to.equal(PHASE.PENDING_CONCESSION);
            expect(phaseFor(TIMING, 0, T0).phase).to.equal(PHASE.PENDING_RULING);
        });

        it("boundary exactness at rulingDeadline: == deadline is ruling; +1 flips to timeout", function () {
            expect(phaseFor(TIMING, 0, 3000).phase).to.equal(PHASE.PENDING_RULING);
            expect(phaseFor(TIMING, 0, 3001).phase).to.equal(PHASE.TIMEOUT_CLAIMABLE);
        });
    });

    describe("Role accuracy: the reason a viewer sees matches what THEY can do", function () {
        // --- POSTER: can concede only before T0; never claims ruling/timeout rights wrongly.
        it("poster before T0 -> can concede now", function () {
            const out = phaseFor(TIMING, 0, NOW.beforeT0, ROLES.POSTER);
            expect(out.phase).to.equal(PHASE.PENDING_CONCESSION);
            expect(out.reason).to.match(/you \(the poster\) can concede/i);
        });

        it("poster inside ruling window (after T0) -> can NO LONGER concede", function () {
            const out = phaseFor(TIMING, 0, NOW.insideRulingWindow, ROLES.POSTER);
            expect(out.phase).to.equal(PHASE.PENDING_RULING);
            expect(out.reason).to.match(/can no longer concede/i);
        });

        it("poster at exactly T0 -> ruling phase but concede still possible this instant (matches the still-present button)", function () {
            const out = phaseFor(TIMING, 0, T0, ROLES.POSTER);
            expect(out.phase).to.equal(PHASE.PENDING_RULING);
            // At T0 the on-chain concede gate (now <= concessionDeadline) still
            // passes, so the reason must NOT say concession has closed.
            expect(out.reason).to.match(/last moment to concede/i);
            expect(out.reason).to.not.match(/can no longer concede/i);
        });

        // --- JUDGE: reject-as-out-of-scope is available in ALL three pending phases.
        it("judge in concession phase -> reason states reject-out-of-scope is available", function () {
            const out = phaseFor(TIMING, 0, NOW.beforeT0, ROLES.JUDGE);
            expect(out.phase).to.equal(PHASE.PENDING_CONCESSION);
            expect(out.reason).to.match(/reject this challenge as out-of-scope/i);
            expect(out.reason).to.match(/you \(the judge\)/i);
            // ...but cannot rule yet in concession.
            expect(out.reason).to.match(/cannot rule/i);
        });

        it("judge in ruling phase -> reason states rule AND reject-out-of-scope", function () {
            const out = phaseFor(TIMING, 0, NOW.insideRulingWindow, ROLES.JUDGE);
            expect(out.phase).to.equal(PHASE.PENDING_RULING);
            expect(out.reason).to.match(/rule for the poster or the challenger/i);
            expect(out.reason).to.match(/reject this challenge as out-of-scope/i);
        });

        it("judge after rulingDeadline (still pending) -> reject-out-of-scope STILL available; ruling no longer", function () {
            const out = phaseFor(TIMING, 0, NOW.afterRulingEnd, ROLES.JUDGE);
            expect(out.phase).to.equal(PHASE.TIMEOUT_CLAIMABLE);
            expect(out.reason).to.match(/can still reject this challenge as out-of-scope/i);
            expect(out.reason).to.match(/no longer rule/i);
        });

        // --- CHALLENGER: no positive action, but informed the judge may reject.
        it("challenger in concession phase -> told poster may concede + judge may reject; no own action", function () {
            const out = phaseFor(TIMING, 0, NOW.beforeT0, ROLES.CHALLENGER);
            expect(out.reason).to.match(/reject this challenge as out-of-scope/i);
            expect(out.reason).to.match(/no action/i);
        });

        // --- BYSTANDER / role-agnostic: no FALSE exclusivity; mentions judge reject caveat.
        it("bystander concession reason mentions the judge may reject out-of-scope (no false exclusivity)", function () {
            const out = phaseFor(TIMING, 0, NOW.beforeT0, ROLES.BYSTANDER);
            expect(out.reason).to.include("only the poster can concede");
            expect(out.reason).to.match(/reject this challenge as out-of-scope at any time while it is pending/i);
        });

        it("bystander ruling reason mentions the judge may reject out-of-scope", function () {
            const out = phaseFor(TIMING, 0, NOW.insideRulingWindow, ROLES.BYSTANDER);
            expect(out.reason).to.include("only the assigned judge can rule");
            expect(out.reason).to.match(/reject this challenge as out-of-scope/i);
        });

        it("bystander timeout reason mentions the judge may still reject out-of-scope", function () {
            const out = phaseFor(TIMING, 0, NOW.afterRulingEnd, ROLES.BYSTANDER);
            expect(out.reason).to.include("anyone can now claim the timeout refund");
            expect(out.reason).to.match(/reject this challenge as out-of-scope/i);
        });

        it("unknown / omitted viewerRole degrades to the bystander reason", function () {
            const withUnknown = phaseFor(TIMING, 0, NOW.beforeT0, "weirdo");
            const withNone = phaseFor(TIMING, 0, NOW.beforeT0);
            const bystander = phaseFor(TIMING, 0, NOW.beforeT0, ROLES.BYSTANDER);
            expect(withUnknown.reason).to.equal(bystander.reason);
            expect(withNone.reason).to.equal(bystander.reason);
        });
    });

    describe("Resolved statuses (1..5) are terminal regardless of timing/now/role", function () {
        for (const r of RESOLVED) {
            for (const [bucket, now] of Object.entries(NOW)) {
                it(`status ${r.status} (${r.sub}) @ ${bucket} -> resolved`, function () {
                    const out = phaseFor(TIMING, r.status, now, ROLES.JUDGE);
                    expect(out.phase).to.equal(PHASE.RESOLVED);
                    expect(out.phase).to.equal("resolved");
                    expect(out.label).to.equal("Resolved");
                    expect(out.subLabel).to.equal(r.sub);
                    expect(out.activeWindow).to.equal(""); // no timeline step highlighted
                    expect(out.reason).to.match(/^Resolved: /);
                    expect(out.reason).to.include(r.reasonIncludes);
                });
            }
        }
    });

    describe("defensive input handling (pure, no throws)", function () {
        it("missing timing object -> still classifies Pending without throwing", function () {
            const out = phaseFor(undefined, 0, 0);
            expect(out.phase).to.be.a("string");
            expect(out.reason).to.be.a("string");
        });

        it("bigint timing values are accepted (Number-coerced)", function () {
            const out = phaseFor(
                { concessionDeadline: 1000n, rulingWindowStart: 1000n, rulingDeadline: 3000n },
                0,
                2500
            );
            expect(out.phase).to.equal(PHASE.PENDING_RULING);
        });

        it("unknown status index degrades to a resolved-style fallback", function () {
            const out = phaseFor(TIMING, 99, NOW.insideRulingWindow);
            expect(out.phase).to.equal(PHASE.RESOLVED);
            expect(out.reason).to.match(/^Resolved: /);
        });
    });
});
