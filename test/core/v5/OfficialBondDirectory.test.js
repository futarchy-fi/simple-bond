const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OfficialBondDirectory", function () {
  let directory;
  let tokenA;
  let tokenB;
  let judgeA;
  let judgeB;
  let owner;
  let admin;
  let pendingOwner;
  let pendingAdmin;
  let judgeOperatorA;
  let judgeOperatorB;
  let outsider;

  beforeEach(async function () {
    [
      owner,
      admin,
      pendingOwner,
      pendingAdmin,
      judgeOperatorA,
      judgeOperatorB,
      outsider,
    ] = await ethers.getSigners();

    const Directory = await ethers.getContractFactory("OfficialBondDirectory");
    directory = await Directory.deploy(owner.address, admin.address);

    const Token = await ethers.getContractFactory("TestToken");
    tokenA = await Token.deploy();
    tokenB = await Token.deploy();

    const ManualJudge = await ethers.getContractFactory("ManualJudge");
    judgeA = await ManualJudge.deploy(judgeOperatorA.address);
    judgeB = await ManualJudge.deploy(judgeOperatorB.address);
  });

  describe("constructor", function () {
    it("stores owner and admin", async function () {
      expect(await directory.owner()).to.equal(owner.address);
      expect(await directory.admin()).to.equal(admin.address);
    });

    it("reverts on zero owner", async function () {
      const Directory = await ethers.getContractFactory("OfficialBondDirectory");
      await expect(
        Directory.deploy(ethers.ZeroAddress, admin.address)
      ).to.be.revertedWith("Zero owner");
    });

    it("reverts on zero admin", async function () {
      const Directory = await ethers.getContractFactory("OfficialBondDirectory");
      await expect(
        Directory.deploy(owner.address, ethers.ZeroAddress)
      ).to.be.revertedWith("Zero admin");
    });
  });

  describe("role transfers", function () {
    it("supports two-step ownership transfer", async function () {
      await expect(directory.connect(owner).transferOwnership(pendingOwner.address))
        .to.emit(directory, "OwnershipTransferStarted")
        .withArgs(owner.address, pendingOwner.address);

      await expect(directory.connect(pendingOwner).acceptOwnership())
        .to.emit(directory, "OwnershipTransferred")
        .withArgs(owner.address, pendingOwner.address);

      expect(await directory.owner()).to.equal(pendingOwner.address);
    });

    it("supports two-step admin transfer from owner or admin", async function () {
      await expect(directory.connect(admin).transferAdmin(pendingAdmin.address))
        .to.emit(directory, "AdminTransferStarted")
        .withArgs(admin.address, pendingAdmin.address);

      await expect(directory.connect(pendingAdmin).acceptAdmin())
        .to.emit(directory, "AdminTransferred")
        .withArgs(admin.address, pendingAdmin.address);

      expect(await directory.admin()).to.equal(pendingAdmin.address);
    });
  });

  describe("judge entries", function () {
    it("lets owner/admin set and update official judges", async function () {
      const judgeAddress = await judgeA.getAddress();

      await expect(
        directory.connect(admin).setJudge(
          judgeAddress,
          true,
          10,
          "Robin Court",
          "Public evidence, plain-language standards.",
          "https://futarchy.ai/judges/robin"
        )
      ).to.emit(directory, "JudgeSet").withArgs(judgeAddress, true, 10);

      expect(await directory.judgeCount()).to.equal(1n);
      expect(await directory.judgeAt(0)).to.equal(judgeAddress);
      expect(await directory.hasJudge(judgeAddress)).to.equal(true);

      const judgeEntry = await directory.getJudge(judgeAddress);
      expect(judgeEntry.enabled).to.equal(true);
      expect(judgeEntry.sortOrder).to.equal(10n);
      expect(judgeEntry.displayName).to.equal("Robin Court");
      expect(judgeEntry.statement).to.equal("Public evidence, plain-language standards.");
      expect(judgeEntry.linkURI).to.equal("https://futarchy.ai/judges/robin");
      expect(judgeEntry.updatedAt).to.be.greaterThan(0n);

      await directory.connect(owner).setJudge(
        judgeAddress,
        false,
        25,
        "Robin Court (paused)",
        "",
        ""
      );

      const updated = await directory.getJudge(judgeAddress);
      expect(updated.enabled).to.equal(false);
      expect(updated.sortOrder).to.equal(25n);
      expect(await directory.judgeCount()).to.equal(1n);
    });

    it("rejects EOAs and outsiders for judge updates", async function () {
      await expect(
        directory.connect(outsider).setJudge(
          await judgeA.getAddress(),
          true,
          1,
          "Nope",
          "",
          ""
        )
      ).to.be.revertedWith("Only owner or admin");

      await expect(
        directory.connect(admin).setJudge(
          outsider.address,
          true,
          1,
          "EOA",
          "",
          ""
        )
      ).to.be.revertedWith("Judge must be contract");
    });
  });

  describe("token entries", function () {
    it("tracks official tokens and keeps default/wrapped-native uniqueness", async function () {
      const tokenAAddress = await tokenA.getAddress();
      const tokenBAddress = await tokenB.getAddress();

      await expect(
        directory.connect(admin).setToken(
          tokenAAddress,
          true,
          true,
          false,
          18,
          5,
          "sDAI",
          "USD Savings"
        )
      ).to.emit(directory, "TokenSet").withArgs(tokenAAddress, true, true, false, 5);

      await directory.connect(admin).setToken(
        tokenBAddress,
        true,
        false,
        true,
        18,
        10,
        "WXDAI",
        "Wrapped xDAI"
      );

      expect(await directory.tokenCount()).to.equal(2n);
      expect(await directory.tokenAt(0)).to.equal(tokenAAddress);
      expect(await directory.tokenAt(1)).to.equal(tokenBAddress);
      expect(await directory.defaultToken()).to.equal(tokenAAddress);
      expect(await directory.wrappedNativeToken()).to.equal(tokenBAddress);

      let tokenAEntry = await directory.getToken(tokenAAddress);
      let tokenBEntry = await directory.getToken(tokenBAddress);

      expect(tokenAEntry.enabled).to.equal(true);
      expect(tokenAEntry.isDefaultToken).to.equal(true);
      expect(tokenAEntry.isWrappedNative).to.equal(false);
      expect(tokenAEntry.decimals).to.equal(18n);
      expect(tokenAEntry.symbol).to.equal("sDAI");
      expect(tokenAEntry.displayName).to.equal("USD Savings");

      expect(tokenBEntry.enabled).to.equal(true);
      expect(tokenBEntry.isDefaultToken).to.equal(false);
      expect(tokenBEntry.isWrappedNative).to.equal(true);

      await directory.connect(owner).setToken(
        tokenBAddress,
        true,
        true,
        true,
        18,
        1,
        "WXDAI",
        "Wrapped xDAI"
      );

      tokenAEntry = await directory.getToken(tokenAAddress);
      tokenBEntry = await directory.getToken(tokenBAddress);

      expect(await directory.defaultToken()).to.equal(tokenBAddress);
      expect(await directory.wrappedNativeToken()).to.equal(tokenBAddress);
      expect(tokenAEntry.isDefaultToken).to.equal(false);
      expect(tokenBEntry.isDefaultToken).to.equal(true);
      expect(tokenBEntry.isWrappedNative).to.equal(true);
    });

    it("clears special roles when a token is disabled", async function () {
      const tokenAAddress = await tokenA.getAddress();

      await directory.connect(admin).setToken(
        tokenAAddress,
        true,
        true,
        true,
        18,
        0,
        "WXDAI",
        "Wrapped xDAI"
      );

      expect(await directory.defaultToken()).to.equal(tokenAAddress);
      expect(await directory.wrappedNativeToken()).to.equal(tokenAAddress);

      await directory.connect(admin).setToken(
        tokenAAddress,
        false,
        false,
        false,
        18,
        0,
        "WXDAI",
        "Wrapped xDAI"
      );

      const entry = await directory.getToken(tokenAAddress);
      expect(entry.enabled).to.equal(false);
      expect(entry.isDefaultToken).to.equal(false);
      expect(entry.isWrappedNative).to.equal(false);
      expect(await directory.defaultToken()).to.equal(ethers.ZeroAddress);
      expect(await directory.wrappedNativeToken()).to.equal(ethers.ZeroAddress);
    });

    it("rejects invalid token configuration", async function () {
      await expect(
        directory.connect(admin).setToken(
          outsider.address,
          true,
          false,
          false,
          18,
          0,
          "EOA",
          "Externally owned account"
        )
      ).to.be.revertedWith("Token must be contract");

      await expect(
        directory.connect(admin).setToken(
          await tokenA.getAddress(),
          false,
          true,
          false,
          18,
          0,
          "sDAI",
          "USD Savings"
        )
      ).to.be.revertedWith("Disabled token cannot be special");
    });
  });

  describe("pause control", function () {
    it("blocks writes while paused", async function () {
      await directory.connect(owner).setWritesPaused(true);

      await expect(
        directory.connect(admin).setJudge(
          await judgeA.getAddress(),
          true,
          0,
          "Paused",
          "",
          ""
        )
      ).to.be.revertedWith("Writes paused");
    });
  });
});
