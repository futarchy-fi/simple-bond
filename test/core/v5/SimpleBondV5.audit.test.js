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

// ---------------------------------------------------------------------------
// Tests targeting coverage gaps identified in the V5 pre-audit.
// Grouped by the audit finding they address.
// ---------------------------------------------------------------------------

describe("SimpleBondV5 audit coverage", function () {
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
    judgeAddr = fixture.addresses.judge;
    bondAddr = fixture.addresses.bond;
  });

  // -------------------------------------------------------------------------
  // L-01: rejectBond has no time constraint
  // -------------------------------------------------------------------------

  describe("rejectBond timing (L-01)", function () {
    it("judge can reject before the ruling window opens", async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "Dispute");

      // Verify we are before the ruling window.
      const start = await bond.rulingWindowStart(0);
      expect(await time.latest()).to.be.lt(start);

      const posterBefore = await token.balanceOf(poster.address);
      const challengerBefore = await token.balanceOf(challenger1.address);

      await fixture.actions.rejectBond();
      await claimAllRefunds();

      expect(await token.balanceOf(poster.address) - posterBefore).to.equal(BOND_AMOUNT);
      expect(await token.balanceOf(challenger1.address) - challengerBefore).to.equal(CHALLENGE_AMOUNT);
      expect(await token.balanceOf(bondAddr)).to.equal(0n);
    });

    it("judge can reject after the ruling deadline passes", async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "Dispute");
      await advancePastRulingDeadline();

      // Verify we are past the ruling deadline.
      const end = await bond.rulingDeadline(0);
      expect(await time.latest()).to.be.gt(end);

      const posterBefore = await token.balanceOf(poster.address);
      const challengerBefore = await token.balanceOf(challenger1.address);

      await fixture.actions.rejectBond();
      await claimAllRefunds();

      expect(await token.balanceOf(poster.address) - posterBefore).to.equal(BOND_AMOUNT);
      expect(await token.balanceOf(challenger1.address) - challengerBefore).to.equal(CHALLENGE_AMOUNT);
      expect(await token.balanceOf(bondAddr)).to.equal(0n);
    });

    it("judge can reject a bond that has no challenges at all", async function () {
      await createDefaultBond();

      const posterBefore = await token.balanceOf(poster.address);
      await fixture.actions.rejectBond();

      expect(await token.balanceOf(poster.address) - posterBefore).to.equal(BOND_AMOUNT);
      expect(await token.balanceOf(bondAddr)).to.equal(0n);

      const b = await bond.bonds(0);
      expect(b.settled).to.be.true;
    });

    it("rejectBond and claimTimeout are both valid after the ruling deadline", async function () {
      // Create two identical bonds to test both paths.
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "Dispute");

      await fixture.actions.createBond({ metadata: "Second bond" });
      await bond.connect(challenger2).challenge(1, "Dispute");

      await advancePastRulingDeadline(0);

      // Bond 0: resolved via rejectBond.
      await fixture.actions.rejectBond({ bondId: 0 });
      await claimAllRefunds(0);
      const b0 = await bond.bonds(0);
      expect(b0.settled).to.be.true;

      // Bond 1: resolved via claimTimeout.
      await fixture.actions.claimTimeout({ bondId: 1 });
      await claimAllRefunds(1);
      const b1 = await bond.bonds(1);
      expect(b1.settled).to.be.true;
    });
  });

  // -------------------------------------------------------------------------
  // rejectBond after partial poster wins
  // -------------------------------------------------------------------------

  describe("rejectBond after partial poster wins (I-04)", function () {
    it("refunds only remaining challengers after partial poster wins", async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "C1");
      await bond.connect(challenger2).challenge(0, "C2");
      await bond.connect(challenger3).challenge(0, "C3");

      await advanceToRulingWindow();

      // Poster wins first challenge.
      await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });

      const posterBefore = await token.balanceOf(poster.address);
      const c1Before = await token.balanceOf(challenger1.address);
      const c2Before = await token.balanceOf(challenger2.address);
      const c3Before = await token.balanceOf(challenger3.address);
      const judgeBefore = await token.balanceOf(judgeAddr);

      // Judge rejects the rest.
      await fixture.actions.rejectBond();
      await claimAllRefunds();

      // Poster gets bondAmount back from rejection.
      expect(await token.balanceOf(poster.address) - posterBefore).to.equal(BOND_AMOUNT);

      // Challenger 1 already lost — gets nothing from rejection.
      expect(await token.balanceOf(challenger1.address) - c1Before).to.equal(0n);

      // Challengers 2 and 3 are refunded.
      expect(await token.balanceOf(challenger2.address) - c2Before).to.equal(CHALLENGE_AMOUNT);
      expect(await token.balanceOf(challenger3.address) - c3Before).to.equal(CHALLENGE_AMOUNT);

      // Judge gets no additional fee from rejection.
      expect(await token.balanceOf(judgeAddr) - judgeBefore).to.equal(0n);

      // Contract is empty.
      expect(await token.balanceOf(bondAddr)).to.equal(0n);
    });

    it("challenge statuses are correct after partial wins then rejection", async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "C1");
      await bond.connect(challenger2).challenge(0, "C2");

      await advanceToRulingWindow();
      await fixture.actions.ruleForPoster({ feeCharged: 0n });
      await fixture.actions.rejectBond();
      await claimAllRefunds();

      const [, status0] = await bond.getChallenge(0, 0);
      const [, status1] = await bond.getChallenge(0, 1);

      expect(status0).to.equal(2n); // lost
      expect(status1).to.equal(3n); // refunded
    });
  });

  // -------------------------------------------------------------------------
  // Challenge deadline boundary
  // -------------------------------------------------------------------------

  describe("Challenge deadline boundary", function () {
    it("challenge succeeds at exactly block.timestamp == deadline", async function () {
      const shortFixture = await deploySimpleBondV5FuzzFixture({
        deadlineLeadTime: ONE_DAY,
      });
      await shortFixture.actions.createBond();

      const d = shortFixture.defaults.deadline;
      // increaseTo(d) mines a block at d; the next tx mines at d+1.
      // Use d-1 so the challenge tx lands at exactly d.
      await time.increaseTo(d - 1);

      await expect(
        shortFixture.bond.connect(shortFixture.actors.challenger1).challenge(0, "At deadline")
      ).to.not.be.reverted;
    });

    it("challenge reverts at deadline + 1", async function () {
      const shortFixture = await deploySimpleBondV5FuzzFixture({
        deadlineLeadTime: ONE_DAY,
      });
      await shortFixture.actions.createBond();

      const d = shortFixture.defaults.deadline;
      await time.increaseTo(d + 1);

      await expect(
        shortFixture.bond.connect(shortFixture.actors.challenger1).challenge(0, "Too late")
      ).to.be.revertedWith("Past deadline");
    });
  });

  // -------------------------------------------------------------------------
  // Poster challenging own bond (I-03)
  // -------------------------------------------------------------------------

  describe("Poster as challenger (I-03)", function () {
    it("poster can challenge their own bond", async function () {
      await createDefaultBond();

      // Poster also acts as a challenger.
      await expect(
        bond.connect(poster).challenge(0, "Self-challenge")
      ).to.not.be.reverted;

      const [addr, status] = await bond.getChallenge(0, 0);
      expect(addr).to.equal(poster.address);
      expect(status).to.equal(0n);
    });

    it("token conservation holds when poster challenges own bond and wins", async function () {
      await createDefaultBond();
      await bond.connect(poster).challenge(0, "Self-challenge");

      const allAccounts = [poster, judgeOperator, challenger1, challenger2, outsider];
      async function totalHeld() {
        let sum = 0n;
        for (const a of allAccounts) sum += await token.balanceOf(a.address);
        sum += await token.balanceOf(judgeAddr);
        sum += await token.balanceOf(bondAddr);
        return sum;
      }

      const before = await totalHeld();

      await advanceToRulingWindow();
      await fixture.actions.ruleForPoster({ feeCharged: 0n });
      await advancePastDeadline();
      await bond.connect(poster).withdrawBond(0);

      expect(await totalHeld()).to.equal(before);
      expect(await token.balanceOf(bondAddr)).to.equal(0n);
    });
  });

  // -------------------------------------------------------------------------
  // ManualJudge fee custody (M-01)
  // -------------------------------------------------------------------------

  describe("ManualJudge fee custody (M-01)", function () {
    it("fees accumulate on ManualJudge and the operator can withdraw them", async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "C1");
      await bond.connect(challenger2).challenge(0, "C2");

      await advanceToRulingWindow();

      const judgeBefore = await token.balanceOf(judgeAddr);

      await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });
      await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });

      const judgeAfter = await token.balanceOf(judgeAddr);
      expect(judgeAfter - judgeBefore).to.equal(JUDGE_FEE * 2n);

      const operatorBefore = await token.balanceOf(judgeOperator.address);
      await expect(
        manualJudge.connect(judgeOperator).withdrawFees(
          await token.getAddress(),
          judgeOperator.address,
          JUDGE_FEE * 2n
        )
      ).to.emit(manualJudge, "FeesWithdrawn");

      expect(await token.balanceOf(judgeOperator.address) - operatorBefore).to.equal(JUDGE_FEE * 2n);
      expect(await token.balanceOf(judgeAddr)).to.equal(0n);
    });

    it("non-operators cannot withdraw ManualJudge fees", async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "C1");
      await advanceToRulingWindow();
      await fixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });

      await expect(
        manualJudge.connect(outsider).withdrawFees(
          await token.getAddress(),
          outsider.address,
          JUDGE_FEE
        )
      ).to.be.revertedWith("Only operator");
    });
  });

  // -------------------------------------------------------------------------
  // L-02: Timing parameter bounds
  // -------------------------------------------------------------------------

  describe("Timing parameter bounds (L-02)", function () {
    it("allows acceptanceDelay exactly at the configured maximum and rejects max + 1", async function () {
      const maxAcceptanceDelay = await bond.MAX_ACCEPTANCE_DELAY();

      await expect(
        fixture.actions.createBond({
          acceptanceDelay: maxAcceptanceDelay,
          metadata: "Max acceptance delay",
        })
      ).to.not.be.reverted;

      await expect(
        fixture.actions.createBond({
          acceptanceDelay: maxAcceptanceDelay + 1n,
          metadata: "Too much acceptance delay",
        })
      ).to.be.revertedWith("Acceptance delay too long");
    });

    it("allows rulingBuffer exactly at the configured maximum and rejects max + 1", async function () {
      const maxRulingBuffer = await bond.MAX_RULING_BUFFER();

      await expect(
        fixture.actions.createBond({
          rulingBuffer: maxRulingBuffer,
          metadata: "Max ruling buffer",
        })
      ).to.not.be.reverted;

      await expect(
        fixture.actions.createBond({
          rulingBuffer: maxRulingBuffer + 1n,
          metadata: "Too much ruling buffer",
        })
      ).to.be.revertedWith("Ruling buffer too long");
    });

    it("rejects deadlines that would make later window arithmetic unsafe", async function () {
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
  });

  // -------------------------------------------------------------------------
  // M-02: High challenge count refund batching
  // -------------------------------------------------------------------------

  describe("High challenge count refund batching (M-02)", function () {
    // These tests use a moderate count (50-100) to verify the loop works
    // without hitting CI timeouts. A real gas-limit test would need 800+
    // challenges but is too slow for automated test suites.

    it("refunds 50 challengers via concede without reverting", async function () {
      this.timeout(120_000);

      const signers = await ethers.getSigners();
      // We need many challengers — use all available signers beyond the
      // first two (poster + judge operator).
      const challengerCount = Math.min(50, signers.length - 3);
      if (challengerCount < 10) this.skip();

      const manyFixture = await deploySimpleBondV5FuzzFixture({
        challengers: signers.slice(2, 2 + challengerCount),
      });

      await manyFixture.actions.createBond();

      for (let i = 0; i < challengerCount; i++) {
        await manyFixture.actions.challenge({
          challenger: manyFixture.actors.challengers[i],
          metadata: `C${i}`,
        });
      }

      // Concede now only enables refund claims.
      await expect(
        manyFixture.actions.concede({ metadata: "Mass refund" })
      ).to.not.be.reverted;

      expect(await manyFixture.bond.refundCursor(0)).to.equal(0n);
      expect(await manyFixture.bond.refundEnd(0)).to.equal(BigInt(challengerCount));

      await expect(
        manyFixture.actions.claimAllRefunds({ maxCountPerTx: 7 })
      ).to.not.be.reverted;

      const contractBalance = await manyFixture.token.balanceOf(
        await manyFixture.bond.getAddress()
      );
      expect(contractBalance).to.equal(0n);
    });

    it("refunds 50 challengers via claimTimeout without reverting", async function () {
      this.timeout(120_000);

      const signers = await ethers.getSigners();
      const challengerCount = Math.min(50, signers.length - 3);
      if (challengerCount < 10) this.skip();

      const manyFixture = await deploySimpleBondV5FuzzFixture({
        challengers: signers.slice(2, 2 + challengerCount),
      });

      await manyFixture.actions.createBond();

      for (let i = 0; i < challengerCount; i++) {
        await manyFixture.actions.challenge({
          challenger: manyFixture.actors.challengers[i],
          metadata: `C${i}`,
        });
      }

      await manyFixture.actions.advancePastRulingDeadline();
      await expect(
        manyFixture.actions.claimTimeout()
      ).to.not.be.reverted;

      await expect(
        manyFixture.actions.claimAllRefunds({ maxCountPerTx: 9 })
      ).to.not.be.reverted;

      const contractBalance = await manyFixture.token.balanceOf(
        await manyFixture.bond.getAddress()
      );
      expect(contractBalance).to.equal(0n);
    });

    it("ruleForChallenger refunds remaining challengers after partial poster wins", async function () {
      this.timeout(120_000);

      const signers = await ethers.getSigners();
      const challengerCount = Math.min(20, signers.length - 3);
      if (challengerCount < 5) this.skip();

      const manyFixture = await deploySimpleBondV5FuzzFixture({
        challengers: signers.slice(2, 2 + challengerCount),
      });

      await manyFixture.actions.createBond();

      for (let i = 0; i < challengerCount; i++) {
        await manyFixture.actions.challenge({
          challenger: manyFixture.actors.challengers[i],
          metadata: `C${i}`,
        });
      }

      await manyFixture.actions.advanceToRulingWindow();

      // Win the first 3 challenges.
      for (let i = 0; i < 3; i++) {
        await manyFixture.actions.ruleForPoster({ feeCharged: JUDGE_FEE });
      }

      // Challenger wins #4 — triggers refund of the remaining queue.
      await expect(
        manyFixture.actions.ruleForChallenger({ feeCharged: JUDGE_FEE })
      ).to.not.be.reverted;

      await expect(
        manyFixture.actions.claimAllRefunds({ maxCountPerTx: 4 })
      ).to.not.be.reverted;

      const contractBalance = await manyFixture.token.balanceOf(
        await manyFixture.bond.getAddress()
      );
      expect(contractBalance).to.equal(0n);
    });
  });

  // -------------------------------------------------------------------------
  // Concession window boundary (validates V5 fix from V4)
  // -------------------------------------------------------------------------

  describe("Concession window boundary precision", function () {
    it("concession succeeds one second before the deadline and fails at it", async function () {
      // Use a short deadline so the test runs quickly and concessionDeadline
      // equals deadline (no late-challenge extension).
      const shortFixture = await deploySimpleBondV5FuzzFixture({
        deadlineLeadTime: ONE_DAY,
        acceptanceDelay: 0,
      });
      await shortFixture.actions.createBond();
      await shortFixture.actions.challenge({
        challenger: shortFixture.actors.challenger1,
        metadata: "Early",
      });

      const cd = Number(await shortFixture.bond.concessionDeadline(0));

      // increaseTo(cd - 2) mines a block at cd-2; the concede tx mines at
      // cd-1, satisfying block.timestamp < concessionDeadline.
      await time.increaseTo(cd - 2);

      await expect(
        shortFixture.bond.connect(shortFixture.actors.poster).concede(0, "Just in time")
      ).to.not.be.reverted;

      // Second fixture: advance to exactly the deadline.
      const shortFixture2 = await deploySimpleBondV5FuzzFixture({
        deadlineLeadTime: ONE_DAY,
        acceptanceDelay: 0,
      });
      await shortFixture2.actions.createBond();
      await shortFixture2.actions.challenge({
        challenger: shortFixture2.actors.challenger1,
        metadata: "Early",
      });

      const cd2 = Number(await shortFixture2.bond.concessionDeadline(0));
      // increaseTo(cd2 - 1) mines at cd2-1; tx mines at cd2.
      // concede requires block.timestamp < cd2, so cd2 < cd2 is false → reverts.
      await time.increaseTo(cd2 - 1);

      await expect(
        shortFixture2.bond.connect(shortFixture2.actors.poster).concede(0, "Too late")
      ).to.be.revertedWith("Concession window closed");
    });
  });

  // -------------------------------------------------------------------------
  // Ruling window boundary precision
  // -------------------------------------------------------------------------

  describe("Ruling window boundary precision", function () {
    it("ruling succeeds at exactly the ruling deadline", async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "Edge");

      const rd = Number(await bond.rulingDeadline(0));
      // increaseTo(rd - 1) so the ruling tx mines at exactly rd.
      await time.increaseTo(rd - 1);

      // Should succeed at exactly the deadline (<=).
      await expect(
        fixture.actions.ruleForPoster({ feeCharged: 0n })
      ).to.not.be.reverted;
    });

    it("ruling fails one second after the ruling deadline", async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "Edge");

      const rd = Number(await bond.rulingDeadline(0));
      await time.increaseTo(rd);

      await expect(
        manualJudge.connect(judgeOperator).ruleForPoster(bondAddr, 0, 0n)
      ).to.be.revertedWith("Past ruling deadline");
    });

    it("timeout fails at exactly the ruling deadline and succeeds one second after", async function () {
      await createDefaultBond();
      await bond.connect(challenger1).challenge(0, "Edge");

      const rd = Number(await bond.rulingDeadline(0));
      // increaseTo(rd - 1) so the timeout tx mines at rd.
      // claimTimeout requires block.timestamp > rulingDeadline (strict).
      await time.increaseTo(rd - 1);

      await expect(
        bond.connect(outsider).claimTimeout(0)
      ).to.be.revertedWith("Before ruling deadline");

      // The previous failed tx still mined a block at rd.
      // The next tx mines at rd + 1, which is > rd → succeeds.
      await expect(
        bond.connect(outsider).claimTimeout(0)
      ).to.not.be.reverted;
    });
  });
});
