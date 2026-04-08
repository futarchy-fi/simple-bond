const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const { DEFAULTS } = require("./helpers/v5/simpleBondV5Fuzz");

describe("SimpleBondV5 judge flow", function () {
  async function deployFixture() {
    const [
      registryOwner,
      registryAdmin,
      poster,
      judgeOperator1,
      judgeOperator2,
      challenger1,
      challenger2,
      challenger3,
      outsider,
    ] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("TestToken");
    const token = await Token.deploy();

    const Bond = await ethers.getContractFactory("SimpleBondV5");
    const bond = await Bond.deploy();

    const ManualJudge = await ethers.getContractFactory("ManualJudge");
    const judge1 = await ManualJudge.deploy(judgeOperator1.address);
    const judge2 = await ManualJudge.deploy(judgeOperator2.address);

    const Registry = await ethers.getContractFactory("JudgeProfileRegistry");
    const registry = await Registry.deploy(registryOwner.address, registryAdmin.address);

    const tokenAddress = await token.getAddress();
    const bondAddress = await bond.getAddress();

    for (const signer of [poster, challenger1, challenger2, challenger3]) {
      await token.mint(signer.address, DEFAULTS.participantFunding);
      await token.connect(signer).approve(bondAddress, ethers.MaxUint256);
    }

    async function createBond({
      caller = poster,
      judge = judge1,
      metadata = DEFAULTS.bondMetadata,
      bondAmount = DEFAULTS.bondAmount,
      challengeAmount = DEFAULTS.challengeAmount,
      judgeFee = DEFAULTS.judgeFee,
      acceptanceDelay = DEFAULTS.acceptanceDelay,
      rulingBuffer = DEFAULTS.rulingBuffer,
    } = {}) {
      const bondId = Number(await bond.nextBondId());
      const deadline = await time.latest() + DEFAULTS.deadlineLeadTime;

      await bond.connect(caller).createBond(
        tokenAddress,
        bondAmount,
        challengeAmount,
        judgeFee,
        await judge.getAddress(),
        deadline,
        acceptanceDelay,
        rulingBuffer,
        metadata
      );

      return { bondId, deadline };
    }

    async function challengeBond(bondId, challenger, metadata) {
      const challengeIndex = Number(await bond.getChallengeCount(bondId));
      await bond.connect(challenger).challenge(
        bondId,
        metadata || `Challenge ${challengeIndex + 1}`
      );
      return challengeIndex;
    }

    async function advanceToRulingWindow(bondId) {
      const start = await bond.rulingWindowStart(bondId);
      await time.increaseTo(start);
      return start;
    }

    async function claimAllRefunds(bondId, caller = outsider) {
      while ((await bond.refundCursor(bondId)) < (await bond.refundEnd(bondId))) {
        const cursor = await bond.refundCursor(bondId);
        const end = await bond.refundEnd(bondId);
        const remaining = Number(end - cursor);
        await bond.connect(caller).claimRefunds(bondId, remaining);
      }
    }

    async function getProfile(judge) {
      const judgeAddress = typeof judge === "string" ? judge : await judge.getAddress();
      const [displayName, statement, linkURI, metadataURI, updatedAt] = await registry.getProfile(judgeAddress);
      return { displayName, statement, linkURI, metadataURI, updatedAt };
    }

    return {
      registryOwner,
      registryAdmin,
      poster,
      judgeOperator1,
      judgeOperator2,
      challenger1,
      challenger2,
      challenger3,
      outsider,
      token,
      bond,
      judge1,
      judge2,
      registry,
      tokenAddress,
      createBond,
      challengeBond,
      advanceToRulingWindow,
      claimAllRefunds,
      getProfile,
    };
  }

  it("registers multiple judge profiles and keeps controllers separate", async function () {
    const {
      judge1,
      judge2,
      judgeOperator1,
      judgeOperator2,
      registry,
      getProfile,
    } = await deployFixture();

    const judge1Address = await judge1.getAddress();
    const judge2Address = await judge2.getAddress();

    await expect(
      registry.connect(judgeOperator1).setProfile(
        judge1Address,
        "Alice Court",
        "I rule on public evidence.",
        "https://futarchy.ai/judges/alice",
        "ipfs://alice-profile"
      )
    ).to.emit(registry, "JudgeProfileUpdated").withArgs(judge1Address, judgeOperator1.address);

    await judge1.connect(judgeOperator1).acceptOperatorRole();
    await judge2.connect(judgeOperator2).acceptOperatorRole();

    await expect(
      registry.connect(judgeOperator2).setProfile(
        judge2Address,
        "Bob Arbitration",
        "I specialize in long-form disputes.",
        "https://futarchy.ai/judges/bob",
        "ipfs://bob-profile"
      )
    ).to.emit(registry, "JudgeProfileUpdated").withArgs(judge2Address, judgeOperator2.address);

    expect(await registry.hasProfile(judge1Address)).to.equal(true);
    expect(await registry.hasProfile(judge2Address)).to.equal(true);
    expect(await registry.profileControllerOf(judge1Address)).to.equal(judgeOperator1.address);
    expect(await registry.profileControllerOf(judge2Address)).to.equal(judgeOperator2.address);

    expect(await getProfile(judge1)).to.deep.equal({
      displayName: "Alice Court",
      statement: "I rule on public evidence.",
      linkURI: "https://futarchy.ai/judges/alice",
      metadataURI: "ipfs://alice-profile",
      updatedAt: await registry.getProfile(judge1Address).then((profile) => profile[4]),
    });

    const bobProfile = await getProfile(judge2);
    expect(bobProfile.displayName).to.equal("Bob Arbitration");
    expect(bobProfile.statement).to.equal("I specialize in long-form disputes.");
    expect(bobProfile.linkURI).to.equal("https://futarchy.ai/judges/bob");
    expect(bobProfile.metadataURI).to.equal("ipfs://bob-profile");
    expect(bobProfile.updatedAt).to.be.greaterThan(0n);
  });

  it("covers multiple judges, profiles, and the full dispute lifecycle", async function () {
    const {
      poster,
      judgeOperator1,
      judgeOperator2,
      challenger1,
      challenger2,
      challenger3,
      outsider,
      token,
      bond,
      judge1,
      judge2,
      registry,
      createBond,
      challengeBond,
      advanceToRulingWindow,
      claimAllRefunds,
    } = await deployFixture();

    const judge1Address = await judge1.getAddress();
    const judge2Address = await judge2.getAddress();
    const tokenAddress = await token.getAddress();

    await registry.connect(judgeOperator1).setProfile(
      judge1Address,
      "Alice Court",
      "I rule on public evidence.",
      "https://futarchy.ai/judges/alice",
      "ipfs://alice-profile"
    );
    await judge1.connect(judgeOperator1).acceptOperatorRole();

    await judge2.connect(judgeOperator2).acceptOperatorRole();
    await registry.connect(judgeOperator2).setProfile(
      judge2Address,
      "Bob Arbitration",
      "I specialize in long-form disputes.",
      "https://futarchy.ai/judges/bob",
      "ipfs://bob-profile"
    );

    const posterInitial = await token.balanceOf(poster.address);
    const challenger1Initial = await token.balanceOf(challenger1.address);
    const challenger2Initial = await token.balanceOf(challenger2.address);
    const challenger3Initial = await token.balanceOf(challenger3.address);

    const { bondId: meritsBondId } = await createBond({
      judge: judge1,
      metadata: "Judge one merits bond",
    });
    expect((await bond.bonds(meritsBondId)).judge).to.equal(judge1Address);

    await challengeBond(meritsBondId, challenger1, "First challenge");
    await challengeBond(meritsBondId, challenger2, "Second challenge");
    await advanceToRulingWindow(meritsBondId);

    const firstFee = ethers.parseEther("100");
    const secondFee = ethers.parseEther("200");

    await expect(
      judge1.connect(judgeOperator1).ruleForPoster(await bond.getAddress(), meritsBondId, firstFee)
    ).to.emit(bond, "RuledForPoster").withArgs(meritsBondId, 0, challenger1.address, firstFee);

    let firstChallenge = await bond.getChallenge(meritsBondId, 0);
    let secondChallenge = await bond.getChallenge(meritsBondId, 1);
    let meritsBond = await bond.bonds(meritsBondId);

    expect(firstChallenge.status).to.equal(2n);
    expect(secondChallenge.status).to.equal(0n);
    expect(meritsBond.currentChallenge).to.equal(1n);
    expect(await token.balanceOf(judge1Address)).to.equal(firstFee);

    await expect(
      judge1.connect(judgeOperator1).ruleForChallenger(await bond.getAddress(), meritsBondId, secondFee)
    ).to.emit(bond, "RuledForChallenger").withArgs(meritsBondId, 1, challenger2.address, secondFee);

    meritsBond = await bond.bonds(meritsBondId);
    secondChallenge = await bond.getChallenge(meritsBondId, 1);

    expect(meritsBond.settled).to.equal(true);
    expect(meritsBond.conceded).to.equal(false);
    expect(secondChallenge.status).to.equal(1n);
    expect(await token.balanceOf(judge1Address)).to.equal(firstFee + secondFee);
    expect(await token.balanceOf(challenger2.address)).to.equal(
      challenger2Initial - DEFAULTS.challengeAmount + DEFAULTS.bondAmount + DEFAULTS.challengeAmount - secondFee
    );

    await expect(
      judge1.connect(judgeOperator1).withdrawFees(tokenAddress, judgeOperator1.address, firstFee + secondFee)
    ).to.emit(judge1, "FeesWithdrawn").withArgs(tokenAddress, judgeOperator1.address, firstFee + secondFee);

    expect(await token.balanceOf(judge1Address)).to.equal(0n);
    expect(await token.balanceOf(judgeOperator1.address)).to.equal(firstFee + secondFee);
    expect(await token.balanceOf(poster.address)).to.equal(
      posterInitial - DEFAULTS.bondAmount + (DEFAULTS.challengeAmount - firstFee)
    );
    expect(await token.balanceOf(challenger1.address)).to.equal(challenger1Initial - DEFAULTS.challengeAmount);

    const { bondId: rejectedBondId } = await createBond({
      judge: judge2,
      metadata: "Judge two rejected bond",
    });
    await challengeBond(rejectedBondId, challenger3, "Third challenge");

    await expect(
      judge2.connect(judgeOperator2).rejectBond(await bond.getAddress(), rejectedBondId)
    ).to.emit(bond, "BondRejectedByJudge").withArgs(rejectedBondId, judge2Address);

    expect(await bond.refundEnd(rejectedBondId)).to.equal(1n);
    await claimAllRefunds(rejectedBondId, outsider);

    const rejectedBond = await bond.bonds(rejectedBondId);
    const rejectedChallenge = await bond.getChallenge(rejectedBondId, 0);
    expect(rejectedBond.settled).to.equal(true);
    expect(rejectedBond.conceded).to.equal(false);
    expect(rejectedChallenge.status).to.equal(3n);
    expect(await token.balanceOf(challenger3.address)).to.equal(challenger3Initial);

    const { bondId: concededBondId } = await createBond({
      judge: judge1,
      metadata: "Judge one conceded bond",
    });
    await challengeBond(concededBondId, challenger1, "Concession challenge");

    await expect(
      bond.connect(poster).concede(concededBondId, "I concede")
    ).to.emit(bond, "ClaimConceded").withArgs(concededBondId, poster.address, "I concede");

    await claimAllRefunds(concededBondId, outsider);

    const concededBond = await bond.bonds(concededBondId);
    const concededChallenge = await bond.getChallenge(concededBondId, 0);
    expect(concededBond.settled).to.equal(true);
    expect(concededBond.conceded).to.equal(true);
    expect(concededChallenge.status).to.equal(3n);
    expect(await token.balanceOf(challenger1.address)).to.equal(
      challenger1Initial - DEFAULTS.challengeAmount
    );

    expect(await registry.hasProfile(judge1Address)).to.equal(true);
    expect(await registry.hasProfile(judge2Address)).to.equal(true);
  });
});
