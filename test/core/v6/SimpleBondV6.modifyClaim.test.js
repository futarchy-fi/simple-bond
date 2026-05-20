const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
    deployMockSUSDS,
    deployBond,
    deployAcceptJudge,
    fundAndApprove,
    DEFAULT_BOND_PARAMS,
} = require("../../helpers/v6/fixtures");

async function setup() {
    const [poster, other] = await ethers.getSigners();
    const token = await deployMockSUSDS();
    const bond = await deployBond();
    const judge = await deployAcceptJudge();
    await fundAndApprove(token, bond, poster, ethers.parseEther("1000"));
    const tx = await bond.connect(poster).createBond(
        await token.getAddress(),
        DEFAULT_BOND_PARAMS.bondAmount,
        DEFAULT_BOND_PARAMS.challengeAmount,
        DEFAULT_BOND_PARAMS.judgeFee,
        await judge.getAddress(),
        DEFAULT_BOND_PARAMS.acceptanceDelay,
        DEFAULT_BOND_PARAMS.rulingBuffer,
        DEFAULT_BOND_PARAMS.maxChallenges,
        DEFAULT_BOND_PARAMS.judgeProfileId,
        DEFAULT_BOND_PARAMS.claimContent
    );
    await tx.wait();
    return { poster, other, token, bond, judge };
}

describe("SimpleBondV6.modifyClaim", () => {
    it("modifies claim text and bumps version when queue is empty", async () => {
        const { poster, bond } = await setup();
        const newContent = "ipfs://updated-claim";

        const tx = await bond.connect(poster).modifyClaim(0, newContent);
        const receipt = await tx.wait();
        const log = receipt.logs.find((l) => l.fragment && l.fragment.name === "ClaimModified");

        expect(log.args.bondId).to.equal(0n);
        expect(log.args.oldVersion).to.equal(1n);
        expect(log.args.newVersion).to.equal(2n);
        expect(log.args.newHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes(newContent)));
        expect(log.args.newContent).to.equal(newContent);

        const stored = await bond.bonds(0);
        expect(stored.claimVersion).to.equal(2n);
        expect(stored.claimHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes(newContent)));
    });

    it("can be called repeatedly while queue is empty, incrementing version each time", async () => {
        const { poster, bond } = await setup();
        await bond.connect(poster).modifyClaim(0, "v2");
        await bond.connect(poster).modifyClaim(0, "v3");
        const stored = await bond.bonds(0);
        expect(stored.claimVersion).to.equal(3n);
        expect(stored.claimHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes("v3")));
    });

    it("reverts when non-poster calls", async () => {
        const { other, bond } = await setup();
        await expect(
            bond.connect(other).modifyClaim(0, "hostile")
        ).to.be.revertedWith("Not poster");
    });

    it("reverts on a non-existent bond id", async () => {
        const { poster, bond } = await setup();
        // Bond id 1 doesn't exist; struct defaults give poster = 0x0, so msg.sender != 0x0 → "Not poster".
        await expect(
            bond.connect(poster).modifyClaim(99, "x")
        ).to.be.revertedWith("Not poster");
    });
});
