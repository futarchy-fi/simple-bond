const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("SimpleBondV5", function () {
  const BOND_AMOUNT = ethers.parseEther("10000");
  const CHALLENGE_AMOUNT = ethers.parseEther("3000");
  const JUDGE_FEE = ethers.parseEther("500");
  const ACCEPTANCE_DELAY = 24 * 60 * 60;
  const RULING_BUFFER = 24 * 60 * 60;

  let bond;
  let token;
  let manualJudge;
  let poster;
  let operator;
  let challenger;
  let outsider;

  async function latestDeadline(offset = 7 * 24 * 60 * 60) {
    return (await time.latest()) + offset;
  }

  async function createBondWithJudge(judgeAddress, overrides = {}) {
    const deadline = overrides.deadline ?? await latestDeadline();
    const tx = await bond.connect(poster).createBond(
      await token.getAddress(),
      BOND_AMOUNT,
      CHALLENGE_AMOUNT,
      overrides.judgeFee ?? JUDGE_FEE,
      judgeAddress,
      deadline,
      overrides.acceptanceDelay ?? ACCEPTANCE_DELAY,
      overrides.rulingBuffer ?? RULING_BUFFER,
      overrides.metadata ?? "Claim metadata"
    );
    await tx.wait();
    return 0n;
  }

  async function challengeBond(bondId, metadata = "Challenge metadata") {
    await bond.connect(challenger).challenge(bondId, metadata);
  }

  beforeEach(async function () {
    [poster, operator, challenger, outsider] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("TestToken");
    token = await Token.deploy();

    const Bond = await ethers.getContractFactory("SimpleBondV5");
    bond = await Bond.deploy();

    const ManualJudge = await ethers.getContractFactory("ManualJudge");
    manualJudge = await ManualJudge.deploy(operator.address);

    for (const signer of [poster, challenger]) {
      await token.mint(signer.address, ethers.parseEther("1000000"));
      await token.connect(signer).approve(await bond.getAddress(), ethers.MaxUint256);
    }
  });

  it("rejects EOA judges", async function () {
    await expect(
      createBondWithJudge(operator.address)
    ).to.be.revertedWith("Judge must be contract");
  });

  it("rejects inactive ManualJudge wrappers", async function () {
    await expect(
      createBondWithJudge(await manualJudge.getAddress())
    ).to.be.revertedWith("Judge inactive");
  });

  it("accepts an active ManualJudge wrapper and stores the judge contract", async function () {
    await expect(
      manualJudge.connect(operator).acceptOperatorRole()
    ).to.emit(manualJudge, "OperatorAccepted").withArgs(operator.address);

    const bondId = await createBondWithJudge(await manualJudge.getAddress());
    const createdBond = await bond.bonds(bondId);

    expect(createdBond.poster).to.equal(poster.address);
    expect(createdBond.judge).to.equal(await manualJudge.getAddress());
    expect(createdBond.judgeFee).to.equal(JUDGE_FEE);
  });

  it("closes concession once the concession deadline passes", async function () {
    await manualJudge.connect(operator).acceptOperatorRole();

    const deadline = await latestDeadline(24 * 60 * 60);
    const bondId = await createBondWithJudge(await manualJudge.getAddress(), {
      deadline,
      acceptanceDelay: 12 * 60 * 60,
    });

    await challengeBond(bondId);

    const concessionDeadline = await bond.concessionDeadline(bondId);
    await time.increaseTo(concessionDeadline);

    await expect(
      bond.connect(poster).concede(bondId, "Too late")
    ).to.be.revertedWith("Concession window closed");
  });

  it("lets the ManualJudge operator rule for the poster with a partial fee", async function () {
    await manualJudge.connect(operator).acceptOperatorRole();

    const bondId = await createBondWithJudge(await manualJudge.getAddress());
    await challengeBond(bondId);

    const bondState = await bond.getBondCore(bondId);
    const concessionDeadline = await bond.concessionDeadline(bondId);
    expect(concessionDeadline).to.equal(
      bondState.deadline > bondState.lastChallengeTime + BigInt(ACCEPTANCE_DELAY)
        ? bondState.deadline
        : bondState.lastChallengeTime + BigInt(ACCEPTANCE_DELAY)
    );

    await time.increaseTo(await bond.rulingWindowStart(bondId));

    const partialFee = ethers.parseEther("125");
    const posterBalanceBefore = await token.balanceOf(poster.address);
    const operatorBalanceBefore = await token.balanceOf(await manualJudge.getAddress());

    await bond.connect(challenger);
    await manualJudge.connect(operator).ruleForPoster(await bond.getAddress(), bondId, partialFee);

    expect(await token.balanceOf(poster.address)).to.equal(
      posterBalanceBefore + CHALLENGE_AMOUNT - partialFee
    );
    expect(await token.balanceOf(await manualJudge.getAddress())).to.equal(
      operatorBalanceBefore + partialFee
    );

    const updatedBond = await bond.bonds(bondId);
    expect(updatedBond.currentChallenge).to.equal(1n);
    expect(updatedBond.settled).to.equal(false);
  });

  it("refunds poster and challenger when the ManualJudge rejects the bond", async function () {
    await manualJudge.connect(operator).acceptOperatorRole();

    const bondId = await createBondWithJudge(await manualJudge.getAddress());
    await challengeBond(bondId);

    const posterBalanceBefore = await token.balanceOf(poster.address);
    const challengerBalanceBefore = await token.balanceOf(challenger.address);

    await manualJudge.connect(operator).rejectBond(await bond.getAddress(), bondId);

    expect(await token.balanceOf(poster.address)).to.equal(posterBalanceBefore + BOND_AMOUNT);
    expect(await token.balanceOf(challenger.address)).to.equal(
      challengerBalanceBefore + CHALLENGE_AMOUNT
    );

    const updatedBond = await bond.bonds(bondId);
    expect(updatedBond.settled).to.equal(true);
  });
});
