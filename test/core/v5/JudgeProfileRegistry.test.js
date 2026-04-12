const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("JudgeProfileRegistry", function () {
  let registry;
  let manualJudge;
  let owner;
  let admin;
  let pendingOwner;
  let pendingAdmin;
  let judgeOperator;
  let outsider;

  async function getProfile(judgeAddr) {
    const [displayName, statement, linkURI, metadataURI, updatedAt] = await registry.getProfile(judgeAddr);
    return { displayName, statement, linkURI, metadataURI, updatedAt };
  }

  beforeEach(async function () {
    [owner, admin, pendingOwner, pendingAdmin, judgeOperator, outsider] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("JudgeProfileRegistry");
    registry = await Registry.deploy(owner.address, admin.address);

    const ManualJudge = await ethers.getContractFactory("ManualJudge");
    manualJudge = await ManualJudge.deploy(judgeOperator.address);
  });

  describe("constructor", function () {
    it("stores the initial owner and admin", async function () {
      expect(await registry.owner()).to.equal(owner.address);
      expect(await registry.admin()).to.equal(admin.address);
    });

    it("reverts on zero owner", async function () {
      const Registry = await ethers.getContractFactory("JudgeProfileRegistry");
      await expect(
        Registry.deploy(ethers.ZeroAddress, admin.address)
      ).to.be.revertedWith("Zero owner");
    });

    it("reverts on zero admin", async function () {
      const Registry = await ethers.getContractFactory("JudgeProfileRegistry");
      await expect(
        Registry.deploy(owner.address, ethers.ZeroAddress)
      ).to.be.revertedWith("Zero admin");
    });
  });

  describe("role transfers", function () {
    it("supports two-step ownership transfer", async function () {
      await expect(registry.connect(owner).transferOwnership(pendingOwner.address))
        .to.emit(registry, "OwnershipTransferStarted")
        .withArgs(owner.address, pendingOwner.address);

      expect(await registry.pendingOwner()).to.equal(pendingOwner.address);

      await expect(registry.connect(pendingOwner).acceptOwnership())
        .to.emit(registry, "OwnershipTransferred")
        .withArgs(owner.address, pendingOwner.address);

      expect(await registry.owner()).to.equal(pendingOwner.address);
      expect(await registry.pendingOwner()).to.equal(ethers.ZeroAddress);
    });

    it("only owner can start ownership transfer", async function () {
      await expect(
        registry.connect(outsider).transferOwnership(pendingOwner.address)
      ).to.be.revertedWith("Only owner");
    });

    it("supports two-step admin transfer from the current admin", async function () {
      await expect(registry.connect(admin).transferAdmin(pendingAdmin.address))
        .to.emit(registry, "AdminTransferStarted")
        .withArgs(admin.address, pendingAdmin.address);

      await expect(registry.connect(pendingAdmin).acceptAdmin())
        .to.emit(registry, "AdminTransferred")
        .withArgs(admin.address, pendingAdmin.address);

      expect(await registry.admin()).to.equal(pendingAdmin.address);
      expect(await registry.pendingAdmin()).to.equal(ethers.ZeroAddress);
    });

    it("also lets the owner rotate admin", async function () {
      await registry.connect(owner).transferAdmin(pendingAdmin.address);
      await registry.connect(pendingAdmin).acceptAdmin();

      expect(await registry.admin()).to.equal(pendingAdmin.address);
    });
  });

  describe("pause control", function () {
    it("owner can pause writes", async function () {
      await expect(registry.connect(owner).setWritesPaused(true))
        .to.emit(registry, "WritesPausedSet")
        .withArgs(true);

      expect(await registry.writesPaused()).to.equal(true);
    });

    it("admin can pause writes", async function () {
      await registry.connect(admin).setWritesPaused(true);
      expect(await registry.writesPaused()).to.equal(true);
    });

    it("outsiders cannot pause writes", async function () {
      await expect(
        registry.connect(outsider).setWritesPaused(true)
      ).to.be.revertedWith("Only owner or admin");
    });
  });

  describe("profile editing", function () {
    it("lets the ManualJudge proposed operator set a profile before activation", async function () {
      const judgeAddr = await manualJudge.getAddress();

      await expect(
        registry.connect(judgeOperator).setProfile(
          judgeAddr,
          "Alice Court",
          "I review public evidence and arguments.",
          "https://example.com/judging",
          "ipfs://judge-profile"
        )
      ).to.emit(registry, "JudgeProfileUpdated").withArgs(judgeAddr, judgeOperator.address);

      const profile = await getProfile(judgeAddr);
      expect(profile.displayName).to.equal("Alice Court");
      expect(profile.statement).to.equal("I review public evidence and arguments.");
      expect(profile.linkURI).to.equal("https://example.com/judging");
      expect(profile.metadataURI).to.equal("ipfs://judge-profile");
      expect(profile.updatedAt).to.be.greaterThan(0n);
    });

    it("keeps the ManualJudge operator as profile controller after activation", async function () {
      await manualJudge.connect(judgeOperator).acceptOperatorRole();

      expect(await registry.profileControllerOf(await manualJudge.getAddress())).to.equal(judgeOperator.address);
    });

    it("rejects profile writes from unauthorized callers", async function () {
      await expect(
        registry.connect(outsider).setProfile(
          await manualJudge.getAddress(),
          "Bad Actor",
          "Fake profile",
          "",
          ""
        )
      ).to.be.revertedWith("Not judge controller");
    });

    it("rejects EOAs as judges", async function () {
      await expect(
        registry.connect(outsider).setProfile(
          outsider.address,
          "EOA",
          "Should fail",
          "",
          ""
        )
      ).to.be.revertedWith("Not judge controller");
    });

    it("rejects empty profiles", async function () {
      await expect(
        registry.connect(judgeOperator).setProfile(
          await manualJudge.getAddress(),
          "",
          "",
          "",
          ""
        )
      ).to.be.revertedWith("Empty profile");
    });

    it("enforces field length limits", async function () {
      const tooLong = "x".repeat(121);

      await expect(
        registry.connect(judgeOperator).setProfile(
          await manualJudge.getAddress(),
          tooLong,
          "",
          "",
          ""
        )
      ).to.be.revertedWith("Display name too long");
    });

    it("blocks writes while paused", async function () {
      await registry.connect(admin).setWritesPaused(true);

      await expect(
        registry.connect(judgeOperator).setProfile(
          await manualJudge.getAddress(),
          "Alice Court",
          "Paused write",
          "",
          ""
        )
      ).to.be.revertedWith("Writes paused");
    });

    it("allows the controller to clear an existing profile even if writes are paused", async function () {
      const judgeAddr = await manualJudge.getAddress();
      await registry.connect(judgeOperator).setProfile(
        judgeAddr,
        "Alice Court",
        "Statement",
        "",
        ""
      );
      await registry.connect(admin).setWritesPaused(true);

      await expect(registry.connect(judgeOperator).clearProfile(judgeAddr))
        .to.emit(registry, "JudgeProfileCleared")
        .withArgs(judgeAddr, judgeOperator.address);

      expect(await registry.hasProfile(judgeAddr)).to.equal(false);
    });

    it("reverts when clearing a missing profile", async function () {
      await expect(
        registry.connect(judgeOperator).clearProfile(await manualJudge.getAddress())
      ).to.be.revertedWith("Profile not found");
    });
  });
});
