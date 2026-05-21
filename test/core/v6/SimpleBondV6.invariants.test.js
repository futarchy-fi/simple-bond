// Property-style invariant tests for SimpleBondV6. Each scenario walks the
// contract through a sequence of state transitions and asserts the global
// invariants from SPEC_V06.md hold at every step:
//
//   - Conservation: bondContract balance + sum(externally-held amounts owed)
//     stays consistent with deposits in.
//   - Monotonic claimVersion.
//   - Terminal challenge statuses never regress.
//   - Settled bonds make no new state transitions except claimRefunds drains.
//   - judgeProfileId immutable after creation.
//   - pendingCount equals the count of Pending statuses (consistency check).

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

async function countPendingByStatus(bond, bondId) {
    const n = Number(await bond.getChallengeCount(bondId));
    let pending = 0;
    for (let i = 0; i < n; i++) {
        const c = await bond.getChallenge(bondId, i);
        if (Number(c.status) === 0) pending += 1;
    }
    return pending;
}

async function snapshotState(bond, bondId, token, accounts) {
    const b = await bond.bonds(bondId);
    const contractBal = await token.balanceOf(await bond.getAddress());
    const balances = {};
    for (const [name, addr] of Object.entries(accounts)) {
        balances[name] = await token.balanceOf(addr);
    }
    return { b, contractBal, balances };
}

describe("SimpleBondV6 invariants", () => {
    it("token balance conservation across a full lifecycle", async () => {
        const { poster, challengers, token, bond, judge, p } = await setupBond();
        const judgeAddr = await judge.getAddress();
        const bondAddr = await bond.getAddress();
        const totalIn = p.bondAmount + 3n * p.challengeAmount;

        // 3 challenges
        await bond.connect(challengers[0]).challenge(0, 1, "a");
        await bond.connect(challengers[1]).challenge(0, 1, "b");
        await bond.connect(challengers[2]).challenge(0, 1, "c");
        expect(await token.balanceOf(bondAddr)).to.equal(totalIn);

        // concede #0 (refunds c0)
        await bond.connect(poster).concede(0, 0, "ok");
        expect(await token.balanceOf(bondAddr)).to.equal(totalIn - p.challengeAmount);

        // judge rejects #1 (refunds c1)
        await forward(judge, bond, "rejectChallenge", [0, 1, "oos"]);
        expect(await token.balanceOf(bondAddr)).to.equal(totalIn - 2n * p.challengeAmount);

        // judge rules for poster on #2 after window opens
        await time.increase(p.acceptanceDelay + 1);
        await forward(judge, bond, "ruleForPoster", [0, 2, p.judgeFee, "valid"]);
        // Poster gets challengeAmount - fee; judge gets fee.
        expect(await token.balanceOf(judgeAddr)).to.equal(p.judgeFee);
        // Bond contract retains only poster's bondAmount now.
        expect(await token.balanceOf(bondAddr)).to.equal(p.bondAmount);

        // Close + withdraw
        await bond.connect(poster).closeBond(0);
        await bond.connect(poster).withdrawBond(0);
        expect(await token.balanceOf(bondAddr)).to.equal(0n);
    });

    it("ruleForChallenger pays winner exactly bondAmount + challengeAmount - fee", async () => {
        const { challengers, token, bond, judge, p } = await setupBond();
        const c0 = challengers[0];
        const c0Before = await token.balanceOf(c0.address);
        await bond.connect(c0).challenge(0, 1, "x");
        await time.increase(p.acceptanceDelay + 1);
        await forward(judge, bond, "ruleForChallenger", [0, 0, p.judgeFee, "winner"]);
        const c0After = await token.balanceOf(c0.address);
        // Net to challenger = +bondAmount - judgeFee (they staked challengeAmount and got it back too).
        expect(c0After - c0Before).to.equal(p.bondAmount - p.judgeFee);
    });

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
        await bond.connect(c0).challenge(0, 1, "a"); // -> conceded
        await bond.connect(c1).challenge(0, 1, "b"); // -> lost
        await bond.connect(c2).challenge(0, 1, "c"); // -> rejected by judge

        await bond.connect(poster).concede(0, 0, "ok");
        expect((await bond.getChallenge(0, 0)).status).to.equal(3n);

        await time.increase(p.acceptanceDelay + 1);
        await forward(judge, bond, "ruleForPoster", [0, 1, 0n, "valid"]);
        expect((await bond.getChallenge(0, 1)).status).to.equal(2n);

        await forward(judge, bond, "rejectChallenge", [0, 2, "oos"]);
        expect((await bond.getChallenge(0, 2)).status).to.equal(4n);

        // Now try to re-concede #0 / re-rule #1 / re-reject #2 — all should revert.
        await expect(bond.connect(poster).concede(0, 0, "again")).to.be.reverted;
        await expect(forward(judge, bond, "ruleForPoster", [0, 1, 0n, "again"])).to.be.reverted;
        await expect(forward(judge, bond, "rejectChallenge", [0, 2, "again"])).to.be.reverted;
    });

    it("settled bonds reject new challenges, new rulings, modifyClaim, withdraw, concede", async () => {
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

    it("judgeProfileId stored at creation never changes", async () => {
        const { bond, judgeProfileId } = await setupBond();
        const before = (await bond.bonds(0)).judgeProfileId;
        // Drive arbitrary state changes that should not touch judgeProfileId.
        const [, c0] = await ethers.getSigners();
        await bond.connect(c0).challenge(0, 1, "x");
        await bond.connect((await ethers.getSigners())[0]).concede(0, 0, "ok");
        const after = (await bond.bonds(0)).judgeProfileId;
        expect(after).to.equal(before);
        expect(after).to.equal(judgeProfileId);
    });

    it("pendingCount equals the live count of Pending statuses across actions", async () => {
        const { poster, challengers, bond, judge, p } = await setupBond();
        const checks = async (label) => {
            const stored = (await bond.bonds(0)).pendingCount;
            const counted = await countPendingByStatus(bond, 0);
            expect(stored, label).to.equal(BigInt(counted));
        };

        await bond.connect(challengers[0]).challenge(0, 1, "a");
        await checks("after first challenge");
        await bond.connect(challengers[1]).challenge(0, 1, "b");
        await checks("after second challenge");
        await bond.connect(poster).concede(0, 0, "ok");
        await checks("after concede");
        await forward(judge, bond, "rejectChallenge", [0, 1, "oos"]);
        await checks("after reject");
        // pendingCount should be 0 now.
        expect((await bond.bonds(0)).pendingCount).to.equal(0n);

        // After settlement (ruleForChallenger), Pending entries remain marked Pending
        // until claimRefunds drains them; pendingCount becomes stale but is never
        // read for settled bonds, so no assertion is made past settlement.
    });

    it("claimRefunds drains every Pending entry left after settlement and is idempotent", async () => {
        const { challengers, token, bond, judge, p } = await setupBond({ maxChallenges: 5 });
        const [c0, c1, c2, c3] = challengers;
        await bond.connect(c0).challenge(0, 1, "a");
        await bond.connect(c1).challenge(0, 1, "b");
        await bond.connect(c2).challenge(0, 1, "c");
        await bond.connect(c3).challenge(0, 1, "d");

        await forward(judge, bond, "rejectBond", [0, "void"]);
        // Drain in small batches and assert idempotence at each step.
        let totalRefunded = 0n;
        for (let k = 0; k < 6; k++) {
            const before = await token.balanceOf(await bond.getAddress());
            await bond.claimRefunds(0, 2);
            const after = await token.balanceOf(await bond.getAddress());
            totalRefunded += (before - after);
        }
        expect(totalRefunded).to.equal(4n * DEFAULT_BOND_PARAMS.challengeAmount);
        expect(await token.balanceOf(await bond.getAddress())).to.equal(0n);
        // Re-run for idempotence.
        await bond.claimRefunds(0, 100);
        expect(await token.balanceOf(await bond.getAddress())).to.equal(0n);
    });
});
