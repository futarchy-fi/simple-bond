const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
    deployMockSUSDS,
    deployBond,
    deployAcceptJudge,
    fundAndApprove,
    DEFAULT_BOND_PARAMS,
} = require("../../helpers/v6/fixtures");

async function setupWithChallenge(overrides = {}) {
    const [poster, challenger, other] = await ethers.getSigners();
    const token = await deployMockSUSDS();
    const bond = await deployBond();
    const judge = await deployAcceptJudge();

    await fundAndApprove(token, bond, poster, ethers.parseEther("1000"));
    await fundAndApprove(token, bond, challenger, ethers.parseEther("1000"));

    const p = { ...DEFAULT_BOND_PARAMS, ...overrides };
    await bond.connect(poster).createBond(
        await token.getAddress(),
        p.bondAmount,
        p.challengeAmount,
        p.judgeFee,
        await judge.getAddress(),
        p.acceptanceDelay,
        p.rulingBuffer,
        p.maxChallenges,
        p.judgeProfileId,
        p.claimContent
    );
    await bond.connect(challenger).challenge(0, 1, "dispute");
    return { poster, challenger, other, token, bond, judge, params: p };
}

describe("SimpleBondV6.concede", () => {
    it("refunds the challenger immediately, marks Conceded, emits event, decrements pendingCount", async () => {
        const { poster, challenger, token, bond, params } = await setupWithChallenge();

        const before = await token.balanceOf(challenger.address);
        const tx = await bond.connect(poster).concede(0, 0, "you are right");
        const receipt = await tx.wait();
        const log = receipt.logs.find((l) => l.fragment && l.fragment.name === "ClaimConceded");

        expect(log.args.bondId).to.equal(0n);
        expect(log.args.challengeIndex).to.equal(0n);
        expect(log.args.poster).to.equal(poster.address);
        expect(log.args.contentHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes("you are right")));
        expect(log.args.content).to.equal("you are right");

        const after = await token.balanceOf(challenger.address);
        expect(after - before).to.equal(params.challengeAmount);

        const ch = await bond.getChallenge(0, 0);
        expect(ch.status).to.equal(3n); // Conceded
        expect(ch.rulingMetadataHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes("you are right")));

        const stored = await bond.bonds(0);
        expect(stored.pendingCount).to.equal(0n);
        expect(stored.settled).to.equal(false);

        // Bond contract retains poster's bondAmount only.
        expect(await token.balanceOf(await bond.getAddress())).to.equal(params.bondAmount);
    });

    it("reverts when called by non-poster", async () => {
        const { other, bond } = await setupWithChallenge();
        await expect(bond.connect(other).concede(0, 0, "x")).to.be.revertedWith("Not poster");
    });

    it("reverts after concession window closes", async () => {
        const { poster, bond, params } = await setupWithChallenge();
        await time.increase(params.acceptanceDelay + 1);
        await expect(
            bond.connect(poster).concede(0, 0, "late")
        ).to.be.revertedWith("Concession window closed");
    });

    it("reverts when the challenge is already terminal", async () => {
        const { poster, bond } = await setupWithChallenge();
        await bond.connect(poster).concede(0, 0, "first");
        await expect(
            bond.connect(poster).concede(0, 0, "second")
        ).to.be.revertedWith("Not pending");
    });

    it("allows concede right at the boundary timestamp", async () => {
        const { poster, bond } = await setupWithChallenge();
        const deadline = await bond.concessionDeadline(0, 0);
        await time.setNextBlockTimestamp(Number(deadline));
        await expect(bond.connect(poster).concede(0, 0, "boundary")).to.not.be.reverted;
    });

    it("allows other challenges to proceed (bond stays alive)", async () => {
        const { poster, challenger, bond } = await setupWithChallenge();
        const [, , , c2] = await ethers.getSigners();
        const tokenAddr = await bond.bonds(0).then((b) => b.token);
        const token = await ethers.getContractAt("MockSUSDS", tokenAddr);
        await token.mint(c2.address, ethers.parseEther("100"));
        await token.connect(c2).approve(await bond.getAddress(), ethers.parseEther("100"));

        await bond.connect(c2).challenge(0, 1, "second dispute");
        await bond.connect(poster).concede(0, 0, "ok on first");

        const stored = await bond.bonds(0);
        expect(stored.pendingCount).to.equal(1n);
        expect(stored.settled).to.equal(false);

        // Second challenge still pending.
        const ch1 = await bond.getChallenge(0, 1);
        expect(ch1.status).to.equal(0n); // Pending
    });
});
