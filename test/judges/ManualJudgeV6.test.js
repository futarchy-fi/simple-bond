const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
    deployMockSUSDS,
    deployJudgeProfileRegistry,
    deployBond,
    fundAndApprove,
    createDefaultBond,
    DEFAULT_BOND_PARAMS,
} = require("../helpers/v6/fixtures");

async function deployActiveManualJudge(operator) {
    const F = await ethers.getContractFactory("ManualJudgeV6");
    const j = await F.deploy(operator.address);
    await j.waitForDeployment();
    await j.connect(operator).acceptOperatorRole();
    return j;
}

async function setup() {
    const [poster, operator, challenger, other] = await ethers.getSigners();
    const token = await deployMockSUSDS();
    const registry = await deployJudgeProfileRegistry();
    const bond = await deployBond(await registry.getAddress());
    const judge = await deployActiveManualJudge(operator);
    const tx = await registry.registerProfile(await judge.getAddress(), "manual judge profile");
    const r = await tx.wait();
    const judgeProfileId = r.logs.find(
        (l) => l.fragment && l.fragment.name === "ProfileRegistered"
    ).args.entryId;

    await fundAndApprove(token, bond, poster, ethers.parseEther("1000"));
    await fundAndApprove(token, bond, challenger, ethers.parseEther("1000"));
    await createDefaultBond(bond, poster, token, judge, judgeProfileId);
    return { poster, operator, challenger, other, token, bond, judge, judgeProfileId };
}

describe("ManualJudgeV6", () => {
    it("requires the proposed operator to accept before validateBond passes", async () => {
        const [, operator, poster] = await ethers.getSigners();
        const token = await deployMockSUSDS();
        const registry = await deployJudgeProfileRegistry();
        const bond = await deployBond(await registry.getAddress());

        const F = await ethers.getContractFactory("ManualJudgeV6");
        const judge = await F.deploy(operator.address);
        await judge.waitForDeployment();

        const tx = await registry.registerProfile(await judge.getAddress(), "pre-acceptance");
        const r = await tx.wait();
        const judgeProfileId = r.logs.find(
            (l) => l.fragment && l.fragment.name === "ProfileRegistered"
        ).args.entryId;

        await fundAndApprove(token, bond, poster, ethers.parseEther("100"));

        await expect(
            createDefaultBond(bond, poster, token, judge, judgeProfileId)
        ).to.be.revertedWith("Judge inactive");

        await judge.connect(operator).acceptOperatorRole();

        await expect(
            createDefaultBond(bond, poster, token, judge, judgeProfileId)
        ).to.not.be.reverted;
    });

    it("forwards ruleForPoster from operator", async () => {
        const { operator, challenger, bond, judge, token } = await setup();
        await bond.connect(challenger).challenge(0, 1, "x");
        await time.increase(DEFAULT_BOND_PARAMS.acceptanceDelay + 1);

        await judge.connect(operator).ruleForPoster(
            await bond.getAddress(),
            0,
            0,
            DEFAULT_BOND_PARAMS.judgeFee,
            "you defended"
        );

        // Judge contract received fee.
        expect(await token.balanceOf(await judge.getAddress())).to.equal(DEFAULT_BOND_PARAMS.judgeFee);
    });

    it("forwards ruleForChallenger from operator", async () => {
        const { operator, challenger, bond, judge } = await setup();
        await bond.connect(challenger).challenge(0, 1, "x");
        await time.increase(DEFAULT_BOND_PARAMS.acceptanceDelay + 1);
        await judge.connect(operator).ruleForChallenger(
            await bond.getAddress(),
            0,
            0,
            0n,
            "challenger wins"
        );
        expect((await bond.bonds(0)).settled).to.equal(true);
    });

    it("forwards rejectChallenge from operator", async () => {
        const { operator, challenger, bond, judge } = await setup();
        await bond.connect(challenger).challenge(0, 1, "spam");
        await judge.connect(operator).rejectChallenge(
            await bond.getAddress(),
            0,
            0,
            "out of scope"
        );
        expect((await bond.getChallenge(0, 0)).status).to.equal(4n); // RejectedByJudge
    });

    it("forwards rejectBond from operator", async () => {
        const { operator, bond, judge } = await setup();
        await judge.connect(operator).rejectBond(await bond.getAddress(), 0, "void");
        expect((await bond.bonds(0)).settled).to.equal(true);
    });

    it("non-operator cannot forward rulings", async () => {
        const { other, bond, judge } = await setup();
        await expect(
            judge.connect(other).rejectBond(await bond.getAddress(), 0, "x")
        ).to.be.revertedWith("Only operator");
    });

    it("operator can withdraw fees", async () => {
        const { operator, challenger, bond, judge, token } = await setup();
        await bond.connect(challenger).challenge(0, 1, "x");
        await time.increase(DEFAULT_BOND_PARAMS.acceptanceDelay + 1);
        await judge.connect(operator).ruleForPoster(
            await bond.getAddress(),
            0,
            0,
            DEFAULT_BOND_PARAMS.judgeFee,
            "ok"
        );

        const before = await token.balanceOf(operator.address);
        await judge
            .connect(operator)
            .withdrawFees(await token.getAddress(), operator.address, DEFAULT_BOND_PARAMS.judgeFee);
        expect((await token.balanceOf(operator.address)) - before).to.equal(
            DEFAULT_BOND_PARAMS.judgeFee
        );
    });
});
