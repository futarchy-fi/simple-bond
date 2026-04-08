const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  ACCEPTANCE_DELAY,
  BOND_AMOUNT,
  BOND_RESOLVED_FOR_CHALLENGER,
  BOND_RESOLVED_FOR_POSTER,
  CHALLENGE_AMOUNT,
  DETAILED_BOND_CREATED_EVENT,
  JUDGE_FEE,
  LIGHTWEIGHT_BOND_CREATED_EVENT,
  ONE_DAY,
  RULING_BUFFER,
  deploySimpleBondV4FuzzFixture,
} = require("../helpers/v4/simpleBondV4Fuzz");

// --- Constants -----------------------------------------------------------
// Robin Hanson's preferred numbers: bond=$10K, challenge=$3K, judgeFee=$0.5K

describe("SimpleBondV4 fuzz fixture helper", function () {
  it("honors deadlineLeadTime overrides when deriving the default deadline", async function () {
    const customLeadTime = 5 * ONE_DAY;
    const customFixture = await deploySimpleBondV4FuzzFixture({ deadlineLeadTime: customLeadTime });
    const { bondId } = await customFixture.actions.createBond();
    const createdBond = await customFixture.read.getBond(bondId);
    const remainingLeadTime = customFixture.defaults.deadline - await time.latest();

    expect(customFixture.defaults.deadlineLeadTime).to.equal(customLeadTime);
    expect(createdBond.deadline).to.equal(customFixture.defaults.deadline);
    expect(remainingLeadTime).to.be.greaterThan(0);
    expect(remainingLeadTime).to.be.lessThan(customLeadTime + ONE_DAY);
  });

  it("skips default judge fee setup when judge registration is disabled", async function () {
    const customFixture = await deploySimpleBondV4FuzzFixture({ registerJudge: false });

    expect(await customFixture.bond.judges(customFixture.actors.judge.address)).to.equal(false);
    expect(await customFixture.read.getJudgeMinFee()).to.equal(0n);
    await expect(customFixture.actions.createBond()).to.be.revertedWith("Selected judge is not registered");
  });
});

describe("SimpleBondV4", function () {
  let bond, token;
  let poster, judge, challenger1, challenger2, challenger3, outsider;
  let deadline;
  let tokenAddr;
  let fixture;

  async function createDefaultBond() {
    const { bondId } = await fixture.actions.createBond();
    return bondId;
  }

  // Advance past deadline + acceptance delay so judge can rule on bond `id`
  async function advanceToRulingWindow(id = 0) {
    await fixture.actions.advanceToRulingWindow({ bondId: id });
  }

  async function advancePastRulingDeadline(id = 0) {
    await fixture.actions.advancePastRulingDeadline({ bondId: id });
  }

  async function challengeBond(bondId, challenger, metadata = "I found errors") {
    await fixture.actions.challenge({ bondId, challenger, metadata });
  }

  async function setBondCurrentChallenge(bondId, currentChallenge) {
    const bondBaseSlot = BigInt(
      ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [bondId, 1n])
      )
    );
    const currentChallengeSlot = ethers.toBeHex(bondBaseSlot + 11n, 32);
    await ethers.provider.send("hardhat_setStorageAt", [
      await bond.getAddress(),
      currentChallengeSlot,
      ethers.toBeHex(currentChallenge, 32),
    ]);
    await ethers.provider.send("evm_mine", []);
  }
  beforeEach(async function () {
    fixture = await deploySimpleBondV4FuzzFixture();
    bond = fixture.bond;
    token = fixture.token;
    tokenAddr = fixture.addresses.token;
    deadline = fixture.defaults.deadline;
    poster = fixture.actors.poster;
    judge = fixture.actors.judge;
    challenger1 = fixture.actors.challenger1;
    challenger2 = fixture.actors.challenger2;
    challenger3 = fixture.actors.challenger3;
    outsider = fixture.actors.outsider;
  });

  // =====================================================================
  // 1. JUDGE REGISTRY
  // =====================================================================
  describe("Judge Registry", function () {

    it("registers a judge and emits JudgeRegistered", async function () {
      await expect(
        bond.connect(outsider).registerAsJudge()
      ).to.emit(bond, "JudgeRegistered").withArgs(outsider.address);

      const registered = await bond.judges(outsider.address);
      expect(registered).to.be.true;
    });

    it("sets per-token minimum fee and emits JudgeFeeUpdated", async function () {
      await bond.connect(outsider).registerAsJudge();
      const minFee = ethers.parseEther("100");
      await expect(
        bond.connect(outsider).setJudgeFee(tokenAddr, minFee)
      ).to.emit(bond, "JudgeFeeUpdated").withArgs(outsider.address, tokenAddr, minFee);

      expect(await bond.judgeMinFees(outsider.address, tokenAddr)).to.equal(minFee);
      expect(await bond.getJudgeMinFee(outsider.address, tokenAddr)).to.equal(minFee);
    });

    it("different tokens have independent minimum fees", async function () {
      await bond.connect(outsider).registerAsJudge();

      // Deploy a second token
      const Token2 = await ethers.getContractFactory("TestToken");
      const token2 = await Token2.deploy();
      const token2Addr = await token2.getAddress();

      const fee1 = ethers.parseEther("100");
      const fee2 = ethers.parseEther("999");

      await bond.connect(outsider).setJudgeFee(tokenAddr, fee1);
      await bond.connect(outsider).setJudgeFee(token2Addr, fee2);

      expect(await bond.getJudgeMinFee(outsider.address, tokenAddr)).to.equal(fee1);
      expect(await bond.getJudgeMinFee(outsider.address, token2Addr)).to.equal(fee2);
    });

    it("unset token fee defaults to zero (free)", async function () {
      await bond.connect(outsider).registerAsJudge();
      expect(await bond.getJudgeMinFee(outsider.address, tokenAddr)).to.equal(0n);
    });

    it("deregisters a judge and emits JudgeDeregistered", async function () {
      await bond.connect(outsider).registerAsJudge();
      await expect(
        bond.connect(outsider).deregisterAsJudge()
      ).to.emit(bond, "JudgeDeregistered").withArgs(outsider.address);

      const registered = await bond.judges(outsider.address);
      expect(registered).to.be.false;
    });

    it("reverts deregister if not registered", async function () {
      await expect(
        bond.connect(outsider).deregisterAsJudge()
      ).to.be.revertedWith("Caller is not a registered judge");
    });

    it("reverts setJudgeFee if not registered", async function () {
      await expect(
        bond.connect(outsider).setJudgeFee(tokenAddr, 100)
      ).to.be.revertedWith("Caller is not a registered judge");
    });

    it("reverts setJudgeFee for zero token address", async function () {
      await bond.connect(outsider).registerAsJudge();
      await expect(
        bond.connect(outsider).setJudgeFee(ethers.ZeroAddress, 100)
      ).to.be.revertedWith("Token address cannot be zero");
    });

    it("re-registration preserves existing per-token fees", async function () {
      await bond.connect(outsider).registerAsJudge();
      await bond.connect(outsider).setJudgeFee(tokenAddr, ethers.parseEther("100"));
      await bond.connect(outsider).deregisterAsJudge();
      await bond.connect(outsider).registerAsJudge();
      // Per-token fee is stored in a separate mapping, not cleared on re-register
      expect(await bond.getJudgeMinFee(outsider.address, tokenAddr)).to.equal(ethers.parseEther("100"));
    });

    it("can update per-token fee", async function () {
      const newFee = ethers.parseEther("200");
      await expect(
        bond.connect(judge).setJudgeFee(tokenAddr, newFee)
      ).to.emit(bond, "JudgeFeeUpdated").withArgs(judge.address, tokenAddr, newFee);
      expect(await bond.getJudgeMinFee(judge.address, tokenAddr)).to.equal(newFee);
    });

    it("batch setJudgeFees sets multiple tokens at once", async function () {
      await bond.connect(outsider).registerAsJudge();

      const Token2 = await ethers.getContractFactory("TestToken");
      const token2 = await Token2.deploy();
      const token2Addr = await token2.getAddress();

      const fee1 = ethers.parseEther("50");
      const fee2 = ethers.parseEther("200");

      const tx = await bond.connect(outsider).setJudgeFees(
        [tokenAddr, token2Addr],
        [fee1, fee2]
      );

      await expect(tx).to.emit(bond, "JudgeFeeUpdated").withArgs(outsider.address, tokenAddr, fee1);
      await expect(tx).to.emit(bond, "JudgeFeeUpdated").withArgs(outsider.address, token2Addr, fee2);

      expect(await bond.getJudgeMinFee(outsider.address, tokenAddr)).to.equal(fee1);
      expect(await bond.getJudgeMinFee(outsider.address, token2Addr)).to.equal(fee2);
    });

    it("batch setJudgeFees reverts on length mismatch", async function () {
      await bond.connect(outsider).registerAsJudge();
      await expect(
        bond.connect(outsider).setJudgeFees([tokenAddr], [100, 200])
      ).to.be.revertedWith("Token and minimum fee array lengths must match");
    });

    it("batch setJudgeFees reverts on empty batch", async function () {
      await bond.connect(outsider).registerAsJudge();
      await expect(
        bond.connect(outsider).setJudgeFees([], [])
      ).to.be.revertedWith("At least one token fee entry is required");
    });

    it("batch setJudgeFees reverts if not registered", async function () {
      await expect(
        bond.connect(outsider).setJudgeFees([tokenAddr], [100])
      ).to.be.revertedWith("Caller is not a registered judge");
    });

    it("batch setJudgeFees reverts for zero token address", async function () {
      await bond.connect(outsider).registerAsJudge();
      await expect(
        bond.connect(outsider).setJudgeFees([tokenAddr, ethers.ZeroAddress], [100, 200])
      ).to.be.revertedWith("Token address cannot be zero");
    });
  });

  // =====================================================================
  // 2. CREATE BOND — registry checks
  // =====================================================================
  describe("Bond Creation — Registry Checks", function () {

    it("reverts if judge not registered", async function () {
      await expect(
        bond.connect(poster).createBond(
          tokenAddr,
          BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
          outsider.address, // not registered
          deadline, ACCEPTANCE_DELAY, RULING_BUFFER, "Test"
        )
      ).to.be.revertedWith("Selected judge is not registered");
    });

    it("reverts if fee below judge minimum for that token", async function () {
      const highMinFee = ethers.parseEther("1000");
      await bond.connect(outsider).registerAsJudge();
      await bond.connect(outsider).setJudgeFee(tokenAddr, highMinFee);
      await expect(
        bond.connect(poster).createBond(
          tokenAddr,
          BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE, // 500 < 1000
          outsider.address,
          deadline, ACCEPTANCE_DELAY, RULING_BUFFER, "Test"
        )
      ).to.be.revertedWith("Judge fee is below the selected judge's minimum for this token");
    });

    it("succeeds with registered judge and sufficient fee", async function () {
      await expect(
        bond.connect(poster).createBond(
          tokenAddr,
          BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
          judge.address, // registered with per-token minFee=500
          deadline, ACCEPTANCE_DELAY, RULING_BUFFER, "Valid bond"
        )
      ).to.emit(bond, DETAILED_BOND_CREATED_EVENT);
    });

    it("succeeds when fee equals judge minimum exactly", async function () {
      const exactFee = ethers.parseEther("500");
      // judge already registered with per-token minFee=500
      await bond.connect(poster).createBond(
        tokenAddr,
        BOND_AMOUNT, CHALLENGE_AMOUNT, exactFee,
        judge.address,
        deadline, ACCEPTANCE_DELAY, RULING_BUFFER, "Exact fee bond"
      );
      const b = await bond.bonds(0);
      expect(b.judgeFee).to.equal(exactFee);
    });

    it("succeeds when fee exceeds judge minimum", async function () {
      const higherFee = ethers.parseEther("1000");
      await bond.connect(poster).createBond(
        tokenAddr,
        BOND_AMOUNT, CHALLENGE_AMOUNT, higherFee,
        judge.address, // per-token minFee=500
        deadline, ACCEPTANCE_DELAY, RULING_BUFFER, "Generous fee"
      );
      const b = await bond.bonds(0);
      expect(b.judgeFee).to.equal(higherFee);
    });

    it("deregistered judge cannot be named on new bonds", async function () {
      await bond.connect(judge).deregisterAsJudge();
      await expect(
        bond.connect(poster).createBond(
          tokenAddr,
          BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
          judge.address,
          deadline, ACCEPTANCE_DELAY, RULING_BUFFER, "Test"
        )
      ).to.be.revertedWith("Selected judge is not registered");
    });

    it("judge with no fee set for token allows zero-fee bonds", async function () {
      // Register outsider with no per-token fee (defaults to 0)
      await bond.connect(outsider).registerAsJudge();
      // Don't set any fee — default is 0 for all tokens
      await bond.connect(poster).createBond(
        tokenAddr, BOND_AMOUNT, CHALLENGE_AMOUNT, 0,
        outsider.address, deadline, ACCEPTANCE_DELAY, RULING_BUFFER, "Free judge bond"
      );
      const b = await bond.bonds(0);
      expect(b.judgeFee).to.equal(0n);
    });

    it("judge fee check is per-token: passes for token with no min, fails for token with high min", async function () {
      const Token2 = await ethers.getContractFactory("TestToken");
      const token2 = await Token2.deploy();
      const token2Addr = await token2.getAddress();

      await bond.connect(outsider).registerAsJudge();
      // Set high fee only for token2, leave tokenAddr at default 0
      await bond.connect(outsider).setJudgeFee(token2Addr, ethers.parseEther("2000"));

      // Should succeed: tokenAddr has no min fee
      await bond.connect(poster).createBond(
        tokenAddr, BOND_AMOUNT, CHALLENGE_AMOUNT, 0,
        outsider.address, deadline, ACCEPTANCE_DELAY, RULING_BUFFER, "Token1 bond"
      );

      // Should fail: token2 has minFee=2000, but we offer 500
      await token2.mint(poster.address, BOND_AMOUNT);
      await token2.connect(poster).approve(await bond.getAddress(), ethers.MaxUint256);
      await expect(
        bond.connect(poster).createBond(
          token2Addr, BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
          outsider.address, deadline, ACCEPTANCE_DELAY, RULING_BUFFER, "Token2 bond"
        )
      ).to.be.revertedWith("Judge fee is below the selected judge's minimum for this token");
    });
  });

  // =====================================================================
  // 3. REJECT BOND
  // =====================================================================
  describe("Reject Bond", function () {
    beforeEach(async function () {
      await createDefaultBond();
    });

    it("judge rejects bond with no challenges — poster refunded", async function () {
      const before = await token.balanceOf(poster.address);
      await expect(
        bond.connect(judge).rejectBond(0)
      ).to.emit(bond, "BondRejectedByJudge").withArgs(0, judge.address);

      const after = await token.balanceOf(poster.address);
      expect(after - before).to.equal(BOND_AMOUNT);
      const b = await bond.bonds(0);
      expect(b.settled).to.be.true;
    });

    it("judge rejects bond with challengers — all refunded", async function () {
      await bond.connect(challenger1).challenge(0, "Error 1");
      await bond.connect(challenger2).challenge(0, "Error 2");

      const posterBefore = await token.balanceOf(poster.address);
      const c1Before = await token.balanceOf(challenger1.address);
      const c2Before = await token.balanceOf(challenger2.address);

      await bond.connect(judge).rejectBond(0);

      expect(await token.balanceOf(poster.address) - posterBefore).to.equal(BOND_AMOUNT);
      expect(await token.balanceOf(challenger1.address) - c1Before).to.equal(CHALLENGE_AMOUNT);
      expect(await token.balanceOf(challenger2.address) - c2Before).to.equal(CHALLENGE_AMOUNT);
    });

    it("reject leaves zero tokens in contract", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(judge).rejectBond(0);
      expect(await token.balanceOf(await bond.getAddress())).to.equal(0n);
    });

    it("reverts if not the judge", async function () {
      await expect(
        bond.connect(poster).rejectBond(0)
      ).to.be.revertedWith("Caller is not the judge for this bond");
      await expect(
        bond.connect(outsider).rejectBond(0)
      ).to.be.revertedWith("Caller is not the judge for this bond");
    });

    it("reverts if already settled", async function () {
      await bond.connect(poster).withdrawBond(0);
      await expect(
        bond.connect(judge).rejectBond(0)
      ).to.be.revertedWith("Bond is already settled");
    });

    it("reverts if already conceded", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(poster).concede(0, "");
      await expect(
        bond.connect(judge).rejectBond(0)
      ).to.be.revertedWith("Bond is already settled");
    });

    it("judge can reject after partial rulings", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(challenger2).challenge(0, "");

      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);

      // Reject with second challenge pending
      const posterBefore = await token.balanceOf(poster.address);
      const c2Before = await token.balanceOf(challenger2.address);

      await bond.connect(judge).rejectBond(0);

      expect(await token.balanceOf(poster.address) - posterBefore).to.equal(BOND_AMOUNT);
      expect(await token.balanceOf(challenger2.address) - c2Before).to.equal(CHALLENGE_AMOUNT);
    });

    it("emits ChallengeRefunded for each pending challenger", async function () {
      await bond.connect(challenger1).challenge(0, "A");
      await bond.connect(challenger2).challenge(0, "B");

      const tx = bond.connect(judge).rejectBond(0);
      await expect(tx).to.emit(bond, "ChallengeRefunded").withArgs(0, 0, challenger1.address);
      await expect(tx).to.emit(bond, "ChallengeRefunded").withArgs(0, 1, challenger2.address);
    });

    it("bond does not exist reverts", async function () {
      await expect(
        bond.connect(judge).rejectBond(999)
      ).to.be.revertedWith("Bond does not exist");
    });
  });

  describe("Invalid Settlement Bond IDs", function () {
    it("concede reverts for a nonexistent bond", async function () {
      await expect(
        bond.connect(poster).concede(0, "")
      ).to.be.revertedWith("Bond does not exist");
    });

    it("ruleForPoster reverts for a nonexistent bond", async function () {
      await expect(
        bond.connect(judge).ruleForPoster(0, JUDGE_FEE)
      ).to.be.revertedWith("Bond does not exist");
    });

    it("ruleForChallenger reverts for a nonexistent bond", async function () {
      await expect(
        bond.connect(judge).ruleForChallenger(0, JUDGE_FEE)
      ).to.be.revertedWith("Bond does not exist");
    });

    it("withdrawBond reverts for a nonexistent bond", async function () {
      await expect(
        bond.connect(poster).withdrawBond(0)
      ).to.be.revertedWith("Bond does not exist");
    });

    it("claimTimeout reverts for a nonexistent bond", async function () {
      await expect(
        bond.connect(outsider).claimTimeout(0)
      ).to.be.revertedWith("Bond does not exist");
    });
  });

  describe("View Helpers", function () {
    it("getChallengeCount reverts for a nonexistent bond", async function () {
      await expect(
        bond.getChallengeCount(0)
      ).to.be.revertedWith("Bond does not exist");
    });

    it("getChallenge reverts for a nonexistent bond", async function () {
      await expect(
        bond.getChallenge(0, 0)
      ).to.be.revertedWith("Bond does not exist");
    });

    it("getChallenge reverts for an out-of-range challenge index", async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "Only challenge");

      await expect(
        bond.getChallenge(0, 1)
      ).to.be.revertedWith("Challenge does not exist");
    });

    it("rulingWindowStart reverts for a nonexistent bond", async function () {
      await expect(
        bond.rulingWindowStart(0)
      ).to.be.revertedWith("Bond does not exist");
    });

    it("rulingDeadline reverts for a nonexistent bond", async function () {
      await expect(
        bond.rulingDeadline(0)
      ).to.be.revertedWith("Bond does not exist");
    });

    it("getJudgeMinFee reverts for a zero judge address", async function () {
      await expect(
        bond.getJudgeMinFee(ethers.ZeroAddress, tokenAddr)
      ).to.be.revertedWith("Judge address cannot be zero");
    });

    it("getJudgeMinFee reverts for a zero token address", async function () {
      await expect(
        bond.getJudgeMinFee(judge.address, ethers.ZeroAddress)
      ).to.be.revertedWith("Token address cannot be zero");
    });
  });

  // =====================================================================
  // 4. DEREGISTERED JUDGE CAN STILL RULE ON EXISTING BONDS
  // =====================================================================
  describe("Deregistered Judge — Existing Bonds", function () {
    it("deregistered judge can still rule for poster on existing bond", async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "Wrong");

      // Judge deregisters
      await bond.connect(judge).deregisterAsJudge();

      // Judge can still rule on the existing bond
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);

      const [, status] = await bond.getChallenge(0, 0);
      expect(status).to.equal(2n); // lost
    });

    it("deregistered judge can still rule for challenger on existing bond", async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "Fatal flaw");

      await bond.connect(judge).deregisterAsJudge();

      await advanceToRulingWindow();
      const c1Before = await token.balanceOf(challenger1.address);
      await bond.connect(judge).ruleForChallenger(0, JUDGE_FEE);

      expect(await token.balanceOf(challenger1.address) - c1Before)
        .to.equal(BOND_AMOUNT + CHALLENGE_AMOUNT - JUDGE_FEE);
    });

    it("deregistered judge can still reject existing bond", async function () {
      await createDefaultBond();
      await bond.connect(judge).deregisterAsJudge();

      const posterBefore = await token.balanceOf(poster.address);
      await bond.connect(judge).rejectBond(0);
      expect(await token.balanceOf(poster.address) - posterBefore).to.equal(BOND_AMOUNT);
    });
  });

  // =====================================================================
  // 5. CREATION (existing V3 tests, adapted for V4)
  // =====================================================================
  describe("Bond Creation", function () {
    it("creates a bond with correct parameters and emits both BondCreated events", async function () {
      const tx = bond.connect(poster).createBond(
        tokenAddr,
        BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
        judge.address,
        deadline, ACCEPTANCE_DELAY, RULING_BUFFER,
        "Test claim"
      );

      await expect(tx).to.emit(bond, DETAILED_BOND_CREATED_EVENT).withArgs(
        0, poster.address, judge.address, tokenAddr,
        BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
        deadline, ACCEPTANCE_DELAY, RULING_BUFFER,
        "Test claim"
      );
      await expect(tx).to.emit(bond, LIGHTWEIGHT_BOND_CREATED_EVENT).withArgs(
        0, poster.address, tokenAddr, BOND_AMOUNT
      );

      expect(await bond.nextBondId()).to.equal(1n);
    });

    it("transfers bondAmount from poster to contract", async function () {
      const before = await token.balanceOf(poster.address);
      await createDefaultBond();
      const after = await token.balanceOf(poster.address);
      expect(before - after).to.equal(BOND_AMOUNT);
      expect(await token.balanceOf(await bond.getAddress())).to.equal(BOND_AMOUNT);
    });

    it("createBond reverts when bondAmount is 0", async function () {
      await expect(
        bond.connect(poster).createBond(
          tokenAddr, 0, CHALLENGE_AMOUNT, JUDGE_FEE,
          judge.address, deadline, ACCEPTANCE_DELAY, RULING_BUFFER, ""
        )
      ).to.be.revertedWith("Bond amount must be greater than zero");

      expect(await bond.nextBondId()).to.equal(0n);
    });

    it("createBond reverts when challengeAmount is 0", async function () {
      await expect(
        bond.connect(poster).createBond(
          tokenAddr, BOND_AMOUNT, 0, 0,
          judge.address, deadline, ACCEPTANCE_DELAY, RULING_BUFFER, ""
        )
      ).to.be.revertedWith("Challenge amount must be greater than zero");
    });

    it("reverts if judgeFee > challengeAmount", async function () {
      await expect(
        bond.connect(poster).createBond(
          tokenAddr, BOND_AMOUNT, CHALLENGE_AMOUNT,
          CHALLENGE_AMOUNT + 1n,
          judge.address, deadline, ACCEPTANCE_DELAY, RULING_BUFFER, ""
        )
      )
        .to.be.revertedWithCustomError(bond, "InsufficientChallengeAmount")
        .withArgs(CHALLENGE_AMOUNT, CHALLENGE_AMOUNT + 1n);
    });

    it("allows zero judge fee (when judge has no per-token min fee)", async function () {
      // Register outsider with no per-token fee set (defaults to 0)
      await bond.connect(outsider).registerAsJudge();
      await bond.connect(poster).createBond(
        tokenAddr, BOND_AMOUNT, CHALLENGE_AMOUNT, 0,
        outsider.address, deadline, ACCEPTANCE_DELAY, RULING_BUFFER, "No fee claim"
      );
      const b = await bond.bonds(0);
      expect(b.judgeFee).to.equal(0n);
    });

    it("allows zero acceptance delay", async function () {
      await bond.connect(poster).createBond(
        tokenAddr, BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
        judge.address, deadline, 0, RULING_BUFFER, "No delay claim"
      );
      const b = await bond.bonds(0);
      expect(b.acceptanceDelay).to.equal(0n);
    });

    it("reverts on deadline in the past", async function () {
      await expect(
        bond.connect(poster).createBond(
          tokenAddr, BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
          judge.address, 1, ACCEPTANCE_DELAY, RULING_BUFFER, ""
        )
      ).to.be.revertedWith("Challenge deadline must be in the future");
    });

    it("reverts when rulingBuffer is 0", async function () {
      await expect(
        bond.connect(poster).createBond(
          tokenAddr, BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
          judge.address, deadline, ACCEPTANCE_DELAY, 0, ""
        )
      ).to.be.revertedWith("Ruling buffer must be greater than zero");
    });

    it("increments bondId for sequential creates", async function () {
      await createDefaultBond();
      await bond.connect(poster).createBond(
        tokenAddr, BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
        judge.address, deadline, ACCEPTANCE_DELAY, RULING_BUFFER, "Second claim"
      );
      expect(await bond.nextBondId()).to.equal(2n);
    });
  });

  // =====================================================================
  // 6. CHALLENGES
  // =====================================================================
  describe("Challenges", function () {
    beforeEach(async function () {
      await createDefaultBond();
    });

    it("accepts a challenge with metadata and emits both challenge events", async function () {
      const tx = bond.connect(challenger1).challenge(0, "Section 3 contains factual errors");

      await expect(tx).to.emit(bond, "Challenged").withArgs(
        0, 0, challenger1.address, "Section 3 contains factual errors"
      );
      await expect(tx).to.emit(bond, "BondChallenged").withArgs(
        0, challenger1.address, CHALLENGE_AMOUNT
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
      const [addr, status, meta] = await bond.getChallenge(0, 0);
      expect(addr).to.equal(challenger1.address);
      expect(status).to.equal(0n);
      expect(meta).to.equal("The math in section 5 is wrong");
    });

    it("allows multiple challengers to queue up", async function () {
      await bond.connect(challenger1).challenge(0, "Error 1");
      await bond.connect(challenger2).challenge(0, "Error 2");
      await bond.connect(challenger3).challenge(0, "Error 3");
      expect(await bond.getChallengeCount(0)).to.equal(3n);
    });

    it("updates lastChallengeTime on each challenge", async function () {
      await bond.connect(challenger1).challenge(0, "");
      const b1 = await bond.bonds(0);
      const t1 = b1.lastChallengeTime;

      await time.increase(ONE_DAY);
      await bond.connect(challenger2).challenge(0, "");
      const b2 = await bond.bonds(0);
      expect(b2.lastChallengeTime).to.be.gt(t1);
    });

    it("reverts challengeBond after the deadline has passed", async function () {
      await time.setNextBlockTimestamp(deadline);
      await challengeBond(0, challenger1, "Filed at the deadline");

      await time.increaseTo(deadline + 1);
      await expect(
        challengeBond(0, challenger2, "Too late")
      ).to.be.revertedWith("Challenge deadline has passed");
    });

    it("reverts challenge on settled bond", async function () {
      await bond.connect(poster).withdrawBond(0);
      await expect(
        bond.connect(challenger1).challenge(0, "")
      ).to.be.revertedWith("Bond is already settled");
    });

    it("reverts challenge on conceded bond", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(poster).concede(0, "You're right");
      await expect(
        bond.connect(challenger2).challenge(0, "")
      ).to.be.revertedWith("Bond is already settled");
    });
  });

  // =====================================================================
  // 7. POSTER CONCESSION
  // =====================================================================
  describe("Poster Concession", function () {
    beforeEach(async function () {
      await createDefaultBond();
    });

    it("poster concedes and emits both concession events", async function () {
      await bond.connect(challenger1).challenge(0, "You're wrong about X");

      const tx = bond.connect(poster).concede(0, "I was wrong because Y");

      await expect(tx).to.emit(bond, "ClaimConceded").withArgs(
        0, poster.address, "I was wrong because Y"
      );
      await expect(tx).to.emit(bond, "BondConceded").withArgs(0);
    });

    it("concession refunds poster's full bond", async function () {
      await bond.connect(challenger1).challenge(0, "");
      const before = await token.balanceOf(poster.address);
      await bond.connect(poster).concede(0, "");
      const after = await token.balanceOf(poster.address);
      expect(after - before).to.equal(BOND_AMOUNT);
    });

    it("concession refunds ALL challengers in the queue", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(challenger2).challenge(0, "");
      await bond.connect(challenger3).challenge(0, "");

      const before1 = await token.balanceOf(challenger1.address);
      const before2 = await token.balanceOf(challenger2.address);
      const before3 = await token.balanceOf(challenger3.address);

      await bond.connect(poster).concede(0, "All of you are right");

      expect(await token.balanceOf(challenger1.address) - before1).to.equal(CHALLENGE_AMOUNT);
      expect(await token.balanceOf(challenger2.address) - before2).to.equal(CHALLENGE_AMOUNT);
      expect(await token.balanceOf(challenger3.address) - before3).to.equal(CHALLENGE_AMOUNT);
    });

    it("concession leaves zero tokens in contract", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(challenger2).challenge(0, "");
      await bond.connect(poster).concede(0, "");
      expect(await token.balanceOf(await bond.getAddress())).to.equal(0n);
    });

    it("concession sets both settled and conceded flags", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(poster).concede(0, "");
      const b = await bond.bonds(0);
      expect(b.settled).to.be.true;
      expect(b.conceded).to.be.true;
    });

    it("judge receives nothing on concession", async function () {
      await bond.connect(challenger1).challenge(0, "");
      const before = await token.balanceOf(judge.address);
      await bond.connect(poster).concede(0, "");
      expect(await token.balanceOf(judge.address)).to.equal(before);
    });

    it("reverts if non-poster tries to concede", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await expect(
        bond.connect(challenger1).concede(0, "")
      ).to.be.revertedWith("Caller is not the poster for this bond");
    });

    it("reverts concession if no pending challenges", async function () {
      await expect(
        bond.connect(poster).concede(0, "")
      ).to.be.revertedWith("Bond has no pending challenges");
    });

    it("reverts concession after judge has already ruled on first challenge", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(challenger2).challenge(0, "");

      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);

      await expect(
        bond.connect(poster).concede(0, "Changed my mind")
      ).to.be.revertedWith("Ruling has already started");
    });

    it("reverts double concession", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(poster).concede(0, "");
      await expect(
        bond.connect(poster).concede(0, "")
      ).to.be.revertedWith("Bond is already settled");
    });

    it("emits ChallengeRefunded for each queued challenger", async function () {
      await bond.connect(challenger1).challenge(0, "A");
      await bond.connect(challenger2).challenge(0, "B");

      const tx = bond.connect(poster).concede(0, "OK fine");
      await expect(tx).to.emit(bond, "ChallengeRefunded").withArgs(0, 0, challenger1.address);
      await expect(tx).to.emit(bond, "ChallengeRefunded").withArgs(0, 1, challenger2.address);
    });
  });

  // =====================================================================
  // 8. ACCEPTANCE DELAY & RULING WINDOW TIMING
  // =====================================================================
  describe("Acceptance Delay & Ruling Window", function () {
    beforeEach(async function () {
      await createDefaultBond();
    });

    it("rulingWindowStart = max(deadline, lastChallengeTime + acceptanceDelay)", async function () {
      await bond.connect(challenger1).challenge(0, "");
      const rws = await bond.rulingWindowStart(0);
      expect(Number(rws)).to.equal(deadline);
    });

    it("late challenge extends ruling window beyond deadline", async function () {
      await time.increaseTo(deadline - ONE_DAY);
      await bond.connect(challenger1).challenge(0, "Last minute challenge");

      const b = await bond.bonds(0);
      const expectedStart = Number(b.lastChallengeTime) + ACCEPTANCE_DELAY;
      const rws = await bond.rulingWindowStart(0);
      expect(Number(rws)).to.equal(expectedStart);
      expect(Number(rws)).to.be.gt(deadline);
    });

    it("judge cannot rule before ruling window opens", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await expect(
        bond.connect(judge).ruleForPoster(0, JUDGE_FEE)
      ).to.be.revertedWith("Ruling window has not opened");
    });

    it("judge cannot rule after ruling deadline", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await advancePastRulingDeadline();
      await expect(
        bond.connect(judge).ruleForPoster(0, JUDGE_FEE)
      ).to.be.revertedWith("Ruling deadline has passed");
    });

    it("ruleForChallenger also reverts before the ruling window opens", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await expect(
        bond.connect(judge).ruleForChallenger(0, JUDGE_FEE)
      ).to.be.revertedWith("Ruling window has not opened");
    });

    it("ruleForChallenger also reverts after the ruling deadline", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await advancePastRulingDeadline();
      await expect(
        bond.connect(judge).ruleForChallenger(0, JUDGE_FEE)
      ).to.be.revertedWith("Ruling deadline has passed");
    });

    it("judge can rule exactly at ruling window start", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
    });

    it("poster can concede during acceptance delay (before judge can rule)", async function () {
      await time.increaseTo(deadline - 100);
      await bond.connect(challenger1).challenge(0, "");

      await time.increase(ONE_DAY);

      await expect(
        bond.connect(judge).ruleForPoster(0, JUDGE_FEE)
      ).to.be.revertedWith("Ruling window has not opened");

      await bond.connect(poster).concede(0, "Conceding during acceptance delay");
      const b = await bond.bonds(0);
      expect(b.conceded).to.be.true;
    });

    it("ruling deadline = rulingWindowStart + rulingBuffer", async function () {
      await bond.connect(challenger1).challenge(0, "");
      const rws = await bond.rulingWindowStart(0);
      const rd = await bond.rulingDeadline(0);
      expect(rd - rws).to.equal(BigInt(RULING_BUFFER));
    });

    it("zero acceptance delay means judge can rule right after deadline", async function () {
      await bond.connect(poster).createBond(
        tokenAddr, BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
        judge.address, deadline, 0, RULING_BUFFER, "No delay"
      );
      await bond.connect(challenger1).challenge(1, "");

      await time.increaseTo(deadline);
      await bond.connect(judge).ruleForPoster(1, JUDGE_FEE);
    });
  });

  // =====================================================================
  // 9. JUDGE RULINGS — poster wins
  // =====================================================================
  describe("Rule for Poster (challenger loses)", function () {
    beforeEach(async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "Wrong");
    });

    it("poster receives challengeAmount - feeCharged", async function () {
      await advanceToRulingWindow();
      const before = await token.balanceOf(poster.address);
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      const after = await token.balanceOf(poster.address);
      expect(after - before).to.equal(CHALLENGE_AMOUNT - JUDGE_FEE);
    });

    it("judge receives feeCharged", async function () {
      await advanceToRulingWindow();
      const before = await token.balanceOf(judge.address);
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      expect(await token.balanceOf(judge.address) - before).to.equal(JUDGE_FEE);
    });

    it("bond pool stays at bondAmount (Robin's invariant)", async function () {
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      expect(await token.balanceOf(await bond.getAddress())).to.equal(BOND_AMOUNT);
    });

    it("advances queue to next challenge", async function () {
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      const b = await bond.bonds(0);
      expect(b.currentChallenge).to.equal(1n);
      expect(b.settled).to.be.false;
    });

    it("sets challenge status to lost (2)", async function () {
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      const [, status] = await bond.getChallenge(0, 0);
      expect(status).to.equal(2n);
    });

    it("emits RuledForPoster and BondResolved for a poster win", async function () {
      await advanceToRulingWindow();
      const tx = bond.connect(judge).ruleForPoster(0, JUDGE_FEE);

      await expect(tx).to.emit(bond, "RuledForPoster").withArgs(
        0, 0, challenger1.address, JUDGE_FEE
      );
      await expect(tx).to.emit(bond, "BondResolved").withArgs(
        0, BOND_RESOLVED_FOR_POSTER
      );
    });

    it("reverts if there is no pending challenge left to rule on", async function () {
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);

      await expect(
        bond.connect(judge).ruleForPoster(0, JUDGE_FEE)
      ).to.be.revertedWith("No pending challenge to rule on");
    });

    it("reverts if the current challenge is no longer pending", async function () {
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);

      // Rewind the queue pointer to the already-lost challenge to exercise
      // the defensive status check directly.
      await setBondCurrentChallenge(0, 0);

      await expect(
        bond.connect(judge).ruleForPoster(0, JUDGE_FEE)
      ).to.be.revertedWith("Current challenge is not pending");
    });
  });

  // =====================================================================
  // 10. JUDGE RULINGS — challenger wins
  // =====================================================================
  describe("Rule for Challenger (poster loses)", function () {
    beforeEach(async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "Fatal flaw");
    });

    it("challenger receives bondAmount + challengeAmount - feeCharged", async function () {
      await advanceToRulingWindow();
      const before = await token.balanceOf(challenger1.address);
      await bond.connect(judge).ruleForChallenger(0, JUDGE_FEE);
      const after = await token.balanceOf(challenger1.address);
      expect(after - before).to.equal(BOND_AMOUNT + CHALLENGE_AMOUNT - JUDGE_FEE);
    });

    it("judge receives feeCharged from pool", async function () {
      await advanceToRulingWindow();
      const before = await token.balanceOf(judge.address);
      await bond.connect(judge).ruleForChallenger(0, JUDGE_FEE);
      expect(await token.balanceOf(judge.address) - before).to.equal(JUDGE_FEE);
    });

    it("settles the bond", async function () {
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForChallenger(0, JUDGE_FEE);
      const b = await bond.bonds(0);
      expect(b.settled).to.be.true;
    });

    it("contract holds zero tokens after challenger wins", async function () {
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForChallenger(0, JUDGE_FEE);
      expect(await token.balanceOf(await bond.getAddress())).to.equal(0n);
    });

    it("refunds remaining challengers when first challenger wins", async function () {
      await bond.connect(challenger2).challenge(0, "Also wrong");
      await bond.connect(challenger3).challenge(0, "Definitely wrong");

      const before2 = await token.balanceOf(challenger2.address);
      const before3 = await token.balanceOf(challenger3.address);

      await advanceToRulingWindow();
      await bond.connect(judge).ruleForChallenger(0, JUDGE_FEE);

      expect(await token.balanceOf(challenger2.address) - before2).to.equal(CHALLENGE_AMOUNT);
      expect(await token.balanceOf(challenger3.address) - before3).to.equal(CHALLENGE_AMOUNT);
    });

    it("emits RuledForChallenger and BondResolved for a challenger win", async function () {
      await advanceToRulingWindow();
      const tx = bond.connect(judge).ruleForChallenger(0, JUDGE_FEE);

      await expect(tx).to.emit(bond, "RuledForChallenger").withArgs(
        0, 0, challenger1.address, JUDGE_FEE
      );
      await expect(tx).to.emit(bond, "BondResolved").withArgs(
        0, BOND_RESOLVED_FOR_CHALLENGER
      );
    });

    it("reverts if feeCharged exceeds max judgeFee", async function () {
      await advanceToRulingWindow();
      await expect(
        bond.connect(judge).ruleForChallenger(0, JUDGE_FEE + 1n)
      ).to.be.revertedWith("Fee charged exceeds the bond's maximum judge fee");
    });

    it("reverts if there is no pending challenge left to rule on", async function () {
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);

      await expect(
        bond.connect(judge).ruleForChallenger(0, JUDGE_FEE)
      ).to.be.revertedWith("No pending challenge to rule on");
    });

    it("reverts if the current challenge is no longer pending", async function () {
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      await setBondCurrentChallenge(0, 0);

      await expect(
        bond.connect(judge).ruleForChallenger(0, JUDGE_FEE)
      ).to.be.revertedWith("Current challenge is not pending");
    });
  });

  // =====================================================================
  // 11. JUDGE FEE WAIVER
  // =====================================================================
  describe("Judge Fee Waiver", function () {
    beforeEach(async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "");
      await advanceToRulingWindow();
    });

    it("judge can charge zero fee (full waiver)", async function () {
      const before = await token.balanceOf(poster.address);
      await bond.connect(judge).ruleForPoster(0, 0);
      expect(await token.balanceOf(poster.address) - before).to.equal(CHALLENGE_AMOUNT);
      expect(await token.balanceOf(judge.address)).to.equal(0n);
    });

    it("judge can charge partial fee", async function () {
      const partialFee = ethers.parseEther("200");
      const before = await token.balanceOf(poster.address);
      const judgeBefore = await token.balanceOf(judge.address);
      await bond.connect(judge).ruleForPoster(0, partialFee);
      expect(await token.balanceOf(poster.address) - before).to.equal(CHALLENGE_AMOUNT - partialFee);
      expect(await token.balanceOf(judge.address) - judgeBefore).to.equal(partialFee);
    });

    it("judge can charge full fee", async function () {
      const judgeBefore = await token.balanceOf(judge.address);
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      expect(await token.balanceOf(judge.address) - judgeBefore).to.equal(JUDGE_FEE);
    });

    it("reverts if feeCharged exceeds max judgeFee", async function () {
      await expect(
        bond.connect(judge).ruleForPoster(0, JUDGE_FEE + 1n)
      ).to.be.revertedWith("Fee charged exceeds the bond's maximum judge fee");
    });

    it("full waiver on ruleForChallenger — challenger gets entire pot", async function () {
      const before = await token.balanceOf(challenger1.address);
      await bond.connect(judge).ruleForChallenger(0, 0);
      expect(await token.balanceOf(challenger1.address) - before).to.equal(BOND_AMOUNT + CHALLENGE_AMOUNT);
    });
  });

  // =====================================================================
  // 12. SEQUENTIAL CHALLENGE QUEUE
  // =====================================================================
  describe("Sequential Challenge Queue (multi-challenger)", function () {
    beforeEach(async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "Error in section 1");
      await bond.connect(challenger2).challenge(0, "Error in section 2");
      await bond.connect(challenger3).challenge(0, "Error in section 3");
    });

    it("poster defeats all three challengers", async function () {
      const posterBefore = await token.balanceOf(poster.address);
      const judgeBefore = await token.balanceOf(judge.address);

      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);

      const posterProfit = await token.balanceOf(poster.address) - posterBefore;
      const judgeProfit = await token.balanceOf(judge.address) - judgeBefore;

      expect(posterProfit).to.equal((CHALLENGE_AMOUNT - JUDGE_FEE) * 3n);
      expect(judgeProfit).to.equal(JUDGE_FEE * 3n);
      expect(await token.balanceOf(await bond.getAddress())).to.equal(BOND_AMOUNT);
    });

    it("poster can withdraw after defeating all challengers", async function () {
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);

      await bond.connect(poster).withdrawBond(0);
      const b = await bond.bonds(0);
      expect(b.settled).to.be.true;
      expect(await token.balanceOf(await bond.getAddress())).to.equal(0n);
    });

    it("second challenger wins after first loses — remaining refunded", async function () {
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);

      const c2Before = await token.balanceOf(challenger2.address);
      const c3Before = await token.balanceOf(challenger3.address);

      await bond.connect(judge).ruleForChallenger(0, JUDGE_FEE);

      expect(await token.balanceOf(challenger2.address) - c2Before)
        .to.equal(BOND_AMOUNT + CHALLENGE_AMOUNT - JUDGE_FEE);
      expect(await token.balanceOf(challenger3.address) - c3Before)
        .to.equal(CHALLENGE_AMOUNT);
    });

    it("belief thresholds stay constant across all challenges (Robin's invariant)", async function () {
      await advanceToRulingWindow();

      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      expect(await token.balanceOf(await bond.getAddress()))
        .to.equal(BOND_AMOUNT + CHALLENGE_AMOUNT * 2n);

      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      expect(await token.balanceOf(await bond.getAddress()))
        .to.equal(BOND_AMOUNT + CHALLENGE_AMOUNT);

      const b = await bond.bonds(0);
      expect(b.bondAmount).to.equal(BOND_AMOUNT);
      expect(b.challengeAmount).to.equal(CHALLENGE_AMOUNT);
      expect(b.judgeFee).to.equal(JUDGE_FEE);
    });
  });

  // =====================================================================
  // 13. POSTER WITHDRAWAL
  // =====================================================================
  describe("Poster Withdrawal", function () {
    beforeEach(async function () {
      await createDefaultBond();
    });

    it("poster withdraws with no challenges — before deadline", async function () {
      const before = await token.balanceOf(poster.address);
      const tx = bond.connect(poster).withdrawBond(0);
      await expect(tx).to.emit(bond, "BondWithdrawn").withArgs(0);
      expect(await token.balanceOf(poster.address) - before).to.equal(BOND_AMOUNT);
    });

    it("poster withdraws after defeating all challengers", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);

      const before = await token.balanceOf(poster.address);
      const tx = bond.connect(poster).withdrawBond(0);
      await expect(tx).to.emit(bond, "BondWithdrawn").withArgs(0);
      expect(await token.balanceOf(poster.address) - before).to.equal(BOND_AMOUNT);
    });

    it("reverts withdrawal if challenges are pending", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await expect(
        bond.connect(poster).withdrawBond(0)
      ).to.be.revertedWith("Bond still has pending challenges");
    });

    it("reverts withdrawal by non-poster", async function () {
      await expect(
        bond.connect(outsider).withdrawBond(0)
      ).to.be.revertedWith("Caller is not the poster for this bond");
    });

    it("reverts double withdrawal", async function () {
      await bond.connect(poster).withdrawBond(0);
      await expect(
        bond.connect(poster).withdrawBond(0)
      ).to.be.revertedWith("Bond is already settled");
    });
  });

  // =====================================================================
  // 14. TIMEOUT
  // =====================================================================
  describe("Timeout", function () {
    beforeEach(async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "");
    });

    it("anyone can trigger timeout after ruling deadline", async function () {
      await advancePastRulingDeadline();
      await expect(
        bond.connect(outsider).claimTimeout(0)
      ).to.emit(bond, "BondTimedOut").withArgs(0);
    });

    it("timeout refunds poster's bond", async function () {
      await advancePastRulingDeadline();
      const before = await token.balanceOf(poster.address);
      await bond.connect(outsider).claimTimeout(0);
      expect(await token.balanceOf(poster.address) - before).to.equal(BOND_AMOUNT);
    });

    it("timeout refunds all pending challengers", async function () {
      await bond.connect(challenger2).challenge(0, "");

      await advancePastRulingDeadline();
      const before1 = await token.balanceOf(challenger1.address);
      const before2 = await token.balanceOf(challenger2.address);
      await bond.connect(outsider).claimTimeout(0);
      expect(await token.balanceOf(challenger1.address) - before1).to.equal(CHALLENGE_AMOUNT);
      expect(await token.balanceOf(challenger2.address) - before2).to.equal(CHALLENGE_AMOUNT);
    });

    it("timeout gives judge nothing", async function () {
      await advancePastRulingDeadline();
      const before = await token.balanceOf(judge.address);
      await bond.connect(outsider).claimTimeout(0);
      expect(await token.balanceOf(judge.address)).to.equal(before);
    });

    it("timeout leaves zero tokens in contract", async function () {
      await advancePastRulingDeadline();
      await bond.connect(outsider).claimTimeout(0);
      expect(await token.balanceOf(await bond.getAddress())).to.equal(0n);
    });

    it("reverts timeout before ruling deadline", async function () {
      await expect(
        bond.connect(outsider).claimTimeout(0)
      ).to.be.revertedWith("Ruling deadline has not passed");
    });

    it("timeout after partial rulings — only refunds remaining challengers", async function () {
      await bond.connect(challenger2).challenge(0, "");

      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);

      await advancePastRulingDeadline();

      const posterBefore = await token.balanceOf(poster.address);
      const c2Before = await token.balanceOf(challenger2.address);

      await bond.connect(outsider).claimTimeout(0);

      expect(await token.balanceOf(poster.address) - posterBefore).to.equal(BOND_AMOUNT);
      expect(await token.balanceOf(challenger2.address) - c2Before).to.equal(CHALLENGE_AMOUNT);
    });
  });

  // =====================================================================
  // 15. COMPLEX END-TO-END SCENARIOS
  // =====================================================================
  describe("Complex End-to-End Scenarios", function () {

    it("Robin Hanson scenario: full lifecycle with concession", async function () {
      await createDefaultBond();

      const b = await bond.bonds(0);
      const netPot = b.bondAmount + b.challengeAmount - b.judgeFee;
      expect(netPot).to.equal(ethers.parseEther("12500"));

      await bond.connect(challenger1).challenge(0, "The claim in paragraph 3 is factually incorrect");
      await bond.connect(poster).concede(0, "Challenger is right");

      expect(await token.balanceOf(await bond.getAddress())).to.equal(0n);
    });

    it("poster fights and wins all challenges", async function () {
      await createDefaultBond();

      const challengers = [challenger1, challenger2, challenger3];
      for (const c of challengers) {
        await bond.connect(c).challenge(0, "Wrong");
      }

      const posterBefore = await token.balanceOf(poster.address);
      const judgeBefore = await token.balanceOf(judge.address);

      await advanceToRulingWindow();
      for (let i = 0; i < 3; i++) {
        await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      }

      await bond.connect(poster).withdrawBond(0);

      const posterTotal = await token.balanceOf(poster.address) - posterBefore;
      const judgeTotal = await token.balanceOf(judge.address) - judgeBefore;

      expect(posterTotal).to.equal(BOND_AMOUNT + (CHALLENGE_AMOUNT - JUDGE_FEE) * 3n);
      expect(judgeTotal).to.equal(JUDGE_FEE * 3n);
    });

    it("anti-gaming: shill challenge doesn't protect poster", async function () {
      await createDefaultBond();

      await bond.connect(challenger1).challenge(0, "Weak challenge");
      await bond.connect(challenger2).challenge(0, "Real substantive error");

      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);

      const b = await bond.bonds(0);
      expect(b.settled).to.be.false;
      expect(b.currentChallenge).to.equal(1n);

      const c2Before = await token.balanceOf(challenger2.address);
      await bond.connect(judge).ruleForChallenger(0, JUDGE_FEE);

      expect(await token.balanceOf(challenger2.address) - c2Before)
        .to.equal(BOND_AMOUNT + CHALLENGE_AMOUNT - JUDGE_FEE);
    });

    it("token accounting invariant: total tokens always balance", async function () {
      await createDefaultBond();

      const bondAddr = await bond.getAddress();
      const allActors = [poster, judge, challenger1, challenger2, challenger3, outsider];

      async function totalHeld() {
        let sum = 0n;
        for (const a of allActors) {
          sum += await token.balanceOf(a.address);
        }
        sum += await token.balanceOf(bondAddr);
        return sum;
      }

      const initialTotal = await totalHeld();

      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(challenger2).challenge(0, "");
      expect(await totalHeld()).to.equal(initialTotal);

      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      expect(await totalHeld()).to.equal(initialTotal);

      await bond.connect(judge).ruleForChallenger(0, JUDGE_FEE);
      expect(await totalHeld()).to.equal(initialTotal);
    });

    it("judge rejects after viewing challenges — everyone refunded", async function () {
      await createDefaultBond();

      await bond.connect(challenger1).challenge(0, "Complex dispute");
      await bond.connect(challenger2).challenge(0, "Another angle");

      const posterBefore = await token.balanceOf(poster.address);
      const c1Before = await token.balanceOf(challenger1.address);
      const c2Before = await token.balanceOf(challenger2.address);
      const judgeBefore = await token.balanceOf(judge.address);

      await bond.connect(judge).rejectBond(0);

      expect(await token.balanceOf(poster.address) - posterBefore).to.equal(BOND_AMOUNT);
      expect(await token.balanceOf(challenger1.address) - c1Before).to.equal(CHALLENGE_AMOUNT);
      expect(await token.balanceOf(challenger2.address) - c2Before).to.equal(CHALLENGE_AMOUNT);
      // Judge gets nothing from rejection
      expect(await token.balanceOf(judge.address)).to.equal(judgeBefore);
      expect(await token.balanceOf(await bond.getAddress())).to.equal(0n);
    });

    it("gas stress test: 10 challengers, all defeated, then withdrawn", async function () {
      await createDefaultBond();

      const signers = await ethers.getSigners();
      const allChallengers = signers.slice(2, 12);

      for (const c of allChallengers) {
        await token.mint(c.address, CHALLENGE_AMOUNT);
        await token.connect(c).approve(await bond.getAddress(), CHALLENGE_AMOUNT);
        await bond.connect(c).challenge(0, `Challenge by ${c.address.slice(0, 8)}`);
      }

      expect(await bond.getChallengeCount(0)).to.equal(10n);

      await advanceToRulingWindow();

      for (let i = 0; i < 10; i++) {
        await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      }

      await bond.connect(poster).withdrawBond(0);
      expect(await token.balanceOf(await bond.getAddress())).to.equal(0n);
    });
  });

  // =====================================================================
  // 16. ACCESS CONTROL
  // =====================================================================
  describe("Access Control", function () {
    beforeEach(async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "");
    });

    it("only judge can call ruleForPoster", async function () {
      await advanceToRulingWindow();
      await expect(
        bond.connect(poster).ruleForPoster(0, JUDGE_FEE)
      ).to.be.revertedWith("Caller is not the judge for this bond");
      await expect(
        bond.connect(challenger1).ruleForPoster(0, JUDGE_FEE)
      ).to.be.revertedWith("Caller is not the judge for this bond");
      await expect(
        bond.connect(outsider).ruleForPoster(0, JUDGE_FEE)
      ).to.be.revertedWith("Caller is not the judge for this bond");
    });

    it("only judge can call ruleForChallenger", async function () {
      await advanceToRulingWindow();
      await expect(
        bond.connect(poster).ruleForChallenger(0, JUDGE_FEE)
      ).to.be.revertedWith("Caller is not the judge for this bond");
    });

    it("only poster can withdraw", async function () {
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      await expect(
        bond.connect(judge).withdrawBond(0)
      ).to.be.revertedWith("Caller is not the poster for this bond");
    });

    it("only poster can concede", async function () {
      await expect(
        bond.connect(judge).concede(0, "")
      ).to.be.revertedWith("Caller is not the poster for this bond");
      await expect(
        bond.connect(challenger1).concede(0, "")
      ).to.be.revertedWith("Caller is not the poster for this bond");
    });

    it("only judge can reject bond", async function () {
      await expect(
        bond.connect(poster).rejectBond(0)
      ).to.be.revertedWith("Caller is not the judge for this bond");
      await expect(
        bond.connect(outsider).rejectBond(0)
      ).to.be.revertedWith("Caller is not the judge for this bond");
    });
  });
});
