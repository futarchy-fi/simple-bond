const { expect } = require("chai");

const CHALLENGE_STATUS_PENDING = 0n;
const CHALLENGE_STATUS_WON = 1n;
const CHALLENGE_STATUS_LOST = 2n;
const CHALLENGE_STATUS_REFUNDED = 3n;

function resolveAddress(accountOrAddress) {
  if (typeof accountOrAddress === "string") {
    return accountOrAddress;
  }

  if (accountOrAddress && typeof accountOrAddress.address === "string") {
    return accountOrAddress.address;
  }

  if (accountOrAddress && typeof accountOrAddress.target === "string") {
    return accountOrAddress.target;
  }

  throw new TypeError("Expected an address string or signer-like object");
}

function dedupeAddresses(accounts) {
  return [...new Set(accounts.map(resolveAddress))];
}

function normalizeChallenge(challenge, index) {
  return {
    challenger: challenge.challenger ?? challenge[0],
    index,
    metadata: challenge.metadata ?? challenge[2],
    status: BigInt(challenge.status ?? challenge[1]),
  };
}

function collectRoleEntries(fixture, extraAccounts = []) {
  const entries = [];

  function addRole(label, accountOrAddress) {
    if (!accountOrAddress) {
      return;
    }

    entries.push({ address: resolveAddress(accountOrAddress), label });
  }

  addRole("poster", fixture.actors?.poster);
  addRole("judge", fixture.actors?.judgeContract ?? fixture.actors?.judge);
  addRole("judgeOperator", fixture.actors?.judgeOperator);
  addRole("outsider", fixture.actors?.outsider);

  const challengers = fixture.actors?.challengers ?? [];
  challengers.forEach((challenger, index) => {
    addRole(`challenger${index + 1}`, challenger);
  });

  extraAccounts.forEach((accountOrAddress, index) => {
    addRole(`extra${index + 1}`, accountOrAddress);
  });

  return entries;
}

function sumBalances(addresses, balancesByAddress) {
  return addresses.reduce(
    (sum, address) => sum + (balancesByAddress[address] ?? 0n),
    0n
  );
}

function getBalanceDelta(before, after, address) {
  return (after.balancesByAddress[address] ?? 0n) - (before.balancesByAddress[address] ?? 0n);
}

function buildExpectedDeltas(before, after) {
  return new Map(
    dedupeAddresses([...(before.trackedAddresses ?? []), ...(after.trackedAddresses ?? [])])
      .map((address) => [address, 0n])
  );
}

function addExpectedDelta(expectedDeltas, address, amount) {
  expectedDeltas.set(address, (expectedDeltas.get(address) ?? 0n) + amount);
}

function expectTrackedBalanceDeltas(before, after, expectedDeltas) {
  const trackedAddresses = dedupeAddresses([
    ...(before.trackedAddresses ?? []),
    ...(after.trackedAddresses ?? []),
  ]);

  for (const address of trackedAddresses) {
    expect(getBalanceDelta(before, after, address)).to.equal(expectedDeltas.get(address) ?? 0n);
  }
}

function getActiveChallenge(snapshot) {
  return snapshot.challenges[Number(snapshot.currentChallenge)] ?? null;
}

async function captureBondSnapshot(fixture, bondId = 0, options = {}) {
  const roleEntries = collectRoleEntries(fixture, options.extraAccounts);
  const trackedAddresses = dedupeAddresses(roleEntries.map(({ address }) => address));

  const [
    bond,
    challengeCount,
    currentChallenge,
    rawChallenges,
    contractBalance,
    refundCursor,
    refundEnd,
    trackedBalances,
  ] = await Promise.all([
    fixture.read.getBond(bondId),
    fixture.read.getChallengeCount(bondId),
    fixture.read.getCurrentChallenge(bondId),
    fixture.read.getChallenges(bondId),
    fixture.read.contractBalance(),
    fixture.read.refundCursor(bondId),
    fixture.read.refundEnd(bondId),
    fixture.read.balancesOf(trackedAddresses),
  ]);

  const challenges = rawChallenges.map(normalizeChallenge);
  const balancesByAddress = Object.fromEntries(
    trackedBalances.map(({ address, balance }) => [address, balance])
  );
  const roleAddresses = Object.fromEntries(
    roleEntries.map(({ label, address }) => [label, address])
  );
  const challengerAddresses = (fixture.actors?.challengers ?? []).map(resolveAddress);
  const balancesByRole = Object.fromEntries(
    roleEntries.map(({ label, address }) => [label, balancesByAddress[address] ?? 0n])
  );

  balancesByRole.challengers = challengerAddresses.map(
    (address) => balancesByAddress[address] ?? 0n
  );
  roleAddresses.challengers = challengerAddresses;

  const pendingChallenges = challenges.filter(
    ({ status }) => status === CHALLENGE_STATUS_PENDING
  );
  const refundedChallenges = challenges.filter(
    ({ status }) => status === CHALLENGE_STATUS_REFUNDED
  );
  const resolvedChallenges = challenges.filter(
    ({ status }) => status !== CHALLENGE_STATUS_PENDING
  );

  return {
    balancesByAddress,
    balancesByRole,
    bond,
    bondId,
    challengeCount,
    challenges,
    contractBalance,
    currentChallenge,
    pendingChallengeIndices: pendingChallenges.map(({ index }) => index),
    pendingChallenges,
    refundedChallenges,
    refundCursor,
    refundEnd,
    resolvedChallenges,
    roleAddresses,
    totalTrackedTokens: sumBalances(trackedAddresses, balancesByAddress) + contractBalance,
    trackedAddresses,
  };
}

function expectTokenConservation(snapshot, baselineSnapshotOrTotal) {
  const baselineTotal = typeof baselineSnapshotOrTotal === "bigint"
    ? baselineSnapshotOrTotal
    : baselineSnapshotOrTotal.totalTrackedTokens;

  expect(snapshot.totalTrackedTokens).to.equal(baselineTotal);
}

function expectQueueMonotonicity(before, after) {
  expect(after.challengeCount >= before.challengeCount).to.equal(true);
  expect(after.currentChallenge >= before.currentChallenge).to.equal(true);

  for (let index = 0; index < before.challenges.length; index += 1) {
    const beforeChallenge = before.challenges[index];
    const afterChallenge = after.challenges[index];

    expect(afterChallenge, `missing challenge at index ${index}`).to.not.equal(undefined);
    expect(afterChallenge.challenger).to.equal(beforeChallenge.challenger);
    expect(afterChallenge.metadata).to.equal(beforeChallenge.metadata);

    if (beforeChallenge.status !== CHALLENGE_STATUS_PENDING) {
      expect(afterChallenge.status).to.equal(beforeChallenge.status);
    }
  }
}

function expectCurrentChallengeBounds(snapshot) {
  expect(snapshot.currentChallenge <= snapshot.challengeCount).to.equal(true);

  if (!snapshot.bond.settled && !snapshot.bond.conceded && snapshot.pendingChallenges.length === 0) {
    expect(snapshot.currentChallenge).to.equal(snapshot.challengeCount);
  }
}

function expectPosterWinLockedBondBehavior(before, after, feeCharged) {
  const resolvedIndex = Number(before.currentChallenge);
  const resolvedChallenge = before.challenges[resolvedIndex];
  const expectedDeltas = buildExpectedDeltas(before, after);

  expect(
    resolvedChallenge,
    "expected an active challenge before the poster win"
  ).to.not.equal(undefined);
  expect(after.bond.settled).to.equal(false);
  expect(after.bond.conceded).to.equal(false);
  expect(after.challengeCount).to.equal(before.challengeCount);
  expect(after.currentChallenge).to.equal(before.currentChallenge + 1n);
  expect(after.challenges[resolvedIndex].status).to.equal(CHALLENGE_STATUS_LOST);

  for (let index = resolvedIndex + 1; index < before.challenges.length; index += 1) {
    expect(after.challenges[index].challenger).to.equal(before.challenges[index].challenger);
    expect(after.challenges[index].metadata).to.equal(before.challenges[index].metadata);
    expect(after.challenges[index].status).to.equal(CHALLENGE_STATUS_PENDING);
  }

  const expectedContractBalance = before.bond.bondAmount
    + (before.bond.challengeAmount * BigInt(after.pendingChallenges.length));
  const posterAddress = before.roleAddresses.poster;
  const judgeAddress = before.roleAddresses.judge;

  expect(before.contractBalance - after.contractBalance).to.equal(before.bond.challengeAmount);
  expect(after.contractBalance).to.equal(expectedContractBalance);
  addExpectedDelta(expectedDeltas, posterAddress, before.bond.challengeAmount - feeCharged);
  addExpectedDelta(expectedDeltas, judgeAddress, feeCharged);
  expectTrackedBalanceDeltas(before, after, expectedDeltas);
}

function expectWithdrawBondOutcome(before, after) {
  const expectedDeltas = buildExpectedDeltas(before, after);

  addExpectedDelta(expectedDeltas, before.roleAddresses.poster, before.bond.bondAmount);

  expect(after.bond.settled).to.equal(true);
  expect(after.contractBalance).to.equal(0n);
  expectTrackedBalanceDeltas(before, after, expectedDeltas);
}

function expectConcedeOutcome(before, after) {
  const expectedDeltas = buildExpectedDeltas(before, after);

  addExpectedDelta(expectedDeltas, before.roleAddresses.poster, before.bond.bondAmount);

  for (const challenge of before.pendingChallenges) {
    addExpectedDelta(expectedDeltas, challenge.challenger, before.bond.challengeAmount);
  }

  expect(after.bond.settled).to.equal(true);
  expect(after.bond.conceded).to.equal(true);
  expect(after.contractBalance).to.equal(0n);
  expectTrackedBalanceDeltas(before, after, expectedDeltas);
}

function expectRejectBondOutcome(before, after) {
  const expectedDeltas = buildExpectedDeltas(before, after);

  addExpectedDelta(expectedDeltas, before.roleAddresses.poster, before.bond.bondAmount);

  for (const challenge of before.pendingChallenges) {
    addExpectedDelta(expectedDeltas, challenge.challenger, before.bond.challengeAmount);
  }

  expect(after.bond.settled).to.equal(true);
  expect(after.contractBalance).to.equal(0n);
  expectTrackedBalanceDeltas(before, after, expectedDeltas);
}

function expectTimeoutOutcome(before, after) {
  const expectedDeltas = buildExpectedDeltas(before, after);
  const currentIndex = Number(before.currentChallenge);

  addExpectedDelta(expectedDeltas, before.roleAddresses.poster, before.bond.bondAmount);

  for (const challenge of before.pendingChallenges) {
    if (challenge.index >= currentIndex) {
      addExpectedDelta(expectedDeltas, challenge.challenger, before.bond.challengeAmount);
    }
  }

  expect(after.bond.settled).to.equal(true);
  expect(after.contractBalance).to.equal(0n);
  expectTrackedBalanceDeltas(before, after, expectedDeltas);
}

function expectRuleForChallengerOutcome(before, after, feeCharged) {
  const expectedDeltas = buildExpectedDeltas(before, after);
  const activeChallenge = getActiveChallenge(before);

  expect(
    activeChallenge,
    "expected an active challenge before the challenger win"
  ).to.not.equal(undefined);

  addExpectedDelta(
    expectedDeltas,
    activeChallenge.challenger,
    before.bond.bondAmount + before.bond.challengeAmount - feeCharged
  );
  addExpectedDelta(expectedDeltas, before.roleAddresses.judge, feeCharged);

  for (const challenge of before.pendingChallenges) {
    if (challenge.index > Number(before.currentChallenge)) {
      addExpectedDelta(expectedDeltas, challenge.challenger, before.bond.challengeAmount);
    }
  }

  expect(after.bond.settled).to.equal(true);
  expect(after.contractBalance).to.equal(0n);
  expect(after.challenges[Number(before.currentChallenge)].status).to.equal(CHALLENGE_STATUS_WON);
  expectTrackedBalanceDeltas(before, after, expectedDeltas);
}

module.exports = {
  CHALLENGE_STATUS_LOST,
  CHALLENGE_STATUS_PENDING,
  CHALLENGE_STATUS_REFUNDED,
  CHALLENGE_STATUS_WON,
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
};
