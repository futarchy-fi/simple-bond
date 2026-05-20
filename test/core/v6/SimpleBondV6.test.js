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
    return { poster, other, token, bond, judge };
}

async function createDefaultBond(bond, poster, token, judge, overrides = {}) {
    const p = { ...DEFAULT_BOND_PARAMS, ...overrides };
    return bond.connect(poster).createBond(
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
}

describe("SimpleBondV6.createBond", () => {
    it("creates a bond, pulls bondAmount, emits BondCreated", async () => {
        const { poster, token, bond, judge } = await setup();

        const tx = await createDefaultBond(bond, poster, token, judge);
        const receipt = await tx.wait();
        const log = receipt.logs.find((l) => l.fragment && l.fragment.name === "BondCreated");

        expect(log.args.bondId).to.equal(0n);
        expect(log.args.poster).to.equal(poster.address);
        expect(log.args.judge).to.equal(await judge.getAddress());
        expect(log.args.judgeProfileId).to.equal(0n);
        expect(log.args.bondAmount).to.equal(DEFAULT_BOND_PARAMS.bondAmount);
        expect(log.args.claimHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes(DEFAULT_BOND_PARAMS.claimContent)));
        expect(log.args.claimContent).to.equal(DEFAULT_BOND_PARAMS.claimContent);

        expect(await token.balanceOf(await bond.getAddress())).to.equal(DEFAULT_BOND_PARAMS.bondAmount);

        const stored = await bond.bonds(0);
        expect(stored.poster).to.equal(poster.address);
        expect(stored.claimVersion).to.equal(1n);
        expect(stored.settled).to.equal(false);
        expect(stored.closed).to.equal(false);
    });

    it("increments bondId on each create", async () => {
        const { poster, token, bond, judge } = await setup();
        await createDefaultBond(bond, poster, token, judge);
        const tx = await createDefaultBond(bond, poster, token, judge);
        const receipt = await tx.wait();
        const log = receipt.logs.find((l) => l.fragment && l.fragment.name === "BondCreated");
        expect(log.args.bondId).to.equal(1n);
    });

    describe("validation", () => {
        it("reverts on zero bondAmount", async () => {
            const { poster, token, bond, judge } = await setup();
            await expect(
                createDefaultBond(bond, poster, token, judge, { bondAmount: 0n })
            ).to.be.revertedWith("Zero bond amount");
        });

        it("reverts on zero challengeAmount", async () => {
            const { poster, token, bond, judge } = await setup();
            await expect(
                createDefaultBond(bond, poster, token, judge, { challengeAmount: 0n })
            ).to.be.revertedWith("Zero challenge amount");
        });

        it("reverts on zero judge", async () => {
            const { poster, token, bond } = await setup();
            const fakeJudge = { getAddress: async () => ethers.ZeroAddress };
            await expect(
                createDefaultBond(bond, poster, token, fakeJudge)
            ).to.be.revertedWith("Zero judge");
        });

        it("reverts when judge is an EOA", async () => {
            const { poster, other, token, bond } = await setup();
            const eoaJudge = { getAddress: async () => other.address };
            await expect(
                createDefaultBond(bond, poster, token, eoaJudge)
            ).to.be.revertedWith("Judge must be contract");
        });

        it("reverts when judgeFee > challengeAmount", async () => {
            const { poster, token, bond, judge } = await setup();
            await expect(
                createDefaultBond(bond, poster, token, judge, {
                    judgeFee: ethers.parseEther("100"),
                    challengeAmount: ethers.parseEther("1"),
                })
            ).to.be.revertedWith("Fee > challenge amount");
        });

        it("reverts on zero maxChallenges", async () => {
            const { poster, token, bond, judge } = await setup();
            await expect(
                createDefaultBond(bond, poster, token, judge, { maxChallenges: 0 })
            ).to.be.revertedWith("Zero maxChallenges");
        });

        it("reverts when acceptanceDelay exceeds MAX_ACCEPTANCE_DELAY", async () => {
            const { poster, token, bond, judge } = await setup();
            await expect(
                createDefaultBond(bond, poster, token, judge, { acceptanceDelay: 366 * 24 * 3600 })
            ).to.be.revertedWith("Acceptance delay too long");
        });

        it("reverts on zero rulingBuffer", async () => {
            const { poster, token, bond, judge } = await setup();
            await expect(
                createDefaultBond(bond, poster, token, judge, { rulingBuffer: 0 })
            ).to.be.revertedWith("Zero ruling buffer");
        });

        it("reverts when rulingBuffer exceeds MAX_RULING_BUFFER", async () => {
            const { poster, token, bond, judge } = await setup();
            await expect(
                createDefaultBond(bond, poster, token, judge, { rulingBuffer: 366 * 24 * 3600 })
            ).to.be.revertedWith("Ruling buffer too long");
        });
    });
});
