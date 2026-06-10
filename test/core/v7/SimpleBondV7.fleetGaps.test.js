// Test gaps surfaced by the multi-agent cross-check (AUDIT-v7-2026-06.md §6,
// tests-deploy lens, findings TD5-TD9) — each describe names its finding:
//   TD5  claimTimeout with multiple pending challenges at different timestamps
//        (the earliest-expiring challenge settles the WHOLE bond — inherited v6
//        semantics, judge-liveness-bounded; this test pins the behavior)
//   TD6  settlement at pendingCount == MAX_CHALLENGES_CEILING (worst-case sweep gas)
//   TD7  judgeFee == challengeAmount boundary (zero poster credit, no Credited event)
//   TD8  modifyClaim positive path (post-modify challenge pins the NEW version/hash)
//   TD9  _removePending swap-and-pop edges driven through the public surface

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

async function forward(judge, bond, fn, args) {
    const data = bond.interface.encodeFunctionData(fn, args);
    return judge.forward(await bond.getAddress(), data);
}

async function setup(overrides = {}) {
    const signers = await ethers.getSigners();
    const [poster, c1, c2] = signers;
    const token = await deployMockSUSDS();
    const { bond, judge, judgeProfileId } = await deployBondHarness({
        withForwardingJudge: true,
        tokens: [token],
    });
    for (const s of [poster, c1, c2]) await fundAndApprove(token, bond, s, ethers.parseEther("100000"));
    await createDefaultBond(bond, poster, token, judge, judgeProfileId, overrides);
    return { poster, c1, c2, token, bond, judge };
}

describe("TD5 — claimTimeout with multiple pending challenges at different timestamps", () => {
    it("timing out the EARLIEST challenge settles the whole bond; the later (still-in-window) challenge is swept Refunded", async () => {
        const p = { ...DEFAULT_BOND_PARAMS };
        const { poster, c1, c2, token, bond } = await setup();
        const tokenAddr = await token.getAddress();

        await bond.connect(c1).challenge(0, 1, "early challenge");
        // File the second challenge much later, so its ruling window is still
        // open (even unopened) when the first one's deadline passes.
        await time.increase(p.acceptanceDelay + p.rulingBuffer - 60);
        await bond.connect(c2).challenge(0, 1, "late challenge");

        // Past challenge 0's ruling deadline; challenge 1's window not yet open.
        await time.increase(61);
        expect(await time.latest()).to.be.greaterThan(Number(await bond.rulingDeadline(0, 0)));
        expect(await time.latest()).to.be.lessThan(Number(await bond.rulingWindowStart(0, 1)));

        // ANY caller can trigger; bond settles in the poster's favor.
        await bond.connect(c2).claimTimeout(0, 0);
        const b = await bond.bonds(0);
        expect(b.settled).to.equal(true);
        expect(b.pendingCount).to.equal(0n);

        // Poster credited the bond back; BOTH challengers swept Refunded with
        // their stake — including the late one whose window never opened.
        expect(await bond.credits(poster.address, tokenAddr)).to.equal(p.bondAmount);
        expect(await bond.credits(c1.address, tokenAddr)).to.equal(p.challengeAmount);
        expect(await bond.credits(c2.address, tokenAddr)).to.equal(p.challengeAmount);
        expect((await bond.getChallenge(0, 0)).status).to.equal(5n); // Refunded
        expect((await bond.getChallenge(0, 1)).status).to.equal(5n); // Refunded

        // Conservation: every wei escrowed is credited; contract nets to zero
        // after all pulls.
        for (const s of [poster, c1, c2]) await bond.connect(s).claim(tokenAddr);
        expect(await token.balanceOf(await bond.getAddress())).to.equal(0n);
    });

    it("a challenge whose own deadline has NOT passed cannot be used to time out", async () => {
        const p = { ...DEFAULT_BOND_PARAMS };
        const { c1, c2, bond } = await setup();
        await bond.connect(c1).challenge(0, 1, "early");
        await time.increase(p.acceptanceDelay + p.rulingBuffer - 60);
        await bond.connect(c2).challenge(0, 1, "late");
        await time.increase(61);
        // Challenge 1 is Pending but inside its window -> NOT timeout-able.
        await expect(bond.claimTimeout(0, 1)).to.be.revertedWith("Ruling window still open");
    });
});

describe("TD6 — settlement sweep at the MAX_CHALLENGES_CEILING (worst-case gas)", () => {
    it("ruleForChallenger settles a bond with 100 pending challenges within a sane gas budget", async function () {
        this.timeout(120_000);
        const p = { ...DEFAULT_BOND_PARAMS };
        const { c1, token, bond, judge } = await setup({ maxChallenges: 100 });
        const tokenAddr = await token.getAddress();
        await fundAndApprove(token, bond, c1, ethers.parseEther("1000000"));

        const CEILING = Number(await bond.MAX_CHALLENGES_CEILING());
        for (let i = 0; i < CEILING; i++) await bond.connect(c1).challenge(0, 1, `c${i}`);
        expect((await bond.bonds(0)).pendingCount).to.equal(BigInt(CEILING));

        await time.increase(p.acceptanceDelay + 1);
        const tx = await forward(judge, bond, "ruleForChallenger", [0, 0, 0n, "winner sweeps 99"]);
        const gasUsed = (await tx.wait()).gasUsed;

        // Worst-case sweep must fit comfortably in a block (30M); pin a budget
        // far below it so a regression that re-introduces an unbounded scan fails loudly.
        expect(gasUsed).to.be.lessThan(15_000_000n);

        const b = await bond.bonds(0);
        expect(b.settled).to.equal(true);
        expect(b.pendingCount).to.equal(0n);
        // Winner: bond + stake. The 99 swept: stake each. One aggregate credit.
        expect(await bond.credits(c1.address, tokenAddr)).to.equal(
            p.bondAmount + p.challengeAmount + p.challengeAmount * BigInt(CEILING - 1)
        );
    });
});

describe("TD7 — judgeFee == challengeAmount boundary", () => {
    it("createBond accepts equality; ruleForPoster with full fee leaves the poster a ZERO credit (skipped, no entry)", async () => {
        const p = { ...DEFAULT_BOND_PARAMS, judgeFee: DEFAULT_BOND_PARAMS.challengeAmount };
        const { poster, c1, token, bond, judge } = await setup({ judgeFee: p.judgeFee });
        const tokenAddr = await token.getAddress();

        await bond.connect(c1).challenge(0, 1, "will lose, full fee");
        await time.increase(p.acceptanceDelay + 1);

        const judgeBefore = await token.balanceOf(await judge.getAddress());
        await forward(judge, bond, "ruleForPoster", [0, 0, p.judgeFee, "poster right, fee == stake"]);

        // Whole stake goes to the judge inline; poster's share is exactly 0 and
        // the zero-credit is SKIPPED (no ledger entry, no Credited event).
        expect((await token.balanceOf(await judge.getAddress())) - judgeBefore).to.equal(p.judgeFee);
        expect(await bond.credits(poster.address, tokenAddr)).to.equal(0n);
        await expect(bond.connect(poster).claim(tokenAddr)).to.be.revertedWith("Nothing to claim");
    });

    it("createBond rejects judgeFee one wei above challengeAmount", async () => {
        const signers = await ethers.getSigners();
        const [poster] = signers;
        const token = await deployMockSUSDS();
        const { bond, judge, judgeProfileId } = await deployBondHarness({ withForwardingJudge: true, tokens: [token] });
        await fundAndApprove(token, bond, poster, ethers.parseEther("1000"));
        await expect(
            createDefaultBond(bond, poster, token, judge, judgeProfileId, {
                judgeFee: DEFAULT_BOND_PARAMS.challengeAmount + 1n,
            })
        ).to.be.revertedWith("Fee > challenge amount");
    });
});

describe("TD8 — modifyClaim positive path: new version is challengeable and snapshotted", () => {
    it("after modifyClaim, a challenge pinned to the NEW version succeeds and snapshots the NEW hash", async () => {
        const { poster, c1, bond } = await setup();
        const newContent = "claim v2 — corrected wording";
        await bond.connect(poster).modifyClaim(0, newContent);

        const b = await bond.bonds(0);
        expect(b.claimVersion).to.equal(2n);
        const newHash = ethers.keccak256(ethers.toUtf8Bytes(newContent));
        expect(b.claimHash).to.equal(newHash);

        // Old-version pin reverts; new-version pin succeeds and snapshots.
        await expect(bond.connect(c1).challenge(0, 1, "stale pin")).to.be.revertedWith("Stale claim version");
        await bond.connect(c1).challenge(0, 2, "challenging v2");
        const ch = await bond.getChallenge(0, 0);
        expect(ch.challengeAtVersion).to.equal(2n);
        expect(ch.claimHashAtChallenge).to.equal(newHash);
    });
});

describe("TD9 — pending-set swap-and-pop edges via the public surface", () => {
    it("resolving the MIDDLE of three pending challenges keeps the set consistent for the remaining two", async () => {
        const p = { ...DEFAULT_BOND_PARAMS };
        const { poster, c1, c2, token, bond, judge } = await setup();
        const tokenAddr = await token.getAddress();
        await bond.connect(c1).challenge(0, 1, "idx 0");
        await bond.connect(c2).challenge(0, 1, "idx 1 (middle, removed first)");
        await bond.connect(c1).challenge(0, 1, "idx 2 (last, swapped into middle slot)");
        await time.increase(p.acceptanceDelay + 1);

        // Remove the middle -> last element (idx 2) is swapped into its slot.
        await forward(judge, bond, "rejectChallenge", [0, 1, "out of scope"]);
        expect((await bond.bonds(0)).pendingCount).to.equal(2n);

        // Now resolve the SWAPPED element (idx 2) — exercises the rewritten
        // pendingPos of a moved entry; then the only remaining element (idx 0).
        await forward(judge, bond, "ruleForPoster", [0, 2, 0n, "lost"]);
        expect((await bond.bonds(0)).pendingCount).to.equal(1n);
        await bond.connect(poster).closeBond(0);
        await forward(judge, bond, "ruleForPoster", [0, 0, 0n, "lost too"]);
        expect((await bond.bonds(0)).pendingCount).to.equal(0n);

        // Statuses: 1 rejected (refund), 2 ruled-lost (stake to poster, fee 0).
        expect((await bond.getChallenge(0, 1)).status).to.equal(4n); // RejectedByJudge
        expect((await bond.getChallenge(0, 2)).status).to.equal(2n); // Lost
        expect((await bond.getChallenge(0, 0)).status).to.equal(2n); // Lost
        expect(await bond.credits(c2.address, tokenAddr)).to.equal(p.challengeAmount); // rejected refund
        // Poster: two lost challenges' stakes.
        expect(await bond.credits(poster.address, tokenAddr)).to.equal(p.challengeAmount * 2n);

        // With pendingCount 0 and the bond closed, withdraw works (set fully consumed).
        await bond.connect(poster).withdrawBond(0);
        expect((await bond.bonds(0)).settled).to.equal(true);
    });

    it("conceding the ONLY pending challenge empties the set and modifyClaim becomes available", async () => {
        const { poster, c1, bond } = await setup();
        await bond.connect(c1).challenge(0, 1, "solo");
        await bond.connect(poster).concede(0, 0, "fair point");
        expect((await bond.bonds(0)).pendingCount).to.equal(0n);
        await expect(bond.connect(poster).modifyClaim(0, "amended")).to.not.be.reverted;
    });
});
