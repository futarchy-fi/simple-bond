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

const DETAILED_BOND_CREATED_EVENT =
  "BondCreated(uint256,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,string)";
const LIGHTWEIGHT_BOND_CREATED_EVENT =
  "BondCreated(uint256,address,address,uint256)";
const BOND_RESOLVED_FOR_POSTER = 1n;
const BOND_RESOLVED_FOR_CHALLENGER = 2n;

function resolveAddress(accountOrAddress) {
  if (typeof accountOrAddress === "string") {
    return accountOrAddress;
  }

  if (accountOrAddress && typeof accountOrAddress.address === "string") {
    return accountOrAddress.address;
  }

  throw new TypeError("Expected an address string or signer-like object");
}

function pickOutsider(signers, explicitOutsider) {
  if (explicitOutsider) {
    return explicitOutsider;
  }

  return signers[Math.min(5, signers.length - 1)];
}

async function deploySimpleBondV4FuzzFixture(options = {}) {
  const signers = options.signers ?? await ethers.getSigners();

  if (signers.length < 4) {
    throw new Error("SimpleBondV4 fuzz fixture requires at least 4 signers");
  }

  const poster = options.poster ?? signers[0];
  const judge = options.judge ?? signers[1];
  const outsider = pickOutsider(signers, options.outsider);
  const challengers = options.challengers ?? signers.filter((signer, index) => (
    index >= 2 && signer.address !== outsider.address
  ));

  if (challengers.length === 0) {
    throw new Error("SimpleBondV4 fuzz fixture requires at least 1 challenger");
  }

  const Token = await ethers.getContractFactory("TestToken");
  const token = await Token.deploy();
  const tokenAddress = await token.getAddress();

  const Bond = await ethers.getContractFactory("SimpleBondV4");
  const bond = await Bond.deploy();
  const bondAddress = await bond.getAddress();

  const participantFunding = options.participantFunding ?? DEFAULTS.participantFunding;
  for (const account of [poster, ...challengers]) {
    await token.mint(account.address, participantFunding);
    await token.connect(account).approve(bondAddress, ethers.MaxUint256);
  }

  const deadlineLeadTime = options.deadlineLeadTime ?? DEFAULTS.deadlineLeadTime;
  const deadline = options.deadline ?? (await time.latest()) + deadlineLeadTime;
  const defaults = {
    bondAmount: options.bondAmount ?? DEFAULTS.bondAmount,
    challengeAmount: options.challengeAmount ?? DEFAULTS.challengeAmount,
    judgeFee: options.judgeFee ?? DEFAULTS.judgeFee,
    judgeMinFee: options.judgeMinFee ?? options.judgeFee ?? DEFAULTS.judgeFee,
    acceptanceDelay: options.acceptanceDelay ?? DEFAULTS.acceptanceDelay,
    rulingBuffer: options.rulingBuffer ?? DEFAULTS.rulingBuffer,
    participantFunding,
    deadlineLeadTime,
    deadline,
    bondMetadata: options.bondMetadata ?? DEFAULTS.bondMetadata,
    challengeMetadata: options.challengeMetadata ?? DEFAULTS.challengeMetadata,
    concessionMetadata: options.concessionMetadata ?? DEFAULTS.concessionMetadata,
  };

  const shouldRegisterJudge = options.registerJudge !== false;
  const shouldSetJudgeFee = shouldRegisterJudge && options.setJudgeFee !== false;

  if (shouldRegisterJudge) {
    await bond.connect(judge).registerAsJudge();
  }

  if (shouldSetJudgeFee) {
    await bond.connect(judge).setJudgeFee(tokenAddress, defaults.judgeMinFee);
  }

  const actors = {
    poster,
    judge,
    outsider,
    challengers,
    challenger1: challengers[0],
    challenger2: challengers[1],
    challenger3: challengers[2],
  };

  const addresses = {
    bond: bondAddress,
    challenger1: actors.challenger1 && actors.challenger1.address,
    challenger2: actors.challenger2 && actors.challenger2.address,
    challenger3: actors.challenger3 && actors.challenger3.address,
    challengers: challengers.map((challenger) => challenger.address),
    judge: judge.address,
    outsider: outsider.address,
    poster: poster.address,
    token: tokenAddress,
  };

  const read = {
    async getBond(bondId = 0) {
      return bond.bonds(bondId);
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

    async rulingWindowStart(bondId = 0) {
      return bond.rulingWindowStart(bondId);
    },

    async rulingDeadline(bondId = 0) {
      return bond.rulingDeadline(bondId);
    },

    async latestTime() {
      return time.latest();
    },

    async getJudgeMinFee(judgeAddress = actors.judge.address, tokenAddressOverride = addresses.token) {
      return bond.getJudgeMinFee(resolveAddress(judgeAddress), resolveAddress(tokenAddressOverride));
    },

    async balanceOf(accountOrAddress) {
      return token.balanceOf(resolveAddress(accountOrAddress));
    },

    async balancesOf(accounts) {
      if (Array.isArray(accounts)) {
        return Promise.all(accounts.map(async (account) => ({
          address: resolveAddress(account),
          balance: await token.balanceOf(resolveAddress(account)),
        })));
      }

      return Object.fromEntries(
        await Promise.all(
          Object.entries(accounts).map(async ([key, account]) => (
            [key, await token.balanceOf(resolveAddress(account))]
          ))
        )
      );
    },

    async contractBalance() {
      return token.balanceOf(bondAddress);
    },
  };

  const actions = {
    async createBond(overrides = {}) {
      const bondId = Number(await bond.nextBondId());
      const caller = overrides.caller ?? actors.poster;
      const tx = await bond.connect(caller).createBond(
        overrides.token ?? addresses.token,
        overrides.bondAmount ?? defaults.bondAmount,
        overrides.challengeAmount ?? defaults.challengeAmount,
        overrides.judgeFee ?? defaults.judgeFee,
        resolveAddress(overrides.judge ?? actors.judge),
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

    async ruleForPoster({ bondId = 0, feeCharged = defaults.judgeFee, caller = actors.judge } = {}) {
      const challengeIndex = await read.getCurrentChallenge(bondId);
      const tx = await bond.connect(caller).ruleForPoster(bondId, feeCharged);
      const receipt = await tx.wait();

      return { bondId, challengeIndex, tx, receipt };
    },

    async ruleForChallenger({ bondId = 0, feeCharged = defaults.judgeFee, caller = actors.judge } = {}) {
      const challengeIndex = await read.getCurrentChallenge(bondId);
      const tx = await bond.connect(caller).ruleForChallenger(bondId, feeCharged);
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

    async rejectBond({ bondId = 0, caller = actors.judge } = {}) {
      const tx = await bond.connect(caller).rejectBond(bondId);
      const receipt = await tx.wait();

      return { bondId, tx, receipt };
    },
  };

  actions.createDefaultBond = actions.createBond;
  actions.challengeBond = actions.challenge;

  return {
    bond,
    token,
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
  BOND_RESOLVED_FOR_CHALLENGER,
  BOND_RESOLVED_FOR_POSTER,
  CHALLENGE_AMOUNT: DEFAULTS.challengeAmount,
  DEFAULTS,
  DETAILED_BOND_CREATED_EVENT,
  JUDGE_FEE: DEFAULTS.judgeFee,
  LIGHTWEIGHT_BOND_CREATED_EVENT,
  ONE_DAY,
  ONE_MONTH,
  RULING_BUFFER: DEFAULTS.rulingBuffer,
  deploySimpleBondV4FuzzFixture,
};
