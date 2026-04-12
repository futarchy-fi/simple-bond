const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("JudgeRegistry", function () {
  let registry;
  let manualJudgeA;
  let manualJudgeB;
  let owner;
  let admin;
  let operatorA;
  let operatorB;
  let outsider;
  let pendingOwner;
  let pendingAdmin;

  beforeEach(async function () {
    [owner, admin, operatorA, operatorB, outsider, pendingOwner, pendingAdmin] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("JudgeRegistry");
    registry = await Registry.deploy(owner.address, admin.address);

    const ManualJudge = await ethers.getContractFactory("ManualJudge");
    manualJudgeA = await ManualJudge.deploy(operatorA.address);
    manualJudgeB = await ManualJudge.deploy(operatorB.address);
  });

  describe("constructor", function () {
    it("stores owner and admin", async function () {
      expect(await registry.owner()).to.equal(owner.address);
      expect(await registry.admin()).to.equal(admin.address);
    });

    it("reverts on zero owner", async function () {
      const Registry = await ethers.getContractFactory("JudgeRegistry");
      await expect(Registry.deploy(ethers.ZeroAddress, admin.address)).to.be.revertedWith("Zero owner");
    });

    it("reverts on zero admin", async function () {
      const Registry = await ethers.getContractFactory("JudgeRegistry");
      await expect(Registry.deploy(owner.address, ethers.ZeroAddress)).to.be.revertedWith("Zero admin");
    });
  });

  describe("role transfers", function () {
    it("supports two-step ownership transfer", async function () {
      await expect(registry.connect(owner).transferOwnership(pendingOwner.address))
        .to.emit(registry, "OwnershipTransferStarted")
        .withArgs(owner.address, pendingOwner.address);

      await expect(registry.connect(pendingOwner).acceptOwnership())
        .to.emit(registry, "OwnershipTransferred")
        .withArgs(owner.address, pendingOwner.address);

      expect(await registry.owner()).to.equal(pendingOwner.address);
    });

    it("supports two-step admin transfer", async function () {
      await expect(registry.connect(admin).transferAdmin(pendingAdmin.address))
        .to.emit(registry, "AdminTransferStarted")
        .withArgs(admin.address, pendingAdmin.address);

      await expect(registry.connect(pendingAdmin).acceptAdmin())
        .to.emit(registry, "AdminTransferred")
        .withArgs(admin.address, pendingAdmin.address);

      expect(await registry.admin()).to.equal(pendingAdmin.address);
    });
  });

  describe("registration", function () {
    it("lets the controller canonically register a judge before activation", async function () {
      const judgeAddress = await manualJudgeA.getAddress();

      await expect(registry.connect(operatorA).setJudge(judgeAddress))
        .to.emit(registry, "JudgeRegistered")
        .withArgs(operatorA.address, judgeAddress, operatorA.address);

      expect(await registry.judgeOf(operatorA.address)).to.equal(judgeAddress);
      expect(await registry.operatorOf(judgeAddress)).to.equal(operatorA.address);
      expect(await registry.canRegister(operatorA.address, judgeAddress)).to.equal(true);
      expect(await registry.judgeCount()).to.equal(1n);
      expect(await registry.judgeAt(0)).to.equal(judgeAddress);
    });

    it("rejects non-controllers", async function () {
      await expect(
        registry.connect(outsider).setJudge(await manualJudgeA.getAddress())
      ).to.be.revertedWith("Not judge controller");
    });

    it("moves an operator from an older canonical judge to a new one", async function () {
      const ManualJudge = await ethers.getContractFactory("ManualJudge");
      const replacementJudge = await ManualJudge.deploy(operatorA.address);

      await registry.connect(operatorA).setJudge(await manualJudgeA.getAddress());
      await expect(registry.connect(operatorA).setJudge(await replacementJudge.getAddress()))
        .to.emit(registry, "JudgeCleared")
        .withArgs(operatorA.address, await manualJudgeA.getAddress(), operatorA.address);

      expect(await registry.judgeOf(operatorA.address)).to.equal(await replacementJudge.getAddress());
      expect(await registry.operatorOf(await manualJudgeA.getAddress())).to.equal(ethers.ZeroAddress);
    });

    it("moves a judge from a previous operator when admin backfills a migration", async function () {
      const judgeAddress = await manualJudgeA.getAddress();

      await registry.connect(operatorA).setJudge(judgeAddress);

      await expect(registry.connect(admin).setJudgeFor(operatorB.address, judgeAddress))
        .to.emit(registry, "JudgeCleared")
        .withArgs(operatorA.address, judgeAddress, admin.address);

      expect(await registry.judgeOf(operatorA.address)).to.equal(ethers.ZeroAddress);
      expect(await registry.judgeOf(operatorB.address)).to.equal(judgeAddress);
      expect(await registry.operatorOf(judgeAddress)).to.equal(operatorB.address);
    });

    it("lets the operator clear its own canonical judge", async function () {
      const judgeAddress = await manualJudgeA.getAddress();
      await registry.connect(operatorA).setJudge(judgeAddress);

      await expect(registry.connect(operatorA).clearMyJudge())
        .to.emit(registry, "JudgeCleared")
        .withArgs(operatorA.address, judgeAddress, operatorA.address);

      expect(await registry.judgeOf(operatorA.address)).to.equal(ethers.ZeroAddress);
      expect(await registry.operatorOf(judgeAddress)).to.equal(ethers.ZeroAddress);
    });

    it("lets admin backfill and clear canonical mappings", async function () {
      const judgeAddress = await manualJudgeB.getAddress();

      await registry.connect(admin).setJudgeFor(operatorB.address, judgeAddress);
      expect(await registry.judgeOf(operatorB.address)).to.equal(judgeAddress);

      await registry.connect(admin).clearJudgeFor(operatorB.address);
      expect(await registry.judgeOf(operatorB.address)).to.equal(ethers.ZeroAddress);
      expect(await registry.operatorOf(judgeAddress)).to.equal(ethers.ZeroAddress);
    });

    it("blocks writes while paused", async function () {
      await registry.connect(admin).setWritesPaused(true);

      await expect(
        registry.connect(operatorA).setJudge(await manualJudgeA.getAddress())
      ).to.be.revertedWith("Writes paused");
    });
  });
});
