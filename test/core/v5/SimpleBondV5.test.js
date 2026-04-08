const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  ACCEPTANCE_DELAY,
  BOND_AMOUNT,
  CHALLENGE_AMOUNT,
  JUDGE_FEE,
  ONE_DAY,
  RULING_BUFFER,
  deploySimpleBondV5FuzzFixture,
} = require("../../helpers/v5/simpleBondV5Fuzz");

describe("SimpleBondV5 fixture helper", function () {
  it("honors deadlineLeadTime overrides when deriving the default deadline", async function () {
    const customLeadTime = 5 * ONE_DAY;
    const fixture = await deploySimpleBondV5FuzzFixture({ deadlineLeadTime: customLeadTime });
    const { bondId } = await fixture.actions.createBond();
    const createdBond = await fixture.read.getBond(bondId);
    const remainingLeadTime = fixture.defaults.deadline - await time.latest();

    expect(fixture.defaults.deadlineLeadTime).to.equal(customLeadTime);
    expect(createdBond.deadline).to.equal(fixture.defaults.deadline);
    expect(remainingLeadTime).to.be.greaterThan(0);
    expect(remainingLeadTime).to.be.lessThan(customLeadTime + ONE_DAY);
  });

  it("rejects inactive ManualJudge wrappers", async function () {
    const fixture = await deploySimpleBondV5FuzzFixture({ activateJudge: false });

    await expect(fixture.actions.createBond()).to.be.revertedWith("Judge inactive");
  });
});

describe("SimpleBondV5", function () {
  let fixture;
  let bond;
  let token;
  let manualJudge;
  let poster;
  let judgeOperator;
  let challenger1;
  let challenger2;
  let challenger3;
  let outsider;
  let deadline;
  let tokenAddr;
  let judgeAddr;
  let bondAddr;

  async function createDefaultBond() {
    const { bondId } = await fixture.actions.createBond();
    return bondId;
  }

  async function advanceToRulingWindow(id = 0) {
    await fixture.actions.advanceToRulingWindow({ bondId: id });
  }

  async function advancePastRulingDeadline(id = 0) {
    await fixture.actions.advancePastRulingDeadline({ bondId: id });
  }

  async function advancePastDeadline(id = 0) {
    await fixture.actions.advancePastDeadline({ bondId: id });
  }

  async function claimAllRefunds(id = 0) {
    await fixture.actions.claimAllRefunds({ bondId: id });
  }

  beforeEach(async function () {
    fixture = await deploySimpleBondV5FuzzFixture();
    bond = fixture.bond;
    token = fixture.token;
    manualJudge = fixture.manualJudge;
    poster = fixture.actors.poster;
    judgeOperator = fixture.actors.judgeOperator;
    challenger1 = fixture.actors.challenger1;
    challenger2 = fixture.actors.challenger2;
    challenger3 = fixture.actors.challenger3;
    outsider = fixture.actors.outsider;
    deadline = fixture.defaults.deadline;
    tokenAddr = fixture.addresses.token;
    judgeAddr = fixture.addresses.judge;
    bondAddr = fixture.addresses.bond;
  });

  describe("Bond Creation", function () {
    it("rejects EOA judges", async function () {
      await expect(
        fixture.actions.createBond({ judge: judgeOperator })
      ).to.be.revertedWith("Judge must be contract");
    });

    it("creates a bond with correct parameters and emits BondCreated", async function () {
      await expect(
        bond.connect(poster).createBond(
          tokenAddr,
          BOND_AMOUNT,
          CHALLENGE_AMOUNT,
          JUDGE_FEE,
          judgeAddr,
          deadline,
          ACCEPTANCE_DELAY,
          RULING_BUFFER,
          "Test claim"
        )
      ).to.emit(bond, "BondCreated").withArgs(
        0,
        poster.address,
        judgeAddr,
        tokenAddr,
        BOND_AMOUNT,
        CHALLENGE_AMOUNT,
        JUDGE_FEE,
        deadline,
        ACCEPTANCE_DELAY,
        RULING_BUFFER,
        "Test claim"
      );

      expect(await bond.nextBondId()).to.equal(1n);
    });

    it("stores the contract judge address on the bond", async function () {
      await createDefaultBond();
      const createdBond = await bond.bonds(0);

      expect(createdBond.poster).to.equal(poster.address);
      expect(createdBond.judge).to.equal(judgeAddr);
      expect(createdBond.judgeFee).to.equal(JUDGE_FEE);
    });

    it("transfers bondAmount from poster to contract", async function () {
      const before = await token.balanceOf(poster.address);
      await createDefaultBond();
      const after = await token.balanceOf(poster.address);

      expect(before - after).to.equal(BOND_AMOUNT);
      expect(await token.balanceOf(bondAddr)).to.equal(BOND_AMOUNT);
    });

    it("reverts on zero bond amount", async function () {
      await expect(
        bond.connect(poster).createBond(
          tokenAddr,
          0,
          CHALLENGE_AMOUNT,
          JUDGE_FEE,
          judgeAddr,
          deadline,
          ACCEPTANCE_DELAY,
          RULING_BUFFER,
          ""
        )
      ).to.be.revertedWith("Zero bond amount");
    });

    it("reverts if judgeFee > challengeAmount", async function () {
      await expect(
        bond.connect(poster).createBond(
          tokenAddr,
          BOND_AMOUNT,
          CHALLENGE_AMOUNT,
          CHALLENGE_AMOUNT + 1n,
          judgeAddr,
          deadline,
          ACCEPTANCE_DELAY,
          RULING_BUFFER,
          ""
        )
      ).to.be.revertedWith("Fee > challenge amount");
    });

    it("allows zero judge fee", async function () {
      await fixture.actions.createBond({ judgeFee: 0n, metadata: "No fee claim" });
      const createdBond = await bond.bonds(0);

      expect(createdBond.judgeFee).to.equal(0n);
    });

    it("allows zero acceptance delay", async function () {
      await fixture.actions.createBond({ acceptanceDelay: 0, metadata: "No delay claim" });
      const createdBond = await bond.bonds(0);

      expect(createdBond.acceptanceDelay).to.equal(0n);
    });

    it("allows acceptanceDelay exactly at the configured maximum", async function () {
      const maxAcceptanceDelay = await bond.MAX_ACCEPTANCE_DELAY();
      await fixture.actions.createBond({
        acceptanceDelay: maxAcceptanceDelay,
        metadata: "Max delay claim",
      });

      const createdBond = await bond.bonds(0);
      expect(createdBond.acceptanceDelay).to.equal(maxAcceptanceDelay);
    });

    it("reverts if acceptanceDelay exceeds the configured maximum", async function () {
      const maxAcceptanceDelay = await bond.MAX_ACCEPTANCE_DELAY();

      await expect(
        fixture.actions.createBond({
          acceptanceDelay: maxAcceptanceDelay + 1n,
          metadata: "Too much delay",
        })
      ).to.be.revertedWith("Acceptance delay too long");
    });

    it("allows rulingBuffer exactly at the configured maximum", async function () {
      const maxRulingBuffer = await bond.MAX_RULING_BUFFER();
      await fixture.actions.createBond({
        rulingBuffer: maxRulingBuffer,
        metadata: "Max buffer claim",
      });

      const createdBond = await bond.bonds(0);
      expect(createdBond.rulingBuffer).to.equal(maxRulingBuffer);
    });

    it("reverts if rulingBuffer exceeds the configured maximum", async function () {
      const maxRulingBuffer = await bond.MAX_RULING_BUFFER();

      await expect(
        fixture.actions.createBond({
          rulingBuffer: maxRulingBuffer + 1n,
          metadata: "Too much buffer",
        })
      ).to.be.revertedWith("Ruling buffer too long");
    });

    it("reverts on deadline in the past", async function () {
      await expect(
        bond.connect(poster).createBond(
          tokenAddr,
          BOND_AMOUNT,
          CHALLENGE_AMOUNT,
          JUDGE_FEE,
          judgeAddr,
          1,
          ACCEPTANCE_DELAY,
          RULING_BUFFER,
          ""
        )
      ).to.be.revertedWith("Deadline in past");
    });

    it("reverts on timing params that would overflow later window arithmetic", async function () {
      const maxAcceptanceDelay = await bond.MAX_ACCEPTANCE_DELAY();
      const maxRulingBuffer = await bond.MAX_RULING_BUFFER();
      const unsafeDeadline = ethers.MaxUint256 - maxAcceptanceDelay - maxRulingBuffer + 1n;

      await expect(
        fixture.actions.createBond({
          deadline: unsafeDeadline,
          acceptanceDelay: maxAcceptanceDelay,
          rulingBuffer: maxRulingBuffer,
          metadata: "Unsafe timing claim",
        })
      ).to.be.revertedWith("Unsafe timing params");
    });

    it("increments bondId for sequential creates", async function () {
      await createDefaultBond();
      await fixture.actions.createBond({ metadata: "Second claim" });

      expect(await bond.nextBondId()).to.equal(2n);
    });
  });

  describe("Challenges", function () {
    beforeEach(async function () {
      await createDefaultBond();
    });

    it("accepts a challenge with metadata and emits Challenged", async function () {
      await expect(
        bond.connect(challenger1).challenge(0, "Section 3 contains factual errors")
      ).to.emit(bond, "Challenged").withArgs(
        0,
        0,
        challenger1.address,
        "Section 3 contains factual errors"
      );
    });

    it("transfers challengeAmount from challenger to contract", async function () {
      const before = await token.balanceOf(challenger1.address);
      await bond.connect(challenger1).challenge(0, "Wrong");
      const after = await token.balanceOf(challenger1.address);

      expect(before - after).to.equal(CHALLENGE_AMOUNT);
    });

    it("stores challenge metadata on-chain", async function () {
      await bond.connect(challenger1).challenge(0, "The math in section 5 is wrong");
      const [addr, status, metadata] = await bond.getChallenge(0, 0);

      expect(addr).to.equal(challenger1.address);
      expect(status).to.equal(0n);
      expect(metadata).to.equal("The math in section 5 is wrong");
    });

    it("allows multiple challengers to queue up", async function () {
      await bond.connect(challenger1).challenge(0, "Error 1");
      await bond.connect(challenger2).challenge(0, "Error 2");
      await bond.connect(challenger3).challenge(0, "Error 3");

      expect(await bond.getChallengeCount(0)).to.equal(3n);
    });

    it("updates lastChallengeTime on each challenge", async function () {
      await bond.connect(challenger1).challenge(0, "");
      const bondAfterFirstChallenge = await bond.bonds(0);
      const firstTimestamp = bondAfterFirstChallenge.lastChallengeTime;

      await time.increase(ONE_DAY);
      await bond.connect(challenger2).challenge(0, "");
      const bondAfterSecondChallenge = await bond.bonds(0);

      expect(bondAfterSecondChallenge.lastChallengeTime).to.be.gt(firstTimestamp);
    });

    it("reverts challenge after deadline", async function () {
      await time.increaseTo(deadline + 1);

      await expect(
        bond.connect(challenger1).challenge(0, "Too late")
      ).to.be.revertedWith("Past deadline");
    });

    it("reverts challenge on settled bond", async function () {
      await advancePastDeadline();
      await bond.connect(poster).withdrawBond(0);

      await expect(
        bond.connect(challenger1).challenge(0, "")
      ).to.be.revertedWith("Already settled");
    });

    it("reverts challenge on conceded bond", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(poster).concede(0, "You're right");

      await expect(
        bond.connect(challenger2).challenge(0, "")
      ).to.be.revertedWith("Already settled");
    });
  });

  describe("Judge Rejection", function () {
    beforeEach(async function () {
      await createDefaultBond();
    });

    it("judge rejects bond with no challenges and refunds the poster", async function () {
      const before = await token.balanceOf(poster.address);

      await fixture.actions.rejectBond();
      await claimAllRefunds();

      expect(await token.balanceOf(poster.address) - before).to.equal(BOND_AMOUNT);
      expect(await token.balanceOf(bondAddr)).to.equal(0n);
    });

    it("judge rejects bond with challengers and refunds everyone", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(challenger2).challenge(0, "");

      const posterBefore = await token.balanceOf(poster.address);
      const challenger1Before = await token.balanceOf(challenger1.address);
      const challenger2Before = await token.balanceOf(challenger2.address);

      await fixture.actions.rejectBond();
      await claimAllRefunds();

      expect(await token.balanceOf(poster.address) - posterBefore).to.equal(BOND_AMOUNT);
      expect(await token.balanceOf(challenger1.address) - challenger1Before).to.equal(CHALLENGE_AMOUNT);
      expect(await token.balanceOf(challenger2.address) - challenger2Before).to.equal(CHALLENGE_AMOUNT);
      expect(await token.balanceOf(bondAddr)).to.equal(0n);
    });

    it("enables bounded refund claims for each pending challenger", async function () {
      await bond.connect(challenger1).challenge(0, "A");
      await bond.connect(challenger2).challenge(0, "B");

      const tx = manualJudge.connect(judgeOperator).rejectBond(bondAddr, 0);
      await expect(tx).to.emit(bond, "ChallengeRefundsEnabled").withArgs(0, 0, 2);
      await expect(tx).to.emit(bond, "BondRejectedByJudge").withArgs(0, judgeAddr);

      await expect(
        bond.connect(outsider).claimRefunds(0, 1)
      ).to.emit(bond, "ChallengeRefunded").withArgs(0, 0, challenger1.address);
      await expect(
        bond.connect(outsider).claimRefunds(0, 5)
      ).to.emit(bond, "ChallengeRefunded").withArgs(0, 1, challenger2.address);
    });

    it("reverts for nonexistent bonds", async function () {
      await expect(
        manualJudge.connect(judgeOperator).rejectBond(bondAddr, 999)
      ).to.be.revertedWith("Bond does not exist");
    });
  });

  describe("Poster Concession", function () {
    beforeEach(async function () {
      await createDefaultBond();
    });

    it("poster concedes and emits ClaimConceded with metadata", async function () {
      await bond.connect(challenger1).challenge(0, "You're wrong about X");

      await expect(
        bond.connect(poster).concede(0, "I was wrong because Y")
      ).to.emit(bond, "ClaimConceded").withArgs(
        0,
        poster.address,
        "I was wrong because Y"
      );
    });

    it("concession refunds the poster's full bond", async function () {
      await bond.connect(challenger1).challenge(0, "");
      const before = await token.balanceOf(poster.address);
      await bond.connect(poster).concede(0, "");

      expect(await token.balanceOf(poster.address) - before).to.equal(BOND_AMOUNT);
    });

    it("concession refunds all challengers in the queue", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(challenger2).challenge(0, "");
      await bond.connect(challenger3).challenge(0, "");

      const before1 = await token.balanceOf(challenger1.address);
      const before2 = await token.balanceOf(challenger2.address);
      const before3 = await token.balanceOf(challenger3.address);

      await bond.connect(poster).concede(0, "All of you are right");
      await claimAllRefunds();

      expect(await token.balanceOf(challenger1.address) - before1).to.equal(CHALLENGE_AMOUNT);
      expect(await token.balanceOf(challenger2.address) - before2).to.equal(CHALLENGE_AMOUNT);
      expect(await token.balanceOf(challenger3.address) - before3).to.equal(CHALLENGE_AMOUNT);
    });

    it("concession leaves pending challenger refunds in the contract until claimed", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(challenger2).challenge(0, "");
      await bond.connect(poster).concede(0, "");

      expect(await token.balanceOf(bondAddr)).to.equal(CHALLENGE_AMOUNT * 2n);
    });

    it("concession leaves zero tokens in the contract after refunds are claimed", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(challenger2).challenge(0, "");
      await bond.connect(poster).concede(0, "");
      await claimAllRefunds();

      expect(await token.balanceOf(bondAddr)).to.equal(0n);
    });

    it("concession sets both settled and conceded flags", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(poster).concede(0, "");
      const createdBond = await bond.bonds(0);

      expect(createdBond.settled).to.be.true;
      expect(createdBond.conceded).to.be.true;
    });

    it("judge contract receives nothing on concession", async function () {
      await bond.connect(challenger1).challenge(0, "");
      const before = await token.balanceOf(judgeAddr);
      await bond.connect(poster).concede(0, "");

      expect(await token.balanceOf(judgeAddr)).to.equal(before);
    });

    it("reverts if a non-poster tries to concede", async function () {
      await bond.connect(challenger1).challenge(0, "");

      await expect(
        bond.connect(challenger1).concede(0, "")
      ).to.be.revertedWith("Only poster");
    });

    it("reverts concession if there are no pending challenges", async function () {
      await expect(
        bond.connect(poster).concede(0, "")
      ).to.be.revertedWith("No pending challenges");
    });

    it("reverts concession once the concession deadline passes", async function () {
      const customFixture = await deploySimpleBondV5FuzzFixture({
        deadlineLeadTime: ONE_DAY,
        acceptanceDelay: 12 * 60 * 60,
      });

      await customFixture.actions.createBond();
      await customFixture.actions.challenge();

      const concessionDeadline = await customFixture.read.concessionDeadline();
      await time.increaseTo(concessionDeadline);

      await expect(
        customFixture.bond.connect(customFixture.actors.poster).concede(0, "Too late")
      ).to.be.revertedWith("Concession window closed");
    });

    it("reverts double concession", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(poster).concede(0, "");

      await expect(
        bond.connect(poster).concede(0, "")
      ).to.be.revertedWith("Already settled");
    });

    it("enables bounded refund claims for each queued challenger", async function () {
      await bond.connect(challenger1).challenge(0, "A");
      await bond.connect(challenger2).challenge(0, "B");

      const tx = bond.connect(poster).concede(0, "OK fine");
      await expect(tx).to.emit(bond, "ChallengeRefundsEnabled").withArgs(0, 0, 2);

      await expect(
        bond.connect(outsider).claimRefunds(0, 1)
      ).to.emit(bond, "ChallengeRefunded").withArgs(0, 0, challenger1.address);
      await expect(
        bond.connect(outsider).claimRefunds(0, 2)
      ).to.emit(bond, "ChallengeRefunded").withArgs(0, 1, challenger2.address);
    });
  });

  describe("Acceptance Delay & Ruling Window", function () {
    beforeEach(async function () {
      await createDefaultBond();
    });

    it("concessionDeadline matches rulingWindowStart", async function () {
      await bond.connect(challenger1).challenge(0, "");

      expect(await bond.concessionDeadline(0)).to.equal(await bond.rulingWindowStart(0));
    });

    it("rulingWindowStart equals max(deadline, lastChallengeTime + acceptanceDelay)", async function () {
      await bond.connect(challenger1).challenge(0, "");
      const rulingWindowStart = await bond.rulingWindowStart(0);

      expect(Number(rulingWindowStart)).to.equal(deadline);
    });

    it("late challenge extends the ruling window beyond the deadline", async function () {
      await time.increaseTo(deadline - ONE_DAY);
      await bond.connect(challenger1).challenge(0, "Last minute challenge");

      const createdBond = await bond.bonds(0);
      const expectedStart = Number(createdBond.lastChallengeTime) + ACCEPTANCE_DELAY;
      const rulingWindowStart = await bond.rulingWindowStart(0);

      expect(Number(rulingWindowStart)).to.equal(expectedStart);
      expect(Number(rulingWindowStart)).to.be.gt(deadline);
    });

    it("judge cannot rule before the ruling window opens", async function () {
      await bond.connect(challenger1).challenge(0, "");

      await expect(
        manualJudge.connect(judgeOperator).ruleForPoster(bondAddr, 0, JUDGE_FEE)
      ).to.be.revertedWith("Before ruling window");
    });

    it("judge cannot rule after the ruling deadline", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await advancePastRulingDeadline();

      await expect(
        manualJudge.connect(judgeOperator).ruleForPoster(bondAddr, 0, JUDGE_FEE)
      ).to.be.revertedWith("Past ruling deadline");
    });

    it("judge can rule exactly at the ruling window start", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await advanceToRulingWindow();

      await fixture.actions.ruleForPoster();
    });

    it("poster can concede during acceptance delay before the judge can rule", async function () {
      await time.increaseTo(deadline - 100);
      await bond.connect(challenger1).challenge(0, "");
      await time.increase(ONE_DAY);

      await expect(
        manualJudge.connect(judgeOperator).ruleForPoster(bondAddr, 0, JUDGE_FEE)
      ).to.be.revertedWith("Before ruling window");

      await bond.connect(poster).concede(0, "Conceding during acceptance delay");
      const createdBond = await bond.bonds(0);
      expect(createdBond.conceded).to.be.true;
    });

    it("ruling deadline equals rulingWindowStart plus rulingBuffer", async function () {
      await bond.connect(challenger1).challenge(0, "");
      const rulingWindowStart = await bond.rulingWindowStart(0);
      const rulingDeadline = await bond.rulingDeadline(0);

      expect(rulingDeadline - rulingWindowStart).to.equal(BigInt(RULING_BUFFER));
    });

    it("zero acceptance delay means the judge can rule right after the deadline", async function () {
      await fixture.actions.createBond({
        acceptanceDelay: 0,
        metadata: "No delay",
      });
      await bond.connect(challenger1).challenge(1, "");

      await time.increaseTo(deadline);
      await fixture.actions.ruleForPoster({ bondId: 1 });
    });
  });

  describe("Rule for Poster (challenger loses)", function () {
    beforeEach(async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "Wrong");
    });

    it("poster receives challengeAmount minus feeCharged", async function () {
      await advanceToRulingWindow();
      const before = await token.balanceOf(poster.address);
      await fixture.actions.ruleForPoster();

      expect(await token.balanceOf(poster.address) - before).to.equal(CHALLENGE_AMOUNT - JUDGE_FEE);
    });

    it("judge contract receives feeCharged", async function () {
      await advanceToRulingWindow();
      const before = await token.balanceOf(judgeAddr);
      await fixture.actions.ruleForPoster();

      expect(await token.balanceOf(judgeAddr) - before).to.equal(JUDGE_FEE);
    });

    it("bond pool stays at bondAmount", async function () {
      await advanceToRulingWindow();
      await fixture.actions.ruleForPoster();

      expect(await token.balanceOf(bondAddr)).to.equal(BOND_AMOUNT);
    });

    it("advances the queue to the next challenge", async function () {
      await advanceToRulingWindow();
      await fixture.actions.ruleForPoster();
      const createdBond = await bond.bonds(0);

      expect(createdBond.currentChallenge).to.equal(1n);
      expect(createdBond.settled).to.be.false;
    });

    it("sets the challenge status to lost", async function () {
      await advanceToRulingWindow();
      await fixture.actions.ruleForPoster();
      const [, status] = await bond.getChallenge(0, 0);

      expect(status).to.equal(2n);
    });

    it("emits RuledForPoster with feeCharged", async function () {
      await advanceToRulingWindow();

      await expect(
        manualJudge.connect(judgeOperator).ruleForPoster(bondAddr, 0, JUDGE_FEE)
      ).to.emit(bond, "RuledForPoster").withArgs(0, 0, challenger1.address, JUDGE_FEE);
    });
  });

  describe("Rule for Challenger (poster loses)", function () {
    beforeEach(async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "Fatal flaw");
    });

    it("challenger receives bondAmount plus challengeAmount minus feeCharged", async function () {
      await advanceToRulingWindow();
      const before = await token.balanceOf(challenger1.address);
      await fixture.actions.ruleForChallenger();

      expect(await token.balanceOf(challenger1.address) - before)
        .to.equal(BOND_AMOUNT + CHALLENGE_AMOUNT - JUDGE_FEE);
    });

    it("judge contract receives feeCharged from the pool", async function () {
      await advanceToRulingWindow();
      const before = await token.balanceOf(judgeAddr);
      await fixture.actions.ruleForChallenger();

      expect(await token.balanceOf(judgeAddr) - before).to.equal(JUDGE_FEE);
    });

    it("settles the bond", async function () {
      await advanceToRulingWindow();
      await fixture.actions.ruleForChallenger();
      const createdBond = await bond.bonds(0);

      expect(createdBond.settled).to.be.true;
    });

    it("leaves later challenger refunds in the contract until claimed", async function () {
      await bond.connect(challenger2).challenge(0, "Also wrong");
      await advanceToRulingWindow();
      await fixture.actions.ruleForChallenger();

      expect(await token.balanceOf(bondAddr)).to.equal(CHALLENGE_AMOUNT);
    });

    it("refunds remaining challengers when the first challenger wins", async function () {
      await bond.connect(challenger2).challenge(0, "Also wrong");
      await bond.connect(challenger3).challenge(0, "Definitely wrong");

      const before2 = await token.balanceOf(challenger2.address);
      const before3 = await token.balanceOf(challenger3.address);

      await advanceToRulingWindow();
      await fixture.actions.ruleForChallenger();
      await claimAllRefunds();

      expect(await token.balanceOf(challenger2.address) - before2).to.equal(CHALLENGE_AMOUNT);
      expect(await token.balanceOf(challenger3.address) - before3).to.equal(CHALLENGE_AMOUNT);
    });
  });

  describe("Judge Fee Waiver", function () {
    beforeEach(async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "");
      await advanceToRulingWindow();
    });

    it("judge can charge zero fee with a full waiver", async function () {
      const posterBefore = await token.balanceOf(poster.address);
      const judgeBefore = await token.balanceOf(judgeAddr);

      await fixture.actions.ruleForPoster({ feeCharged: 0n });

      expect(await token.balanceOf(poster.address) - posterBefore).to.equal(CHALLENGE_AMOUNT);
      expect(await token.balanceOf(judgeAddr)).to.equal(judgeBefore);
    });

    it("judge can charge a partial fee", async function () {
      const partialFee = ethers.parseEther("200");
      const posterBefore = await token.balanceOf(poster.address);
      const judgeBefore = await token.balanceOf(judgeAddr);

      await fixture.actions.ruleForPoster({ feeCharged: partialFee });

      expect(await token.balanceOf(poster.address) - posterBefore).to.equal(CHALLENGE_AMOUNT - partialFee);
      expect(await token.balanceOf(judgeAddr) - judgeBefore).to.equal(partialFee);
    });

    it("judge can charge the full fee", async function () {
      const judgeBefore = await token.balanceOf(judgeAddr);

      await fixture.actions.ruleForPoster();

      expect(await token.balanceOf(judgeAddr) - judgeBefore).to.equal(JUDGE_FEE);
    });

    it("reverts if feeCharged exceeds the max judgeFee", async function () {
      await expect(
        manualJudge.connect(judgeOperator).ruleForPoster(bondAddr, 0, JUDGE_FEE + 1n)
      ).to.be.revertedWith("Fee exceeds max");
    });

    it("full waiver on ruleForChallenger gives the challenger the entire pot", async function () {
      const before = await token.balanceOf(challenger1.address);
      await fixture.actions.ruleForChallenger({ feeCharged: 0n });

      expect(await token.balanceOf(challenger1.address) - before).to.equal(BOND_AMOUNT + CHALLENGE_AMOUNT);
    });

    it("ManualJudge operator can withdraw earned fees", async function () {
      await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE / 2n });

      const feeAmount = JUDGE_FEE / 2n;
      const operatorBefore = await token.balanceOf(judgeOperator.address);

      await expect(
        manualJudge.connect(judgeOperator).withdrawFees(tokenAddr, judgeOperator.address, feeAmount)
      ).to.emit(manualJudge, "FeesWithdrawn").withArgs(tokenAddr, judgeOperator.address, feeAmount);

      expect(await token.balanceOf(judgeOperator.address) - operatorBefore).to.equal(feeAmount);
      expect(await token.balanceOf(judgeAddr)).to.equal(0n);
    });

    it("non-operators cannot withdraw ManualJudge fees", async function () {
      await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE / 2n });

      await expect(
        manualJudge.connect(outsider).withdrawFees(tokenAddr, outsider.address, JUDGE_FEE / 2n)
      ).to.be.revertedWith("Only operator");
    });
  });

  describe("Sequential Challenge Queue", function () {
    beforeEach(async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "Error in section 1");
      await bond.connect(challenger2).challenge(0, "Error in section 2");
      await bond.connect(challenger3).challenge(0, "Error in section 3");
      await advanceToRulingWindow();
    });

    it("poster defeats all three challengers", async function () {
      const posterBefore = await token.balanceOf(poster.address);
      const judgeBefore = await token.balanceOf(judgeAddr);

      await fixture.actions.ruleForPoster();
      await fixture.actions.ruleForPoster();
      await fixture.actions.ruleForPoster();

      expect(await token.balanceOf(poster.address) - posterBefore)
        .to.equal((CHALLENGE_AMOUNT - JUDGE_FEE) * 3n);
      expect(await token.balanceOf(judgeAddr) - judgeBefore).to.equal(JUDGE_FEE * 3n);
      expect(await token.balanceOf(bondAddr)).to.equal(BOND_AMOUNT);
    });

    it("poster can withdraw after defeating all challengers", async function () {
      await fixture.actions.ruleForPoster();
      await fixture.actions.ruleForPoster();
      await fixture.actions.ruleForPoster();

      await advancePastDeadline();
      await bond.connect(poster).withdrawBond(0);
      const createdBond = await bond.bonds(0);

      expect(createdBond.settled).to.be.true;
      expect(await token.balanceOf(bondAddr)).to.equal(0n);
    });

    it("second challenger wins after the first loses and later challengers are refunded", async function () {
      await fixture.actions.ruleForPoster();

      const challenger2Before = await token.balanceOf(challenger2.address);
      const challenger3Before = await token.balanceOf(challenger3.address);

      await fixture.actions.ruleForChallenger();
      await claimAllRefunds();

      expect(await token.balanceOf(challenger2.address) - challenger2Before)
        .to.equal(BOND_AMOUNT + CHALLENGE_AMOUNT - JUDGE_FEE);
      expect(await token.balanceOf(challenger3.address) - challenger3Before)
        .to.equal(CHALLENGE_AMOUNT);
    });

    it("belief thresholds stay constant across all challenges", async function () {
      await fixture.actions.ruleForPoster();
      expect(await token.balanceOf(bondAddr)).to.equal(BOND_AMOUNT + CHALLENGE_AMOUNT * 2n);

      await fixture.actions.ruleForPoster();
      expect(await token.balanceOf(bondAddr)).to.equal(BOND_AMOUNT + CHALLENGE_AMOUNT);

      const createdBond = await bond.bonds(0);
      expect(createdBond.bondAmount).to.equal(BOND_AMOUNT);
      expect(createdBond.challengeAmount).to.equal(CHALLENGE_AMOUNT);
      expect(createdBond.judgeFee).to.equal(JUDGE_FEE);
    });
  });

  describe("Poster Withdrawal", function () {
    beforeEach(async function () {
      await createDefaultBond();
    });

    it("poster withdraws with no challenges", async function () {
      const before = await token.balanceOf(poster.address);
      await advancePastDeadline();
      await bond.connect(poster).withdrawBond(0);

      expect(await token.balanceOf(poster.address) - before).to.equal(BOND_AMOUNT);
    });

    it("poster withdraws after defeating all challengers", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await advanceToRulingWindow();
      await fixture.actions.ruleForPoster();

      const before = await token.balanceOf(poster.address);
      await advancePastDeadline();
      await bond.connect(poster).withdrawBond(0);

      expect(await token.balanceOf(poster.address) - before).to.equal(BOND_AMOUNT);
    });

    it("reverts withdrawal before the challenge deadline", async function () {
      await expect(
        bond.connect(poster).withdrawBond(0)
      ).to.be.revertedWith("Before deadline");
    });

    it("reverts withdrawal if challenges are pending", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await advancePastDeadline();

      await expect(
        bond.connect(poster).withdrawBond(0)
      ).to.be.revertedWith("Pending challenges");
    });

    it("reverts withdrawal by a non-poster", async function () {
      await expect(
        bond.connect(outsider).withdrawBond(0)
      ).to.be.revertedWith("Only poster");
    });

    it("reverts double withdrawal", async function () {
      await advancePastDeadline();
      await bond.connect(poster).withdrawBond(0);

      await expect(
        bond.connect(poster).withdrawBond(0)
      ).to.be.revertedWith("Already settled");
    });
  });

  describe("Timeout", function () {
    beforeEach(async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "");
    });

    it("allows anyone to trigger timeout after the ruling deadline", async function () {
      await advancePastRulingDeadline();

      await expect(
        bond.connect(outsider).claimTimeout(0)
      ).to.emit(bond, "BondTimedOut").withArgs(0);
    });

    it("refunds the poster's bond on timeout", async function () {
      await advancePastRulingDeadline();
      const before = await token.balanceOf(poster.address);
      await bond.connect(outsider).claimTimeout(0);

      expect(await token.balanceOf(poster.address) - before).to.equal(BOND_AMOUNT);
    });

    it("refunds all pending challengers on timeout", async function () {
      await bond.connect(challenger2).challenge(0, "");

      await advancePastRulingDeadline();
      const before1 = await token.balanceOf(challenger1.address);
      const before2 = await token.balanceOf(challenger2.address);
      await bond.connect(outsider).claimTimeout(0);
      await claimAllRefunds();

      expect(await token.balanceOf(challenger1.address) - before1).to.equal(CHALLENGE_AMOUNT);
      expect(await token.balanceOf(challenger2.address) - before2).to.equal(CHALLENGE_AMOUNT);
    });

    it("gives the judge nothing on timeout", async function () {
      await advancePastRulingDeadline();
      const before = await token.balanceOf(judgeAddr);
      await bond.connect(outsider).claimTimeout(0);

      expect(await token.balanceOf(judgeAddr)).to.equal(before);
    });

    it("leaves queued refunds in the contract after timeout until they are claimed", async function () {
      await bond.connect(challenger2).challenge(0, "");
      await advancePastRulingDeadline();
      await bond.connect(outsider).claimTimeout(0);

      expect(await token.balanceOf(bondAddr)).to.equal(CHALLENGE_AMOUNT * 2n);
    });

    it("leaves zero tokens in the contract after timeout refunds are claimed", async function () {
      await bond.connect(challenger2).challenge(0, "");
      await advancePastRulingDeadline();
      await bond.connect(outsider).claimTimeout(0);
      await claimAllRefunds();

      expect(await token.balanceOf(bondAddr)).to.equal(0n);
    });

    it("reverts timeout before the ruling deadline", async function () {
      await expect(
        bond.connect(outsider).claimTimeout(0)
      ).to.be.revertedWith("Before ruling deadline");
    });

    it("refunds only remaining challengers after a partial timeout", async function () {
      await bond.connect(challenger2).challenge(0, "");
      await advanceToRulingWindow();
      await fixture.actions.ruleForPoster();
      await advancePastRulingDeadline();

      const posterBefore = await token.balanceOf(poster.address);
      const challenger2Before = await token.balanceOf(challenger2.address);

      await bond.connect(outsider).claimTimeout(0);
      await claimAllRefunds();

      expect(await token.balanceOf(poster.address) - posterBefore).to.equal(BOND_AMOUNT);
      expect(await token.balanceOf(challenger2.address) - challenger2Before).to.equal(CHALLENGE_AMOUNT);
    });
  });

  describe("Complex End-to-End Scenarios", function () {
    it("poster fights and wins all challenges", async function () {
      await createDefaultBond();

      for (const challenger of [challenger1, challenger2, challenger3]) {
        await bond.connect(challenger).challenge(0, "Wrong");
      }

      const posterBefore = await token.balanceOf(poster.address);
      const judgeBefore = await token.balanceOf(judgeAddr);

      await advanceToRulingWindow();
      await fixture.actions.ruleForPoster();
      await fixture.actions.ruleForPoster();
      await fixture.actions.ruleForPoster();
      await advancePastDeadline();
      await bond.connect(poster).withdrawBond(0);

      expect(await token.balanceOf(poster.address) - posterBefore)
        .to.equal(BOND_AMOUNT + (CHALLENGE_AMOUNT - JUDGE_FEE) * 3n);
      expect(await token.balanceOf(judgeAddr) - judgeBefore).to.equal(JUDGE_FEE * 3n);
    });

    it("anti-gaming: a shill challenge does not protect the poster", async function () {
      await createDefaultBond();

      await bond.connect(challenger1).challenge(0, "Weak challenge");
      await bond.connect(challenger2).challenge(0, "Real substantive error");

      await advanceToRulingWindow();
      await fixture.actions.ruleForPoster();

      const createdBond = await bond.bonds(0);
      expect(createdBond.settled).to.be.false;
      expect(createdBond.currentChallenge).to.equal(1n);

      const challenger2Before = await token.balanceOf(challenger2.address);
      await fixture.actions.ruleForChallenger();
      await claimAllRefunds();

      expect(await token.balanceOf(challenger2.address) - challenger2Before)
        .to.equal(BOND_AMOUNT + CHALLENGE_AMOUNT - JUDGE_FEE);
    });

    it("token accounting remains conserved across a full flow", async function () {
      await createDefaultBond();

      const allActors = [poster, judgeOperator, challenger1, challenger2, challenger3, outsider];

      async function totalHeld() {
        let sum = 0n;
        for (const actor of allActors) {
          sum += await token.balanceOf(actor.address);
        }
        sum += await token.balanceOf(judgeAddr);
        sum += await token.balanceOf(bondAddr);
        return sum;
      }

      const initialTotal = await totalHeld();

      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(challenger2).challenge(0, "");
      expect(await totalHeld()).to.equal(initialTotal);

      await advanceToRulingWindow();
      await fixture.actions.ruleForPoster();
      expect(await totalHeld()).to.equal(initialTotal);

      await fixture.actions.ruleForChallenger();
      expect(await totalHeld()).to.equal(initialTotal);
    });

    it("judge rejects after viewing challenges and everyone is refunded", async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "Complex dispute");
      await bond.connect(challenger2).challenge(0, "Another angle");

      const posterBefore = await token.balanceOf(poster.address);
      const challenger1Before = await token.balanceOf(challenger1.address);
      const challenger2Before = await token.balanceOf(challenger2.address);
      const judgeBefore = await token.balanceOf(judgeAddr);

      await fixture.actions.rejectBond();
      await claimAllRefunds();

      expect(await token.balanceOf(poster.address) - posterBefore).to.equal(BOND_AMOUNT);
      expect(await token.balanceOf(challenger1.address) - challenger1Before).to.equal(CHALLENGE_AMOUNT);
      expect(await token.balanceOf(challenger2.address) - challenger2Before).to.equal(CHALLENGE_AMOUNT);
      expect(await token.balanceOf(judgeAddr)).to.equal(judgeBefore);
      expect(await token.balanceOf(bondAddr)).to.equal(0n);
    });
  });

  describe("Access Control", function () {
    beforeEach(async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "");
    });

    it("EOAs cannot call ruleForPoster directly on the bond", async function () {
      await advanceToRulingWindow();

      await expect(
        bond.connect(poster).ruleForPoster(0, JUDGE_FEE)
      ).to.be.revertedWith("Only judge");
      await expect(
        bond.connect(challenger1).ruleForPoster(0, JUDGE_FEE)
      ).to.be.revertedWith("Only judge");
      await expect(
        bond.connect(outsider).ruleForPoster(0, JUDGE_FEE)
      ).to.be.revertedWith("Only judge");
    });

    it("EOAs cannot call ruleForChallenger directly on the bond", async function () {
      await advanceToRulingWindow();

      await expect(
        bond.connect(poster).ruleForChallenger(0, JUDGE_FEE)
      ).to.be.revertedWith("Only judge");
    });

    it("only the ManualJudge operator can forward rulings", async function () {
      await advanceToRulingWindow();

      await expect(
        manualJudge.connect(outsider).ruleForPoster(bondAddr, 0, JUDGE_FEE)
      ).to.be.revertedWith("Only operator");
      await expect(
        manualJudge.connect(outsider).ruleForChallenger(bondAddr, 0, JUDGE_FEE)
      ).to.be.revertedWith("Only operator");
    });

    it("only the poster can withdraw", async function () {
      await advanceToRulingWindow();
      await fixture.actions.ruleForPoster();

      await expect(
        bond.connect(judgeOperator).withdrawBond(0)
      ).to.be.revertedWith("Only poster");
    });

    it("only the poster can concede", async function () {
      await expect(
        bond.connect(judgeOperator).concede(0, "")
      ).to.be.revertedWith("Only poster");
      await expect(
        bond.connect(challenger1).concede(0, "")
      ).to.be.revertedWith("Only poster");
    });

    it("only the judge contract can reject the bond on-chain", async function () {
      await expect(
        bond.connect(poster).rejectBond(0)
      ).to.be.revertedWith("Only judge");
      await expect(
        bond.connect(outsider).rejectBond(0)
      ).to.be.revertedWith("Only judge");
      await expect(
        manualJudge.connect(outsider).rejectBond(bondAddr, 0)
      ).to.be.revertedWith("Only operator");
    });
  });
});
