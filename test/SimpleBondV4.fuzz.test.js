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
  // Mulberry32 keeps adjacent small integer seeds from collapsing into the same path shape.
  let state = seed >>> 0;

  return function nextUint32() {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
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
  const posterFlowCases = [
    { seed: 47, challengeCount: 2, posterWins: 1, terminal: "challenger win" },
    { seed: 48, challengeCount: 3, posterWins: 2, terminal: "rejection" },
    { seed: 50, challengeCount: 4, posterWins: 3, terminal: "timeout" },
    { seed: 24, challengeCount: 5, posterWins: 4, terminal: "rejection" },
    { seed: 23, challengeCount: 5, posterWins: 5, terminal: "withdrawal" },
  ];
  const concedeFlowCases = [
    { seed: 4, challengeCount: 1 },
    { seed: 6, challengeCount: 2 },
    { seed: 7, challengeCount: 3 },
    { seed: 13, challengeCount: 4 },
    { seed: 29, challengeCount: 5 },
  ];

  for (const { seed, challengeCount, posterWins, terminal } of posterFlowCases) {
    it(
      `replays seeded ${terminal} flow for seed ${seed} (${posterWins}/${challengeCount} poster wins)`,
      async function () {
        await runSeededPosterFlow(seed);
      }
    );
  }

  for (const { seed, challengeCount } of concedeFlowCases) {
    it(`replays seeded concession flow for seed ${seed} (${challengeCount} challenges)`, async function () {
      await runSeededConcedeFlow(seed);
    });
  }
});
