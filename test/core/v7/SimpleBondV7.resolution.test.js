// SimpleBondV7 resolution tests — rewritten from the v0.6 resolution suite to the C2
// credit/claim pull-payment model. Outbound value to untrusted recipients is now CREDITED
// (not pushed): the recipient must call claim(token) to receive it. The v0.6 "push appears
// in the recipient's balance immediately" assertions are replaced with "credits[recipient]
// reflects the amount; claim() then pays it." The judge fee STAYS an inline push.

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
    deployMockSUSDS,
    deployBondHarness,
    createDefaultBond,
    fundAndApprove,
    DEFAULT_BOND_PARAMS,
} = require("../../helpers/v7/fixtures");

async function setupBond(overrides = {}, signerCount = 4) {
    const signers = await ethers.getSigners();
    const [poster] = signers;
    const challengers = signers.slice(1, signerCount);

    const token = await deployMockSUSDS();
    const { bond, judge, judgeProfileId } = await deployBondHarness({ withForwardingJudge: true });

    await fundAndApprove(token, bond, poster, ethers.parseEther("1000"));
    for (const c of challengers) {
        await fundAndApprove(token, bond, c, ethers.parseEther("1000"));
    }

    await createDefaultBond(bond, poster, token, judge, judgeProfileId, overrides);

    return {
        poster,
        challengers,
        token,
        bond,
        judge,
        judgeProfileId,
        params: { ...DEFAULT_BOND_PARAMS, ...overrides },
    };
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

// Net balance delta from claiming a token credit: claim() then measure.
async function claimAndMeasure(bond, token, signer) {
    const tokenAddr = await token.getAddress();
    const before = await token.balanceOf(signer.address);
    await bond.connect(signer).claim(tokenAddr);
    const after = await token.balanceOf(signer.address);
    return after - before;
}

describe("SimpleBondV7.ruleForChallenger (credit model)", () => {
    it("credits winner bond+stake-fee, pushes judge fee inline, marks Won, settles", async () => {
        const { challengers, token, bond, judge, params } = await setupBond();
        const c0 = challengers[0];
        const tokenAddr = await token.getAddress();
        await bond.connect(c0).challenge(0, 1, "dispute");
        await time.increase(params.acceptanceDelay + 1);

        const jBefore = await token.balanceOf(await judge.getAddress());
        const tx = await forward(judge, bond, "ruleForChallenger", [0, 0, params.judgeFee, "you win"]);
        const receipt = await tx.wait();
        const log = findEvent(bond, receipt, "RuledForChallenger");

        expect(log.args.bondId).to.equal(0n);
        expect(log.args.feeCharged).to.equal(params.judgeFee);

        // Judge fee is pushed inline (NOT credited).
        expect((await token.balanceOf(await judge.getAddress())) - jBefore).to.equal(params.judgeFee);

        // Winner is CREDITED bondAmount + challengeAmount - fee (not pushed yet).
        const owed = params.bondAmount + params.challengeAmount - params.judgeFee;
        expect(await bond.credits(c0.address, tokenAddr)).to.equal(owed);
        expect(await token.balanceOf(c0.address)).to.equal(
            ethers.parseEther("1000") - params.challengeAmount
        );

        // claim() pays exactly the credited amount.
        expect(await claimAndMeasure(bond, token, c0)).to.equal(owed);
        expect(await bond.credits(c0.address, tokenAddr)).to.equal(0n);

        expect((await bond.bonds(0)).settled).to.equal(true);
        expect((await bond.getChallenge(0, 0)).status).to.equal(1n); // Won
    });

    it("settlement credits all OTHER pending challengers their stake (no stranded funds)", async () => {
        const { challengers, token, bond, judge, params } = await setupBond();
        const [c0, c1, c2] = challengers;
        const tokenAddr = await token.getAddress();
        await bond.connect(c0).challenge(0, 1, "first");
        await bond.connect(c1).challenge(0, 1, "second");
        await bond.connect(c2).challenge(0, 1, "third");
        await time.increase(params.acceptanceDelay + 1);

        // Rule for c1 (middle).
        await forward(judge, bond, "ruleForChallenger", [0, 1, 0n, "c1 wins"]);

        // c1 credited bond + stake; c0 and c2 credited their stakes back.
        expect(await bond.credits(c1.address, tokenAddr)).to.equal(
            params.bondAmount + params.challengeAmount
        );
        expect(await bond.credits(c0.address, tokenAddr)).to.equal(params.challengeAmount);
        expect(await bond.credits(c2.address, tokenAddr)).to.equal(params.challengeAmount);

        // Status: losers flipped to Lost, winner Won.
        expect((await bond.getChallenge(0, 0)).status).to.equal(2n); // Lost
        expect((await bond.getChallenge(0, 1)).status).to.equal(1n); // Won
        expect((await bond.getChallenge(0, 2)).status).to.equal(2n); // Lost
        // Settle loop swept pendingCount to 0.
        expect((await bond.bonds(0)).pendingCount).to.equal(0n);

        // Each claims exactly; contract nets to zero after all claims.
        expect(await claimAndMeasure(bond, token, c0)).to.equal(params.challengeAmount);
        expect(await claimAndMeasure(bond, token, c2)).to.equal(params.challengeAmount);
        expect(await claimAndMeasure(bond, token, c1)).to.equal(
            params.bondAmount + params.challengeAmount
        );
        expect(await token.balanceOf(await bond.getAddress())).to.equal(0n);
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

describe("SimpleBondV7.ruleForPoster (credit model)", () => {
    it("credits poster the challenge stake minus fee; pushes judge fee inline; bond continues", async () => {
        const { poster, challengers, token, bond, judge, params } = await setupBond();
        const c0 = challengers[0];
        const tokenAddr = await token.getAddress();
        await bond.connect(c0).challenge(0, 1, "dispute");
        await time.increase(params.acceptanceDelay + 1);

        const jBefore = await token.balanceOf(await judge.getAddress());
        await forward(judge, bond, "ruleForPoster", [0, 0, params.judgeFee, "valid claim"]);

        // Judge fee inline push.
        expect((await token.balanceOf(await judge.getAddress())) - jBefore).to.equal(params.judgeFee);
        // Poster credited challengeAmount - fee.
        expect(await bond.credits(poster.address, tokenAddr)).to.equal(
            params.challengeAmount - params.judgeFee
        );
        // Bond NOT settled (continues).
        expect((await bond.bonds(0)).settled).to.equal(false);
        expect((await bond.getChallenge(0, 0)).status).to.equal(2n); // Lost
        expect((await bond.bonds(0)).pendingCount).to.equal(0n);

        expect(await claimAndMeasure(bond, token, poster)).to.equal(
            params.challengeAmount - params.judgeFee
        );
    });

    it("zero fee credits poster the full challengeAmount", async () => {
        const { poster, challengers, token, bond, judge, params } = await setupBond();
        const tokenAddr = await token.getAddress();
        await bond.connect(challengers[0]).challenge(0, 1, "x");
        await time.increase(params.acceptanceDelay + 1);
        await forward(judge, bond, "ruleForPoster", [0, 0, 0n, "valid"]);
        expect(await bond.credits(poster.address, tokenAddr)).to.equal(params.challengeAmount);
    });
});

describe("SimpleBondV7.rejectChallenge (credit model)", () => {
    it("credits challenger their stake, marks RejectedByJudge, bond continues", async () => {
        const { challengers, token, bond, judge, params } = await setupBond();
        const c0 = challengers[0];
        const tokenAddr = await token.getAddress();
        await bond.connect(c0).challenge(0, 1, "spam");

        await forward(judge, bond, "rejectChallenge", [0, 0, "out of scope"]);

        expect(await bond.credits(c0.address, tokenAddr)).to.equal(params.challengeAmount);
        expect((await bond.getChallenge(0, 0)).status).to.equal(4n); // RejectedByJudge
        expect((await bond.bonds(0)).settled).to.equal(false);
        expect((await bond.bonds(0)).pendingCount).to.equal(0n);

        expect(await claimAndMeasure(bond, token, c0)).to.equal(params.challengeAmount);
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

describe("SimpleBondV7.rejectBond (credit model)", () => {
    it("settles, credits poster the bond, credits all pending challengers their stake", async () => {
        const { poster, challengers, token, bond, judge, params } = await setupBond();
        const c0 = challengers[0];
        const tokenAddr = await token.getAddress();
        await bond.connect(c0).challenge(0, 1, "dispute");

        await forward(judge, bond, "rejectBond", [0, "void"]);

        expect(await bond.credits(poster.address, tokenAddr)).to.equal(params.bondAmount);
        expect(await bond.credits(c0.address, tokenAddr)).to.equal(params.challengeAmount);
        expect((await bond.bonds(0)).settled).to.equal(true);
        expect((await bond.bonds(0)).pendingCount).to.equal(0n);
        expect((await bond.getChallenge(0, 0)).status).to.equal(5n); // Refunded

        expect(await claimAndMeasure(bond, token, poster)).to.equal(params.bondAmount);
        expect(await claimAndMeasure(bond, token, c0)).to.equal(params.challengeAmount);
        expect(await token.balanceOf(await bond.getAddress())).to.equal(0n);
    });

    it("does not unwind already-finalized challenges", async () => {
        const { challengers, token, bond, judge, params } = await setupBond();
        const [c0, c1] = challengers;
        const tokenAddr = await token.getAddress();
        await bond.connect(c0).challenge(0, 1, "first");
        await time.increase(params.acceptanceDelay + 1);
        await forward(judge, bond, "ruleForPoster", [0, 0, 0n, "c0 loses"]);
        // c0 already Lost (no refund credit).
        expect(await bond.credits(c0.address, tokenAddr)).to.equal(0n);

        await bond.connect(c1).challenge(0, 1, "second");
        await forward(judge, bond, "rejectBond", [0, "void"]);

        // rejectBond doesn't unwind c0's loss; only c1 (still pending) gets a refund credit.
        expect(await bond.credits(c0.address, tokenAddr)).to.equal(0n);
        expect(await bond.credits(c1.address, tokenAddr)).to.equal(params.challengeAmount);
        await expect(bond.connect(c0).claim(tokenAddr)).to.be.revertedWith("Nothing to claim");
    });

    it("credits only Pending challengers; skips Conceded / RejectedByJudge", async () => {
        const { poster, challengers, token, bond, judge, params } = await setupBond({}, 5);
        const [c0, c1, c2, c3] = challengers;
        const tokenAddr = await token.getAddress();
        await bond.connect(c0).challenge(0, 1, "a");
        await bond.connect(c1).challenge(0, 1, "b");
        await bond.connect(c2).challenge(0, 1, "c");
        await bond.connect(c3).challenge(0, 1, "d");

        // c0 conceded (already credited), c1 rejected (already credited), c2/c3 still pending.
        await bond.connect(poster).concede(0, 0, "conceded");
        await forward(judge, bond, "rejectChallenge", [0, 1, "out-of-scope"]);

        // Reset baseline: read credits before rejectBond.
        const c0Before = await bond.credits(c0.address, tokenAddr);
        const c1Before = await bond.credits(c1.address, tokenAddr);

        await forward(judge, bond, "rejectBond", [0, "void"]);

        // c2/c3 (pending) newly credited; c0/c1 credits unchanged by the settle loop.
        expect(await bond.credits(c2.address, tokenAddr)).to.equal(params.challengeAmount);
        expect(await bond.credits(c3.address, tokenAddr)).to.equal(params.challengeAmount);
        expect(await bond.credits(c0.address, tokenAddr)).to.equal(c0Before);
        expect(await bond.credits(c1.address, tokenAddr)).to.equal(c1Before);

        expect((await bond.getChallenge(0, 0)).status).to.equal(3n); // Conceded
        expect((await bond.getChallenge(0, 1)).status).to.equal(4n); // RejectedByJudge
        expect((await bond.getChallenge(0, 2)).status).to.equal(5n); // Refunded
        expect((await bond.getChallenge(0, 3)).status).to.equal(5n); // Refunded
    });
});

describe("SimpleBondV7.closeBond / openBond", () => {
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
        await expect(
            forward(judge, bond, "ruleForPoster", [0, 0, 0n, "ok"])
        ).to.not.be.reverted;
    });
});

describe("SimpleBondV7.withdrawBond (credit model)", () => {
    it("requires closed + no pending; credits poster and settles", async () => {
        const { poster, token, bond, params } = await setupBond();
        const tokenAddr = await token.getAddress();
        await expect(bond.connect(poster).withdrawBond(0)).to.be.revertedWith("Must close first");
        await bond.connect(poster).closeBond(0);
        await bond.connect(poster).withdrawBond(0);
        expect(await bond.credits(poster.address, tokenAddr)).to.equal(params.bondAmount);
        expect((await bond.bonds(0)).settled).to.equal(true);

        expect(await claimAndMeasure(bond, token, poster)).to.equal(params.bondAmount);
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

describe("SimpleBondV7.claimTimeout (credit model)", () => {
    it("anyone can trigger after ruling window; settles, credits poster + all pending", async () => {
        const { poster, challengers, token, bond, params } = await setupBond();
        const [c0, , c2] = challengers;
        const tokenAddr = await token.getAddress();
        await bond.connect(c0).challenge(0, 1, "x");
        await time.increase(params.acceptanceDelay + params.rulingBuffer + 1);

        await bond.connect(c2).claimTimeout(0, 0);

        expect(await bond.credits(poster.address, tokenAddr)).to.equal(params.bondAmount);
        // The timed-out (still-pending) challenger is also refunded.
        expect(await bond.credits(c0.address, tokenAddr)).to.equal(params.challengeAmount);
        expect((await bond.bonds(0)).settled).to.equal(true);
        expect((await bond.bonds(0)).pendingCount).to.equal(0n);
        expect((await bond.getChallenge(0, 0)).status).to.equal(5n); // Refunded

        expect(await claimAndMeasure(bond, token, poster)).to.equal(params.bondAmount);
        expect(await claimAndMeasure(bond, token, c0)).to.equal(params.challengeAmount);
        expect(await token.balanceOf(await bond.getAddress())).to.equal(0n);
    });

    it("reverts before ruling deadline", async () => {
        const { challengers, bond, params } = await setupBond();
        await bond.connect(challengers[0]).challenge(0, 1, "x");
        await time.increase(params.acceptanceDelay + 1);
        await expect(
            bond.connect(challengers[1]).claimTimeout(0, 0)
        ).to.be.revertedWith("Ruling window still open");
    });

    it("credits every still-pending challenger, not just the timed-out index", async () => {
        const { poster, challengers, token, bond, params } = await setupBond({}, 4);
        const [c0, c1, c2] = challengers;
        const tokenAddr = await token.getAddress();
        await bond.connect(c0).challenge(0, 1, "a");
        await bond.connect(c1).challenge(0, 1, "b");
        await bond.connect(c2).challenge(0, 1, "c");
        await time.increase(params.acceptanceDelay + params.rulingBuffer + 1);

        await bond.connect(c0).claimTimeout(0, 1); // time out via index 1

        expect(await bond.credits(poster.address, tokenAddr)).to.equal(params.bondAmount);
        for (const c of [c0, c1, c2]) {
            expect(await bond.credits(c.address, tokenAddr)).to.equal(params.challengeAmount);
        }
        expect((await bond.bonds(0)).pendingCount).to.equal(0n);
    });
});

describe("SimpleBondV7.concede (credit model)", () => {
    it("credits the conceded challenger their stake; marks Conceded", async () => {
        const { poster, challengers, token, bond, params } = await setupBond();
        const c0 = challengers[0];
        const tokenAddr = await token.getAddress();
        await bond.connect(c0).challenge(0, 1, "dispute");
        await bond.connect(poster).concede(0, 0, "you are right");

        expect(await bond.credits(c0.address, tokenAddr)).to.equal(params.challengeAmount);
        expect((await bond.getChallenge(0, 0)).status).to.equal(3n); // Conceded
        expect((await bond.bonds(0)).pendingCount).to.equal(0n);

        expect(await claimAndMeasure(bond, token, c0)).to.equal(params.challengeAmount);
    });
});

describe("SimpleBondV7.claim (CEI / idempotence)", () => {
    it("reverts 'Nothing to claim' when there is no credit", async () => {
        const { challengers, token, bond } = await setupBond();
        await expect(
            bond.connect(challengers[0]).claim(await token.getAddress())
        ).to.be.revertedWith("Nothing to claim");
    });

    it("double-claim no-ops: second claim reverts 'Nothing to claim'", async () => {
        const { poster, challengers, token, bond } = await setupBond();
        const c0 = challengers[0];
        const tokenAddr = await token.getAddress();
        await bond.connect(c0).challenge(0, 1, "x");
        await bond.connect(poster).concede(0, 0, "ok");

        await bond.connect(c0).claim(tokenAddr);
        await expect(bond.connect(c0).claim(tokenAddr)).to.be.revertedWith("Nothing to claim");
    });

    it("emits Claimed with the exact amount and zeroes the ledger before transfer", async () => {
        const { poster, challengers, token, bond, params } = await setupBond();
        const c0 = challengers[0];
        const tokenAddr = await token.getAddress();
        await bond.connect(c0).challenge(0, 1, "x");
        await bond.connect(poster).concede(0, 0, "ok");

        await expect(bond.connect(c0).claim(tokenAddr))
            .to.emit(bond, "Claimed")
            .withArgs(tokenAddr, c0.address, params.challengeAmount);
        expect(await bond.credits(c0.address, tokenAddr)).to.equal(0n);
    });
});
