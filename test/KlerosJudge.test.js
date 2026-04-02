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

const ONE_DAY = 86400;
const ONE_MONTH = 30 * ONE_DAY;

describe("KlerosJudge", function () {
  let bond, token, mockArbitrator, klerosJudge;
  let poster, challenger1, challenger2, outsider, owner;
  let deadline;
  let tokenAddr, klerosJudgeAddr;

  async function deployFixture() {
    [owner, poster, challenger1, challenger2, outsider] = await ethers.getSigners();

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

    // Deploy KlerosJudge (registers itself as judge in SimpleBondV4)
    const KlerosJudge = await ethers.getContractFactory("KlerosJudge");
    klerosJudge = await KlerosJudge.connect(owner).deploy(
      await mockArbitrator.getAddress(),
      await bond.getAddress(),
      "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003",
      "/ipfs/QmMetaEvidence"
    );
    klerosJudgeAddr = await klerosJudge.getAddress();

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
      klerosJudgeAddr,
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

  beforeEach(async function () {
    await deployFixture();
  });

  // =====================================================================
  // 0. PUBLIC ABI SURFACE
  // =====================================================================
  describe("Public ABI surface", function () {

    it("keeps the expected public and external function signatures", async function () {
      const signatures = klerosJudge.interface.fragments
        .filter((fragment) => fragment.type === "function")
        .map((fragment) => fragment.format("minimal"))
        .sort();

      expect(signatures).to.deep.equal([
        "function RULING_CHALLENGER() view returns (uint256)",
        "function RULING_CHOICES() view returns (uint256)",
        "function RULING_POSTER() view returns (uint256)",
        "function arbitrator() view returns (address)",
        "function arbitratorExtraData() view returns (bytes)",
        "function bondChallengeToDispute(uint256,uint256) view returns (uint256)",
        "function disputes(uint256) view returns (uint256,uint256,address,uint8,uint256)",
        "function executeRuling(uint256)",
        "function getArbitrationCost() view returns (uint256)",
        "function hasDispute(uint256,uint256) view returns (bool)",
        "function owner() view returns (address)",
        "function requestArbitration(uint256) payable returns (uint256)",
        "function rule(uint256,uint256)",
        "function simpleBond() view returns (address)",
        "function submitEvidence(uint256,uint256,string)",
        "function transferOwnership(address)",
        "function updateArbitratorExtraData(bytes)",
        "function withdrawFees(address,address,uint256)",
      ]);
    });
  });

  // =====================================================================
  // 1. DEPLOYMENT & REGISTRATION
  // =====================================================================
  describe("Deployment", function () {

    it("registers as judge in SimpleBondV4 on deployment", async function () {
      const info = await bond.judges(klerosJudgeAddr);
      expect(info).to.equal(true);
    });

    it("stores immutables correctly", async function () {
      expect(await klerosJudge.arbitrator()).to.equal(
        await mockArbitrator.getAddress()
      );
      expect(await klerosJudge.simpleBond()).to.equal(
        await bond.getAddress()
      );
      expect(await klerosJudge.owner()).to.equal(owner.address);
    });

    it("emits MetaEvidence on deployment", async function () {
      const KlerosJudge = await ethers.getContractFactory("KlerosJudge");
      const newJudge = await KlerosJudge.connect(owner).deploy(
        await mockArbitrator.getAddress(),
        await bond.getAddress(),
        "0x",
        "/ipfs/QmTest123"
      );
      const tx = newJudge.deploymentTransaction();
      await expect(tx).to.emit(newJudge, "MetaEvidence").withArgs(0, "/ipfs/QmTest123");
    });

    it("reverts on zero arbitrator address", async function () {
      const KlerosJudge = await ethers.getContractFactory("KlerosJudge");
      await expect(
        KlerosJudge.deploy(ethers.ZeroAddress, await bond.getAddress(), "0x", "")
      ).to.be.revertedWith("Zero arbitrator");
    });

    it("reverts on zero simpleBond address", async function () {
      const KlerosJudge = await ethers.getContractFactory("KlerosJudge");
      await expect(
        KlerosJudge.deploy(await mockArbitrator.getAddress(), ethers.ZeroAddress, "0x", "")
      ).to.be.revertedWith("Zero simpleBond");
    });
  });

  // =====================================================================
  // 2. BOND CREATION WITH KLEROS JUDGE
  // =====================================================================
  describe("Bond creation with KlerosJudge", function () {

    it("allows creating a bond with KlerosJudge as judge", async function () {
      const bondId = await createDefaultBond();
      const b = await bond.bonds(bondId);
      expect(b.judge).to.equal(klerosJudgeAddr);
    });
  });

  // =====================================================================
  // 3. REQUEST ARBITRATION
  // =====================================================================
  describe("requestArbitration", function () {

    it("poster can request arbitration after challenge", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      const tx = await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      await expect(tx)
        .to.emit(klerosJudge, "ArbitrationRequested")
        .withArgs(bondId, 0, 0, poster.address);

      // Verify dispute stored
      const d = await klerosJudge.disputes(0);
      expect(d.bondId).to.equal(bondId);
      expect(d.challengeIndex).to.equal(0);
      expect(d.requester).to.equal(poster.address);
      expect(d.status).to.equal(1); // Active
    });

    it("challenger can request arbitration", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      await klerosJudge.connect(challenger1).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      const d = await klerosJudge.disputes(0);
      expect(d.requester).to.equal(challenger1.address);
    });

    it("reverts if not poster or challenger", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      await expect(
        klerosJudge.connect(outsider).requestArbitration(bondId, {
          value: ARBITRATION_COST,
        })
      ).to.be.revertedWith("Only poster or challenger");
    });

    it("reverts if no pending challenge", async function () {
      const bondId = await createDefaultBond();

      await expect(
        klerosJudge.connect(poster).requestArbitration(bondId, {
          value: ARBITRATION_COST,
        })
      ).to.be.revertedWith("No pending challenge");
    });

    it("reverts if dispute already exists for this challenge", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      await expect(
        klerosJudge.connect(challenger1).requestArbitration(bondId, {
          value: ARBITRATION_COST,
        })
      ).to.be.revertedWith("Dispute already exists");
    });

    it("reverts if the bond is past ruling deadline", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await advancePastRulingDeadline(bondId);

      await expect(
        klerosJudge.connect(poster).requestArbitration(bondId, {
          value: ARBITRATION_COST,
        })
      ).to.be.revertedWith("Bond past ruling deadline");
    });

    it("reverts if insufficient arbitration fee", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      await expect(
        klerosJudge.connect(poster).requestArbitration(bondId, {
          value: ARBITRATION_COST - 1n,
        })
      ).to.be.revertedWith("Insufficient arbitration fee");
    });

    it("refunds excess ETH", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      const excess = ethers.parseEther("1");
      const balBefore = await ethers.provider.getBalance(poster.address);

      const tx = await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST + excess,
      });
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const balAfter = await ethers.provider.getBalance(poster.address);
      // Should only have paid ARBITRATION_COST + gas, not the excess
      const spent = balBefore - balAfter;
      expect(spent).to.equal(ARBITRATION_COST + gasUsed);
    });

    it("reverts if bond is not judged by this adapter", async function () {
      // Create a bond with a different judge (bondId = 0)
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
        klerosJudge.connect(poster).requestArbitration(0, {
          value: ARBITRATION_COST,
        })
      ).to.be.revertedWith("Not judge for this bond");
    });

    it("sets hasDispute and bondChallengeToDispute correctly", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      expect(await klerosJudge.hasDispute(bondId, 0)).to.equal(true);
      expect(await klerosJudge.bondChallengeToDispute(bondId, 0)).to.equal(0);
    });
  });

  // =====================================================================
  // 4. RULING DELIVERY (rule)
  // =====================================================================
  describe("rule", function () {

    it("only arbitrator can call rule", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      await expect(
        klerosJudge.connect(outsider).rule(0, 1)
      ).to.be.revertedWith("Only arbitrator");
    });

    it("arbitrator delivers ruling via MockArbitrator.giveRuling", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      await mockArbitrator.giveRuling(0, 2); // challenger wins

      const d = await klerosJudge.disputes(0);
      expect(d.status).to.equal(2); // Ruled
      expect(d.ruling).to.equal(2);
    });

    it("reverts if dispute not active", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      // Rule once
      await mockArbitrator.giveRuling(0, 1);

      // Try to rule again
      await expect(
        mockArbitrator.giveRuling(0, 2)
      ).to.be.revertedWith("Already ruled");
    });
  });

  // =====================================================================
  // 5. EXECUTE RULING — CHALLENGER WINS
  // =====================================================================
  describe("executeRuling — challenger wins", function () {

    it("ruling 2 calls ruleForChallenger, challenger gets funds", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      // Kleros rules: challenger wins
      await mockArbitrator.giveRuling(0, 2);

      // Advance to ruling window
      await advanceToRulingWindow(bondId);

      const balBefore = await token.balanceOf(challenger1.address);

      await klerosJudge.connect(outsider).executeRuling(0);

      const balAfter = await token.balanceOf(challenger1.address);
      const pot = BOND_AMOUNT + CHALLENGE_AMOUNT;
      const expected = pot - JUDGE_FEE;
      expect(balAfter - balBefore).to.equal(expected);

      // Bond should be settled
      const b = await bond.bonds(bondId);
      expect(b.settled).to.equal(true);

      // Dispute should be Executed
      const d = await klerosJudge.disputes(0);
      expect(d.status).to.equal(3); // Executed
    });

    it("emits RulingExecuted event", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });
      await mockArbitrator.giveRuling(0, 2);
      await advanceToRulingWindow(bondId);

      await expect(klerosJudge.connect(outsider).executeRuling(0))
        .to.emit(klerosJudge, "RulingExecuted")
        .withArgs(bondId, 0, 2);
    });
  });

  // =====================================================================
  // 6. EXECUTE RULING — POSTER WINS
  // =====================================================================
  describe("executeRuling — poster wins", function () {

    it("ruling 1 calls ruleForPoster, queue advances", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      await mockArbitrator.giveRuling(0, 1);
      await advanceToRulingWindow(bondId);

      const posterBalBefore = await token.balanceOf(poster.address);

      await klerosJudge.connect(outsider).executeRuling(0);

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
  // 7. EXECUTE RULING — REFUSED (0)
  // =====================================================================
  describe("executeRuling — refused to arbitrate", function () {

    it("ruling 0 calls rejectBond, everyone refunded", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      await mockArbitrator.giveRuling(0, 0);
      await advanceToRulingWindow(bondId);

      const posterBefore = await token.balanceOf(poster.address);
      const challengerBefore = await token.balanceOf(challenger1.address);

      await klerosJudge.connect(outsider).executeRuling(0);

      const posterAfter = await token.balanceOf(poster.address);
      const challengerAfter = await token.balanceOf(challenger1.address);

      // Poster gets bondAmount back
      expect(posterAfter - posterBefore).to.equal(BOND_AMOUNT);
      // Challenger gets challengeAmount back
      expect(challengerAfter - challengerBefore).to.equal(CHALLENGE_AMOUNT);

      // Bond should be settled
      const b = await bond.bonds(bondId);
      expect(b.settled).to.equal(true);
    });
  });

  // =====================================================================
  // 8. EXECUTE RULING — TIMING CHECKS
  // =====================================================================
  describe("executeRuling — timing", function () {

    it("reverts before ruling window opens", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });
      await mockArbitrator.giveRuling(0, 2);

      // Don't advance time — still before ruling window
      await expect(
        klerosJudge.connect(outsider).executeRuling(0)
      ).to.be.revertedWith("Before ruling window");
    });

    it("reverts after ruling deadline", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });
      await mockArbitrator.giveRuling(0, 2);
      await advancePastRulingDeadline(bondId);

      await expect(
        klerosJudge.connect(outsider).executeRuling(0)
      ).to.be.revertedWith("Past ruling deadline");
    });

    it("reverts if not yet ruled", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      // Don't deliver ruling
      await advanceToRulingWindow(bondId);

      await expect(
        klerosJudge.connect(outsider).executeRuling(0)
      ).to.be.revertedWith("Not yet ruled");
    });

    it("reverts if already executed", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });
      await mockArbitrator.giveRuling(0, 1);
      await advanceToRulingWindow(bondId);

      await klerosJudge.connect(outsider).executeRuling(0);

      await expect(
        klerosJudge.connect(outsider).executeRuling(0)
      ).to.be.revertedWith("Not yet ruled");
    });
  });

  // =====================================================================
  // 9. JUDGE FEE COLLECTION
  // =====================================================================
  describe("Judge fee collection", function () {

    it("judge fees accumulate in the adapter contract", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });
      await mockArbitrator.giveRuling(0, 1); // poster wins
      await advanceToRulingWindow(bondId);
      await klerosJudge.connect(outsider).executeRuling(0);

      // Judge fee should be in the adapter contract
      const adapterBal = await token.balanceOf(klerosJudgeAddr);
      expect(adapterBal).to.equal(JUDGE_FEE);
    });

    it("owner can withdraw accumulated fees", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });
      await mockArbitrator.giveRuling(0, 1);
      await advanceToRulingWindow(bondId);
      await klerosJudge.connect(outsider).executeRuling(0);

      const balBefore = await token.balanceOf(owner.address);
      await klerosJudge.connect(owner).withdrawFees(tokenAddr, owner.address, JUDGE_FEE);
      const balAfter = await token.balanceOf(owner.address);

      expect(balAfter - balBefore).to.equal(JUDGE_FEE);
    });

    it("non-owner cannot withdraw fees", async function () {
      await expect(
        klerosJudge.connect(outsider).withdrawFees(tokenAddr, outsider.address, 1)
      ).to.be.revertedWith("Only owner");
    });
  });

  // =====================================================================
  // 10. EVIDENCE
  // =====================================================================
  describe("submitEvidence", function () {

    it("emits Evidence event for active dispute", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      const tx = klerosJudge.connect(poster).submitEvidence(
        bondId, 0, "/ipfs/QmEvidence1"
      );

      await expect(tx).to.emit(klerosJudge, "Evidence");
    });

    it("anyone can submit evidence", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      // Outsider submits evidence — should work
      await klerosJudge.connect(outsider).submitEvidence(
        bondId, 0, "/ipfs/QmOutsiderEvidence"
      );
    });

    it("reverts if no dispute exists", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      // No arbitration requested

      await expect(
        klerosJudge.connect(poster).submitEvidence(bondId, 0, "/ipfs/QmEvidence")
      ).to.be.revertedWith("No dispute for this challenge");
    });

    it("reverts if dispute already ruled", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);
      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });
      await mockArbitrator.giveRuling(0, 1);

      await expect(
        klerosJudge.connect(poster).submitEvidence(bondId, 0, "/ipfs/QmLate")
      ).to.be.revertedWith("Dispute not active");
    });
  });

  // =====================================================================
  // 11. OWNER FUNCTIONS
  // =====================================================================
  describe("Owner functions", function () {

    it("owner can update arbitrator extra data", async function () {
      const newData = "0x0000000000000000000000000000000000000000000000000000000000000001" +
                      "0000000000000000000000000000000000000000000000000000000000000005";
      await klerosJudge.connect(owner).updateArbitratorExtraData(newData);

      expect(await klerosJudge.arbitratorExtraData()).to.equal(
        newData.toLowerCase()
      );
    });

    it("non-owner cannot update extra data", async function () {
      await expect(
        klerosJudge.connect(outsider).updateArbitratorExtraData("0x")
      ).to.be.revertedWith("Only owner");
    });

    it("owner can transfer ownership", async function () {
      await klerosJudge.connect(owner).transferOwnership(outsider.address);
      expect(await klerosJudge.owner()).to.equal(outsider.address);

      // Old owner can no longer call owner functions
      await expect(
        klerosJudge.connect(owner).updateArbitratorExtraData("0x")
      ).to.be.revertedWith("Only owner");
    });

    it("transferOwnership emits event", async function () {
      await expect(klerosJudge.connect(owner).transferOwnership(outsider.address))
        .to.emit(klerosJudge, "OwnershipTransferred")
        .withArgs(owner.address, outsider.address);
    });

    it("cannot transfer to zero address", async function () {
      await expect(
        klerosJudge.connect(owner).transferOwnership(ethers.ZeroAddress)
      ).to.be.revertedWith("Zero address");
    });
  });

  // =====================================================================
  // 12. VIEW FUNCTIONS
  // =====================================================================
  describe("View functions", function () {

    it("getArbitrationCost returns current cost", async function () {
      const cost = await klerosJudge.getArbitrationCost();
      expect(cost).to.equal(ARBITRATION_COST);
    });

    it("getArbitrationCost updates when mock cost changes", async function () {
      const newCost = ethers.parseEther("0.1");
      await mockArbitrator.setCost(newCost);
      expect(await klerosJudge.getArbitrationCost()).to.equal(newCost);
    });
  });

  // =====================================================================
  // 13. MULTI-CHALLENGE SCENARIO
  // =====================================================================
  describe("Multiple challenges with separate disputes", function () {

    it("poster wins first challenge, new dispute for second", async function () {
      const bondId = await createDefaultBond();

      // Two challengers
      await challengeBond(bondId, challenger1);
      await challengeBond(bondId, challenger2);

      // Request arbitration for first challenge
      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      // Kleros rules: poster wins first challenge
      await mockArbitrator.giveRuling(0, 1);
      await advanceToRulingWindow(bondId);
      await klerosJudge.connect(outsider).executeRuling(0);

      // Bond not settled, currentChallenge advanced to 1
      const b = await bond.bonds(bondId);
      expect(b.settled).to.equal(false);
      expect(b.currentChallenge).to.equal(1);

      // Request arbitration for second challenge
      // Need to advance past deadline for new lastChallengeTime window
      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      // Second dispute has ID 1
      const d = await klerosJudge.disputes(1);
      expect(d.bondId).to.equal(bondId);
      expect(d.challengeIndex).to.equal(1);

      expect(await klerosJudge.hasDispute(bondId, 1)).to.equal(true);
    });
  });

  // =====================================================================
  // 14. TIMEOUT STILL WORKS
  // =====================================================================
  describe("Timeout fallback", function () {

    it("claimTimeout works if ruling not executed in time", async function () {
      const bondId = await createDefaultBond();
      await challengeBond(bondId, challenger1);

      // Arbitration requested but Kleros is too slow or ruling not executed
      await klerosJudge.connect(poster).requestArbitration(bondId, {
        value: ARBITRATION_COST,
      });

      // Advance past ruling deadline
      await advancePastRulingDeadline(bondId);

      // Anyone can claim timeout on SimpleBondV4 directly
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
