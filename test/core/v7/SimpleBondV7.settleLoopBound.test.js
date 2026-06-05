// SimpleBondV7 — settle-loop gas-bound regression (the CRITICAL fund-stranding bug).
//
// THE BUG (security-panel CRITICAL, exploit-verified): the C2 settlement sweep
// (`_creditPendingLosers` and every pending-scan) used to iterate the FULL append-only
// `challenges[bondId]` array. C1 deliberately makes that array CUMULATIVE and unbounded:
// spam-to-cap -> judge-rejects-all -> refile recycles a single stake per cycle (O(1) capital)
// and grows `challenges[].length` without bound, while `pendingCount` (the LIVE set) stays
// <= maxChallenges <= MAX_CHALLENGES_CEILING. So once the history was long enough, EVERY
// settlement path (ruleForChallenger losers / rejectBond / claimTimeout) exceeded the block
// gas limit and reverted PERMANENTLY -> the bond could never settle -> the poster bond + all
// genuinely-pending stakes were STRANDED FOREVER.
//
// THE FIX: bound every settle/pending-scan loop on the LIVE pending set (an explicit per-bond
// `pendingIds` list), so iterations are <= maxChallenges independent of `challenges[].length`.
//
// These tests grow `challenges[].length` HUGE (via spammer signers) while keeping `pendingCount`
// tiny (via a SEPARATE pool of fresh pending challengers, so their credit reflects only the
// genuine refund), then settle and assert: (1) settlement SUCCEEDS, (2) every still-pending
// challenger is credited exactly challengeAmount, (3) per-token conservation holds, and (4) the
// settle cost does NOT scale with `challenges[].length` (gasUsed for a HUGE-history settle is
// ~equal to a small-history baseline, NOT length-proportional).

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

// Set up a bond plus two DISJOINT pools of signers:
//   spammers       — drive the spam-then-reject cycles that grow challenges[].length.
//   pendingPool    — fresh challengers used ONLY for genuinely-pending challenges at settle time,
//                    so their `credits` reflect exactly their refund (no spam-refund accumulation).
async function setupBond(overrides = {}, { nSpammers = 4, nPending = 3 } = {}) {
    const signers = await ethers.getSigners();
    const [poster] = signers;
    const spammers = signers.slice(1, 1 + nSpammers);
    const pendingPool = signers.slice(1 + nSpammers, 1 + nSpammers + nPending);
    const token = await deployMockSUSDS();
    const { bond, judge, judgeProfileId } = await deployBondHarness({ withForwardingJudge: true });

    for (const s of [poster, ...spammers, ...pendingPool]) {
        await fundAndApprove(token, bond, s, ethers.parseEther("1000000"));
    }

    await createDefaultBond(bond, poster, token, judge, judgeProfileId, overrides);
    return {
        poster,
        spammers,
        pendingPool,
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

// Grow challenges[].length to >= `targetLen` using O(1) recycled capital:
//   file `cap` challenges (fills the LIVE set), judge rejects ALL of them (frees the LIVE set),
//   repeat. Each cycle appends `cap` entries to the append-only challenges[] but resets the live
//   pending set to empty. Leaves `pendingCount == 0` and the bond UNSETTLED. Uses only `spammers`.
async function growHistory(bond, judge, spammers, cap, targetLen) {
    let len = Number(await bond.getChallengeCount(0));
    while (len < targetLen) {
        const idxStart = len;
        for (let k = 0; k < cap; k++) {
            await bond.connect(spammers[k % spammers.length]).challenge(0, 1, `spam-${idxStart + k}`);
        }
        for (let k = 0; k < cap; k++) {
            await forward(judge, bond, "rejectChallenge", [0, idxStart + k, "oos"]);
        }
        len = Number(await bond.getChallengeCount(0));
    }
    return len;
}

async function sumCredits(bond, tokenAddr, addrs) {
    let total = 0n;
    for (const a of addrs) total += await bond.credits(a, tokenAddr);
    return total;
}

describe("SimpleBondV7 — settle loop is bounded by the LIVE pending set, not challenges[].length", () => {
    const cap = 8; // small cap so each spam cycle is cheap to drive in the test
    const nPending = 3;
    const TARGET_LEN = 320; // >> cap; ~40 spam-then-reject cycles -> huge history

    it("rejectBond settles a HUGE-history bond; pending credited exactly; gas ~constant vs baseline", async () => {
        const overrides = { maxChallenges: cap };

        // ---- BASELINE: tiny history (no spam). nPending real challenges, then settle. ----
        const base = await setupBond(overrides, { nSpammers: cap, nPending });
        for (let i = 0; i < nPending; i++) {
            await base.bond.connect(base.pendingPool[i]).challenge(0, 1, `real-${i}`);
        }
        expect((await base.bond.bonds(0)).pendingCount).to.equal(BigInt(nPending));
        const baseLenAtSettle = Number(await base.bond.getChallengeCount(0));
        const baseTx = await forward(base.judge, base.bond, "rejectBond", [0, "void"]);
        const baseGas = (await baseTx.wait()).gasUsed;

        // ---- EXPLOIT CASE: grow challenges[].length HUGE, then nPending fresh challenges, settle. ----
        const huge = await setupBond(overrides, { nSpammers: cap, nPending });
        const tokenAddr = await huge.token.getAddress();
        const bondAddr = await huge.bond.getAddress();

        const grownLen = await growHistory(huge.bond, huge.judge, huge.spammers, cap, TARGET_LEN);
        expect(grownLen).to.be.gte(TARGET_LEN);
        expect((await huge.bond.bonds(0)).pendingCount).to.equal(0n);
        expect((await huge.bond.bonds(0)).settled).to.equal(false);

        // Fresh pending challengers (never spammed) -> their credit will be exactly challengeAmount.
        const firstNewIdx = grownLen;
        for (let i = 0; i < nPending; i++) {
            await huge.bond.connect(huge.pendingPool[i]).challenge(0, 1, `real-${i}`);
        }
        expect((await huge.bond.bonds(0)).pendingCount).to.equal(BigInt(nPending));
        const hugeLenAtSettle = Number(await huge.bond.getChallengeCount(0));

        // (1) Settlement SUCCEEDS on the huge-history bond (the bug made this revert forever).
        const hugeTx = await forward(huge.judge, huge.bond, "rejectBond", [0, "void"]);
        const hugeGas = (await hugeTx.wait()).gasUsed;
        expect((await huge.bond.bonds(0)).settled).to.equal(true);
        expect((await huge.bond.bonds(0)).pendingCount).to.equal(0n);

        // (2) Every genuinely-pending challenger credited EXACTLY challengeAmount; poster the bond.
        for (let i = 0; i < nPending; i++) {
            expect(await huge.bond.credits(huge.pendingPool[i].address, tokenAddr)).to.equal(
                huge.p.challengeAmount
            );
            expect((await huge.bond.getChallenge(0, firstNewIdx + i)).status).to.equal(5n); // Refunded
        }
        expect(await huge.bond.credits(huge.poster.address, tokenAddr)).to.equal(huge.p.bondAmount);

        // (3) Per-token conservation: contract balance == sum of ALL unclaimed credits (spammers'
        //     refunds + the new pending + poster). Nothing stranded, nothing over-credited.
        const everyone = [
            huge.poster.address,
            ...huge.spammers.map((s) => s.address),
            ...huge.pendingPool.map((s) => s.address),
        ];
        expect(await huge.token.balanceOf(bondAddr)).to.equal(
            await sumCredits(huge.bond, tokenAddr, everyone)
        );

        // (3b) Each pending challenger can claim exactly challengeAmount.
        for (let i = 0; i < nPending; i++) {
            const before = await huge.token.balanceOf(huge.pendingPool[i].address);
            await huge.bond.connect(huge.pendingPool[i]).claim(tokenAddr);
            expect((await huge.token.balanceOf(huge.pendingPool[i].address)) - before).to.equal(
                huge.p.challengeAmount
            );
        }

        // (4) THE CORE ASSERTION: settle cost does NOT scale with challenges[].length. The huge
        //     history is >40x the baseline array; with the unbounded-array bug, hugeGas would scale
        //     ~linearly with it and blow the block gas limit. Bounded on the LIVE set, both settles
        //     iterate the same `nPending` entries, so gas is ~equal (small slack for delete cleanup).
        expect(hugeLenAtSettle).to.be.greaterThan(40 * baseLenAtSettle);
        expect(hugeGas).to.be.lte((baseGas * 150n) / 100n); // within 1.5x baseline
        expect(hugeGas).to.be.lt(baseGas * 5n); // nowhere near length-proportional
    });

    it("ruleForChallenger settles a HUGE-history bond; winner + losers credited; gas bounded", async () => {
        const overrides = { maxChallenges: cap };

        // Baseline ruleForChallenger settle with a tiny history.
        const base = await setupBond(overrides, { nSpammers: cap, nPending });
        for (let i = 0; i < nPending; i++) {
            await base.bond.connect(base.pendingPool[i]).challenge(0, 1, `real-${i}`);
        }
        await time.increase(base.p.acceptanceDelay + 1);
        const baseLenAtSettle = Number(await base.bond.getChallengeCount(0));
        const baseTx = await forward(base.judge, base.bond, "ruleForChallenger", [0, 0, 0n, "c0 wins"]);
        const baseGas = (await baseTx.wait()).gasUsed;

        // Exploit case: huge history, then nPending fresh challenges, then ruleForChallenger.
        const huge = await setupBond(overrides, { nSpammers: cap, nPending });
        const tokenAddr = await huge.token.getAddress();
        const bondAddr = await huge.bond.getAddress();
        const grownLen = await growHistory(huge.bond, huge.judge, huge.spammers, cap, TARGET_LEN);

        const firstNewIdx = grownLen;
        for (let i = 0; i < nPending; i++) {
            await huge.bond.connect(huge.pendingPool[i]).challenge(0, 1, `real-${i}`);
        }
        await time.increase(huge.p.acceptanceDelay + 1);
        const hugeLenAtSettle = Number(await huge.bond.getChallengeCount(0));

        // Settlement SUCCEEDS (winner = first of the new pending challenges).
        const winnerIdx = firstNewIdx;
        const hugeTx = await forward(huge.judge, huge.bond, "ruleForChallenger", [0, winnerIdx, 0n, "winner"]);
        const hugeGas = (await hugeTx.wait()).gasUsed;
        expect((await huge.bond.bonds(0)).settled).to.equal(true);
        expect((await huge.bond.bonds(0)).pendingCount).to.equal(0n);

        // Winner credited bond + stake; the other pending challengers credited their stake (Lost).
        expect(await huge.bond.credits(huge.pendingPool[0].address, tokenAddr)).to.equal(
            huge.p.bondAmount + huge.p.challengeAmount
        );
        expect((await huge.bond.getChallenge(0, winnerIdx)).status).to.equal(1n); // Won
        for (let i = 1; i < nPending; i++) {
            expect(await huge.bond.credits(huge.pendingPool[i].address, tokenAddr)).to.equal(
                huge.p.challengeAmount
            );
            expect((await huge.bond.getChallenge(0, firstNewIdx + i)).status).to.equal(2n); // Lost
        }

        // Conservation: contract balance == sum of ALL unclaimed credits.
        const everyone = [
            huge.poster.address,
            ...huge.spammers.map((s) => s.address),
            ...huge.pendingPool.map((s) => s.address),
        ];
        expect(await huge.token.balanceOf(bondAddr)).to.equal(
            await sumCredits(huge.bond, tokenAddr, everyone)
        );

        // Gas does NOT scale with the (40x-larger) history.
        expect(hugeLenAtSettle).to.be.greaterThan(40 * baseLenAtSettle);
        expect(hugeGas).to.be.lte((baseGas * 150n) / 100n);
        expect(hugeGas).to.be.lt(baseGas * 5n);
    });

    it("claimTimeout settles a HUGE-history bond and credits every still-pending challenger", async () => {
        const overrides = { maxChallenges: cap };
        const huge = await setupBond(overrides, { nSpammers: cap, nPending });
        const tokenAddr = await huge.token.getAddress();
        const bondAddr = await huge.bond.getAddress();

        const grownLen = await growHistory(huge.bond, huge.judge, huge.spammers, cap, 256);

        const firstNewIdx = grownLen;
        for (let i = 0; i < nPending; i++) {
            await huge.bond.connect(huge.pendingPool[i]).challenge(0, 1, `real-${i}`);
        }
        await time.increase(huge.p.acceptanceDelay + huge.p.rulingBuffer + 1);

        // Anyone times out via one of the new pending indices; the whole live set is swept.
        await huge.bond.connect(huge.pendingPool[0]).claimTimeout(0, firstNewIdx);
        expect((await huge.bond.bonds(0)).settled).to.equal(true);
        expect((await huge.bond.bonds(0)).pendingCount).to.equal(0n);

        for (let i = 0; i < nPending; i++) {
            expect(await huge.bond.credits(huge.pendingPool[i].address, tokenAddr)).to.equal(
                huge.p.challengeAmount
            );
            expect((await huge.bond.getChallenge(0, firstNewIdx + i)).status).to.equal(5n); // Refunded
        }
        expect(await huge.bond.credits(huge.poster.address, tokenAddr)).to.equal(huge.p.bondAmount);

        // Conservation holds.
        const everyone = [
            huge.poster.address,
            ...huge.spammers.map((s) => s.address),
            ...huge.pendingPool.map((s) => s.address),
        ];
        expect(await huge.token.balanceOf(bondAddr)).to.equal(
            await sumCredits(huge.bond, tokenAddr, everyone)
        );
    });

    it("settle visits exactly pendingCount entries regardless of history length (event count check)", async () => {
        // Independent of gas: assert the settle loop emits exactly `pendingCount` refund Credited
        // events (one per LIVE pending challenger) — NOT one per challenges[] entry. This pins the
        // "visited == pendingCount" property directly.
        const overrides = { maxChallenges: cap };
        const huge = await setupBond(overrides, { nSpammers: cap, nPending });
        await growHistory(huge.bond, huge.judge, huge.spammers, cap, 256);

        for (let i = 0; i < nPending; i++) {
            await huge.bond.connect(huge.pendingPool[i]).challenge(0, 1, `real-${i}`);
        }
        const lenAtSettle = Number(await huge.bond.getChallengeCount(0));
        expect(lenAtSettle).to.be.gte(256);

        const tx = await forward(huge.judge, huge.bond, "rejectBond", [0, "void"]);
        const receipt = await tx.wait();

        // Count Credited events emitted by THIS settle: 1 (poster bond) + nPending (each loser).
        let creditedCount = 0;
        for (const log of receipt.logs) {
            try {
                const parsed = huge.bond.interface.parseLog(log);
                if (parsed && parsed.name === "Credited") creditedCount += 1;
            } catch (_) {}
        }
        expect(creditedCount).to.equal(1 + nPending); // bounded by pendingCount, NOT lenAtSettle
    });
});
