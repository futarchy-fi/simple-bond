// FLOWS.md section D — challenger wallet-driven flows + C3 (per-challenge concede).

const { test, expect, KEYS } = require("./fixtures/wallet-with-node");
const { ethers } = require("ethers");
const {
    createBondViaUI,
    gotoBondDetail,
    readBond,
    readChallenge,
    getChallengeCount,
    timeTravel,
} = require("./fixtures/helpers");

async function challengeAs(page, switchAccount, key, bondId, reason) {
    await switchAccount(key);
    // Force a reload so the page re-reads `account` from the (now-switched)
    // mock provider. The UI only updates account on the accountsChanged event,
    // and our mock dispatches it; if the page is still rendering the previous
    // state, a reload is the cleanest reset.
    await page.reload();
    await gotoBondDetail(page, bondId);
    await page.fill("#chContent", reason);
    await page.locator("#challengeBtn").click();
    // Poll the on-chain count.
    const before = await getChallengeCount({}, bondId).catch(() => null);
    // We don't have `deployed` here, so let the test handle the assert.
}

test.describe("D — challenger flows + C3 concede", () => {
    test("D1 — challenger files a challenge against the bond", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(120_000);
        const id = await createBondViaUI(page);
        await switchAccount(KEYS.challenger1);
        await page.reload();
        await gotoBondDetail(page, id);
        await page.fill("#chContent", "I dispute this claim because X.");
        await page.locator("#challengeBtn").click();
        // Poll on-chain.
        const start = Date.now();
        while (Date.now() - start < 60_000) {
            const n = await getChallengeCount(deployed, id);
            if (n === 1n) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        const n = await getChallengeCount(deployed, id);
        expect(n).toBe(1n);
        const c = await readChallenge(deployed, id, 0);
        expect(c.challenger.toLowerCase()).toBe(
            new ethers.Wallet(KEYS.challenger1).address.toLowerCase()
        );
        expect(c.status).toBe(0n); // Pending
    });

    test("C3 — poster concedes a specific challenge", async ({ page, deployed, switchAccount }) => {
        test.setTimeout(120_000);
        const id = await createBondViaUI(page);
        // Challenger files
        await switchAccount(KEYS.challenger1);
        await page.reload();
        await gotoBondDetail(page, id);
        await page.fill("#chContent", "challenger1's beef");
        await page.locator("#challengeBtn").click();
        const cstart = Date.now();
        while (Date.now() - cstart < 60_000) {
            if ((await getChallengeCount(deployed, id)) === 1n) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        expect(await getChallengeCount(deployed, id)).toBe(1n);

        // Poster concedes the challenge (index 0).
        await switchAccount(KEYS.poster);
        await page.reload();
        await gotoBondDetail(page, id);
        // Concede button is `<button data-act="concede" data-i="0">`.
        await page.locator('button[data-act="concede"][data-i="0"]').click();
        // Poll on-chain status.
        const cstart2 = Date.now();
        while (Date.now() - cstart2 < 60_000) {
            const c = await readChallenge(deployed, id, 0);
            if (c.status === 3n) {
                // Conceded enum value
                const b = await readBond(deployed, id);
                expect(b.settled).toBe(false);
                expect(b.pendingCount).toBe(0n);
                return;
            }
            await new Promise((r) => setTimeout(r, 500));
        }
        const c = await readChallenge(deployed, id, 0);
        expect(c.status).toBe(3n);
    });

    test("D2 — drain refunds after a bond-wide settlement", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(180_000);
        const id = await createBondViaUI(page, { acceptanceDelay: 60, rulingBuffer: 600 });
        // Two challenges from different wallets.
        await switchAccount(KEYS.challenger1);
        await page.reload();
        await gotoBondDetail(page, id);
        await page.fill("#chContent", "first");
        await page.locator("#challengeBtn").click();
        const wait1 = Date.now();
        while (Date.now() - wait1 < 30_000) {
            if ((await getChallengeCount(deployed, id)) === 1n) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        await switchAccount(KEYS.challenger2);
        await page.reload();
        await gotoBondDetail(page, id);
        await page.fill("#chContent", "second");
        await page.locator("#challengeBtn").click();
        const wait2 = Date.now();
        while (Date.now() - wait2 < 30_000) {
            if ((await getChallengeCount(deployed, id)) === 2n) break;
            await new Promise((r) => setTimeout(r, 500));
        }

        // Advance past acceptance + rule for challenger #0 → bond settles,
        // challenge #1 becomes refundable via claimRefunds.
        await timeTravel(deployed, 120, page);
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
        await page.reload();
        await gotoBondDetail(page, id);
        await page.fill('input[id="fee-0"]', "0");
        await page.fill('textarea[id="rule-0"]', "winner #0");
        await page.locator('button[data-act="ruleForChallenger"][data-i="0"]').click();
        const settleStart = Date.now();
        while (Date.now() - settleStart < 60_000) {
            const b = await readBond(deployed, id);
            if (b.settled) break;
            await new Promise((r) => setTimeout(r, 500));
        }

        // Now drain refunds and verify challenge #1 ends up Refunded.
        await page.reload();
        await gotoBondDetail(page, id);
        await page.locator("#refundsBtn").click();
        const drainStart = Date.now();
        while (Date.now() - drainStart < 60_000) {
            const c = await readChallenge(deployed, id, 1);
            if (c.status === 5n /* Refunded */) return;
            await new Promise((r) => setTimeout(r, 500));
        }
        const c = await readChallenge(deployed, id, 1);
        expect(c.status).toBe(5n);
    });

    test("D3 — anyone triggers claimTimeout after the ruling window passes", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(180_000);
        // Use short windows so we don't time-travel huge ranges.
        const id = await createBondViaUI(page, { acceptanceDelay: 60, rulingBuffer: 60 });
        await switchAccount(KEYS.challenger1);
        await page.reload();
        await gotoBondDetail(page, id);
        await page.fill("#chContent", "timeout test");
        await page.locator("#challengeBtn").click();
        // Wait for challenge to land.
        const cstart = Date.now();
        while (Date.now() - cstart < 60_000) {
            if ((await getChallengeCount(deployed, id)) === 1n) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        // Time-travel past both windows (60 + 60 + slack).
        await timeTravel(deployed, 200, page);
        // Reload so the UI re-renders the timeout button (gated by chain time).
        await page.reload();
        await gotoBondDetail(page, id);
        await page.locator('button[data-act="claimTimeout"][data-i="0"]').click();
        const start = Date.now();
        while (Date.now() - start < 60_000) {
            const b = await readBond(deployed, id);
            if (b.settled) return;
            await new Promise((r) => setTimeout(r, 500));
        }
        const b = await readBond(deployed, id);
        expect(b.settled).toBe(true);
    });
});
