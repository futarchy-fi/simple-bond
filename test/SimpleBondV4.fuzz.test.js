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

function createPrng(seed) {
  let state = BigInt(seed >>> 0);

  return function nextUint32() {
    state = (state * 1664525n + 1013904223n) % 4294967296n;
    return Number(state);
  };
}

function pickInt(nextUint32, upperBoundExclusive) {
  return nextUint32() % upperBoundExclusive;
}

function pickFee(nextUint32) {
  const feeOptions = [0n, JUDGE_FEE / 4n, JUDGE_FEE / 2n, JUDGE_FEE];
  return feeOptions[pickInt(nextUint32, feeOptions.length)];
}

async function snapshot(fixture) {
  return captureBondSnapshot(fixture);
}

function expectGenericInvariants(before, after, baseline) {
  expectTokenConservation(after, baseline);
  expectQueueMonotonicity(before, after);
  expectCurrentChallengeBounds(after);
}

async function createBondWithSeededChallenges(fixture, nextUint32, minimumChallenges = 1) {
  await fixture.actions.createBond();

  const baseline = await snapshot(fixture);
  let previous = baseline;
  const maxChallenges = Math.min(5, fixture.actors.challengers.length);
  const challengeCount = Math.max(
    minimumChallenges,
    1 + pickInt(nextUint32, maxChallenges)
  );

  for (let index = 0; index < challengeCount; index += 1) {
    await fixture.actions.challenge({
      challenger: fixture.actors.challengers[index],
      metadata: `Seeded challenge ${index + 1}`,
    });

    const current = await snapshot(fixture);
    expectGenericInvariants(previous, current, baseline);
    previous = current;
  }

  return { baseline, challengeCount, previous };
}

async function runSeededPosterFlow(seed) {
  const fixture = await deploySimpleBondV4FuzzFixture();
  const nextUint32 = createPrng(seed);
  const {
    baseline,
    challengeCount,
    previous: afterChallenges,
  } = await createBondWithSeededChallenges(fixture, nextUint32, 2);
  let previous = afterChallenges;

  await fixture.actions.advanceToRulingWindow();

  const posterWins = 1 + pickInt(nextUint32, challengeCount);
  for (let winIndex = 0; winIndex < posterWins; winIndex += 1) {
    const feeCharged = pickFee(nextUint32);
    await fixture.actions.ruleForPoster({ feeCharged });

    const current = await snapshot(fixture);
    expectPosterWinLockedBondBehavior(previous, current, feeCharged);
    expectGenericInvariants(previous, current, baseline);
    previous = current;
  }

  if (posterWins === challengeCount) {
    await fixture.actions.withdrawBond();
    const afterWithdraw = await snapshot(fixture);
    expectWithdrawBondOutcome(previous, afterWithdraw);
    expectGenericInvariants(previous, afterWithdraw, baseline);
    return;
  }

  const terminalAction = pickInt(nextUint32, 3);

  if (terminalAction === 0) {
    const feeCharged = pickFee(nextUint32);
    await fixture.actions.ruleForChallenger({ feeCharged });
    const afterChallengerWin = await snapshot(fixture);
    expectRuleForChallengerOutcome(previous, afterChallengerWin, feeCharged);
    expectGenericInvariants(previous, afterChallengerWin, baseline);
    return;
  }

  if (terminalAction === 1) {
    await fixture.actions.rejectBond();
    const afterReject = await snapshot(fixture);
    expectRejectBondOutcome(previous, afterReject);
    expectGenericInvariants(previous, afterReject, baseline);
    return;
  }

  await fixture.actions.advancePastRulingDeadline();
  await fixture.actions.claimTimeout();
  const afterTimeout = await snapshot(fixture);
  expectTimeoutOutcome(previous, afterTimeout);
  expectGenericInvariants(previous, afterTimeout, baseline);
}

async function runSeededConcedeFlow(seed) {
  const fixture = await deploySimpleBondV4FuzzFixture();
  const nextUint32 = createPrng(seed);
  const {
    baseline,
    previous,
  } = await createBondWithSeededChallenges(fixture, nextUint32, 1);

  await fixture.actions.concede({
    metadata: `Concede seed ${seed}`,
  });

  const afterConcede = await snapshot(fixture);
  expectConcedeOutcome(previous, afterConcede);
  expectGenericInvariants(previous, afterConcede, baseline);
}

describe("SimpleBondV4 seeded fuzz flows", function () {
  const posterFlowSeeds = [7, 11, 23, 31, 47, 61];
  const concedeFlowSeeds = [13, 19, 29, 37];

  for (const seed of posterFlowSeeds) {
    it(`replays seeded poster-side queue flow for seed ${seed}`, async function () {
      await runSeededPosterFlow(seed);
    });
  }

  for (const seed of concedeFlowSeeds) {
    it(`replays seeded concession flow for seed ${seed}`, async function () {
      await runSeededConcedeFlow(seed);
    });
  }
});
