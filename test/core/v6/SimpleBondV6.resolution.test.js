const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
    deployMockSUSDS,
    deployBond,
    deployForwardingJudge,
    fundAndApprove,
    DEFAULT_BOND_PARAMS,
} = require("../../helpers/v6/fixtures");

async function setupBond(overrides = {}, signerCount = 4) {
    const signers = await ethers.getSigners();
    const [poster] = signers;
    const challengers = signers.slice(1, signerCount);

    const token = await deployMockSUSDS();
    const bond = await deployBond();
    const judge = await deployForwardingJudge();

    await fundAndApprove(token, bond, poster, ethers.parseEther("1000"));
    for (const c of challengers) {
        await fundAndApprove(token, bond, c, ethers.parseEther("1000"));
    }

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

    return { poster, challengers, token, bond, judge, params: p };
}

async function forward(judge, bond, fn, args) {
    const data = bond.interface.encodeFunctionData(fn, args);
    return judge.forward(await bond.getAddress(), data);
}

function findEvent(bond, receipt, name) {
    for (const log of receipt.logs) {
        try {
            const p = bond.interface.parseLog(log);
            if (p && p.name === name) return p;
        } catch (_) {}
    }
    return null;
}

describe("SimpleBondV6.ruleForChallenger", () => {
    it("happy path: pays challenger bond+stake-fee, judge fee, marks Won, settles bond", async () => {
        const { challengers, token, bond, judge, params } = await setupBond();
        const c0 = challengers[0];
        await bond.connect(c0).challenge(0, 1, "dispute");
        await time.increase(params.acceptanceDelay + 1);

        const cBefore = await token.balanceOf(c0.address);
        const jBefore = await token.balanceOf(await judge.getAddress());
        const tx = await forward(judge, bond, "ruleForChallenger", [0, 0, params.judgeFee, "you win"]);
        const receipt = await tx.wait();
        const log = findEvent(bond, receipt, "RuledForChallenger");

        expect(log.args.bondId).to.equal(0n);
        expect(log.args.feeCharged).to.equal(params.judgeFee);
        expect((await token.balanceOf(c0.address)) - cBefore).to.equal(
            params.bondAmount + params.challengeAmount - params.judgeFee
        );
        expect((await token.balanceOf(await judge.getAddress())) - jBefore).to.equal(params.judgeFee);
        expect((await bond.bonds(0)).settled).to.equal(true);
        expect((await bond.getChallenge(0, 0)).status).to.equal(1n); // Won
    });

    it("makes other pending challengers refundable via claimRefunds", async () => {
        const { challengers, token, bond, judge, params } = await setupBond();
        const [c0, c1, c2] = challengers;
        await bond.connect(c0).challenge(0, 1, "first");
        await bond.connect(c1).challenge(0, 1, "second");
        await bond.connect(c2).challenge(0, 1, "third");
        await time.increase(params.acceptanceDelay + 1);

        // Rule for c1 (middle)
        await forward(judge, bond, "ruleForChallenger", [0, 1, 0n, "c1 wins"]);

        // Bond contract held bondAmount + 3*challengeAmount; after payout to c1: 2*challengeAmount left.
        const bondBalAfterRuling = await token.balanceOf(await bond.getAddress());
        expect(bondBalAfterRuling).to.equal(2n * params.challengeAmount);

        const c0Before = await token.balanceOf(c0.address);
        const c2Before = await token.balanceOf(c2.address);

        // Drain refunds.
        await bond.claimRefunds(0, 10);

        expect((await token.balanceOf(c0.address)) - c0Before).to.equal(params.challengeAmount);
        expect((await token.balanceOf(c2.address)) - c2Before).to.equal(params.challengeAmount);
        expect(await token.balanceOf(await bond.getAddress())).to.equal(0n);
        expect((await bond.getChallenge(0, 0)).status).to.equal(5n); // Refunded
        expect((await bond.getChallenge(0, 1)).status).to.equal(1n); // Won
        expect((await bond.getChallenge(0, 2)).status).to.equal(5n); // Refunded
    });

    it("reverts on non-judge caller, fee>cap, window gates", async () => {
        const { poster, challengers, bond, judge, params } = await setupBond();
        const c0 = challengers[0];
        await bond.connect(c0).challenge(0, 1, "x");

        await expect(
            bond.connect(poster).ruleForChallenger(0, 0, 0n, "x")
        ).to.be.revertedWith("Only judge");

        await expect(
            forward(judge, bond, "ruleForChallenger", [0, 0, 0n, "x"])
        ).to.be.revertedWith("judge forward failed"); // before window

        await time.increase(params.acceptanceDelay + 1);

        await expect(
            forward(judge, bond, "ruleForChallenger", [0, 0, params.judgeFee + 1n, "x"])
        ).to.be.revertedWith("judge forward failed");
    });
});

describe("SimpleBondV6.rejectChallenge", () => {
    it("refunds challenger, marks RejectedByJudge, bond continues", async () => {
        const { challengers, token, bond, judge, params } = await setupBond();
        const c0 = challengers[0];
        await bond.connect(c0).challenge(0, 1, "spam");
        const cBefore = await token.balanceOf(c0.address);

        await forward(judge, bond, "rejectChallenge", [0, 0, "out of scope"]);

        expect((await token.balanceOf(c0.address)) - cBefore).to.equal(params.challengeAmount);
        expect((await bond.getChallenge(0, 0)).status).to.equal(4n); // RejectedByJudge
        expect((await bond.bonds(0)).settled).to.equal(false);
        expect((await bond.bonds(0)).pendingCount).to.equal(0n);
    });

    it("callable before acceptance delay elapses", async () => {
        const { challengers, bond, judge } = await setupBond();
        await bond.connect(challengers[0]).challenge(0, 1, "spam");
        await expect(
            forward(judge, bond, "rejectChallenge", [0, 0, "early reject"])
        ).to.not.be.reverted;
    });

    it("reverts when non-judge calls", async () => {
        const { poster, challengers, bond } = await setupBond();
        await bond.connect(challengers[0]).challenge(0, 1, "spam");
        await expect(
            bond.connect(poster).rejectChallenge(0, 0, "x")
        ).to.be.revertedWith("Only judge");
    });
});

describe("SimpleBondV6.rejectBond", () => {
    it("settles, refunds poster, leaves pending challengers refundable", async () => {
        const { poster, challengers, token, bond, judge, params } = await setupBond();
        const c0 = challengers[0];
        await bond.connect(c0).challenge(0, 1, "dispute");

        const pBefore = await token.balanceOf(poster.address);
        await forward(judge, bond, "rejectBond", [0, "void"]);
        const pAfter = await token.balanceOf(poster.address);

        expect(pAfter - pBefore).to.equal(params.bondAmount);
        expect((await bond.bonds(0)).settled).to.equal(true);

        const cBefore = await token.balanceOf(c0.address);
        await bond.claimRefunds(0, 10);
        expect((await token.balanceOf(c0.address)) - cBefore).to.equal(params.challengeAmount);
    });

    it("does not unwind already-finalized challenges", async () => {
        const { challengers, token, bond, judge, params } = await setupBond();
        const [c0, c1] = challengers;
        await bond.connect(c0).challenge(0, 1, "first");
        await time.increase(params.acceptanceDelay + 1);
        await forward(judge, bond, "ruleForPoster", [0, 0, 0n, "c0 loses"]);
        const c0BalAfterLoss = await token.balanceOf(c0.address);

        await bond.connect(c1).challenge(0, 1, "second");
        await forward(judge, bond, "rejectBond", [0, "void"]);
        await bond.claimRefunds(0, 10);

        // c0 already lost; rejectBond doesn't unwind that. Their balance shouldn't change.
        expect(await token.balanceOf(c0.address)).to.equal(c0BalAfterLoss);
    });
});

describe("SimpleBondV6.closeBond / openBond", () => {
    it("close blocks new challenges; open re-enables them", async () => {
        const { poster, challengers, bond } = await setupBond();
        await bond.connect(poster).closeBond(0);
        await expect(
            bond.connect(challengers[0]).challenge(0, 1, "blocked")
        ).to.be.revertedWith("Bond closed");

        await bond.connect(poster).openBond(0);
        await expect(
            bond.connect(challengers[0]).challenge(0, 1, "now ok")
        ).to.not.be.reverted;
    });

    it("only poster can toggle", async () => {
        const { challengers, bond } = await setupBond();
        await expect(
            bond.connect(challengers[0]).closeBond(0)
        ).to.be.revertedWith("Not poster");
    });

    it("close-twice and open-when-open revert", async () => {
        const { poster, bond } = await setupBond();
        await bond.connect(poster).closeBond(0);
        await expect(bond.connect(poster).closeBond(0)).to.be.revertedWith("Already closed");
        await bond.connect(poster).openBond(0);
        await expect(bond.connect(poster).openBond(0)).to.be.revertedWith("Already open");
    });

    it("existing pending challenges continue under close", async () => {
        const { poster, challengers, bond, judge, params } = await setupBond();
        await bond.connect(challengers[0]).challenge(0, 1, "x");
        await bond.connect(poster).closeBond(0);
        await time.increase(params.acceptanceDelay + 1);
        // Judge can still rule.
        await expect(
            forward(judge, bond, "ruleForPoster", [0, 0, 0n, "ok"])
        ).to.not.be.reverted;
    });
});

describe("SimpleBondV6.withdrawBond", () => {
    it("requires closed + no pending; pays poster and settles", async () => {
        const { poster, token, bond, params } = await setupBond();
        await expect(bond.connect(poster).withdrawBond(0)).to.be.revertedWith("Must close first");
        await bond.connect(poster).closeBond(0);
        const before = await token.balanceOf(poster.address);
        await bond.connect(poster).withdrawBond(0);
        expect((await token.balanceOf(poster.address)) - before).to.equal(params.bondAmount);
        expect((await bond.bonds(0)).settled).to.equal(true);
    });

    it("reverts when challenges are pending", async () => {
        const { poster, challengers, bond } = await setupBond();
        await bond.connect(challengers[0]).challenge(0, 1, "x");
        await bond.connect(poster).closeBond(0);
        await expect(
            bond.connect(poster).withdrawBond(0)
        ).to.be.revertedWith("Pending challenges");
    });

    it("cannot withdraw twice", async () => {
        const { poster, bond } = await setupBond();
        await bond.connect(poster).closeBond(0);
        await bond.connect(poster).withdrawBond(0);
        await expect(bond.connect(poster).withdrawBond(0)).to.be.revertedWith("Bond settled");
    });
});

describe("SimpleBondV6.claimTimeout", () => {
    it("anyone can trigger after ruling window elapses; settles + refunds poster", async () => {
        const { poster, challengers, token, bond, params } = await setupBond();
        await bond.connect(challengers[0]).challenge(0, 1, "x");
        await time.increase(params.acceptanceDelay + params.rulingBuffer + 1);
        const before = await token.balanceOf(poster.address);
        await bond.connect(challengers[1]).claimTimeout(0, 0);
        expect((await token.balanceOf(poster.address)) - before).to.equal(params.bondAmount);
        expect((await bond.bonds(0)).settled).to.equal(true);
        // Pending challengers refundable via claimRefunds.
        const cBefore = await token.balanceOf(challengers[0].address);
        await bond.claimRefunds(0, 10);
        expect((await token.balanceOf(challengers[0].address)) - cBefore).to.equal(
            params.challengeAmount
        );
    });

    it("reverts before ruling deadline", async () => {
        const { challengers, bond, params } = await setupBond();
        await bond.connect(challengers[0]).challenge(0, 1, "x");
        await time.increase(params.acceptanceDelay + 1);
        await expect(
            bond.connect(challengers[1]).claimTimeout(0, 0)
        ).to.be.revertedWith("Ruling window still open");
    });
});

describe("SimpleBondV6.claimRefunds", () => {
    it("only refunds Pending statuses; skips Conceded / RejectedByJudge", async () => {
        const { poster, challengers, token, bond, judge, params } = await setupBond({}, 5);
        const [c0, c1, c2, c3] = challengers;
        await bond.connect(c0).challenge(0, 1, "a");
        await bond.connect(c1).challenge(0, 1, "b");
        await bond.connect(c2).challenge(0, 1, "c");
        await bond.connect(c3).challenge(0, 1, "d");

        // c0 conceded, c1 rejected, c2/c3 still pending.
        await bond.connect(poster).concede(0, 0, "conceded");
        await forward(judge, bond, "rejectChallenge", [0, 1, "out-of-scope"]);
        const c2BalBefore = await token.balanceOf(c2.address);
        const c3BalBefore = await token.balanceOf(c3.address);

        await forward(judge, bond, "rejectBond", [0, "void"]);
        await bond.claimRefunds(0, 10);

        expect((await token.balanceOf(c2.address)) - c2BalBefore).to.equal(params.challengeAmount);
        expect((await token.balanceOf(c3.address)) - c3BalBefore).to.equal(params.challengeAmount);

        // Statuses
        expect((await bond.getChallenge(0, 0)).status).to.equal(3n); // Conceded
        expect((await bond.getChallenge(0, 1)).status).to.equal(4n); // RejectedByJudge
        expect((await bond.getChallenge(0, 2)).status).to.equal(5n); // Refunded
        expect((await bond.getChallenge(0, 3)).status).to.equal(5n); // Refunded

        // No further refunds in second drain (idempotent).
        const balBefore = await token.balanceOf(c2.address);
        await bond.claimRefunds(0, 10);
        expect(await token.balanceOf(c2.address)).to.equal(balBefore);
    });

    it("bounded by maxCount and resumable", async () => {
        const { challengers, token, bond, judge, params } = await setupBond({ maxChallenges: 5 }, 5);
        for (let i = 0; i < 4; i++) {
            await bond.connect(challengers[i]).challenge(0, 1, `n${i}`);
        }
        await forward(judge, bond, "rejectBond", [0, "void"]);

        await bond.claimRefunds(0, 2);
        expect((await bond.getChallenge(0, 0)).status).to.equal(5n);
        expect((await bond.getChallenge(0, 1)).status).to.equal(5n);
        expect((await bond.getChallenge(0, 2)).status).to.equal(0n);
        expect((await bond.getChallenge(0, 3)).status).to.equal(0n);

        await bond.claimRefunds(0, 10);
        expect((await bond.getChallenge(0, 2)).status).to.equal(5n);
        expect((await bond.getChallenge(0, 3)).status).to.equal(5n);
        expect(await token.balanceOf(await bond.getAddress())).to.equal(0n);
    });

    it("reverts when bond not settled", async () => {
        const { bond } = await setupBond();
        await expect(bond.claimRefunds(0, 10)).to.be.revertedWith("Bond not settled");
    });
});
