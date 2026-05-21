const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
    deployMockSUSDS,
    deployBondHarness,
    createDefaultBond,
    fundAndApprove,
    DEFAULT_BOND_PARAMS,
} = require("../../helpers/v6/fixtures");

async function setupWithBond(overrides = {}) {
    const [poster, challenger1, challenger2] = await ethers.getSigners();
    const token = await deployMockSUSDS();
    const { bond, judge, judgeProfileId } = await deployBondHarness();

    await fundAndApprove(token, bond, poster, ethers.parseEther("1000"));
    await fundAndApprove(token, bond, challenger1, ethers.parseEther("1000"));
    await fundAndApprove(token, bond, challenger2, ethers.parseEther("1000"));

    await createDefaultBond(bond, poster, token, judge, judgeProfileId, overrides);

    return {
        poster,
        challenger1,
        challenger2,
        token,
        bond,
        judge,
        judgeProfileId,
        params: { ...DEFAULT_BOND_PARAMS, ...overrides },
    };
}

describe("SimpleBondV6.challenge", () => {
    it("happy path: transfers stake, records challenge, emits Challenged", async () => {
        const { challenger1, token, bond, params } = await setupWithBond();
        const content = "I dispute claim X because Y.";

        const tx = await bond.connect(challenger1).challenge(0, 1, content);
        const receipt = await tx.wait();
        const log = receipt.logs.find((l) => l.fragment && l.fragment.name === "Challenged");

        expect(log.args.bondId).to.equal(0n);
        expect(log.args.challengeIndex).to.equal(0n);
        expect(log.args.challenger).to.equal(challenger1.address);
        expect(log.args.expectedVersion).to.equal(1n);
        expect(log.args.claimHashAtChallenge).to.equal(
            ethers.keccak256(ethers.toUtf8Bytes(params.claimContent))
        );
        expect(log.args.metadataHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes(content)));
        expect(log.args.content).to.equal(content);

        // Stake transferred (bond + challenge in contract).
        expect(await token.balanceOf(await bond.getAddress())).to.equal(
            params.bondAmount + params.challengeAmount
        );

        // Stored challenge
        const ch = await bond.getChallenge(0, 0);
        expect(ch.challenger).to.equal(challenger1.address);
        expect(ch.status).to.equal(0n); // Pending
        expect(ch.challengeAtVersion).to.equal(1n);

        // pendingCount bumped
        const stored = await bond.bonds(0);
        expect(stored.pendingCount).to.equal(1n);
    });

    it("appends multiple challenges in order", async () => {
        const { challenger1, challenger2, bond } = await setupWithBond();
        await bond.connect(challenger1).challenge(0, 1, "first");
        await bond.connect(challenger2).challenge(0, 1, "second");
        expect(await bond.getChallengeCount(0)).to.equal(2n);
        const ch0 = await bond.getChallenge(0, 0);
        const ch1 = await bond.getChallenge(0, 1);
        expect(ch0.challenger).to.equal(challenger1.address);
        expect(ch1.challenger).to.equal(challenger2.address);
    });

    it("reverts on stale claim version", async () => {
        const { poster, challenger1, bond } = await setupWithBond();
        // Poster modifies claim -> version becomes 2.
        await bond.connect(poster).modifyClaim(0, "v2");
        await expect(
            bond.connect(challenger1).challenge(0, 1, "outdated")
        ).to.be.revertedWith("Stale claim version");
    });

    it("reverts on maxChallenges exceeded", async () => {
        const { challenger1, challenger2, bond } = await setupWithBond({ maxChallenges: 2 });
        await bond.connect(challenger1).challenge(0, 1, "one");
        await bond.connect(challenger2).challenge(0, 1, "two");
        await expect(
            bond.connect(challenger1).challenge(0, 1, "three")
        ).to.be.revertedWith("Max challenges reached");
    });

    it("reverts on unknown bond id", async () => {
        const { challenger1, bond } = await setupWithBond();
        await expect(
            bond.connect(challenger1).challenge(99, 1, "x")
        ).to.be.revertedWith("Unknown bond");
    });
});

describe("SimpleBondV6.modifyClaim (pending-challenge gate)", () => {
    it("reverts when at least one challenge is pending", async () => {
        const { poster, challenger1, bond } = await setupWithBond();
        await bond.connect(challenger1).challenge(0, 1, "first");
        await expect(
            bond.connect(poster).modifyClaim(0, "v2")
        ).to.be.revertedWith("Pending challenges");
    });
});
