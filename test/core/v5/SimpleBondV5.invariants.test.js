const { expect } = require("chai");
const {
  JUDGE_FEE,
  ONE_DAY,
  deploySimpleBondV5FuzzFixture,
} = require("../../helpers/v5/simpleBondV5Fuzz");
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
} = require("../../helpers/v5/simpleBondV5Invariants");

describe("SimpleBondV5 invariant helpers", function () {
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

  function expectOperatorBalanceUnchanged(before, after) {
    const operatorAddress = before.roleAddresses.judgeOperator;
    expect((after.balancesByAddress[operatorAddress] ?? 0n) - (before.balancesByAddress[operatorAddress] ?? 0n))
      .to.equal(0n);
  }

  beforeEach(async function () {
    fixture = await deploySimpleBondV5FuzzFixture();
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
    expectOperatorBalanceUnchanged(baseline, afterFirstChallenge);

    await fixture.actions.challenge({
      challenger: fixture.actors.challenger2,
      metadata: "Challenge 2",
    });
    const afterSecondChallenge = await snapshot();
    expectGenericInvariants(afterFirstChallenge, afterSecondChallenge, baseline);
    expectOperatorBalanceUnchanged(afterFirstChallenge, afterSecondChallenge);

    await fixture.actions.advanceToRulingWindow();
    await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });
    const afterFirstPosterWin = await snapshot();
    expectGenericInvariants(afterSecondChallenge, afterFirstPosterWin, baseline);
    expectOperatorBalanceUnchanged(afterSecondChallenge, afterFirstPosterWin);

    await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });
    const afterSecondPosterWin = await snapshot();
    expectGenericInvariants(afterFirstPosterWin, afterSecondPosterWin, baseline);
    expectOperatorBalanceUnchanged(afterFirstPosterWin, afterSecondPosterWin);
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
    expectOperatorBalanceUnchanged(beforeFirstWin, afterFirstWin);

    await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });
    const afterSecondWin = await snapshot();
    expectPosterWinLockedBondBehavior(afterFirstWin, afterSecondWin, JUDGE_FEE);
    expectGenericInvariants(afterFirstWin, afterSecondWin, baseline);
    expectOperatorBalanceUnchanged(afterFirstWin, afterSecondWin);
  });

  it("validates withdraw outcomes from a post-ruling snapshot", async function () {
    await createBondWithChallenges(1);
    const baseline = await snapshot();

    await fixture.actions.advanceToRulingWindow();
    await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });

    const beforeWithdraw = await snapshot();
    await fixture.actions.advancePastDeadline();
    await fixture.actions.withdrawBond();
    const afterWithdraw = await snapshot();

    expectWithdrawBondOutcome(beforeWithdraw, afterWithdraw);
    expectGenericInvariants(beforeWithdraw, afterWithdraw, baseline);
    expectOperatorBalanceUnchanged(beforeWithdraw, afterWithdraw);
  });

  it("validates concede outcomes from queued challenges", async function () {
    await createBondWithChallenges(2);
    const baseline = await snapshot();
    const beforeConcede = await snapshot();

    await fixture.actions.concede();
    await fixture.actions.claimAllRefunds();
    const afterConcede = await snapshot();

    expectConcedeOutcome(beforeConcede, afterConcede);
    expectGenericInvariants(beforeConcede, afterConcede, baseline);
    expectOperatorBalanceUnchanged(beforeConcede, afterConcede);
  });

  it("validates reject outcomes after an earlier poster win", async function () {
    await createBondWithChallenges(3);
    const baseline = await snapshot();

    await fixture.actions.advanceToRulingWindow();
    await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });

    const beforeReject = await snapshot();
    await fixture.actions.rejectBond();
    await fixture.actions.claimAllRefunds();
    const afterReject = await snapshot();

    expectRejectBondOutcome(beforeReject, afterReject);
    expectGenericInvariants(beforeReject, afterReject, baseline);
    expectOperatorBalanceUnchanged(beforeReject, afterReject);
  });

  it("validates timeout outcomes from a partially consumed queue", async function () {
    await createBondWithChallenges(3);
    const baseline = await snapshot();

    await fixture.actions.advanceToRulingWindow();
    await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });

    const beforeTimeout = await snapshot();
    await fixture.actions.advancePastRulingDeadline();
    await fixture.actions.claimTimeout();
    await fixture.actions.claimAllRefunds();
    const afterTimeout = await snapshot();

    expectTimeoutOutcome(beforeTimeout, afterTimeout);
    expectGenericInvariants(beforeTimeout, afterTimeout, baseline);
    expectOperatorBalanceUnchanged(beforeTimeout, afterTimeout);
  });

  it("validates challenger-win outcomes from the active queue item", async function () {
    await createBondWithChallenges(3);
    const baseline = await snapshot();

    await fixture.actions.advanceToRulingWindow();
    await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });

    const beforeChallengerWin = await snapshot();
    await fixture.actions.ruleForChallenger({ feeCharged: JUDGE_FEE });
    await fixture.actions.claimAllRefunds();
    const afterChallengerWin = await snapshot();

    expectRuleForChallengerOutcome(beforeChallengerWin, afterChallengerWin, JUDGE_FEE);
    expectGenericInvariants(beforeChallengerWin, afterChallengerWin, baseline);
    expectOperatorBalanceUnchanged(beforeChallengerWin, afterChallengerWin);
  });

  it("keeps judge fees on the judge contract rather than the operator", async function () {
    await createBondWithChallenges(1);
    await fixture.actions.advanceToRulingWindow();

    const before = await snapshot();
    await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE / 2n });
    const after = await snapshot();

    expect(after.balancesByRole.judge - before.balancesByRole.judge).to.equal(JUDGE_FEE / 2n);
    expect(after.balancesByRole.judgeOperator - before.balancesByRole.judgeOperator).to.equal(0n);
  });

  it("keeps concession open until rulingWindowStart and closes it afterward", async function () {
    fixture = await deploySimpleBondV5FuzzFixture({
      deadlineLeadTime: ONE_DAY,
      acceptanceDelay: 12 * 60 * 60,
    });
    await fixture.actions.createBond();
    await fixture.actions.challenge({
      challenger: fixture.actors.challenger1,
      metadata: "Challenge 1",
    });

    const concessionDeadline = await fixture.read.concessionDeadline();
    expect(concessionDeadline).to.equal(await fixture.read.rulingWindowStart());

    await fixture.actions.concede({ metadata: "Timely concession" });
    await fixture.actions.claimAllRefunds();

    fixture = await deploySimpleBondV5FuzzFixture({
      deadlineLeadTime: ONE_DAY,
      acceptanceDelay: 12 * 60 * 60,
    });
    await fixture.actions.createBond();
    await fixture.actions.challenge({
      challenger: fixture.actors.challenger1,
      metadata: "Challenge 1",
    });

    await fixture.actions.advanceToRulingWindow();

    await expect(
      fixture.actions.concede({ metadata: "Too late" })
    ).to.be.revertedWith("Concession window closed");
  });
});
