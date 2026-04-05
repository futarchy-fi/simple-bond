const { expect } = require("chai");
const {
  JUDGE_FEE,
  deploySimpleBondV4FuzzFixture,
} = require("./helpers/simpleBondV4Fuzz");
const {
  captureBondSnapshot,
  expectConcedeOutcome,
  expectCurrentChallengeBounds,
  expectPosterWinLockedBondBehavior,
  expectQueueMonotonicity,
  expectRejectBondOutcome,
  expectRuleForChallengerOutcome,
  expectTimeoutOutcome,
  expectTokenConservation,
  expectWithdrawBondOutcome,
} = require("./helpers/simpleBondV4Invariants");

describe("SimpleBondV4 invariant helpers", function () {
  let fixture;

  async function snapshot() {
    return captureBondSnapshot(fixture);
  }

  async function createBondWithChallenges(count) {
    await fixture.actions.createBond();

    for (let index = 0; index < count; index += 1) {
      await fixture.actions.challenge({
        challenger: fixture.actors.challengers[index],
        metadata: `Challenge ${index + 1}`,
      });
    }
  }

  function expectGenericInvariants(before, after, baseline) {
    expectTokenConservation(after, baseline);
    expectQueueMonotonicity(before, after);
    expectCurrentChallengeBounds(after);
  }

  beforeEach(async function () {
    fixture = await deploySimpleBondV4FuzzFixture();
  });

  it("tracks conservation, queue monotonicity, and bounds across a deterministic sequence", async function () {
    await fixture.actions.createBond();
    const baseline = await snapshot();

    expectTokenConservation(baseline, baseline);
    expectCurrentChallengeBounds(baseline);

    await fixture.actions.challenge({
      challenger: fixture.actors.challenger1,
      metadata: "Challenge 1",
    });
    const afterFirstChallenge = await snapshot();
    expectGenericInvariants(baseline, afterFirstChallenge, baseline);

    await fixture.actions.challenge({
      challenger: fixture.actors.challenger2,
      metadata: "Challenge 2",
    });
    const afterSecondChallenge = await snapshot();
    expectGenericInvariants(afterFirstChallenge, afterSecondChallenge, baseline);

    await fixture.actions.advanceToRulingWindow();
    await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });
    const afterFirstPosterWin = await snapshot();
    expectGenericInvariants(afterSecondChallenge, afterFirstPosterWin, baseline);

    await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });
    const afterSecondPosterWin = await snapshot();
    expectGenericInvariants(afterFirstPosterWin, afterSecondPosterWin, baseline);
    expect(afterSecondPosterWin.currentChallenge).to.equal(afterSecondPosterWin.challengeCount);
  });

  it("captures the locked-bond behavior for successive poster wins", async function () {
    await createBondWithChallenges(3);
    const baseline = await snapshot();

    await fixture.actions.advanceToRulingWindow();

    const beforeFirstWin = await snapshot();
    await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });
    const afterFirstWin = await snapshot();
    expectPosterWinLockedBondBehavior(beforeFirstWin, afterFirstWin, JUDGE_FEE);
    expectGenericInvariants(beforeFirstWin, afterFirstWin, baseline);

    await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });
    const afterSecondWin = await snapshot();
    expectPosterWinLockedBondBehavior(afterFirstWin, afterSecondWin, JUDGE_FEE);
    expectGenericInvariants(afterFirstWin, afterSecondWin, baseline);
  });

  it("validates withdraw outcomes from a post-ruling snapshot", async function () {
    await createBondWithChallenges(1);
    const baseline = await snapshot();

    await fixture.actions.advanceToRulingWindow();
    await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });

    const beforeWithdraw = await snapshot();
    await fixture.actions.withdrawBond();
    const afterWithdraw = await snapshot();

    expectWithdrawBondOutcome(beforeWithdraw, afterWithdraw);
    expectGenericInvariants(beforeWithdraw, afterWithdraw, baseline);
  });

  it("validates concede outcomes from queued challenges", async function () {
    await createBondWithChallenges(2);
    const baseline = await snapshot();
    const beforeConcede = await snapshot();

    await fixture.actions.concede();
    const afterConcede = await snapshot();

    expectConcedeOutcome(beforeConcede, afterConcede);
    expectGenericInvariants(beforeConcede, afterConcede, baseline);
  });

  it("validates reject outcomes after an earlier poster win", async function () {
    await createBondWithChallenges(3);
    const baseline = await snapshot();

    await fixture.actions.advanceToRulingWindow();
    await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });

    const beforeReject = await snapshot();
    await fixture.actions.rejectBond();
    const afterReject = await snapshot();

    expectRejectBondOutcome(beforeReject, afterReject);
    expectGenericInvariants(beforeReject, afterReject, baseline);
  });

  it("validates timeout outcomes from a partially consumed queue", async function () {
    await createBondWithChallenges(3);
    const baseline = await snapshot();

    await fixture.actions.advanceToRulingWindow();
    await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });

    const beforeTimeout = await snapshot();
    await fixture.actions.advancePastRulingDeadline();
    await fixture.actions.claimTimeout();
    const afterTimeout = await snapshot();

    expectTimeoutOutcome(beforeTimeout, afterTimeout);
    expectGenericInvariants(beforeTimeout, afterTimeout, baseline);
  });

  it("validates challenger-win outcomes from the active queue item", async function () {
    await createBondWithChallenges(3);
    const baseline = await snapshot();

    await fixture.actions.advanceToRulingWindow();
    await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });

    const beforeChallengerWin = await snapshot();
    await fixture.actions.ruleForChallenger({ feeCharged: JUDGE_FEE });
    const afterChallengerWin = await snapshot();

    expectRuleForChallengerOutcome(beforeChallengerWin, afterChallengerWin, JUDGE_FEE);
    expectGenericInvariants(beforeChallengerWin, afterChallengerWin, baseline);
  });
});
