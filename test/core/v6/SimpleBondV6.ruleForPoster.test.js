const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
    deployMockSUSDS,
    deployBondHarness,
    createDefaultBond,
    fundAndApprove,
    DEFAULT_BOND_PARAMS,
} = require("../../helpers/v6/fixtures");

async function setupRuleable(overrides = {}) {
    const [poster, challenger, other] = await ethers.getSigners();
    const token = await deployMockSUSDS();
    const { bond, judge, judgeProfileId } = await deployBondHarness({ withForwardingJudge: true });

    await fundAndApprove(token, bond, poster, ethers.parseEther("1000"));
    await fundAndApprove(token, bond, challenger, ethers.parseEther("1000"));

    await createDefaultBond(bond, poster, token, judge, judgeProfileId, overrides);
    await bond.connect(challenger).challenge(0, 1, "dispute");
    return {
        poster,
        challenger,
        other,
        token,
        bond,
        judge,
        judgeProfileId,
        params: { ...DEFAULT_BOND_PARAMS, ...overrides },
    };
}

async function callRuleForPoster(judge, bond, bondId, i, feeCharged, content) {
    const data = bond.interface.encodeFunctionData("ruleForPoster", [bondId, i, feeCharged, content]);
    return judge.forward(await bond.getAddress(), data);
}

function findBondEvent(bond, receipt, name) {
    for (const log of receipt.logs) {
        try {
            const parsed = bond.interface.parseLog(log);
            if (parsed && parsed.name === name) return parsed;
        } catch (_) {}
    }
    return null;
}

describe("SimpleBondV6.ruleForPoster", () => {
    it("happy path: pays poster + judge fee, marks Lost, bond continues", async () => {
        const { poster, challenger, token, bond, judge, params } = await setupRuleable();
        await time.increase(params.acceptanceDelay + 1);

        const posterBefore = await token.balanceOf(poster.address);
        const judgeBefore = await token.balanceOf(await judge.getAddress());

        const tx = await callRuleForPoster(judge, bond, 0, 0, params.judgeFee, "you defended");
        const receipt = await tx.wait();
        const log = findBondEvent(bond, receipt, "RuledForPoster");

        expect(log.args.bondId).to.equal(0n);
        expect(log.args.challengeIndex).to.equal(0n);
        expect(log.args.challenger).to.equal(challenger.address);
        expect(log.args.feeCharged).to.equal(params.judgeFee);
        expect(log.args.contentHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes("you defended")));

        const posterAfter = await token.balanceOf(poster.address);
        const judgeAfter = await token.balanceOf(await judge.getAddress());
        expect(posterAfter - posterBefore).to.equal(params.challengeAmount - params.judgeFee);
        expect(judgeAfter - judgeBefore).to.equal(params.judgeFee);

        const ch = await bond.getChallenge(0, 0);
        expect(ch.status).to.equal(2n); // Lost
        expect(ch.rulingMetadataHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes("you defended")));

        const stored = await bond.bonds(0);
        expect(stored.pendingCount).to.equal(0n);
        expect(stored.settled).to.equal(false);

        // Bond contract retains only the poster's bondAmount.
        expect(await token.balanceOf(await bond.getAddress())).to.equal(params.bondAmount);
    });

    it("happy path with fee waiver (feeCharged=0)", async () => {
        const { poster, token, bond, judge, params } = await setupRuleable();
        await time.increase(params.acceptanceDelay + 1);
        const before = await token.balanceOf(poster.address);
        await callRuleForPoster(judge, bond, 0, 0, 0n, "no fee");
        const after = await token.balanceOf(poster.address);
        expect(after - before).to.equal(params.challengeAmount);
        expect(await token.balanceOf(await judge.getAddress())).to.equal(0n);
    });

    it("reverts when caller is not the judge contract", async () => {
        const { other, bond, params } = await setupRuleable();
        await time.increase(params.acceptanceDelay + 1);
        await expect(
            bond.connect(other).ruleForPoster(0, 0, 0n, "x")
        ).to.be.revertedWith("Only judge");
    });

    it("reverts before the ruling window opens", async () => {
        const { bond, judge, params } = await setupRuleable();
        await expect(
            callRuleForPoster(judge, bond, 0, 0, params.judgeFee, "too early")
        ).to.be.revertedWith("judge forward failed");
    });

    it("reverts after the ruling deadline", async () => {
        const { bond, judge, params } = await setupRuleable();
        await time.increase(params.acceptanceDelay + params.rulingBuffer + 1);
        await expect(
            callRuleForPoster(judge, bond, 0, 0, params.judgeFee, "too late")
        ).to.be.revertedWith("judge forward failed");
    });

    it("reverts on fee greater than judgeFee", async () => {
        const { bond, judge, params } = await setupRuleable();
        await time.increase(params.acceptanceDelay + 1);
        await expect(
            callRuleForPoster(judge, bond, 0, 0, params.judgeFee + 1n, "greedy")
        ).to.be.revertedWith("judge forward failed");
    });

    it("reverts when challenge is not pending", async () => {
        const { poster, bond, judge, params } = await setupRuleable();
        await bond.connect(poster).concede(0, 0, "concede first");
        await time.increase(params.acceptanceDelay + 1);
        await expect(
            callRuleForPoster(judge, bond, 0, 0, 0n, "after concede")
        ).to.be.revertedWith("judge forward failed");
    });
});
