const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
    deployMockSUSDS,
    deployBondHarness,
    createDefaultBond,
    fundAndApprove,
    DEFAULT_BOND_PARAMS,
} = require("../../helpers/v6/fixtures");

async function setup() {
    const [poster, other] = await ethers.getSigners();
    const token = await deployMockSUSDS();
    const { registry, bond, judge, judgeProfileId } = await deployBondHarness();
    await fundAndApprove(token, bond, poster, ethers.parseEther("1000"));
    return { poster, other, token, bond, judge, registry, judgeProfileId };
}

describe("SimpleBondV6.createBond", () => {
    it("creates a bond, pulls bondAmount, emits BondCreated", async () => {
        const { poster, token, bond, judge, judgeProfileId } = await setup();

        const tx = await createDefaultBond(bond, poster, token, judge, judgeProfileId);
        const receipt = await tx.wait();
        const log = receipt.logs.find((l) => l.fragment && l.fragment.name === "BondCreated");

        expect(log.args.bondId).to.equal(0n);
        expect(log.args.poster).to.equal(poster.address);
        expect(log.args.judge).to.equal(await judge.getAddress());
        expect(log.args.judgeProfileId).to.equal(judgeProfileId);
        expect(log.args.bondAmount).to.equal(DEFAULT_BOND_PARAMS.bondAmount);
        expect(log.args.claimHash).to.equal(
            ethers.keccak256(ethers.toUtf8Bytes(DEFAULT_BOND_PARAMS.claimContent))
        );
        expect(log.args.claimContent).to.equal(DEFAULT_BOND_PARAMS.claimContent);

        expect(await token.balanceOf(await bond.getAddress())).to.equal(
            DEFAULT_BOND_PARAMS.bondAmount
        );

        const stored = await bond.bonds(0);
        expect(stored.poster).to.equal(poster.address);
        expect(stored.claimVersion).to.equal(1n);
        expect(stored.settled).to.equal(false);
        expect(stored.closed).to.equal(false);
        expect(stored.judgeProfileId).to.equal(judgeProfileId);
    });

    it("increments bondId on each create", async () => {
        const { poster, token, bond, judge, judgeProfileId } = await setup();
        await createDefaultBond(bond, poster, token, judge, judgeProfileId);
        const tx = await createDefaultBond(bond, poster, token, judge, judgeProfileId);
        const receipt = await tx.wait();
        const log = receipt.logs.find((l) => l.fragment && l.fragment.name === "BondCreated");
        expect(log.args.bondId).to.equal(1n);
    });

    describe("validation", () => {
        it("reverts on zero bondAmount", async () => {
            const { poster, token, bond, judge, judgeProfileId } = await setup();
            await expect(
                createDefaultBond(bond, poster, token, judge, judgeProfileId, { bondAmount: 0n })
            ).to.be.revertedWith("Zero bond amount");
        });

        it("reverts on zero challengeAmount", async () => {
            const { poster, token, bond, judge, judgeProfileId } = await setup();
            await expect(
                createDefaultBond(bond, poster, token, judge, judgeProfileId, { challengeAmount: 0n })
            ).to.be.revertedWith("Zero challenge amount");
        });

        it("reverts on zero judge", async () => {
            const { poster, token, bond, judgeProfileId } = await setup();
            const fakeJudge = { getAddress: async () => ethers.ZeroAddress };
            await expect(
                createDefaultBond(bond, poster, token, fakeJudge, judgeProfileId)
            ).to.be.revertedWith("Zero judge");
        });

        it("reverts when judge is an EOA", async () => {
            const { poster, other, token, bond, judgeProfileId } = await setup();
            const eoaJudge = { getAddress: async () => other.address };
            await expect(
                createDefaultBond(bond, poster, token, eoaJudge, judgeProfileId)
            ).to.be.revertedWith("Judge must be contract");
        });

        it("reverts when judgeFee > challengeAmount", async () => {
            const { poster, token, bond, judge, judgeProfileId } = await setup();
            await expect(
                createDefaultBond(bond, poster, token, judge, judgeProfileId, {
                    judgeFee: ethers.parseEther("100"),
                    challengeAmount: ethers.parseEther("1"),
                })
            ).to.be.revertedWith("Fee > challenge amount");
        });

        it("reverts on zero maxChallenges", async () => {
            const { poster, token, bond, judge, judgeProfileId } = await setup();
            await expect(
                createDefaultBond(bond, poster, token, judge, judgeProfileId, { maxChallenges: 0 })
            ).to.be.revertedWith("Zero maxChallenges");
        });

        it("reverts when acceptanceDelay exceeds MAX_ACCEPTANCE_DELAY", async () => {
            const { poster, token, bond, judge, judgeProfileId } = await setup();
            await expect(
                createDefaultBond(bond, poster, token, judge, judgeProfileId, {
                    acceptanceDelay: 366 * 24 * 3600,
                })
            ).to.be.revertedWith("Acceptance delay too long");
        });

        it("reverts on zero rulingBuffer", async () => {
            const { poster, token, bond, judge, judgeProfileId } = await setup();
            await expect(
                createDefaultBond(bond, poster, token, judge, judgeProfileId, { rulingBuffer: 0 })
            ).to.be.revertedWith("Zero ruling buffer");
        });

        it("reverts when rulingBuffer exceeds MAX_RULING_BUFFER", async () => {
            const { poster, token, bond, judge, judgeProfileId } = await setup();
            await expect(
                createDefaultBond(bond, poster, token, judge, judgeProfileId, {
                    rulingBuffer: 366 * 24 * 3600,
                })
            ).to.be.revertedWith("Ruling buffer too long");
        });

        it("reverts when judgeProfileId points to a different judge", async () => {
            const { poster, token, bond, judge, registry } = await setup();
            // Register a different judge profile, then use its id with our judge.
            const Other = await ethers.getContractFactory("TestAcceptJudgeV6");
            const otherJudge = await Other.deploy();
            await otherJudge.waitForDeployment();
            const tx = await registry.registerProfile(await otherJudge.getAddress(), "other");
            const r = await tx.wait();
            const otherEntryId = r.logs.find(
                (l) => l.fragment && l.fragment.name === "ProfileRegistered"
            ).args.entryId;
            await expect(
                createDefaultBond(bond, poster, token, judge, otherEntryId)
            ).to.be.revertedWith("Profile judge mismatch");
        });

        it("reverts when judgeProfileId is out of bounds", async () => {
            const { poster, token, bond, judge } = await setup();
            await expect(
                createDefaultBond(bond, poster, token, judge, 999n)
            ).to.be.reverted;
        });
    });
});
