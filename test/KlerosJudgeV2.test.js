const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// --- Constants -----------------------------------------------------------

const BOND_AMOUNT = ethers.parseEther("10000");
const CHALLENGE_AMOUNT = ethers.parseEther("3000");
const JUDGE_FEE = ethers.parseEther("500");
const ACCEPTANCE_DELAY = 3 * 86400;           // 3 days
const RULING_BUFFER = 90 * 86400;             // 90 days (long for Kleros)
const ARBITRATION_COST = ethers.parseEther("0.05"); // 0.05 xDAI
const GRACE_PERIOD = 3 * 86400;              // 3 days

const ONE_DAY = 86400;
const ONE_MONTH = 30 * ONE_DAY;

describe("KlerosJudgeV2", function () {
  let bond, token, mockArbitrator, klerosJudgeV2;
  let poster, challenger1, challenger2, outsider, owner, keeper;
  let deadline;
  let tokenAddr, klerosJudgeV2Addr;

  async function deployFixture() {
    [owner, poster, challenger1, challenger2, outsider, keeper] = await ethers.getSigners();

    // Deploy TestToken
    const Token = await ethers.getContractFactory("TestToken");
    token = await Token.deploy();
    tokenAddr = await token.getAddress();

    // Deploy SimpleBondV4
    const Bond = await ethers.getContractFactory("SimpleBondV4");
    bond = await Bond.deploy();

    // Deploy MockArbitrator
    const MockArbitrator = await ethers.getContractFactory("MockArbitrator");
    mockArbitrator = await MockArbitrator.deploy(ARBITRATION_COST);

    // Deploy KlerosJudgeV2
    const KlerosJudgeV2 = await ethers.getContractFactory("KlerosJudgeV2");
    klerosJudgeV2 = await KlerosJudgeV2.connect(owner).deploy(
      await mockArbitrator.getAddress(),
      await bond.getAddress(),
      "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003",
      GRACE_PERIOD,
      "/ipfs/QmMetaEvidenceV2"
    );
    klerosJudgeV2Addr = await klerosJudgeV2.getAddress();

    // Mint tokens to participants
    for (const acct of [poster, challenger1, challenger2]) {
      await token.mint(acct.address, ethers.parseEther("100000"));
      await token.connect(acct).approve(await bond.getAddress(), ethers.MaxUint256);
    }

    deadline = (await time.latest()) + 3 * ONE_MONTH;
  }

  async function createDefaultBond() {
    await bond.connect(poster).createBond(
      tokenAddr,
      BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
      klerosJudgeV2Addr,
      deadline, ACCEPTANCE_DELAY, RULING_BUFFER,
      "My article has no significant errors"
    );
    return 0;
  }

  async function challengeBond(bondId, challenger) {
    await bond.connect(challenger).challenge(bondId, "I found errors");
  }

  async function advanceToRulingWindow(bondId = 0) {
    const start = await bond.rulingWindowStart(bondId);
    await time.increaseTo(start);
  }

  async function advancePastRulingDeadline(bondId = 0) {
    const end = await bond.rulingDeadline(bondId);
    await time.increaseTo(Number(end) + 1);
  }

  async function advancePastGrace() {
    await time.increase(GRACE_PERIOD + 1);
  }

  beforeEach(async function () {
    await deployFixture();
  });

  // =====================================================================
  // 1. DEPLOYMENT & REGISTRATION
  // =====================================================================
  describe("Deployment", function () {

    it("registers as judge in SimpleBondV4 on deployment", async function () {
      const info = await bond.judges(klerosJudgeV2Addr);
      expect(info).to.equal(true);
    });

    it("stores immutables correctly", async function () {
      expect(await klerosJudgeV2.arbitrator()).to.equal(
        await mockArbitrator.getAddress()
      );
      expect(await klerosJudgeV2.simpleBond()).to.equal(
        await bond.getAddress()
      );
      expect(await klerosJudgeV2.ownerGracePeriod()).to.equal(GRACE_PERIOD);
      expect(await klerosJudgeV2.owner()).to.equal(owner.address);
    });

    it("emits MetaEvidence on deployment", async function () {
      const KlerosJudgeV2 = await ethers.getContractFactory("KlerosJudgeV2");
      const newJudge = await KlerosJudgeV2.connect(owner).deploy(
        await mockArbitrator.getAddress(),
        await bond.getAddress(),
        "0x",
        GRACE_PERIOD,
        "/ipfs/QmTest123"
      );
      const tx = newJudge.deploymentTransaction();
      await expect(tx).to.emit(newJudge, "MetaEvidence").withArgs(0, "/ipfs/QmTest123");
    });

    it("reverts on zero arbitrator address", async function () {
      const KlerosJudgeV2 = await ethers.getContractFactory("KlerosJudgeV2");
      await expect(
        KlerosJudgeV2.deploy(ethers.ZeroAddress, await bond.getAddress(), "0x", GRACE_PERIOD, "")
      ).to.be.revertedWith("Zero arbitrator");
    });

    it("reverts on zero simpleBond address", async function () {
      const KlerosJudgeV2 = await ethers.getContractFactory("KlerosJudgeV2");
      await expect(
        KlerosJudgeV2.deploy(await mockArbitrator.getAddress(), ethers.ZeroAddress, "0x", GRACE_PERIOD, "")
      ).to.be.revertedWith("Zero simpleBond");
    });
  });

  // =====================================================================
  // 2. PRE-FUNDING
  // =====================================================================
  describe("Pre-Funding", function () {

    it("fundBond increments balance", async function () {
      const amount = ethers.parseEther("0.1");
      await klerosJudgeV2.connect(outsider).fundBond(0, { value: amount });
      expect(await klerosJudgeV2.bondXdaiBalance(0)).to.equal(amount);
    });

    it("fundBond reverts on zero value", async function () {
      await expect(
        klerosJudgeV2.connect(outsider).fundBond(0, { value: 0 })
      ).to.be.revertedWith("Zero value");
    });

    it("multiple funders are additive", async function () {
      const a1 = ethers.parseEther("0.02");
      const a2 = ethers.parseEther("0.03");
      await klerosJudgeV2.connect(outsider).fundBond(0, { value: a1 });
      await klerosJudgeV2.connect(keeper).fundBond(0, { value: a2 });
      expect(await klerosJudgeV2.bondXdaiBalance(0)).to.equal(a1 + a2);
    });

    it("owner can withdraw pre-funded balance", async function () {
      const amount = ethers.parseEther("0.1");
      await klerosJudgeV2.connect(outsider).fundBond(0, { value: amount });

      const balBefore = await ethers.provider.getBalance(owner.address);
      const tx = await klerosJudgeV2.connect(owner).withdrawBondFunding(0);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(owner.address);

      expect(balAfter - balBefore + gasUsed).to.equal(amount);
      expect(await klerosJudgeV2.bondXdaiBalance(0)).to.equal(0);
    });
  });

  // =====================================================================
  // 3. GRACE PERIOD
  // =====================================================================
  describe("Grace Period", function () {

    it("owner can trigger within grace period", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      // Within grace — owner can trigger
      const tx = await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });
      await expect(tx).to.emit(klerosJudgeV2, "ArbitrationTriggered");
    });

    it("non-owner reverts within grace period", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      await expect(
        klerosJudgeV2.connect(outsider).triggerArbitration(bondId, {
          value: ARBITRATION_COST,
        })
      ).to.be.revertedWith("Owner grace period active");
    });

    it("anyone can trigger after grace period", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      await advancePastGrace();

      const tx = await klerosJudgeV2.connect(outsider).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });
      await expect(tx).to.emit(klerosJudgeV2, "ArbitrationTriggered");
    });

    it("owner still works after grace period", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      await advancePastGrace();

      const tx = await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });
      await expect(tx).to.emit(klerosJudgeV2, "ArbitrationTriggered");
    });
  });

  // =====================================================================
  // 4. TRIGGER — xDAI SOURCES
  // =====================================================================
  describe("triggerArbitration — xDAI sources", function () {

    it("pre-funded balance covers cost → funder=owner", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      // Pre-fund with enough
      await klerosJudgeV2.connect(outsider).fundBond(bondId, { value: ARBITRATION_COST });

      // Owner triggers within grace, no msg.value needed
      const tx = await klerosJudgeV2.connect(owner).triggerArbitration(bondId);
      await expect(tx).to.emit(klerosJudgeV2, "ArbitrationTriggered")
        .withArgs(bondId, 0, 0, owner.address);

      const d = await klerosJudgeV2.getBondDispute(bondId, 0);
      expect(d.funder).to.equal(owner.address);

      // Pre-funded balance should be depleted
      expect(await klerosJudgeV2.bondXdaiBalance(bondId)).to.equal(0);
    });

    it("msg.value within grace → funder=owner", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      const tx = await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      const d = await klerosJudgeV2.getBondDispute(bondId, 0);
      expect(d.funder).to.equal(owner.address);
    });

    it("msg.value after grace → funder=caller", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      await advancePastGrace();

      await klerosJudgeV2.connect(keeper).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      const d = await klerosJudgeV2.getBondDispute(bondId, 0);
      expect(d.funder).to.equal(keeper.address);
    });

    it("insufficient funds reverts", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      await expect(
        klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
          value: ARBITRATION_COST - 1n,
        })
      ).to.be.revertedWith("Insufficient funds");
    });

    it("combined pre-funded + msg.value → funder=owner", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      const half = ARBITRATION_COST / 2n;
      await klerosJudgeV2.connect(outsider).fundBond(bondId, { value: half });

      // Owner provides the rest
      const tx = await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST - half,
      });

      const d = await klerosJudgeV2.getBondDispute(bondId, 0);
      expect(d.funder).to.equal(owner.address);

      // Pre-funded balance should be zero
      expect(await klerosJudgeV2.bondXdaiBalance(bondId)).to.equal(0);
    });

    it("excess msg.value is refunded", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      const excess = ethers.parseEther("1");
      const balBefore = await ethers.provider.getBalance(owner.address);

      const tx = await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST + excess,
      });
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const balAfter = await ethers.provider.getBalance(owner.address);
      const spent = balBefore - balAfter;
      expect(spent).to.equal(ARBITRATION_COST + gasUsed);
    });
  });

  // =====================================================================
  // 5. TRIGGER — VALIDATION
  // =====================================================================
  describe("triggerArbitration — validation", function () {

    it("reverts if bond not judged by this adapter", async function () {
      await bond.connect(outsider).registerAsJudge();
      await bond.connect(outsider).setJudgeFee(tokenAddr, JUDGE_FEE);
      await bond.connect(poster).createBond(
        tokenAddr,
        BOND_AMOUNT, CHALLENGE_AMOUNT, JUDGE_FEE,
        outsider.address,
        deadline, ACCEPTANCE_DELAY, RULING_BUFFER,
        "Different judge bond"
      );
      await bond.connect(challenger1).challenge(0, "Challenge it");

      await expect(
        klerosJudgeV2.connect(owner).triggerArbitration(0, {
          value: ARBITRATION_COST,
        })
      ).to.be.revertedWith("Not judge for this bond");
    });

    it("reverts if no pending challenge", async function () {
      const bondId = await createDefaultBond();

      await expect(
        klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
          value: ARBITRATION_COST,
        })
      ).to.be.revertedWith("No pending challenge");
    });

    it("reverts if dispute already exists", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      await expect(
        klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
          value: ARBITRATION_COST,
        })
      ).to.be.revertedWith("Dispute already exists");
    });

    it("reverts if bond already settled", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      // Settle via concede (sets both conceded and settled)
      await bond.connect(poster).concede(bondId, "I give up");

      await expect(
        klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
          value: ARBITRATION_COST,
        })
      ).to.be.revertedWith("Bond already settled");
    });

    it("reverts if bond conceded", async function () {
      const bondId = await createDefaultBond();
      // Must challenge first so concede doesn't revert
      await challengeBond(bondId, challenger1);
      await bond.connect(poster).concede(bondId, "Conceding");

      await expect(
        klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
          value: ARBITRATION_COST,
        })
      ).to.be.revertedWith("Bond already settled");
    });
  });

  // =====================================================================
  // 6. RULING DELIVERY (rule)
  // =====================================================================
  describe("rule", function () {

    it("only arbitrator can call rule", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      await expect(
        klerosJudgeV2.connect(outsider).rule(0, 1)
      ).to.be.revertedWith("Only arbitrator");
    });

    it("arbitrator stores ruling correctly", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      await mockArbitrator.giveRuling(0, 2); // challenger wins

      const d = await klerosJudgeV2.getBondDispute(bondId, 0);
      expect(d.status).to.equal(2); // Ruled
      expect(d.ruling).to.equal(2);
    });

    it("reverts if dispute not active", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      await mockArbitrator.giveRuling(0, 1);

      // Try to rule again
      await expect(
        mockArbitrator.giveRuling(0, 2)
      ).to.be.revertedWith("Already ruled");
    });
  });

  // =====================================================================
  // 7. EXECUTE RULING — CHALLENGER WINS
  // =====================================================================
  describe("executeRuling — challenger wins", function () {

    it("ruling 2 calls ruleForChallenger, challenger gets funds", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      await mockArbitrator.giveRuling(0, 2);
      await advanceToRulingWindow(bondId);

      const balBefore = await token.balanceOf(challenger1.address);
      await klerosJudgeV2.connect(outsider).executeRuling(bondId, 0);
      const balAfter = await token.balanceOf(challenger1.address);

      const pot = BOND_AMOUNT + CHALLENGE_AMOUNT;
      const expected = pot - JUDGE_FEE;
      expect(balAfter - balBefore).to.equal(expected);

      // Bond should be settled
      const b = await bond.bonds(bondId);
      expect(b.settled).to.equal(true);

      // Dispute should be Executed
      const d = await klerosJudgeV2.getBondDispute(bondId, 0);
      expect(d.status).to.equal(3); // Executed
    });
  });

  // =====================================================================
  // 8. EXECUTE RULING — POSTER WINS
  // =====================================================================
  describe("executeRuling — poster wins", function () {

    it("ruling 1 calls ruleForPoster, queue advances", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      await mockArbitrator.giveRuling(0, 1);
      await advanceToRulingWindow(bondId);

      const posterBalBefore = await token.balanceOf(poster.address);
      await klerosJudgeV2.connect(outsider).executeRuling(bondId, 0);
      const posterBalAfter = await token.balanceOf(poster.address);

      const expected = CHALLENGE_AMOUNT - JUDGE_FEE;
      expect(posterBalAfter - posterBalBefore).to.equal(expected);

      // Bond should NOT be settled (queue advances)
      const b = await bond.bonds(bondId);
      expect(b.settled).to.equal(false);
      expect(b.currentChallenge).to.equal(1);
    });
  });

  // =====================================================================
  // 9. EXECUTE RULING — REFUSED (0)
  // =====================================================================
  describe("executeRuling — refused to arbitrate", function () {

    it("ruling 0 calls rejectBond, everyone refunded", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      await mockArbitrator.giveRuling(0, 0);
      await advanceToRulingWindow(bondId);

      const posterBefore = await token.balanceOf(poster.address);
      const challengerBefore = await token.balanceOf(challenger1.address);

      await klerosJudgeV2.connect(outsider).executeRuling(bondId, 0);

      const posterAfter = await token.balanceOf(poster.address);
      const challengerAfter = await token.balanceOf(challenger1.address);

      expect(posterAfter - posterBefore).to.equal(BOND_AMOUNT);
      expect(challengerAfter - challengerBefore).to.equal(CHALLENGE_AMOUNT);

      const b = await bond.bonds(bondId);
      expect(b.settled).to.equal(true);
    });
  });

  // =====================================================================
  // 10. EXECUTE RULING — TIMING
  // =====================================================================
  describe("executeRuling — timing", function () {

    it("reverts before ruling window opens", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });
      await mockArbitrator.giveRuling(0, 2);

      await expect(
        klerosJudgeV2.connect(outsider).executeRuling(bondId, 0)
      ).to.be.revertedWith("Before ruling window");
    });

    it("reverts after ruling deadline", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });
      await mockArbitrator.giveRuling(0, 2);
      await advancePastRulingDeadline(bondId);

      await expect(
        klerosJudgeV2.connect(outsider).executeRuling(bondId, 0)
      ).to.be.revertedWith("Past ruling deadline");
    });
  });

  // =====================================================================
  // 11. FEE CLAIMING
  // =====================================================================
  describe("Fee Claiming", function () {

    it("funder claims ERC-20 fee after execution", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });
      await mockArbitrator.giveRuling(0, 1); // poster wins
      await advanceToRulingWindow(bondId);
      await klerosJudgeV2.connect(outsider).executeRuling(bondId, 0);

      // Judge fee should be in the adapter contract
      const adapterBal = await token.balanceOf(klerosJudgeV2Addr);
      expect(adapterBal).to.equal(JUDGE_FEE);

      // Owner (funder) claims
      const balBefore = await token.balanceOf(owner.address);
      await klerosJudgeV2.connect(owner).claimFee(bondId, 0);
      const balAfter = await token.balanceOf(owner.address);

      expect(balAfter - balBefore).to.equal(JUDGE_FEE);

      // Adapter balance should be zero
      expect(await token.balanceOf(klerosJudgeV2Addr)).to.equal(0);
    });

    it("reverts if not funder", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });
      await mockArbitrator.giveRuling(0, 2);
      await advanceToRulingWindow(bondId);
      await klerosJudgeV2.connect(outsider).executeRuling(bondId, 0);

      await expect(
        klerosJudgeV2.connect(outsider).claimFee(bondId, 0)
      ).to.be.revertedWith("Only funder");
    });

    it("reverts if already claimed", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });
      await mockArbitrator.giveRuling(0, 1);
      await advanceToRulingWindow(bondId);
      await klerosJudgeV2.connect(outsider).executeRuling(bondId, 0);

      await klerosJudgeV2.connect(owner).claimFee(bondId, 0);

      await expect(
        klerosJudgeV2.connect(owner).claimFee(bondId, 0)
      ).to.be.revertedWith("Already claimed");
    });

    it("reverts if refused ruling (no fee)", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });
      await mockArbitrator.giveRuling(0, 0); // refused
      await advanceToRulingWindow(bondId);
      await klerosJudgeV2.connect(outsider).executeRuling(bondId, 0);

      await expect(
        klerosJudgeV2.connect(owner).claimFee(bondId, 0)
      ).to.be.revertedWith("Refused ruling, no fee");
    });

    it("correct token and amount transferred", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      // After grace, keeper triggers and becomes funder
      await advancePastGrace();
      await klerosJudgeV2.connect(keeper).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      await mockArbitrator.giveRuling(0, 2); // challenger wins
      await advanceToRulingWindow(bondId);
      await klerosJudgeV2.connect(outsider).executeRuling(bondId, 0);

      // Keeper claims
      const keeperBefore = await token.balanceOf(keeper.address);
      const tx = await klerosJudgeV2.connect(keeper).claimFee(bondId, 0);

      await expect(tx).to.emit(klerosJudgeV2, "FeeClaimed")
        .withArgs(bondId, 0, keeper.address, tokenAddr, JUDGE_FEE);

      const keeperAfter = await token.balanceOf(keeper.address);
      expect(keeperAfter - keeperBefore).to.equal(JUDGE_FEE);
    });
  });

  // =====================================================================
  // 12. EVIDENCE
  // =====================================================================
  describe("submitEvidence", function () {

    it("anyone can submit evidence for active dispute", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      const tx = klerosJudgeV2.connect(outsider).submitEvidence(
        bondId, 0, "/ipfs/QmEvidence1"
      );
      await expect(tx).to.emit(klerosJudgeV2, "Evidence");
    });

    it("reverts if no dispute exists", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      await expect(
        klerosJudgeV2.connect(poster).submitEvidence(bondId, 0, "/ipfs/QmEvidence")
      ).to.be.revertedWith("No dispute for this challenge");
    });

    it("reverts if dispute not active", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });
      await mockArbitrator.giveRuling(0, 1);

      await expect(
        klerosJudgeV2.connect(poster).submitEvidence(bondId, 0, "/ipfs/QmLate")
      ).to.be.revertedWith("Dispute not active");
    });
  });

  // =====================================================================
  // 13. OWNER FUNCTIONS
  // =====================================================================
  describe("Owner functions", function () {

    it("owner can transfer ownership", async function () {
      await klerosJudgeV2.connect(owner).transferOwnership(outsider.address);
      expect(await klerosJudgeV2.owner()).to.equal(outsider.address);

      // Old owner can no longer call owner functions
      await expect(
        klerosJudgeV2.connect(owner).withdrawBondFunding(0)
      ).to.be.revertedWith("Only owner");
    });

    it("no updateArbitratorExtraData function exists", async function () {
      // Verify the function does not exist on the contract
      expect(klerosJudgeV2.updateArbitratorExtraData).to.be.undefined;
    });
  });

  // =====================================================================
  // 14. VIEW FUNCTIONS
  // =====================================================================
  describe("View functions", function () {

    it("getArbitrationCost returns current cost", async function () {
      const cost = await klerosJudgeV2.getArbitrationCost();
      expect(cost).to.equal(ARBITRATION_COST);
    });

    it("isWithinGracePeriod returns correct value", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      expect(await klerosJudgeV2.isWithinGracePeriod(bondId)).to.equal(true);

      await advancePastGrace();

      expect(await klerosJudgeV2.isWithinGracePeriod(bondId)).to.equal(false);
    });
  });

  // =====================================================================
  // 15. MULTI-CHALLENGE SCENARIO
  // =====================================================================
  describe("Multiple challenges with separate disputes", function () {

    it("separate disputes per challenge index", async function () {
      const bondId = await createDefaultBond();

      // Two challengers
      await challengeBond(bondId, challenger1);
      await challengeBond(bondId, challenger2);

      // Trigger arbitration for first challenge
      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      // Kleros rules: poster wins first challenge
      await mockArbitrator.giveRuling(0, 1);
      await advanceToRulingWindow(bondId);
      await klerosJudgeV2.connect(outsider).executeRuling(bondId, 0);

      // Bond not settled, currentChallenge advanced to 1
      const b = await bond.bonds(bondId);
      expect(b.settled).to.equal(false);
      expect(b.currentChallenge).to.equal(1);

      // Trigger arbitration for second challenge
      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      // Second dispute has ID 1
      const d = await klerosJudgeV2.getBondDispute(bondId, 1);
      expect(d.disputeId).to.equal(1);
      expect(d.status).to.equal(1); // Active

      expect(await klerosJudgeV2.hasDispute(bondId, 1)).to.equal(true);
    });

    it("independent fee claims per challenge", async function () {
      const bondId = await createDefaultBond();

      await challengeBond(bondId, challenger1);
      await challengeBond(bondId, challenger2);

      // First challenge — poster wins
      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });
      await mockArbitrator.giveRuling(0, 1);
      await advanceToRulingWindow(bondId);
      await klerosJudgeV2.connect(outsider).executeRuling(bondId, 0);

      // Claim fee for first challenge
      await klerosJudgeV2.connect(owner).claimFee(bondId, 0);
      const bal1 = await token.balanceOf(owner.address);

      // Second challenge — challenger wins
      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });
      await mockArbitrator.giveRuling(1, 2);

      // For the second ruling window, time may already be past the start
      // (since we advanced for the first ruling). Check and only advance if needed.
      const rwStart2 = await bond.rulingWindowStart(bondId);
      const now2 = await time.latest();
      if (now2 < rwStart2) {
        await time.increaseTo(rwStart2);
      }
      await klerosJudgeV2.connect(outsider).executeRuling(bondId, 1);

      // Claim fee for second challenge
      await klerosJudgeV2.connect(owner).claimFee(bondId, 1);
      const bal2 = await token.balanceOf(owner.address);

      expect(bal2 - bal1).to.equal(JUDGE_FEE);
    });
  });

  // =====================================================================
  // 16. TIMEOUT FALLBACK
  // =====================================================================
  describe("Timeout fallback", function () {

    it("claimTimeout still works if ruling not executed in time", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      await klerosJudgeV2.connect(owner).triggerArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      await advancePastRulingDeadline(bondId);

      const posterBefore = await token.balanceOf(poster.address);
      const challengerBefore = await token.balanceOf(challenger1.address);

      await bond.connect(outsider).claimTimeout(bondId);

      const posterAfter = await token.balanceOf(poster.address);
      const challengerAfter = await token.balanceOf(challenger1.address);

      expect(posterAfter - posterBefore).to.equal(BOND_AMOUNT);
      expect(challengerAfter - challengerBefore).to.equal(CHALLENGE_AMOUNT);
    });
  });
});
