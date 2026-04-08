const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const ONE_DAY = 86400;
const ONE_MONTH = 30 * ONE_DAY;

const DEFAULTS = Object.freeze({
  bondAmount: ethers.parseEther("10000"),
  challengeAmount: ethers.parseEther("3000"),
  judgeFee: ethers.parseEther("500"),
  acceptanceDelay: 3 * ONE_DAY,
  rulingBuffer: 30 * ONE_DAY,
  participantFunding: ethers.parseEther("100000"),
  deadlineLeadTime: 3 * ONE_MONTH,
  bondMetadata: "My article has no significant errors",
  challengeMetadata: "I found errors",
  concessionMetadata: "I concede the claim is wrong",
});

function resolveAddress(accountOrAddress) {
  if (typeof accountOrAddress === "string") {
    return accountOrAddress;
  }

  if (accountOrAddress && typeof accountOrAddress.address === "string") {
    return accountOrAddress.address;
  }

  if (accountOrAddress && typeof accountOrAddress.getAddress === "function") {
    return accountOrAddress.getAddress();
  }

  throw new TypeError("Expected an address string or signer-like object");
}

function pickOutsider(signers, explicitOutsider) {
  if (explicitOutsider) {
    return explicitOutsider;
  }

  return signers[Math.min(5, signers.length - 1)];
}

async function deploySimpleBondV5FuzzFixture(options = {}) {
  const signers = options.signers ?? await ethers.getSigners();

  if (signers.length < 4) {
    throw new Error("SimpleBondV5 fuzz fixture requires at least 4 signers");
  }

  const poster = options.poster ?? signers[0];
  const judgeOperator = options.judgeOperator ?? signers[1];
  const outsider = pickOutsider(signers, options.outsider);
  const challengers = options.challengers ?? signers.filter((signer, index) => (
    index >= 2 && signer.address !== outsider.address
  ));

  if (challengers.length === 0) {
    throw new Error("SimpleBondV5 fuzz fixture requires at least 1 challenger");
  }

  const Token = await ethers.getContractFactory("TestToken");
  const token = await Token.deploy();
  const tokenAddress = await token.getAddress();

  const Bond = await ethers.getContractFactory("SimpleBondV5");
  const bond = await Bond.deploy();
  const bondAddress = await bond.getAddress();

  const ManualJudge = await ethers.getContractFactory("ManualJudge");
  const judge = await ManualJudge.deploy(judgeOperator.address);
  const judgeAddress = await judge.getAddress();

  const participantFunding = options.participantFunding ?? DEFAULTS.participantFunding;
  for (const account of [poster, ...challengers]) {
    await token.mint(account.address, participantFunding);
    await token.connect(account).approve(bondAddress, ethers.MaxUint256);
  }

  if (options.activateJudge !== false) {
    await judge.connect(judgeOperator).acceptOperatorRole();
  }

  const deadlineLeadTime = options.deadlineLeadTime ?? DEFAULTS.deadlineLeadTime;
  const deadline = options.deadline ?? (await time.latest()) + deadlineLeadTime;
  const defaults = {
    bondAmount: options.bondAmount ?? DEFAULTS.bondAmount,
    challengeAmount: options.challengeAmount ?? DEFAULTS.challengeAmount,
    judgeFee: options.judgeFee ?? DEFAULTS.judgeFee,
    acceptanceDelay: options.acceptanceDelay ?? DEFAULTS.acceptanceDelay,
    rulingBuffer: options.rulingBuffer ?? DEFAULTS.rulingBuffer,
    participantFunding,
    deadlineLeadTime,
    deadline,
    bondMetadata: options.bondMetadata ?? DEFAULTS.bondMetadata,
    challengeMetadata: options.challengeMetadata ?? DEFAULTS.challengeMetadata,
    concessionMetadata: options.concessionMetadata ?? DEFAULTS.concessionMetadata,
  };

  const actors = {
    poster,
    judgeOperator,
    judge,
    judgeContract: judge,
    outsider,
    challengers,
    challenger1: challengers[0],
    challenger2: challengers[1],
    challenger3: challengers[2],
  };

  const addresses = {
    bond: bondAddress,
    judge: judgeAddress,
    judgeContract: judgeAddress,
    judgeOperator: judgeOperator.address,
    poster: poster.address,
    outsider: outsider.address,
    token: tokenAddress,
    challenger1: actors.challenger1 && actors.challenger1.address,
    challenger2: actors.challenger2 && actors.challenger2.address,
    challenger3: actors.challenger3 && actors.challenger3.address,
    challengers: challengers.map((challenger) => challenger.address),
  };

  const read = {
    async getBond(bondId = 0) {
      return bond.bonds(bondId);
    },

    async getBondCore(bondId = 0) {
      return bond.getBondCore(bondId);
    },

    async getCurrentChallenge(bondId = 0) {
      const bondState = await bond.bonds(bondId);
      return bondState.currentChallenge;
    },

    async getChallengeCount(bondId = 0) {
      return bond.getChallengeCount(bondId);
    },

    async getChallenge(bondId = 0, index = 0) {
      return bond.getChallenge(bondId, index);
    },

    async getChallenges(bondId = 0) {
      const count = Number(await bond.getChallengeCount(bondId));
      const queuedChallenges = [];

      for (let index = 0; index < count; index += 1) {
        queuedChallenges.push(await bond.getChallenge(bondId, index));
      }

      return queuedChallenges;
    },

    async concessionDeadline(bondId = 0) {
      return bond.concessionDeadline(bondId);
    },

    async rulingWindowStart(bondId = 0) {
      return bond.rulingWindowStart(bondId);
    },

    async rulingDeadline(bondId = 0) {
      return bond.rulingDeadline(bondId);
    },

    async latestTime() {
      return time.latest();
    },

    async balanceOf(accountOrAddress) {
      return token.balanceOf(await resolveAddress(accountOrAddress));
    },

    async balancesOf(accounts) {
      if (Array.isArray(accounts)) {
        return Promise.all(accounts.map(async (account) => ({
          address: await resolveAddress(account),
          balance: await token.balanceOf(await resolveAddress(account)),
        })));
      }

      return Object.fromEntries(
        await Promise.all(
          Object.entries(accounts).map(async ([key, account]) => (
            [key, await token.balanceOf(await resolveAddress(account))]
          ))
        )
      );
    },

    async contractBalance() {
      return token.balanceOf(bondAddress);
    },

    async judgeBalance() {
      return token.balanceOf(judgeAddress);
    },

    async operatorBalance() {
      return token.balanceOf(judgeOperator.address);
    },
  };

  const actions = {
    async activateJudge({ caller = actors.judgeOperator } = {}) {
      const tx = await judge.connect(caller).acceptOperatorRole();
      const receipt = await tx.wait();

      return { tx, receipt };
    },

    async createBond(overrides = {}) {
      const bondId = Number(await bond.nextBondId());
      const caller = overrides.caller ?? actors.poster;
      const tx = await bond.connect(caller).createBond(
        overrides.token ?? addresses.token,
        overrides.bondAmount ?? defaults.bondAmount,
        overrides.challengeAmount ?? defaults.challengeAmount,
        overrides.judgeFee ?? defaults.judgeFee,
        await resolveAddress(overrides.judge ?? actors.judge),
        overrides.deadline ?? defaults.deadline,
        overrides.acceptanceDelay ?? defaults.acceptanceDelay,
        overrides.rulingBuffer ?? defaults.rulingBuffer,
        overrides.metadata ?? defaults.bondMetadata
      );
      const receipt = await tx.wait();

      return { bondId, tx, receipt };
    },

    async challenge({ bondId = 0, challenger = actors.challengers[0], metadata = defaults.challengeMetadata } = {}) {
      const challengeIndex = Number(await bond.getChallengeCount(bondId));
      const tx = await bond.connect(challenger).challenge(bondId, metadata);
      const receipt = await tx.wait();

      return { bondId, challengeIndex, challenger, tx, receipt };
    },

    async advanceToRulingWindow({ bondId = 0 } = {}) {
      const start = await bond.rulingWindowStart(bondId);
      await time.increaseTo(start);

      return { bondId, timestamp: start };
    },

    async advancePastRulingDeadline({ bondId = 0 } = {}) {
      const end = await bond.rulingDeadline(bondId);
      const timestamp = Number(end) + 1;
      await time.increaseTo(timestamp);

      return { bondId, timestamp };
    },

    async ruleForPoster({ bondId = 0, feeCharged = defaults.judgeFee, caller = actors.judgeOperator } = {}) {
      const challengeIndex = await read.getCurrentChallenge(bondId);
      const tx = await judge.connect(caller).ruleForPoster(bondAddress, bondId, feeCharged);
      const receipt = await tx.wait();

      return { bondId, challengeIndex, tx, receipt };
    },

    async ruleForChallenger({ bondId = 0, feeCharged = defaults.judgeFee, caller = actors.judgeOperator } = {}) {
      const challengeIndex = await read.getCurrentChallenge(bondId);
      const tx = await judge.connect(caller).ruleForChallenger(bondAddress, bondId, feeCharged);
      const receipt = await tx.wait();

      return { bondId, challengeIndex, tx, receipt };
    },

    async withdrawBond({ bondId = 0, caller = actors.poster } = {}) {
      const tx = await bond.connect(caller).withdrawBond(bondId);
      const receipt = await tx.wait();

      return { bondId, tx, receipt };
    },

    async claimTimeout({ bondId = 0, caller = actors.outsider } = {}) {
      const tx = await bond.connect(caller).claimTimeout(bondId);
      const receipt = await tx.wait();

      return { bondId, tx, receipt };
    },

    async concede({ bondId = 0, metadata = defaults.concessionMetadata, caller = actors.poster } = {}) {
      const tx = await bond.connect(caller).concede(bondId, metadata);
      const receipt = await tx.wait();

      return { bondId, tx, receipt };
    },

    async rejectBond({ bondId = 0, caller = actors.judgeOperator } = {}) {
      const tx = await judge.connect(caller).rejectBond(bondAddress, bondId);
      const receipt = await tx.wait();

      return { bondId, tx, receipt };
    },
  };

  actions.createDefaultBond = actions.createBond;
  actions.challengeBond = actions.challenge;

  return {
    bond,
    token,
    manualJudge: judge,
    actors,
    addresses,
    defaults,
    actions,
    read,
  };
}

module.exports = {
  ACCEPTANCE_DELAY: DEFAULTS.acceptanceDelay,
  BOND_AMOUNT: DEFAULTS.bondAmount,
  CHALLENGE_AMOUNT: DEFAULTS.challengeAmount,
  DEFAULTS,
  JUDGE_FEE: DEFAULTS.judgeFee,
  ONE_DAY,
  ONE_MONTH,
  RULING_BUFFER: DEFAULTS.rulingBuffer,
  deploySimpleBondV5FuzzFixture,
};
