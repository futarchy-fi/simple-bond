const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// ─── Constants ───────────────────────────────────────────────────────────
// Robin Hanson's preferred numbers: bond=$10K, challenge=$3K, judgeFee=$0.5K
// → Challenger threshold: 3/12.5 = 24%, Poster threshold: 1 - 10/12.5 = 20%
const BOND_AMOUNT = ethers.parseEther("10000");
const CHALLENGE_AMOUNT = ethers.parseEther("3000");
const JUDGE_FEE = ethers.parseEther("500");
const ACCEPTANCE_DELAY = 3 * 86400; // 3 days
const RULING_BUFFER = 30 * 86400;   // 30 days

const ONE_DAY = 86400;
const ONE_MONTH = 30 * ONE_DAY;

describe("SimpleBondV3", function () {
  let bond, token;
  let poster, judge, challenger1, challenger2, challenger3, outsider;
  let deadline;

  async function deployFixture() {
    [poster, judge, challenger1, challenger2, challenger3, outsider] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("TestToken");
    token = await Token.deploy();

    const Bond = await ethers.getContractFactory("SimpleBondV3");
    bond = await Bond.deploy();

    // Mint tokens to all participants
    for (const acct of [poster, challenger1, challenger2, challenger3]) {
      await token.mint(acct.address, ethers.parseEther("100000"));
      await token.connect(acct).approve(await bond.getAddress(), ethers.MaxUint256);
    }

    deadline = (await time.latest()) + 3 * ONE_MONTH;
  }

  async function createDefaultBond() {
    const tx = await bond.connect(poster).createBond(
      await token.getAddress(),
      BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
      judge.address,
      deadline, ACCEPTANCE_DELAY, RULING_BUFFER,
      "My article has no significant errors"
    );
    const receipt = await tx.wait();
    return 0; // first bond is always ID 0
  }

  // Advance past deadline + acceptance delay so judge can rule on bond `id`
  async function advanceToRulingWindow(id = 0) {
    const start = await bond.rulingWindowStart(id);
    await time.increaseTo(start);
  }

  async function advancePastRulingDeadline(id = 0) {
    const end = await bond.rulingDeadline(id);
    await time.increaseTo(Number(end) + 1);
  }

  beforeEach(async function () {
    await deployFixture();
  });

  // =====================================================================
  // 1. CREATION
  // =====================================================================
  describe("Bond Creation", function () {
    it("creates a bond with correct parameters and emits BondCreated", async function () {
      await expect(
        bond.connect(poster).createBond(
          await token.getAddress(),
          BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
          judge.address,
          deadline, ACCEPTANCE_DELAY, RULING_BUFFER,
          "Test claim"
        )
      ).to.emit(bond, "BondCreated").withArgs(
        0, poster.address, judge.address, await token.getAddress(),
        BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
        deadline, ACCEPTANCE_DELAY, RULING_BUFFER,
        "Test claim"
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

    it("reverts on zero bond amount", async function () {
      await expect(
        bond.connect(poster).createBond(
          await token.getAddress(), 0, CHALLENGE_AMOUNT, JUDGE_FEE,
          judge.address, deadline, ACCEPTANCE_DELAY, RULING_BUFFER, ""
        )
      ).to.be.revertedWith("Zero bond amount");
    });

    it("reverts if judgeFee > challengeAmount", async function () {
      await expect(
        bond.connect(poster).createBond(
          await token.getAddress(), BOND_AMOUNT, CHALLENGE_AMOUNT,
          CHALLENGE_AMOUNT + 1n,
          judge.address, deadline, ACCEPTANCE_DELAY, RULING_BUFFER, ""
        )
      ).to.be.revertedWith("Fee > challenge amount");
    });

    it("allows zero judge fee", async function () {
      await bond.connect(poster).createBond(
        await token.getAddress(), BOND_AMOUNT, CHALLENGE_AMOUNT, 0,
        judge.address, deadline, ACCEPTANCE_DELAY, RULING_BUFFER, "No fee claim"
      );
      const b = await bond.bonds(0);
      expect(b.judgeFee).to.equal(0n);
    });

    it("allows zero acceptance delay", async function () {
      await bond.connect(poster).createBond(
        await token.getAddress(), BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
        judge.address, deadline, 0, RULING_BUFFER, "No delay claim"
      );
      const b = await bond.bonds(0);
      expect(b.acceptanceDelay).to.equal(0n);
    });

    it("reverts on deadline in the past", async function () {
      await expect(
        bond.connect(poster).createBond(
          await token.getAddress(), BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
          judge.address, 1, ACCEPTANCE_DELAY, RULING_BUFFER, ""
        )
      ).to.be.revertedWith("Deadline in past");
    });

    it("increments bondId for sequential creates", async function () {
      await createDefaultBond();
      await bond.connect(poster).createBond(
        await token.getAddress(), BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
        judge.address, deadline, ACCEPTANCE_DELAY, RULING_BUFFER, "Second claim"
      );
      expect(await bond.nextBondId()).to.equal(2n);
    });
  });

  // =====================================================================
  // 2. CHALLENGES
  // =====================================================================
  describe("Challenges", function () {
    beforeEach(async function () {
      await createDefaultBond();
    });

    it("accepts a challenge with metadata and emits Challenged", async function () {
      await expect(
        bond.connect(challenger1).challenge(0, "Section 3 contains factual errors")
      ).to.emit(bond, "Challenged").withArgs(
        0, 0, challenger1.address, "Section 3 contains factual errors"
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
      expect(status).to.equal(0n); // pending
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

    it("reverts challenge after deadline", async function () {
      await time.increaseTo(deadline + 1);
      await expect(
        bond.connect(challenger1).challenge(0, "Too late")
      ).to.be.revertedWith("Past deadline");
    });

    it("reverts challenge on settled bond", async function () {
      // Poster withdraws (no challenges)
      await bond.connect(poster).withdrawBond(0);
      await expect(
        bond.connect(challenger1).challenge(0, "")
      ).to.be.revertedWith("Already settled");
    });

    it("reverts challenge on conceded bond", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(poster).concede(0, "You're right");
      // Concession sets settled=true, so the "Already settled" check fires first
      await expect(
        bond.connect(challenger2).challenge(0, "")
      ).to.be.revertedWith("Already settled");
    });
  });

  // =====================================================================
  // 3. POSTER CONCESSION — the core v3 feature
  // =====================================================================
  describe("Poster Concession", function () {
    beforeEach(async function () {
      await createDefaultBond();
    });

    it("poster concedes, emits ClaimConceded with metadata", async function () {
      await bond.connect(challenger1).challenge(0, "You're wrong about X");

      await expect(
        bond.connect(poster).concede(0, "I was wrong because Y")
      ).to.emit(bond, "ClaimConceded").withArgs(
        0, poster.address, "I was wrong because Y"
      );
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
      ).to.be.revertedWith("Only poster");
    });

    it("reverts concession if no pending challenges", async function () {
      await expect(
        bond.connect(poster).concede(0, "")
      ).to.be.revertedWith("No pending challenges");
    });

    it("reverts concession after judge has already ruled on first challenge", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(challenger2).challenge(0, "");

      // Judge rules on challenger1 (for poster) — advances queue
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);

      // Now poster tries to concede — should fail because ruling started
      await expect(
        bond.connect(poster).concede(0, "Changed my mind")
      ).to.be.revertedWith("Ruling already started");
    });

    it("reverts double concession", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(poster).concede(0, "");
      await expect(
        bond.connect(poster).concede(0, "")
      ).to.be.revertedWith("Already settled");
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
  // 4. ACCEPTANCE DELAY & RULING WINDOW TIMING
  // =====================================================================
  describe("Acceptance Delay & Ruling Window", function () {
    beforeEach(async function () {
      await createDefaultBond();
    });

    it("rulingWindowStart = max(deadline, lastChallengeTime + acceptanceDelay)", async function () {
      // Challenge early — deadline dominates
      await bond.connect(challenger1).challenge(0, "");
      const rws = await bond.rulingWindowStart(0);
      expect(Number(rws)).to.equal(deadline);
    });

    it("late challenge extends ruling window beyond deadline", async function () {
      // Challenge 1 day before deadline
      await time.increaseTo(deadline - ONE_DAY);
      await bond.connect(challenger1).challenge(0, "Last minute challenge");

      const b = await bond.bonds(0);
      const expectedStart = Number(b.lastChallengeTime) + ACCEPTANCE_DELAY;
      const rws = await bond.rulingWindowStart(0);
      // Since lastChallengeTime + 3 days > deadline, acceptance delay dominates
      expect(Number(rws)).to.equal(expectedStart);
      expect(Number(rws)).to.be.gt(deadline);
    });

    it("judge cannot rule before ruling window opens", async function () {
      await bond.connect(challenger1).challenge(0, "");
      // Don't advance time — still before deadline
      await expect(
        bond.connect(judge).ruleForPoster(0, JUDGE_FEE)
      ).to.be.revertedWith("Before ruling window");
    });

    it("judge cannot rule after ruling deadline", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await advancePastRulingDeadline();
      await expect(
        bond.connect(judge).ruleForPoster(0, JUDGE_FEE)
      ).to.be.revertedWith("Past ruling deadline");
    });

    it("judge can rule exactly at ruling window start", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await advanceToRulingWindow();
      // Should not revert
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
    });

    it("poster can concede during acceptance delay (before judge can rule)", async function () {
      // Challenge at the last moment
      await time.increaseTo(deadline - 100);
      await bond.connect(challenger1).challenge(0, "");

      // We're past deadline but in acceptance delay — judge can't rule yet
      await time.increase(ONE_DAY); // 1 day into 3-day acceptance delay

      // Judge can't rule yet
      await expect(
        bond.connect(judge).ruleForPoster(0, JUDGE_FEE)
      ).to.be.revertedWith("Before ruling window");

      // But poster can concede
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
      // Create bond with 0 acceptance delay
      await bond.connect(poster).createBond(
        await token.getAddress(), BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
        judge.address, deadline, 0, RULING_BUFFER, "No delay"
      );
      await bond.connect(challenger1).challenge(1, "");

      // Advance just past deadline
      await time.increaseTo(deadline);
      await bond.connect(judge).ruleForPoster(1, JUDGE_FEE);
    });
  });

  // =====================================================================
  // 5. JUDGE RULINGS — poster wins
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

    it("bond pool stays at bondAmount — amounts fixed (Robin's invariant)", async function () {
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      // Contract should hold exactly bondAmount (poster's original stake)
      expect(await token.balanceOf(await bond.getAddress())).to.equal(BOND_AMOUNT);
    });

    it("advances queue to next challenge", async function () {
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      const b = await bond.bonds(0);
      expect(b.currentChallenge).to.equal(1n);
      expect(b.settled).to.be.false; // bond not settled, just queue advanced
    });

    it("sets challenge status to lost (2)", async function () {
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      const [, status] = await bond.getChallenge(0, 0);
      expect(status).to.equal(2n);
    });

    it("emits RuledForPoster with feeCharged", async function () {
      await advanceToRulingWindow();
      await expect(
        bond.connect(judge).ruleForPoster(0, JUDGE_FEE)
      ).to.emit(bond, "RuledForPoster").withArgs(0, 0, challenger1.address, JUDGE_FEE);
    });
  });

  // =====================================================================
  // 6. JUDGE RULINGS — challenger wins
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
  });

  // =====================================================================
  // 7. JUDGE FEE WAIVER
  // =====================================================================
  describe("Judge Fee Waiver", function () {
    beforeEach(async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "");
      await advanceToRulingWindow();
    });

    it("judge can charge zero fee (full waiver) — poster gets full challengeAmount", async function () {
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
      ).to.be.revertedWith("Fee exceeds max");
    });

    it("full waiver on ruleForChallenger — challenger gets entire pot", async function () {
      const before = await token.balanceOf(challenger1.address);
      await bond.connect(judge).ruleForChallenger(0, 0);
      expect(await token.balanceOf(challenger1.address) - before).to.equal(BOND_AMOUNT + CHALLENGE_AMOUNT);
    });
  });

  // =====================================================================
  // 8. SEQUENTIAL CHALLENGE QUEUE — the multi-challenger flow
  // =====================================================================
  describe("Sequential Challenge Queue (multi-challenger)", function () {
    beforeEach(async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "Error in section 1");
      await bond.connect(challenger2).challenge(0, "Error in section 2");
      await bond.connect(challenger3).challenge(0, "Error in section 3");
    });

    it("poster defeats all three challengers — collects 3x profit, bond intact", async function () {
      const posterBefore = await token.balanceOf(poster.address);
      const judgeBefore = await token.balanceOf(judge.address);

      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);

      const posterProfit = await token.balanceOf(poster.address) - posterBefore;
      const judgeProfit = await token.balanceOf(judge.address) - judgeBefore;

      // Poster gets (challengeAmount - judgeFee) per failed challenger = $2500 × 3
      expect(posterProfit).to.equal((CHALLENGE_AMOUNT - JUDGE_FEE) * 3n);
      // Judge gets judgeFee per ruling = $500 × 3
      expect(judgeProfit).to.equal(JUDGE_FEE * 3n);
      // Bond pool is untouched
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

      // Challenger 1 loses
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);

      // Challenger 2 wins
      const c2Before = await token.balanceOf(challenger2.address);
      const c3Before = await token.balanceOf(challenger3.address);

      await bond.connect(judge).ruleForChallenger(0, JUDGE_FEE);

      // Challenger 2 gets the pot
      expect(await token.balanceOf(challenger2.address) - c2Before)
        .to.equal(BOND_AMOUNT + CHALLENGE_AMOUNT - JUDGE_FEE);
      // Challenger 3 is refunded
      expect(await token.balanceOf(challenger3.address) - c3Before)
        .to.equal(CHALLENGE_AMOUNT);
    });

    it("belief thresholds stay constant across all challenges (Robin's invariant)", async function () {
      // The amounts never change regardless of how many challenges resolve.
      // After each ruling, the contract holds exactly bondAmount (for pending challenges
      // that haven't been refunded/won, their amounts are still in the contract too).

      await advanceToRulingWindow();

      // After ruling on challenger 1 for poster:
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      // Contract holds: bondAmount + 2 × challengeAmount (two remaining challengers)
      expect(await token.balanceOf(await bond.getAddress()))
        .to.equal(BOND_AMOUNT + CHALLENGE_AMOUNT * 2n);

      // After ruling on challenger 2 for poster:
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      // Contract holds: bondAmount + 1 × challengeAmount (one remaining)
      expect(await token.balanceOf(await bond.getAddress()))
        .to.equal(BOND_AMOUNT + CHALLENGE_AMOUNT);

      // The bond struct amounts haven't changed
      const b = await bond.bonds(0);
      expect(b.bondAmount).to.equal(BOND_AMOUNT);
      expect(b.challengeAmount).to.equal(CHALLENGE_AMOUNT);
      expect(b.judgeFee).to.equal(JUDGE_FEE);
    });
  });

  // =====================================================================
  // 9. POSTER WITHDRAWAL
  // =====================================================================
  describe("Poster Withdrawal", function () {
    beforeEach(async function () {
      await createDefaultBond();
    });

    it("poster withdraws with no challenges — before deadline", async function () {
      const before = await token.balanceOf(poster.address);
      await bond.connect(poster).withdrawBond(0);
      expect(await token.balanceOf(poster.address) - before).to.equal(BOND_AMOUNT);
    });

    it("poster withdraws after defeating all challengers", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);

      const before = await token.balanceOf(poster.address);
      await bond.connect(poster).withdrawBond(0);
      expect(await token.balanceOf(poster.address) - before).to.equal(BOND_AMOUNT);
    });

    it("reverts withdrawal if challenges are pending", async function () {
      await bond.connect(challenger1).challenge(0, "");
      await expect(
        bond.connect(poster).withdrawBond(0)
      ).to.be.revertedWith("Pending challenges");
    });

    it("reverts withdrawal by non-poster", async function () {
      await expect(
        bond.connect(outsider).withdrawBond(0)
      ).to.be.revertedWith("Only poster");
    });

    it("reverts double withdrawal", async function () {
      await bond.connect(poster).withdrawBond(0);
      await expect(
        bond.connect(poster).withdrawBond(0)
      ).to.be.revertedWith("Already settled");
    });
  });

  // =====================================================================
  // 10. TIMEOUT
  // =====================================================================
  describe("Timeout", function () {
    beforeEach(async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "");
    });

    it("anyone can trigger timeout after ruling deadline", async function () {
      await advancePastRulingDeadline();
      // outsider triggers it
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
      ).to.be.revertedWith("Before ruling deadline");
    });

    it("timeout after partial rulings — only refunds remaining challengers", async function () {
      await bond.connect(challenger2).challenge(0, "");

      await advanceToRulingWindow();
      // Judge rules on challenger1 (poster wins)
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);

      // Now judge disappears — advance past ruling deadline
      await advancePastRulingDeadline();

      const posterBefore = await token.balanceOf(poster.address);
      const c2Before = await token.balanceOf(challenger2.address);

      await bond.connect(outsider).claimTimeout(0);

      // Poster gets bond back
      expect(await token.balanceOf(poster.address) - posterBefore).to.equal(BOND_AMOUNT);
      // Challenger2 gets refunded
      expect(await token.balanceOf(challenger2.address) - c2Before).to.equal(CHALLENGE_AMOUNT);
      // Challenger1 already lost (no refund)
    });
  });

  // =====================================================================
  // 11. COMPLEX END-TO-END SCENARIOS
  // =====================================================================
  describe("Complex End-to-End Scenarios", function () {

    it("Robin Hanson scenario: $10K bond, $3K challenge, $0.5K fee — full lifecycle", async function () {
      // Robin creates a bond asserting his article is correct
      await createDefaultBond();

      // Verify belief thresholds
      // net_pot = 10000 + 3000 - 500 = 12500
      // challenger threshold = 3000/12500 = 24%
      // poster threshold = 1 - 10000/12500 = 20%
      const b = await bond.bonds(0);
      const netPot = b.bondAmount + b.challengeAmount - b.judgeFee;
      expect(netPot).to.equal(ethers.parseEther("12500"));

      // Someone challenges
      await bond.connect(challenger1).challenge(0, "The claim in paragraph 3 is factually incorrect based on Smith (2025)");

      // Robin concedes — public admission he was wrong
      await bond.connect(poster).concede(0, "Challenger is right, I misread Smith (2025). Correcting the article.");

      // Verify everyone got refunded
      // Total in contract should be 0
      expect(await token.balanceOf(await bond.getAddress())).to.equal(0n);
    });

    it("poster fights and wins all challenges — accumulates profit", async function () {
      await createDefaultBond();

      // 3 challengers queue up
      const challengers = [challenger1, challenger2, challenger3];
      for (const c of challengers) {
        await bond.connect(c).challenge(0, "Wrong");
      }

      const posterBefore = await token.balanceOf(poster.address);
      const judgeBefore = await token.balanceOf(judge.address);

      // Judge rules for poster on all 3
      await advanceToRulingWindow();
      for (let i = 0; i < 3; i++) {
        await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      }

      // Poster withdraws bond
      await bond.connect(poster).withdrawBond(0);

      const posterTotal = await token.balanceOf(poster.address) - posterBefore;
      const judgeTotal = await token.balanceOf(judge.address) - judgeBefore;

      // Poster profit: 3 × ($3000 - $500) = $7500, plus bond back = $17500 total
      expect(posterTotal).to.equal(BOND_AMOUNT + (CHALLENGE_AMOUNT - JUDGE_FEE) * 3n);
      // Judge profit: 3 × $500 = $1500
      expect(judgeTotal).to.equal(JUDGE_FEE * 3n);
    });

    it("anti-gaming: shill challenge doesn't protect poster from real challengers", async function () {
      await createDefaultBond();

      // Poster's friend makes a weak shill challenge
      await bond.connect(challenger1).challenge(0, "Weak challenge");
      // Real challenger also queues
      await bond.connect(challenger2).challenge(0, "Real substantive error found");

      await advanceToRulingWindow();

      // Judge rules for poster on shill challenge
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);

      // Bond is NOT settled — real challenger is still in queue
      const b = await bond.bonds(0);
      expect(b.settled).to.be.false;
      expect(b.currentChallenge).to.equal(1n);

      // Judge rules for real challenger
      const c2Before = await token.balanceOf(challenger2.address);
      await bond.connect(judge).ruleForChallenger(0, JUDGE_FEE);

      // Real challenger wins the full pot
      expect(await token.balanceOf(challenger2.address) - c2Before)
        .to.equal(BOND_AMOUNT + CHALLENGE_AMOUNT - JUDGE_FEE);
    });

    it("judge fee waiver + concession are independent features", async function () {
      // Create bond with high fee
      const highFee = ethers.parseEther("2000");
      await bond.connect(poster).createBond(
        await token.getAddress(), BOND_AMOUNT, CHALLENGE_AMOUNT, highFee,
        judge.address, deadline, ACCEPTANCE_DELAY, RULING_BUFFER,
        "Claim with expensive judge"
      );
      // bondId is 0 (first bond in this test)
      await bond.connect(challenger1).challenge(0, "");

      // Poster concedes — judge fee is irrelevant (judge never invoked)
      await bond.connect(poster).concede(0, "Conceding");

      // Everyone refunded, judge got nothing
      expect(await token.balanceOf(judge.address)).to.equal(0n);
    });

    it("late challenge: acceptance delay protects poster even after deadline", async function () {
      await createDefaultBond();

      // Challenge 10 seconds before deadline
      await time.increaseTo(deadline - 10);
      await bond.connect(challenger1).challenge(0, "Last second!");

      // Advance 1 second past deadline
      await time.increaseTo(deadline + 1);

      // Judge tries to rule — should fail because acceptance delay hasn't passed
      await expect(
        bond.connect(judge).ruleForPoster(0, JUDGE_FEE)
      ).to.be.revertedWith("Before ruling window");

      // Poster concedes during the acceptance delay window
      await bond.connect(poster).concede(0, "Need more time to think... actually you're right");
      expect((await bond.bonds(0)).conceded).to.be.true;
    });

    it("multiple bonds by different posters operate independently", async function () {
      // Two different posters create bonds
      await createDefaultBond(); // bond 0 by poster
      await token.mint(challenger1.address, BOND_AMOUNT);
      await bond.connect(challenger1).createBond(
        await token.getAddress(), BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
        judge.address, deadline, ACCEPTANCE_DELAY, RULING_BUFFER,
        "Different claim by different person"
      ); // bond 1 by challenger1 (acting as poster)

      // Challenge both
      await bond.connect(challenger2).challenge(0, "");
      await bond.connect(challenger3).challenge(1, "");

      // Bond 0: poster concedes
      await bond.connect(poster).concede(0, "I was wrong");

      // Bond 1 is unaffected
      const b1 = await bond.bonds(1);
      expect(b1.settled).to.be.false;
      expect(b1.conceded).to.be.false;

      // Bond 1: judge rules for poster — use bond 1's ruling window directly
      const rws1 = await bond.rulingWindowStart(1);
      await time.increaseTo(rws1);
      await bond.connect(judge).ruleForPoster(1, JUDGE_FEE);
    });

    it("token accounting invariant: total tokens always balance", async function () {
      await createDefaultBond();

      const bondAddr = await bond.getAddress();
      const allActors = [poster, judge, challenger1, challenger2, challenger3, outsider];

      // Snapshot total supply held by all actors + contract
      async function totalHeld() {
        let sum = 0n;
        for (const a of allActors) {
          sum += await token.balanceOf(a.address);
        }
        sum += await token.balanceOf(bondAddr);
        return sum;
      }

      const initialTotal = await totalHeld();

      // Challenge
      await bond.connect(challenger1).challenge(0, "");
      await bond.connect(challenger2).challenge(0, "");
      expect(await totalHeld()).to.equal(initialTotal);

      // Judge rules for poster on first
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      expect(await totalHeld()).to.equal(initialTotal);

      // Judge rules for challenger on second
      await bond.connect(judge).ruleForChallenger(0, JUDGE_FEE);
      expect(await totalHeld()).to.equal(initialTotal);
    });

    it("gas stress test: 10 challengers, all defeated, then withdrawn", async function () {
      await createDefaultBond();

      // Use first 3 named challengers + mint for extra signers
      const signers = await ethers.getSigners();
      const allChallengers = signers.slice(2, 12); // 10 challengers

      for (const c of allChallengers) {
        await token.mint(c.address, CHALLENGE_AMOUNT);
        await token.connect(c).approve(await bond.getAddress(), CHALLENGE_AMOUNT);
        await bond.connect(c).challenge(0, `Challenge by ${c.address.slice(0, 8)}`);
      }

      expect(await bond.getChallengeCount(0)).to.equal(10n);

      await advanceToRulingWindow();

      // Judge defeats all 10
      for (let i = 0; i < 10; i++) {
        await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      }

      // Poster withdraws
      await bond.connect(poster).withdrawBond(0);
      expect(await token.balanceOf(await bond.getAddress())).to.equal(0n);
    });
  });

  // =====================================================================
  // 12. ACCESS CONTROL
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
      ).to.be.revertedWith("Only judge");
      await expect(
        bond.connect(challenger1).ruleForPoster(0, JUDGE_FEE)
      ).to.be.revertedWith("Only judge");
      await expect(
        bond.connect(outsider).ruleForPoster(0, JUDGE_FEE)
      ).to.be.revertedWith("Only judge");
    });

    it("only judge can call ruleForChallenger", async function () {
      await advanceToRulingWindow();
      await expect(
        bond.connect(poster).ruleForChallenger(0, JUDGE_FEE)
      ).to.be.revertedWith("Only judge");
    });

    it("only poster can withdraw", async function () {
      await advanceToRulingWindow();
      await bond.connect(judge).ruleForPoster(0, JUDGE_FEE);
      await expect(
        bond.connect(judge).withdrawBond(0)
      ).to.be.revertedWith("Only poster");
    });

    it("only poster can concede", async function () {
      await expect(
        bond.connect(judge).concede(0, "")
      ).to.be.revertedWith("Only poster");
      await expect(
        bond.connect(challenger1).concede(0, "")
      ).to.be.revertedWith("Only poster");
    });
  });
});
