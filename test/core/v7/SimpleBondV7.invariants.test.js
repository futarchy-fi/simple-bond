// Property-style invariant tests for SimpleBondV7, rewritten from the v0.6 invariant suite to
// the C2 credit/claim model. The v0.6 "balance == 0 after drain" assertions are REPLACED by the
// per-token conservation identity:
//
//   balanceOf(bond, token) == sum(unclaimed credits[*][token])
//                             + sum(live-bond escrows for token)
//                             + judge-fees-not-yet-pushed (always 0 here: the fee is pushed inline)
//
// Plus C2-specific properties: no double-credit, no stranded funds, reentrancy cannot drain,
// fee-on-transfer surfaces a clean revert, N-pending settle -> each claims exactly its stake and
// the contract nets to zero.

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
    deployMockSUSDS,
    deployBondHarness,
    deployBond,
    deployJudgeProfileRegistry,
    deployForwardingJudge,
    createDefaultBond,
    fundAndApprove,
    DEFAULT_BOND_PARAMS,
} = require("../../helpers/v7/fixtures");

async function setupBond(overrides = {}, signerCount = 5) {
    const signers = await ethers.getSigners();
    const [poster] = signers;
    const challengers = signers.slice(1, signerCount);
    const token = await deployMockSUSDS();
    const { bond, judge, judgeProfileId } = await deployBondHarness({ withForwardingJudge: true });

    await fundAndApprove(token, bond, poster, ethers.parseEther("1000"));
    for (const c of challengers) await fundAndApprove(token, bond, c, ethers.parseEther("1000"));

    await createDefaultBond(bond, poster, token, judge, judgeProfileId, overrides);
    return {
        poster,
        challengers,
        token,
        bond,
        judge,
        judgeProfileId,
        p: { ...DEFAULT_BOND_PARAMS, ...overrides },
    };
}

async function forward(judge, bond, fn, args) {
    const data = bond.interface.encodeFunctionData(fn, args);
    return judge.forward(await bond.getAddress(), data);
}

// Sum the unclaimed credits across a set of recipients for one token.
async function sumCredits(bond, token, recipients) {
    const tokenAddr = await token.getAddress();
    let total = 0n;
    for (const r of recipients) total += await bond.credits(r, tokenAddr);
    return total;
}

describe("SimpleBondV7 invariants — per-token conservation (credit model)", () => {
    it("balance == unclaimed credits + live escrow across a full lifecycle", async () => {
        const { poster, challengers, token, bond, judge, p } = await setupBond();
        const bondAddr = await bond.getAddress();
        const judgeAddr = await judge.getAddress();
        const [c0, c1, c2] = challengers;
        const accounts = [poster.address, c0.address, c1.address, c2.address];

        // The conservation identity must hold at EVERY step.
        // live escrow = bondAmount (while unsettled) + challengeAmount * (#challenges still escrowed,
        // i.e. Pending). Rather than track that by hand, we use the simpler global form:
        //   contractBalance == sum(unclaimed credits) + (escrow still owed to nobody-yet)
        // and assert the cross-check that contractBalance always equals
        //   (total deposited in) - (judge fees pushed out) - (credits already claimed out).
        let depositedIn = p.bondAmount; // createBond escrow
        let pushedOut = 0n; // judge fees
        let claimedOut = 0n; // credits pulled

        const assertConservation = async () => {
            const bal = await token.balanceOf(bondAddr);
            // (a) the books: balance == in - pushed - claimed.
            expect(bal).to.equal(depositedIn - pushedOut - claimedOut);
            // (b) balance is fully accounted: it is >= the sum of unclaimed credits (the rest is
            //     live escrow not yet credited).
            const credited = await sumCredits(bond, token, accounts);
            expect(bal).to.be.gte(credited);
        };

        await assertConservation();

        await bond.connect(c0).challenge(0, 1, "a");
        depositedIn += p.challengeAmount;
        await assertConservation();
        await bond.connect(c1).challenge(0, 1, "b");
        depositedIn += p.challengeAmount;
        await assertConservation();
        await bond.connect(c2).challenge(0, 1, "c");
        depositedIn += p.challengeAmount;
        await assertConservation();

        // concede #0 -> credits c0 (no balance change yet, credit not claimed).
        await bond.connect(poster).concede(0, 0, "ok");
        await assertConservation();

        // judge rejects #1 -> credits c1.
        await forward(judge, bond, "rejectChallenge", [0, 1, "oos"]);
        await assertConservation();

        // judge rules for poster on #2 after window -> pushes fee, credits poster.
        await time.increase(p.acceptanceDelay + 1);
        await forward(judge, bond, "ruleForPoster", [0, 2, p.judgeFee, "valid"]);
        pushedOut += p.judgeFee;
        expect(await token.balanceOf(judgeAddr)).to.equal(p.judgeFee);
        await assertConservation();

        // Everyone claims; track claimedOut.
        for (const c of [c0, c1]) {
            const owed = await bond.credits(c.address, await token.getAddress());
            if (owed > 0n) {
                await bond.connect(c).claim(await token.getAddress());
                claimedOut += owed;
            }
        }
        const posterOwed = await bond.credits(poster.address, await token.getAddress());
        if (posterOwed > 0n) {
            await bond.connect(poster).claim(await token.getAddress());
            claimedOut += posterOwed;
        }
        await assertConservation();

        // Close + withdraw the bond -> credits poster the bond back.
        await bond.connect(poster).closeBond(0);
        await bond.connect(poster).withdrawBond(0);
        await assertConservation();
        const w = await bond.credits(poster.address, await token.getAddress());
        await bond.connect(poster).claim(await token.getAddress());
        claimedOut += w;
        await assertConservation();

        // Fully settled and drained: balance is exactly zero.
        expect(await token.balanceOf(bondAddr)).to.equal(0n);
    });

    it("settle with N pending: each claims exactly challengeAmount; contract nets to zero", async () => {
        const N = 6;
        const { challengers, token, bond, judge, p } = await setupBond({ maxChallenges: 10 }, 1 + N);
        const tokenAddr = await token.getAddress();
        const bondAddr = await bond.getAddress();

        for (let i = 0; i < N; i++) {
            await bond.connect(challengers[i]).challenge(0, 1, `c${i}`);
        }
        // Void the bond -> all N pending credited their stake; poster credited the bond.
        await forward(judge, bond, "rejectBond", [0, "void"]);

        // Sum of unclaimed credits == everything in the contract.
        const recipients = [
            ...challengers.slice(0, N).map((c) => c.address),
            // poster:
            (await ethers.getSigners())[0].address,
        ];
        const totalCredits = await sumCredits(bond, token, recipients);
        expect(await token.balanceOf(bondAddr)).to.equal(totalCredits);
        expect(totalCredits).to.equal(p.bondAmount + BigInt(N) * p.challengeAmount);

        // Each challenger claims exactly challengeAmount.
        for (let i = 0; i < N; i++) {
            const before = await token.balanceOf(challengers[i].address);
            await bond.connect(challengers[i]).claim(tokenAddr);
            expect((await token.balanceOf(challengers[i].address)) - before).to.equal(p.challengeAmount);
        }
        // Poster claims the bond.
        const poster = (await ethers.getSigners())[0];
        const pBefore = await token.balanceOf(poster.address);
        await bond.connect(poster).claim(tokenAddr);
        expect((await token.balanceOf(poster.address)) - pBefore).to.equal(p.bondAmount);

        // Contract nets to zero.
        expect(await token.balanceOf(bondAddr)).to.equal(0n);
    });
});

describe("SimpleBondV7 invariants — no double-credit", () => {
    it("a rejected challenger is credited exactly once (settle loop skips terminal entries)", async () => {
        const { challengers, token, bond, judge, p } = await setupBond();
        const c0 = challengers[0];
        const tokenAddr = await token.getAddress();
        await bond.connect(c0).challenge(0, 1, "spam");

        await forward(judge, bond, "rejectChallenge", [0, 0, "oos"]);
        expect(await bond.credits(c0.address, tokenAddr)).to.equal(p.challengeAmount);

        // Now void the bond: the settle loop must SKIP c0 (already RejectedByJudge), not re-credit.
        await forward(judge, bond, "rejectBond", [0, "void"]);
        expect(await bond.credits(c0.address, tokenAddr)).to.equal(p.challengeAmount); // unchanged

        // c0 can claim only once.
        await bond.connect(c0).claim(tokenAddr);
        await expect(bond.connect(c0).claim(tokenAddr)).to.be.revertedWith("Nothing to claim");
    });

    it("winner is not also credited as a pending loser", async () => {
        const { challengers, token, bond, judge, p } = await setupBond();
        const [c0, c1] = challengers;
        const tokenAddr = await token.getAddress();
        await bond.connect(c0).challenge(0, 1, "a");
        await bond.connect(c1).challenge(0, 1, "b");
        await time.increase(p.acceptanceDelay + 1);

        await forward(judge, bond, "ruleForChallenger", [0, 0, 0n, "c0 wins"]);
        // c0 credited bond + stake ONLY (not bond + 2*stake).
        expect(await bond.credits(c0.address, tokenAddr)).to.equal(p.bondAmount + p.challengeAmount);
        // c1 credited stake back exactly once.
        expect(await bond.credits(c1.address, tokenAddr)).to.equal(p.challengeAmount);
    });
});

describe("SimpleBondV7 invariants — no stranded funds", () => {
    it("every pending challenger at settlement is credited; sum reconciles to balance", async () => {
        const { challengers, token, bond, judge, p } = await setupBond({ maxChallenges: 5 }, 5);
        const [c0, c1, c2, c3] = challengers;
        const tokenAddr = await token.getAddress();
        const bondAddr = await bond.getAddress();
        await bond.connect(c0).challenge(0, 1, "a");
        await bond.connect(c1).challenge(0, 1, "b");
        await bond.connect(c2).challenge(0, 1, "c");
        await bond.connect(c3).challenge(0, 1, "d");

        const poster = (await ethers.getSigners())[0];
        await forward(judge, bond, "rejectBond", [0, "void"]);

        // No Pending entry remains; pendingCount swept to 0.
        const len = Number(await bond.getChallengeCount(0));
        for (let i = 0; i < len; i++) {
            expect((await bond.getChallenge(0, i)).status).to.not.equal(0n); // not Pending
        }
        expect((await bond.bonds(0)).pendingCount).to.equal(0n);

        // Sum of unclaimed credits exactly equals the contract balance (nothing stranded, nothing
        // over-credited).
        const total = await sumCredits(bond, token, [
            poster.address,
            c0.address,
            c1.address,
            c2.address,
            c3.address,
        ]);
        expect(total).to.equal(await token.balanceOf(bondAddr));
        expect(total).to.equal(p.bondAmount + 4n * p.challengeAmount);
    });
});

describe("SimpleBondV7 invariants — claimVersion, status, settled gates (ported)", () => {
    it("claimVersion is strictly monotonic across modifyClaim calls", async () => {
        const { poster, bond } = await setupBond();
        let prev = (await bond.bonds(0)).claimVersion;
        for (let k = 0; k < 5; k++) {
            await bond.connect(poster).modifyClaim(0, `v${k + 2}`);
            const next = (await bond.bonds(0)).claimVersion;
            expect(next).to.be.greaterThan(prev);
            prev = next;
        }
    });

    it("terminal challenge statuses never regress", async () => {
        const { poster, challengers, bond, judge, p } = await setupBond();
        const [c0, c1, c2] = challengers;
        await bond.connect(c0).challenge(0, 1, "a");
        await bond.connect(c1).challenge(0, 1, "b");
        await bond.connect(c2).challenge(0, 1, "c");

        await bond.connect(poster).concede(0, 0, "ok");
        expect((await bond.getChallenge(0, 0)).status).to.equal(3n);

        await time.increase(p.acceptanceDelay + 1);
        await forward(judge, bond, "ruleForPoster", [0, 1, 0n, "valid"]);
        expect((await bond.getChallenge(0, 1)).status).to.equal(2n);

        await forward(judge, bond, "rejectChallenge", [0, 2, "oos"]);
        expect((await bond.getChallenge(0, 2)).status).to.equal(4n);

        await expect(bond.connect(poster).concede(0, 0, "again")).to.be.reverted;
        await expect(forward(judge, bond, "ruleForPoster", [0, 1, 0n, "again"])).to.be.reverted;
        await expect(forward(judge, bond, "rejectChallenge", [0, 2, "again"])).to.be.reverted;
    });

    it("settled bonds reject new challenges, rulings, modifyClaim, withdraw, concede", async () => {
        const { poster, challengers, bond, judge, p } = await setupBond();
        const c0 = challengers[0];
        await bond.connect(c0).challenge(0, 1, "x");
        await time.increase(p.acceptanceDelay + 1);
        await forward(judge, bond, "ruleForChallenger", [0, 0, 0n, "winner"]);
        expect((await bond.bonds(0)).settled).to.equal(true);

        await expect(bond.connect(challengers[1]).challenge(0, 1, "y")).to.be.reverted;
        await expect(bond.connect(poster).modifyClaim(0, "z")).to.be.reverted;
        await expect(bond.connect(poster).withdrawBond(0)).to.be.reverted;
        await expect(bond.connect(poster).concede(0, 0, "x")).to.be.reverted;
        await expect(bond.connect(poster).closeBond(0)).to.be.reverted;
        await expect(bond.connect(poster).openBond(0)).to.be.reverted;
        await expect(forward(judge, bond, "ruleForPoster", [0, 0, 0n, "x"])).to.be.reverted;
        await expect(forward(judge, bond, "rejectChallenge", [0, 0, "x"])).to.be.reverted;
        await expect(forward(judge, bond, "rejectBond", [0, "x"])).to.be.reverted;
    });

    it("pendingCount == count of Pending statuses for an UNSETTLED bond; swept to 0 on settle", async () => {
        const { poster, challengers, bond, judge } = await setupBond();
        const countPending = async () => {
            const n = Number(await bond.getChallengeCount(0));
            let c = 0n;
            for (let i = 0; i < n; i++) if ((await bond.getChallenge(0, i)).status === 0n) c += 1n;
            return c;
        };
        const check = async (label) => {
            expect((await bond.bonds(0)).pendingCount, label).to.equal(await countPending());
        };

        await bond.connect(challengers[0]).challenge(0, 1, "a");
        await check("after first challenge");
        await bond.connect(challengers[1]).challenge(0, 1, "b");
        await check("after second challenge");
        await bond.connect(poster).concede(0, 0, "ok");
        await check("after concede");
        await forward(judge, bond, "rejectChallenge", [0, 1, "oos"]);
        await check("after reject");
        expect((await bond.bonds(0)).pendingCount).to.equal(0n);

        // After a settling action (V7 sweeps pendingCount to 0, unlike V6 which left it stale).
        await bond.connect(challengers[2]).challenge(0, 1, "c");
        await forward(judge, bond, "rejectBond", [0, "void"]);
        expect((await bond.bonds(0)).pendingCount).to.equal(0n);
        // And no Pending statuses remain.
        expect(await countPending()).to.equal(0n);
    });
});

describe("SimpleBondV7 — reentrancy mock cannot drain claim()", () => {
    async function setupReentrant() {
        const signers = await ethers.getSigners();
        const [poster] = signers;
        const registry = await deployJudgeProfileRegistry();
        const bond = await deployBond(await registry.getAddress());
        const judge = await deployForwardingJudge();
        const tx = await registry.registerProfile(await judge.getAddress(), "reentrant judge");
        const r = await tx.wait();
        const judgeProfileId = r.logs.find((l) => l.fragment && l.fragment.name === "ProfileRegistered")
            .args.entryId;

        const Tok = await ethers.getContractFactory("MockReentrantToken");
        const token = await Tok.deploy();
        await token.waitForDeployment();

        return { poster, bond, judge, judgeProfileId, token };
    }

    it("nested claim() inside the payout transfer reverts; attacker nets exactly their credit", async () => {
        const { poster, bond, judge, judgeProfileId, token } = await setupReentrant();
        const signers = await ethers.getSigners();
        const attacker = signers[1];
        const tokenAddr = await token.getAddress();
        const bondAddr = await bond.getAddress();

        const p = { ...DEFAULT_BOND_PARAMS };
        await fundAndApprove(token, bond, poster, ethers.parseEther("1000"));
        await fundAndApprove(token, bond, attacker, ethers.parseEther("1000"));
        await createDefaultBond(bond, poster, token, judge, judgeProfileId, {});

        // Attacker challenges, then is conceded -> credited challengeAmount.
        await bond.connect(attacker).challenge(0, 1, "evil");
        await bond.connect(poster).concede(0, 0, "ok");
        expect(await bond.credits(attacker.address, tokenAddr)).to.equal(p.challengeAmount);

        // Over-fund the bond so that IF the guard failed and a double-pay occurred, the contract
        // WOULD have the liquidity to pay twice. This makes the test prove the guard, not just a
        // balance shortfall.
        await token.mint(bondAddr, ethers.parseEther("100"));
        const bondBalBefore = await token.balanceOf(bondAddr);

        // Arm the re-entrancy and claim. The nested claim() must revert (caught by the token), so
        // the attacker is paid exactly once.
        await token.arm(bondAddr);
        const aBefore = await token.balanceOf(attacker.address);
        await bond.connect(attacker).claim(tokenAddr);
        const aAfter = await token.balanceOf(attacker.address);

        // Attacker netted exactly the credited amount (no double-spend).
        expect(aAfter - aBefore).to.equal(p.challengeAmount);
        // The nested call was attempted and reverted.
        expect(await token.reentered()).to.equal(true);
        expect(await token.reentryReverted()).to.equal(true);
        // Ledger zeroed; second claim reverts.
        expect(await bond.credits(attacker.address, tokenAddr)).to.equal(0n);
        await token.disarm();
        await expect(bond.connect(attacker).claim(tokenAddr)).to.be.revertedWith("Nothing to claim");
        // Contract lost exactly challengeAmount (one legitimate payout), not 2x.
        expect(bondBalBefore - (await token.balanceOf(bondAddr))).to.equal(p.challengeAmount);
    });
});

describe("SimpleBondV7 — fee-on-transfer token surfaces a clean revert", () => {
    async function setupFeeToken(feeBps) {
        const signers = await ethers.getSigners();
        const [poster] = signers;
        const registry = await deployJudgeProfileRegistry();
        const bond = await deployBond(await registry.getAddress());
        const judge = await deployForwardingJudge();
        const tx = await registry.registerProfile(await judge.getAddress(), "fee judge");
        const r = await tx.wait();
        const judgeProfileId = r.logs.find((l) => l.fragment && l.fragment.name === "ProfileRegistered")
            .args.entryId;

        const Tok = await ethers.getContractFactory("MockFeeToken");
        const token = await Tok.deploy(feeBps);
        await token.waitForDeployment();
        return { poster, bond, judge, judgeProfileId, token };
    }

    it("credit model over-promises vs the taxed escrow, so a later claim reverts (not silent)", async () => {
        const { poster, bond, judge, judgeProfileId, token } = await setupFeeToken(100); // 1% fee
        const signers = await ethers.getSigners();
        const challenger = signers[1];
        const tokenAddr = await token.getAddress();
        const p = { ...DEFAULT_BOND_PARAMS };

        await fundAndApprove(token, bond, poster, ethers.parseEther("1000"));
        await fundAndApprove(token, bond, challenger, ethers.parseEther("1000"));
        await createDefaultBond(bond, poster, token, judge, judgeProfileId, {});

        // Single challenge, then concede -> challenger credited the FULL challengeAmount even
        // though the fee token only delivered challengeAmount * 0.99 to the escrow.
        await bond.connect(challenger).challenge(0, 1, "x");
        await bond.connect(poster).concede(0, 0, "ok");
        expect(await bond.credits(challenger.address, tokenAddr)).to.equal(p.challengeAmount);

        // The contract holds bondAmount*0.99 + challengeAmount*0.99 (both taxed on the way in).
        // The poster is owed bondAmount and the challenger challengeAmount in credits = full,
        // untaxed totals. Draining both in full exceeds the real balance, and the LAST claim
        // reverts cleanly (ERC20InsufficientBalance) rather than silently shorting a claimant.
        await bond.connect(poster).closeBond(0);
        await bond.connect(poster).withdrawBond(0); // credits poster bondAmount

        // Both claim full credited amounts; the second one to drain hits the shortfall and reverts.
        await bond.connect(challenger).claim(tokenAddr); // first claim may succeed
        await expect(bond.connect(poster).claim(tokenAddr)).to.be.reverted; // shortfall, clean revert
    });
});
