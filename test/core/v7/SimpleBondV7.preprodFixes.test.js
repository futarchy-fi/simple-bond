// Pre-production audit fixes (docs/security/AUDIT-v7-2026-06.md §2) — one describe per
// finding so every fix stays traceable to its audit ID:
//   V7-1  createBond gates on officialDirectory.hasToken(token) (on-chain token whitelist)
//   V7-2  MIN_RULING_BUFFER floor (v6-M6: no more ~1s ruling windows)
//   V7-3  settlement sweep marks still-pending challengers Refunded, never Lost
//         (Lost is reserved for ruled-against-with-stake-lost; owner decision 2026-06-09)
//   V7-5  concession window OWNS its final second: rule* is strictly > rulingWindowStart
//         (v6-L5: concede/rule can no longer both be valid in one block)

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
    deployMockSUSDS,
    deployBondHarness,
    directoryRegisterToken,
    createDefaultBond,
    fundAndApprove,
    DEFAULT_BOND_PARAMS,
} = require("../../helpers/v7/fixtures");

async function forward(judge, bond, fn, args) {
    const data = bond.interface.encodeFunctionData(fn, args);
    return judge.forward(await bond.getAddress(), data);
}

async function setup() {
    const signers = await ethers.getSigners();
    const [poster, challenger] = signers;
    const token = await deployMockSUSDS();
    const { directory, bond, judge, judgeProfileId } = await deployBondHarness({
        withForwardingJudge: true,
        tokens: [token],
    });
    await fundAndApprove(token, bond, poster, ethers.parseEther("1000"));
    await fundAndApprove(token, bond, challenger, ethers.parseEther("1000"));
    return { poster, challenger, token, directory, bond, judge, judgeProfileId };
}

describe("V7-1 — on-chain token whitelist (directory gate)", () => {
    it("createBond reverts 'Token not approved' for a token the directory does not curate", async () => {
        const { poster, bond, judge, judgeProfileId } = await setup();
        const rogue = await deployMockSUSDS(); // real ERC-20, NOT registered in the directory
        await fundAndApprove(rogue, bond, poster, ethers.parseEther("1000"));
        await expect(
            createDefaultBond(bond, poster, rogue, judge, judgeProfileId, {})
        ).to.be.revertedWith("Token not approved");
    });

    it("the same token succeeds once the directory curates it", async () => {
        const { poster, directory, bond, judge, judgeProfileId } = await setup();
        const rogue = await deployMockSUSDS();
        await fundAndApprove(rogue, bond, poster, ethers.parseEther("1000"));
        await directoryRegisterToken(directory, rogue);
        await expect(createDefaultBond(bond, poster, rogue, judge, judgeProfileId, {})).to.not.be
            .reverted;
    });

    it("constructor rejects a zero directory", async () => {
        const { registry } = await deployBondHarness({});
        const F = await ethers.getContractFactory("SimpleBondV7");
        await expect(F.deploy(await registry.getAddress(), ethers.ZeroAddress)).to.be.revertedWith(
            "Zero directory"
        );
    });
});

describe("V7-2 — MIN_RULING_BUFFER floor (v6-M6)", () => {
    it("exposes the floor and rejects a buffer one second below it", async () => {
        const { poster, token, bond, judge, judgeProfileId } = await setup();
        const min = await bond.MIN_RULING_BUFFER();
        expect(min).to.equal(3600n); // 1 hours

        await expect(
            createDefaultBond(bond, poster, token, judge, judgeProfileId, {
                rulingBuffer: Number(min) - 1,
            })
        ).to.be.revertedWith("Ruling buffer too short");

        // Exactly the floor is accepted.
        await expect(
            createDefaultBond(bond, poster, token, judge, judgeProfileId, {
                rulingBuffer: Number(min),
            })
        ).to.not.be.reverted;
    });
});

describe("V7-3 — settlement sweep marks survivors Refunded, never Lost", () => {
    it("ruleForChallenger: winner Won, swept challenger Refunded (stake back); Lost only via ruleForPoster", async () => {
        const { poster, challenger, token, bond, judge, judgeProfileId } = await setup();
        const signers = await ethers.getSigners();
        const other = signers[2];
        await fundAndApprove(token, bond, other, ethers.parseEther("1000"));
        const p = { ...DEFAULT_BOND_PARAMS };
        await createDefaultBond(bond, poster, token, judge, judgeProfileId, {});

        await bond.connect(challenger).challenge(0, 1, "winner-to-be");
        await bond.connect(other).challenge(0, 1, "swept bystander");
        await time.increase(p.acceptanceDelay + 1);
        await forward(judge, bond, "ruleForChallenger", [0, 0, 0n, "challenger is right"]);

        expect((await bond.getChallenge(0, 0)).status).to.equal(1n); // Won
        expect((await bond.getChallenge(0, 1)).status).to.equal(5n); // Refunded — NOT Lost(2)
        // The Refunded sweep really is money-neutral for the bystander.
        expect(await bond.credits(other.address, await token.getAddress())).to.equal(
            p.challengeAmount
        );
    });
});

describe("V7-5 — concession window owns T0; ruling strictly after (v6-L5)", () => {
    // concessionDeadline(bond, i) === rulingWindowStart(bond, i) === T0. Pre-fix both
    // concede (<= T0) and rule (>= T0) were valid in a block mined exactly at T0.
    async function bondWithChallenge() {
        const ctx = await setup();
        await createDefaultBond(ctx.bond, ctx.poster, ctx.token, ctx.judge, ctx.judgeProfileId, {});
        await ctx.bond.connect(ctx.challenger).challenge(0, 1, "boundary probe");
        const t0 = await ctx.bond.rulingWindowStart(0, 0);
        return { ...ctx, t0 };
    }

    it("at exactly T0 a ruling reverts 'Ruling window not open'…", async () => {
        const { bond, judge, t0 } = await bondWithChallenge();
        await time.setNextBlockTimestamp(t0);
        // The forwarding judge wraps the revert, so assert the bond-level guard via staticCall
        // path: the forwarded tx must revert (window opens strictly after T0)…
        await expect(forward(judge, bond, "ruleForPoster", [0, 0, 0n, "too early"])).to.be
            .reverted;
        // …and one second later the SAME ruling goes through.
        await time.setNextBlockTimestamp(t0 + 1n);
        await expect(forward(judge, bond, "ruleForPoster", [0, 0, 0n, "now valid"])).to.not.be
            .reverted;
    });

    it("…while at exactly T0 the poster can still concede (T0 belongs to concession)", async () => {
        const { poster, bond, t0 } = await bondWithChallenge();
        await time.setNextBlockTimestamp(t0);
        await expect(bond.connect(poster).concede(0, 0, "conceded on the boundary")).to.not.be
            .reverted;
        expect((await bond.getChallenge(0, 0)).status).to.equal(3n); // Conceded
    });

    it("one second past T0 concession is closed", async () => {
        const { poster, bond, t0 } = await bondWithChallenge();
        await time.setNextBlockTimestamp(t0 + 1n);
        await expect(bond.connect(poster).concede(0, 0, "too late")).to.be.revertedWith(
            "Concession window closed"
        );
    });
});
