// Refunds-aware UX on bond detail (SECONDARY e2e for the computeRefunds change).
//
// The old "Refunds" card rendered ALWAYS, with an always-on permissionless
// "Drain refunds" button wired to claimRefunds(). On most bonds that button is a
// no-op (claimRefunds only touches challenges still Pending on a SETTLED bond),
// so it invited a gas-wasting transaction and confused already-refunded
// challengers. This spec proves the new behaviour:
//
//   1. A fresh bond with no challenges shows NO drain control.
//   2. A conceded challenge (already refunded inline by the contract) leaves
//      NOTHING drainable -> NO drain control (the conceded challenger isn't
//      offered a confusing no-op).
//   3. A bond settled with a challenge still Pending IS drainable: the owed
//      challenger sees "You are owed ~$X (1 slot)" + the drain control. Draining
//      refunds makes the affordance disappear AND moves the challenger's token
//      balance by challengeAmount.
//
// CONTRACT REFUND TRUTH (SimpleBondV6.sol, verified): claimRefunds() requires
// b.settled and ONLY refunds status==Pending(0) (-> Refunded(5)). concede() and
// rejectChallenge() refund the challenger INLINE, so Conceded(3)/RejectedByJudge(4)
// are NOT drainable. We void a bond via rejectBond() to settle it while leaving a
// challenge Pending — the canonical "drainable after settlement" situation.

const { test, expect, KEYS } = require("./fixtures/wallet-with-node");
const { ethers } = require("ethers");
const {
    createBondViaUI,
    gotoBondDetail,
    readBond,
    readChallenge,
    getChallengeCount,
} = require("./fixtures/helpers");

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

function tokenBalance(deployed, addr) {
    const provider = new ethers.JsonRpcProvider(deployed.rpc);
    return new ethers.Contract(deployed.approvedToken, ERC20_ABI, provider).balanceOf(addr);
}

// Register the canonical judge in localStorage so the UI marks the connected
// wallet as the judge operator on the detail page (mirrors judge-flows.spec.js).
async function asJudgeOperator(page, deployed, switchAccount) {
    await switchAccount(KEYS.judgeOperator);
    await page.evaluate(
        ({ judge, chainId, addr }) => {
            localStorage.setItem(`myJudgeContract:${chainId}:${addr.toLowerCase()}`, judge);
        },
        {
            judge: deployed.manualJudgeV6,
            chainId: deployed.chainId,
            addr: new ethers.Wallet(KEYS.judgeOperator).address,
        }
    );
}

async function fileChallenge(page, deployed, switchAccount, id, key, reason) {
    await switchAccount(key);
    await page.reload();
    await gotoBondDetail(page, id);
    await page.fill("#chContent", reason);
    await page.locator("#challengeBtn").click();
    const start = Date.now();
    while (Date.now() - start < 30_000) {
        if ((await getChallengeCount(deployed, id)) > 0n) break;
        await new Promise((r) => setTimeout(r, 500));
    }
}

test.describe("Refunds-aware UX on bond detail", () => {
    test("a fresh bond with no refundable slots shows NO drain control", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(120_000);
        const id = await createBondViaUI(page);
        // View as a connected, non-poster wallet (a wallet IS connected — the old
        // card was gated only on `signer`, so this is exactly the case that used
        // to show an always-on no-op button).
        await switchAccount(KEYS.challenger1);
        await page.reload();
        await gotoBondDetail(page, id);
        // No challenges, bond not settled -> nothing drainable -> no control.
        await expect(page.locator("#refundsBtn")).toHaveCount(0);
        // And the card heading shouldn't be present either.
        await expect(page.getByRole("heading", { name: "Refunds" })).toHaveCount(0);
    });

    test("a conceded challenge (already refunded inline) shows NO drain control", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(180_000);
        const id = await createBondViaUI(page);
        await fileChallenge(page, deployed, switchAccount, id, KEYS.challenger1, "concede-path");
        expect(await getChallengeCount(deployed, id)).toBe(1n);

        // Poster concedes -> contract refunds the challenger inline, status Conceded(3).
        await switchAccount(KEYS.poster);
        await page.reload();
        await gotoBondDetail(page, id);
        await page.locator('button[data-act="concede"][data-i="0"]').click();
        const start = Date.now();
        while (Date.now() - start < 60_000) {
            if ((await readChallenge(deployed, id, 0)).status === 3n) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        expect((await readChallenge(deployed, id, 0)).status).toBe(3n);

        // View as the (already-refunded) challenger: nothing is drainable.
        await switchAccount(KEYS.challenger1);
        await page.reload();
        await gotoBondDetail(page, id);
        await expect(page.locator("#refundsBtn")).toHaveCount(0);
    });

    test("settled bond with a pending challenge: owed -> drain -> gone + balance moved", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(240_000);
        const id = await createBondViaUI(page);
        await fileChallenge(page, deployed, switchAccount, id, KEYS.challenger1, "stays-pending");
        expect(await getChallengeCount(deployed, id)).toBe(1n);

        // Judge voids the whole bond (rejectBond): settles the bond, refunds the
        // poster, and leaves the still-Pending challenge drainable via claimRefunds.
        await asJudgeOperator(page, deployed, switchAccount);
        await page.reload();
        await gotoBondDetail(page, id);
        page.once("dialog", (d) => d.accept());
        await page.locator("#rejectBondBtn").click();
        const settleStart = Date.now();
        while (Date.now() - settleStart < 60_000) {
            if ((await readBond(deployed, id)).settled) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        expect((await readBond(deployed, id)).settled).toBe(true);
        // The challenge is still Pending (not refunded yet) — the drainable case.
        expect((await readChallenge(deployed, id, 0)).status).toBe(0n);

        // View as the OWED challenger: the affordance + drain control appear.
        const challengerAddr = new ethers.Wallet(KEYS.challenger1).address;
        await switchAccount(KEYS.challenger1);
        await page.reload();
        await gotoBondDetail(page, id);
        await expect(page.getByRole("heading", { name: "Refunds" })).toBeVisible();
        await expect(page.locator("#refundsBtn")).toBeVisible();
        // "You are owed ~$X (1 slot)." — the owed affordance, with a dollar figure.
        await expect(page.locator(".card", { hasText: "You are owed" })).toContainText(
            /You are owed ~\$[\d.,]+ \(1 slot\)/
        );

        // Capture the challenger's token balance, then drain.
        const balBefore = await tokenBalance(deployed, challengerAddr);
        await page.locator("#refundsBtn").click();
        // Wait for the on-chain status to flip to Refunded(5).
        const drainStart = Date.now();
        while (Date.now() - drainStart < 60_000) {
            if ((await readChallenge(deployed, id, 0)).status === 5n) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        expect((await readChallenge(deployed, id, 0)).status).toBe(5n);

        // Balance moved by exactly challengeAmount.
        const balAfter = await tokenBalance(deployed, challengerAddr);
        const bond = await readBond(deployed, id);
        expect(balAfter - balBefore).toBe(bond.challengeAmount);

        // The UI auto-refreshes after the drain (doDrainRefunds re-renders). The
        // affordance must disappear — nothing left to drain.
        const goneStart = Date.now();
        let gone = false;
        while (Date.now() - goneStart < 30_000) {
            if ((await page.locator("#refundsBtn").count()) === 0) { gone = true; break; }
            await new Promise((r) => setTimeout(r, 500));
        }
        // Force a clean re-render in case the auto-refresh raced the assertion.
        if (!gone) {
            await page.reload();
            await gotoBondDetail(page, id);
        }
        await expect(page.locator("#refundsBtn")).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "Refunds" })).toHaveCount(0);
    });
});
