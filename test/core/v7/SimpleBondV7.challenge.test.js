const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
    deployMockSUSDS,
    deployBondHarness,
    createDefaultBond,
    fundAndApprove,
    DEFAULT_BOND_PARAMS,
} = require("../../helpers/v7/fixtures");

async function setupWithBond(overrides = {}, { withForwardingJudge = false } = {}) {
    const signers = await ethers.getSigners();
    const [poster, challenger1, challenger2, challenger3] = signers;
    const token = await deployMockSUSDS();
    const { bond, judge, judgeProfileId } = await deployBondHarness({ withForwardingJudge, tokens: [token] });

    // Fund the poster + a handful of challengers generously (C1 tests file repeatedly).
    await fundAndApprove(token, bond, poster, ethers.parseEther("1000"));
    for (const c of signers.slice(1, 6)) {
        await fundAndApprove(token, bond, c, ethers.parseEther("1000"));
    }

    await createDefaultBond(bond, poster, token, judge, judgeProfileId, overrides);

    return {
        poster,
        challenger1,
        challenger2,
        challenger3,
        token,
        bond,
        judge,
        judgeProfileId,
        params: { ...DEFAULT_BOND_PARAMS, ...overrides },
    };
}

// The judge contract is the only allowed caller of rejectChallenge/ruleFor*; the
// forwarding judge relays an arbitrary judge-only call onto the bond.
async function forward(judge, bond, fn, args) {
    const data = bond.interface.encodeFunctionData(fn, args);
    return judge.forward(await bond.getAddress(), data);
}

describe("SimpleBondV7.challenge", () => {
    it("happy path: transfers stake, records challenge, emits Challenged, pendingCount==1", async () => {
        const { challenger1, token, bond, params } = await setupWithBond();
        const content = "I dispute claim X because Y.";

        const tx = await bond.connect(challenger1).challenge(0, 1, content);
        const receipt = await tx.wait();
        const log = receipt.logs.find((l) => l.fragment && l.fragment.name === "Challenged");

        expect(log.args.bondId).to.equal(0n);
        expect(log.args.challengeIndex).to.equal(0n);
        expect(log.args.challenger).to.equal(challenger1.address);
        expect(log.args.expectedVersion).to.equal(1n);
        expect(log.args.claimHashAtChallenge).to.equal(
            ethers.keccak256(ethers.toUtf8Bytes(params.claimContent))
        );
        expect(log.args.metadataHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes(content)));
        expect(log.args.content).to.equal(content);

        // Stake transferred (bond + challenge in contract).
        expect(await token.balanceOf(await bond.getAddress())).to.equal(
            params.bondAmount + params.challengeAmount
        );

        // Stored challenge
        const ch = await bond.getChallenge(0, 0);
        expect(ch.challenger).to.equal(challenger1.address);
        expect(ch.status).to.equal(0n); // Pending
        expect(ch.challengeAtVersion).to.equal(1n);

        // pendingCount bumped
        const stored = await bond.bonds(0);
        expect(stored.pendingCount).to.equal(1n);
    });

    it("appends multiple challenges in order", async () => {
        const { challenger1, challenger2, bond } = await setupWithBond();
        await bond.connect(challenger1).challenge(0, 1, "first");
        await bond.connect(challenger2).challenge(0, 1, "second");
        expect(await bond.getChallengeCount(0)).to.equal(2n);
        const ch0 = await bond.getChallenge(0, 0);
        const ch1 = await bond.getChallenge(0, 1);
        expect(ch0.challenger).to.equal(challenger1.address);
        expect(ch1.challenger).to.equal(challenger2.address);
    });

    it("reverts on stale claim version", async () => {
        const { poster, challenger1, bond } = await setupWithBond();
        // Poster modifies claim -> version becomes 2.
        await bond.connect(poster).modifyClaim(0, "v2");
        await expect(
            bond.connect(challenger1).challenge(0, 1, "outdated")
        ).to.be.revertedWith("Stale claim version");
    });

    it("reverts on unknown bond id", async () => {
        const { challenger1, bond } = await setupWithBond();
        await expect(
            bond.connect(challenger1).challenge(99, 1, "x")
        ).to.be.revertedWith("Unknown bond");
    });

    // C1 CORE — replaces the v0.6 "Max challenges reached" lockout test.
    it("C1: pending-cap gates the LIVE set; refile-after-reject succeeds (v6 lockout fixed)", async () => {
        const { challenger1, challenger2, challenger3, bond, judge } = await setupWithBond(
            { maxChallenges: 2 },
            { withForwardingJudge: true }
        );

        // File 2 -> pendingCount == 2 (at the cap).
        await bond.connect(challenger1).challenge(0, 1, "one");
        await bond.connect(challenger2).challenge(0, 1, "two");
        expect((await bond.bonds(0)).pendingCount).to.equal(2n);

        // 3rd challenge blocked: pending set is full.
        await expect(
            bond.connect(challenger3).challenge(0, 1, "three")
        ).to.be.revertedWith("Max pending challenges reached");

        // Judge rejects index 0 -> pendingCount drops to 1, status RejectedByJudge.
        await forward(judge, bond, "rejectChallenge", [0, 0, "out of scope"]);
        expect((await bond.bonds(0)).pendingCount).to.equal(1n);
        expect((await bond.getChallenge(0, 0)).status).to.equal(4n); // RejectedByJudge

        // A 3rd challenge now SUCCEEDS — the v0.6 spam-then-reject lockout is gone.
        await bond.connect(challenger3).challenge(0, 1, "three (now allowed)");

        // Cumulative length exceeds the cap while the live set is back at the cap.
        expect(await bond.getChallengeCount(0)).to.equal(3n);
        expect((await bond.bonds(0)).pendingCount).to.equal(2n);
    });

    // C1 INVARIANT — a spam/reject/refile loop must never let pendingCount exceed the cap.
    it("C1 invariant: pendingCount <= maxChallenges throughout a spam-reject-refile loop", async () => {
        const maxChallenges = 2;
        const { bond, judge } = await setupWithBond(
            { maxChallenges },
            { withForwardingJudge: true }
        );
        const signers = await ethers.getSigners();
        const challengers = signers.slice(1, 6);

        const assertInvariant = async () => {
            const pc = (await bond.bonds(0)).pendingCount;
            expect(pc).to.be.lte(BigInt(maxChallenges));
            // pendingCount == count of Pending statuses (Pending == 0).
            const len = Number(await bond.getChallengeCount(0));
            let pendingStatuses = 0n;
            for (let i = 0; i < len; i++) {
                if ((await bond.getChallenge(0, i)).status === 0n) pendingStatuses += 1n;
            }
            expect(pc).to.equal(pendingStatuses);
        };

        let rejectIdx = 0; // next index the judge will reject
        for (let round = 0; round < 4; round++) {
            // Fill to the cap (each iteration tops the pending set back up to maxChallenges).
            for (let k = 0; k < maxChallenges; k++) {
                const pc = Number((await bond.bonds(0)).pendingCount);
                if (pc >= maxChallenges) break;
                const c = challengers[k % challengers.length];
                await bond.connect(c).challenge(0, 1, `r${round}-k${k}`);
                await assertInvariant();
            }

            // Once full, any further challenge must revert (gate holds).
            await expect(
                bond.connect(challengers[0]).challenge(0, 1, "overflow")
            ).to.be.revertedWith("Max pending challenges reached");
            await assertInvariant();

            // Judge rejects the oldest still-pending challenge, freeing a slot.
            await forward(judge, bond, "rejectChallenge", [0, rejectIdx, `reject ${rejectIdx}`]);
            rejectIdx += 1;
            await assertInvariant();
        }

        // Cumulative filings far exceed the cap, but the live set never did.
        expect(await bond.getChallengeCount(0)).to.be.gt(BigInt(maxChallenges));
        expect((await bond.bonds(0)).pendingCount).to.be.lte(BigInt(maxChallenges));
    });

    // C1 ceiling — createBond rejects maxChallenges > 100, accepts 100.
    it("createBond reverts 'maxChallenges too large' above the ceiling; succeeds at 100", async () => {
        const [poster] = await ethers.getSigners();
        const token = await deployMockSUSDS();
        const { bond, judge, judgeProfileId } = await deployBondHarness({ tokens: [token] });
        await fundAndApprove(token, bond, poster, ethers.parseEther("1000"));

        // Sanity: the on-chain ceiling constant is 100.
        expect(await bond.MAX_CHALLENGES_CEILING()).to.equal(100n);

        await expect(
            createDefaultBond(bond, poster, token, judge, judgeProfileId, { maxChallenges: 101 })
        ).to.be.revertedWith("maxChallenges too large");

        // At the ceiling, creation succeeds.
        await expect(
            createDefaultBond(bond, poster, token, judge, judgeProfileId, { maxChallenges: 100 })
        ).to.not.be.reverted;
        expect((await bond.bonds(0)).maxChallenges).to.equal(100n);
    });
});

describe("SimpleBondV7.modifyClaim (pending-challenge gate)", () => {
    it("reverts when at least one challenge is pending", async () => {
        const { poster, challenger1, bond } = await setupWithBond();
        await bond.connect(challenger1).challenge(0, 1, "first");
        await expect(
            bond.connect(poster).modifyClaim(0, "v2")
        ).to.be.revertedWith("Pending challenges");
    });
});
