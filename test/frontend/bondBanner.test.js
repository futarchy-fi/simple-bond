// PRIMARY pure unit test for bondBanner() (frontend/banner.js).
//
// bondBanner turns the ALREADY-COMPUTED gating flags the bond-detail action cards
// use (isPoster / isJudgeOperator / canChallenge) + the bond's lifecycle fields
// (settled / closed / pendingCount) into ONE plain-language headline: the bond's
// lifecycle (open / disputed / closed / settled) and the viewer's next move. It is
// DOM-free and chain-free so we exercise it directly here — a genuine importable
// pure function, the SAME single source of truth the cards key off.
//
// SINGLE SOURCE OF TRUTH CONTRACT (what these tests lock in):
//   - state is derived with the SAME precedence as renderBondDetailRpc's
//     statusName: settled > closed > pendingCount>0 (disputed) > open.
//   - viewerRole is derived with the SAME precedence the cards use:
//     poster > judge > challenger-eligible (canChallenge) > bystander.
//   - The headline must NAME the correct lifecycle and the correct viewer next
//     move, and a settled (resolved) bond must NEVER advertise an action — because
//     the poster/judge cards are gated on !settled and canChallenge is false once
//     settled, so the cards render NO controls there.
//
// CONTRACT FLAG TRUTH (renderBondDetailRpc): canChallenge already encodes
//   !isPoster && !settled && !closed && pendingCount < maxChallenges && <=100,
// so a settled OR closed bond can never produce canChallenge=true. The matrix
// below respects that: we never feed canChallenge=true with settled/closed.
const { expect } = require("chai");
const { bondBanner, BANNER_STATE, BANNER_ROLE } = require("../../frontend/banner.js");

// Build a flags object for a given (state, role) cell. pendingCount is now
// PARAMETRIZED independently of the state LABEL: by default the disputed label
// carries 2 pending and everything else 0 (the legacy mapping), but callers can
// override it to exercise the contract-real combo of a CLOSED bond that STILL has
// pending challenges (closeBond only blocks NEW challenges; existing Pending ones
// still resolve and the judge keeps full rule/reject power). This is the exact
// combo the old fixture could never reach because it hardcoded pendingCount off the
// label. canChallenge is only ever true in OPEN/DISPUTED (the contract gates it on
// !settled && !closed), so the challenger-eligible role only exists there.
function flagsFor(state, role, pendingOverride, opts) {
    const settled = state === BANNER_STATE.SETTLED;
    const closed = state === BANNER_STATE.CLOSED;
    const pendingCount = pendingOverride !== undefined
        ? pendingOverride
        : (state === BANNER_STATE.DISPUTED ? 2 : 0);
    const o = opts || {};
    return {
        settled,
        closed,
        pendingCount,
        isPoster: role === BANNER_ROLE.POSTER,
        isJudgeOperator: role === BANNER_ROLE.JUDGE,
        // canChallenge can only be true when the bond is genuinely challengeable.
        canChallenge: role === BANNER_ROLE.CHALLENGER_ELIGIBLE && !settled && !closed,
        // HIGH-2: the judge's "rule" clause is now TIMING-AWARE. The legacy matrix
        // expected "rule or reject" whenever pending>0, which on-chain corresponds
        // to a Pending challenge being INSIDE its ruling window. So the default for
        // a pending bond is judgeCanRuleSomePending=true (some challenge is rulable
        // now); callers exercising the concession-window / past-deadline cases pass
        // false explicitly.
        judgeCanRuleSomePending: o.judgeCanRuleSomePending !== undefined
            ? o.judgeCanRuleSomePending
            : pendingCount > 0,
        // HIGH-2 bonus: "anyone can challenge" is gated on capacity. Default to
        // "room available" so the legacy open-bond wording holds; the capacity-full
        // case passes false explicitly.
        hasChallengeCapacity: o.hasChallengeCapacity !== undefined ? o.hasChallengeCapacity : true,
    };
}

const ALL_STATES = [BANNER_STATE.OPEN, BANNER_STATE.DISPUTED, BANNER_STATE.CLOSED, BANNER_STATE.SETTLED];
const ALL_ROLES = [BANNER_ROLE.POSTER, BANNER_ROLE.JUDGE, BANNER_ROLE.CHALLENGER_ELIGIBLE, BANNER_ROLE.BYSTANDER];

// Per-state lifecycle phrase the headline must always carry (role-agnostic).
const LIFECYCLE_PHRASE = {
    [BANNER_STATE.OPEN]: /^Open — no challenges yet\./,
    [BANNER_STATE.DISPUTED]: /^Disputed — \d+ challenges? pending\./,
    [BANNER_STATE.CLOSED]: /^Closed — no new challenges; existing disputes still resolve\./,
    [BANNER_STATE.SETTLED]: /^Settled — this bond is resolved\./,
};

describe("bondBanner — pure bond-level lifecycle/role banner", function () {
    it("is a genuinely importable pure function with a stable shape", function () {
        expect(bondBanner).to.be.a("function");
        expect(BANNER_STATE).to.be.an("object");
        expect(BANNER_ROLE).to.be.an("object");
        const out = bondBanner(flagsFor(BANNER_STATE.OPEN, BANNER_ROLE.BYSTANDER));
        expect(out).to.have.all.keys(["state", "viewerRole", "headline"]);
        expect(out.headline).to.be.a("string");
    });

    describe("state classification mirrors the status badge (settled > closed > disputed > open)", function () {
        it("settled wins even if closed and pending are also set", function () {
            expect(bondBanner({ settled: true, closed: true, pendingCount: 3 }).state).to.equal(BANNER_STATE.SETTLED);
        });
        it("closed wins over a pending count when not settled", function () {
            expect(bondBanner({ settled: false, closed: true, pendingCount: 3 }).state).to.equal(BANNER_STATE.CLOSED);
        });
        it("pendingCount>0 -> disputed when open and not closed", function () {
            expect(bondBanner({ settled: false, closed: false, pendingCount: 1 }).state).to.equal(BANNER_STATE.DISPUTED);
        });
        it("nothing set -> open", function () {
            expect(bondBanner({ settled: false, closed: false, pendingCount: 0 }).state).to.equal(BANNER_STATE.OPEN);
        });
    });

    describe("role classification mirrors the cards (poster > judge > challenger-eligible > bystander)", function () {
        it("poster beats judge and challenger when all flags happen to be set", function () {
            const out = bondBanner({ isPoster: true, isJudgeOperator: true, canChallenge: true });
            expect(out.viewerRole).to.equal(BANNER_ROLE.POSTER);
        });
        it("judge beats challenger-eligible", function () {
            const out = bondBanner({ isJudgeOperator: true, canChallenge: true });
            expect(out.viewerRole).to.equal(BANNER_ROLE.JUDGE);
        });
        it("canChallenge alone -> challenger-eligible", function () {
            const out = bondBanner({ canChallenge: true });
            expect(out.viewerRole).to.equal(BANNER_ROLE.CHALLENGER_ELIGIBLE);
        });
        it("no flags -> bystander", function () {
            const out = bondBanner({});
            expect(out.viewerRole).to.equal(BANNER_ROLE.BYSTANDER);
        });
    });

    // The full role x state matrix. For every cell, the headline must:
    //   (a) name the correct lifecycle (LIFECYCLE_PHRASE), and
    //   (b) name the correct viewer next-move (or none), never advertising an
    //       action that the cards would not render in that state.
    describe("role x state matrix: headline names correct lifecycle + viewer next-move", function () {
        for (const state of ALL_STATES) {
            for (const role of ALL_ROLES) {
                // challenger-eligible only exists where the bond is challengeable.
                const reachable = !(role === BANNER_ROLE.CHALLENGER_ELIGIBLE && (state === BANNER_STATE.CLOSED || state === BANNER_STATE.SETTLED));
                if (!reachable) continue;

                it(`${role} @ ${state}`, function () {
                    const out = bondBanner(flagsFor(state, role));
                    expect(out.state).to.equal(state);
                    expect(out.viewerRole).to.equal(role);
                    // (a) lifecycle named correctly and FIRST.
                    expect(out.headline).to.match(LIFECYCLE_PHRASE[state]);

                    // (b) viewer next-move, per (state, role):
                    if (state === BANNER_STATE.SETTLED) {
                        // Resolved: cards render NO controls. The headline must be
                        // exactly the lifecycle clause, with NO action verbs.
                        expect(out.headline).to.equal("Settled — this bond is resolved.");
                        expect(out.headline).to.not.match(/\b(you can|rule or reject|modify|close|reopen|challenge)\b/i);
                        return;
                    }
                    if (role === BANNER_ROLE.CHALLENGER_ELIGIBLE) {
                        // canChallenge true -> challenge card IS rendered.
                        expect(out.headline).to.include("You can challenge this claim.");
                    } else if (role === BANNER_ROLE.JUDGE && state === BANNER_STATE.DISPUTED) {
                        // pending disputes -> judge rules/rejects each below.
                        expect(out.headline).to.match(/You are the judge; rule or reject each pending challenge below\./);
                    } else if (role === BANNER_ROLE.POSTER && state === BANNER_STATE.OPEN) {
                        expect(out.headline).to.include("Your bond is open; you can modify the claim or close it.");
                    } else if (role === BANNER_ROLE.POSTER && state === BANNER_STATE.CLOSED) {
                        expect(out.headline).to.match(/you can reopen it/i);
                    } else if (role === BANNER_ROLE.POSTER && state === BANNER_STATE.DISPUTED) {
                        expect(out.headline).to.match(/pending challenges?; close the bond or wait/i);
                    } else if (role === BANNER_ROLE.BYSTANDER && state === BANNER_STATE.OPEN) {
                        expect(out.headline).to.include("Anyone can challenge this claim.");
                    }
                });
            }
        }
    });

    describe("the headline NEVER advertises an action the cards would not render", function () {
        // A settled bond: poster + judge cards gated on !settled, canChallenge false.
        for (const role of ALL_ROLES) {
            it(`settled + ${role} -> no action verb (cards render nothing)`, function () {
                const out = bondBanner({
                    settled: true,
                    closed: false,
                    pendingCount: 2, // even with stale pending slots, settled is terminal
                    isPoster: role === BANNER_ROLE.POSTER,
                    isJudgeOperator: role === BANNER_ROLE.JUDGE,
                    canChallenge: false, // impossible to be true once settled
                });
                expect(out.state).to.equal(BANNER_STATE.SETTLED);
                expect(out.headline).to.equal("Settled — this bond is resolved.");
            });
        }

        it("a bystander on a closed bond is NOT told they can challenge (no new challenges allowed)", function () {
            const out = bondBanner({ closed: true, isPoster: false, isJudgeOperator: false, canChallenge: false });
            expect(out.state).to.equal(BANNER_STATE.CLOSED);
            expect(out.headline).to.not.match(/can challenge/i);
        });

        it("a judge with NO pending challenges is NOT told to rule (nothing to rule)", function () {
            // Open bond, judge connected, nothing pending.
            const out = bondBanner({ settled: false, closed: false, pendingCount: 0, isJudgeOperator: true });
            expect(out.viewerRole).to.equal(BANNER_ROLE.JUDGE);
            expect(out.headline).to.not.match(/rule or reject each pending challenge/i);
            expect(out.headline).to.not.match(/reject pending challenges as out-of-scope/i);
            expect(out.headline).to.match(/no challenges are pending\.?$/i);
        });

        it("a challenger-eligible viewer is ONLY told they can challenge when canChallenge is true", function () {
            const can = bondBanner({ canChallenge: true });
            expect(can.headline).to.match(/You can challenge this claim\./);
            // Same lifecycle (open) but NOT eligible -> bystander wording, generic.
            const cannot = bondBanner({ canChallenge: false });
            expect(cannot.viewerRole).to.equal(BANNER_ROLE.BYSTANDER);
            expect(cannot.headline).to.not.match(/^.*You can challenge/);
        });
    });

    // REGRESSION: a CLOSED bond can have pendingCount > 0 — closeBond() only blocks
    // NEW challenges; EXISTING Pending ones still resolve and the judge keeps FULL
    // power (ruleForPoster/ruleForChallenger within the ruling window; rejectChallenge
    // out-of-scope at ANY time while Pending). The per-challenge rule/reject buttons
    // in challengeHtml() are gated on isJudgeOperator + Pending, NOT on !closed, and
    // the Judge-controls card is gated on (isJudgeOperator && !settled), NOT on
    // !closed. So the banner MUST tell the judge of a closed-with-pending bond that
    // they can still rule/reject — matching the rendered controls. The next-move
    // clause is keyed off ACTUAL ACTIONABILITY (pendingCount), NOT the state LABEL.
    describe("closed bond WITH pending challenges (label is 'closed', actions still render)", function () {
        // Sanity: the state LABEL is still 'closed' (matches the status badge) even
        // though challenges are pending — closed precedence wins over disputed.
        it("state label stays 'closed' even with pendingCount > 0 (matches the badge)", function () {
            const out = bondBanner(flagsFor(BANNER_STATE.CLOSED, BANNER_ROLE.BYSTANDER, 2));
            expect(out.state).to.equal(BANNER_STATE.CLOSED);
            expect(out.headline).to.match(LIFECYCLE_PHRASE[BANNER_STATE.CLOSED]);
        });

        it("JUDGE @ closed+pending (rulable now): banner says rule/reject (NOT 'no challenges pending')", function () {
            const out = bondBanner(flagsFor(BANNER_STATE.CLOSED, BANNER_ROLE.JUDGE, 2));
            expect(out.state).to.equal(BANNER_STATE.CLOSED);
            expect(out.viewerRole).to.equal(BANNER_ROLE.JUDGE);
            // Lifecycle clause: closed, but existing disputes still resolve.
            expect(out.headline).to.match(LIFECYCLE_PHRASE[BANNER_STATE.CLOSED]);
            // Next-move: the SAME rule/reject clause the disputed judge gets, because
            // the SAME per-challenge buttons render (gated on Pending + ruling window,
            // not !closed). flagsFor defaults judgeCanRuleSomePending=true for pending.
            expect(out.headline).to.match(/You are the judge; rule or reject each pending challenge below\./);
            // The OLD BUG: it fell through to a false, self-contradictory denial.
            expect(out.headline).to.not.match(/no challenges are pending/i);
            // NOT self-contradictory: it must not BOTH claim a pending action AND deny
            // any pending challenge in the same headline.
            const claimsAction = /rule or reject/i.test(out.headline);
            const deniesPending = /no challenges are pending/i.test(out.headline);
            expect(claimsAction && deniesPending).to.equal(false);
        });

        it("JUDGE @ closed+1-pending (rulable now): singular, still says rule/reject", function () {
            const out = bondBanner(flagsFor(BANNER_STATE.CLOSED, BANNER_ROLE.JUDGE, 1));
            expect(out.state).to.equal(BANNER_STATE.CLOSED);
            expect(out.viewerRole).to.equal(BANNER_ROLE.JUDGE);
            expect(out.headline).to.match(/You are the judge; rule or reject each pending challenge below\./);
            expect(out.headline).to.not.match(/no challenges are pending/i);
        });

        it("POSTER @ closed+pending: closed lifecycle + pending disputes still resolve", function () {
            const out = bondBanner(flagsFor(BANNER_STATE.CLOSED, BANNER_ROLE.POSTER, 2));
            expect(out.state).to.equal(BANNER_STATE.CLOSED);
            expect(out.viewerRole).to.equal(BANNER_ROLE.POSTER);
            expect(out.headline).to.match(LIFECYCLE_PHRASE[BANNER_STATE.CLOSED]);
            // With pending challenges, reopen is contract-blocked (pendingCount === 0
            // required), so the banner must NOT promise reopen here.
            expect(out.headline).to.not.match(/you can reopen it/i);
            expect(out.headline).to.match(/pending challenges? still resolve/i);
        });

        it("POSTER @ closed+0-pending: can reopen (pending-free)", function () {
            const out = bondBanner(flagsFor(BANNER_STATE.CLOSED, BANNER_ROLE.POSTER, 0));
            expect(out.state).to.equal(BANNER_STATE.CLOSED);
            expect(out.viewerRole).to.equal(BANNER_ROLE.POSTER);
            expect(out.headline).to.match(/you can reopen it/i);
        });

        it("CHALLENGER (would-be) @ closed+pending: NOT told they can challenge (closed blocks new)", function () {
            // canChallenge is false on a closed bond, so a would-be challenger reads
            // as a bystander — and a closed bond NEVER advertises a new challenge.
            const out = bondBanner(flagsFor(BANNER_STATE.CLOSED, BANNER_ROLE.CHALLENGER_ELIGIBLE, 2));
            expect(out.state).to.equal(BANNER_STATE.CLOSED);
            expect(out.viewerRole).to.equal(BANNER_ROLE.BYSTANDER);
            expect(out.headline).to.not.match(/can challenge/i);
            // No false next-move; the headline is just the closed lifecycle clause.
            expect(out.headline).to.equal("Closed — no new challenges; existing disputes still resolve.");
        });

        it("BYSTANDER @ closed+pending: no next-move, just the closed lifecycle clause", function () {
            const out = bondBanner(flagsFor(BANNER_STATE.CLOSED, BANNER_ROLE.BYSTANDER, 3));
            expect(out.state).to.equal(BANNER_STATE.CLOSED);
            expect(out.viewerRole).to.equal(BANNER_ROLE.BYSTANDER);
            expect(out.headline).to.equal("Closed — no new challenges; existing disputes still resolve.");
            expect(out.headline).to.not.match(/can challenge|rule or reject|modify|reopen/i);
        });

        it("closed+0-pending JUDGE: nothing to rule (no action withheld either way)", function () {
            const out = bondBanner(flagsFor(BANNER_STATE.CLOSED, BANNER_ROLE.JUDGE, 0));
            expect(out.state).to.equal(BANNER_STATE.CLOSED);
            expect(out.viewerRole).to.equal(BANNER_ROLE.JUDGE);
            expect(out.headline).to.match(/no challenges are pending\.?$/i);
            expect(out.headline).to.not.match(/rule or reject each pending challenge/i);
            expect(out.headline).to.not.match(/reject pending challenges as out-of-scope/i);
        });
    });

    // HIGH-2: the judge "rule" clause is TIMING-AWARE. The per-challenge Rule
    // buttons render ONLY inside a Pending challenge's ruling window; during the
    // concession window and after the ruling deadline NO Rule button renders (only
    // reject-as-out-of-scope, which has no timing gate). The old banner said "rule
    // or reject each pending challenge" for ANY pending>0, contradicting the cards
    // and phaseFor. These cases drive judgeCanRuleSomePending=false (pending>0 but
    // nothing rulable now) and assert the banner offers ONLY reject, never "rule".
    describe("judge clause is timing-aware (no over-claiming 'rule' when the ruling window is shut)", function () {
        it("DISPUTED + pending but NOT rulable now (concession window / past deadline): reject-only, NOT 'rule'", function () {
            const out = bondBanner(flagsFor(BANNER_STATE.DISPUTED, BANNER_ROLE.JUDGE, 2, { judgeCanRuleSomePending: false }));
            expect(out.state).to.equal(BANNER_STATE.DISPUTED);
            expect(out.viewerRole).to.equal(BANNER_ROLE.JUDGE);
            // It must NOT over-claim "rule".
            expect(out.headline).to.not.match(/rule or reject each pending challenge/i);
            // It MUST still offer the out-of-scope reject (allowed at any pending instant)…
            expect(out.headline).to.match(/reject pending challenges as out-of-scope/i);
            // …and explain WHY no "rule" — the ruling window is shut right now.
            expect(out.headline).to.match(/ruling window is not open right now/i);
            // And it must NOT falsely deny that any challenge is pending.
            expect(out.headline).to.not.match(/no challenges are pending/i);
        });

        it("CLOSED + pending but NOT rulable now: reject-only on a closed bond too", function () {
            const out = bondBanner(flagsFor(BANNER_STATE.CLOSED, BANNER_ROLE.JUDGE, 1, { judgeCanRuleSomePending: false }));
            expect(out.state).to.equal(BANNER_STATE.CLOSED);
            expect(out.viewerRole).to.equal(BANNER_ROLE.JUDGE);
            // Lifecycle stays "existing disputes still resolve".
            expect(out.headline).to.match(LIFECYCLE_PHRASE[BANNER_STATE.CLOSED]);
            expect(out.headline).to.not.match(/rule or reject each pending challenge/i);
            expect(out.headline).to.match(/reject pending challenges as out-of-scope/i);
        });

        it("DISPUTED + pending AND rulable now: full rule/reject clause", function () {
            const out = bondBanner(flagsFor(BANNER_STATE.DISPUTED, BANNER_ROLE.JUDGE, 2, { judgeCanRuleSomePending: true }));
            expect(out.headline).to.match(/You are the judge; rule or reject each pending challenge below\./);
            expect(out.headline).to.not.match(/ruling window is not open/i);
        });
    });

    // HIGH-2 BONUS: a v6 bond at its TOTAL-EVER maxChallenges cap can have
    // pendingCount === 0 (all challenges resolved), so the lifecycle label is still
    // "open" — but the Challenge card is correctly HIDDEN (hasChallengeCapacity is
    // false on v6 when challengeCount >= maxChallenges). The bystander banner must
    // NOT say "anyone can challenge" there. It keys off the SAME hasChallengeCapacity
    // gate the card uses.
    describe("open bond at full capacity does not claim 'anyone can challenge' (bonus)", function () {
        it("BYSTANDER @ open + capacity FULL: no 'anyone can challenge' clause", function () {
            const out = bondBanner(flagsFor(BANNER_STATE.OPEN, BANNER_ROLE.BYSTANDER, 0, { hasChallengeCapacity: false }));
            expect(out.state).to.equal(BANNER_STATE.OPEN);
            expect(out.viewerRole).to.equal(BANNER_ROLE.BYSTANDER);
            expect(out.headline).to.not.match(/anyone can challenge/i);
            // The headline is just the open lifecycle clause, no false next-move.
            expect(out.headline).to.equal("Open — no challenges yet.");
        });

        it("BYSTANDER @ open + capacity AVAILABLE: keeps 'anyone can challenge'", function () {
            const out = bondBanner(flagsFor(BANNER_STATE.OPEN, BANNER_ROLE.BYSTANDER, 0, { hasChallengeCapacity: true }));
            expect(out.headline).to.include("Anyone can challenge this claim.");
        });

        it("hasChallengeCapacity defaults to TRUE when omitted (back-compat)", function () {
            // A caller that does not pass hasChallengeCapacity keeps the legacy wording.
            const out = bondBanner({ settled: false, closed: false, pendingCount: 0 });
            expect(out.state).to.equal(BANNER_STATE.OPEN);
            expect(out.viewerRole).to.equal(BANNER_ROLE.BYSTANDER);
            expect(out.headline).to.include("Anyone can challenge this claim.");
        });
    });

    describe("disputed pluralization is correct (1 vs N)", function () {
        it("1 pending -> singular 'challenge'", function () {
            const out = bondBanner({ pendingCount: 1, isJudgeOperator: true });
            expect(out.headline).to.match(/Disputed — 1 challenge pending\./);
        });
        it("N pending -> plural 'challenges'", function () {
            const out = bondBanner({ pendingCount: 3, isJudgeOperator: true });
            expect(out.headline).to.match(/Disputed — 3 challenges pending\./);
        });
    });

    describe("defensive input handling (pure, no throws)", function () {
        it("no argument -> open / bystander, a string headline, no throw", function () {
            const out = bondBanner();
            expect(out.state).to.equal(BANNER_STATE.OPEN);
            expect(out.viewerRole).to.equal(BANNER_ROLE.BYSTANDER);
            expect(out.headline).to.be.a("string").and.have.length.greaterThan(0);
        });
        it("bigint pendingCount is accepted (Number-coerced)", function () {
            const out = bondBanner({ pendingCount: 2n, isJudgeOperator: true });
            expect(out.state).to.equal(BANNER_STATE.DISPUTED);
            expect(out.headline).to.match(/Disputed — 2 challenges pending\./);
        });
        it("truthy-but-non-boolean flags are coerced", function () {
            const out = bondBanner({ settled: 1, isPoster: "yes" });
            expect(out.state).to.equal(BANNER_STATE.SETTLED);
        });
    });
});
