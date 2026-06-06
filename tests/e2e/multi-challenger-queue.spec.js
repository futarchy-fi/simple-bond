// e2e #18 — completes the multiple-challengers lifecycle (FIFO challenge queue).
//
// The happy-path matrix already covers a single challenge. This proves the queue
// renders correctly when MORE THAN ONE challenge is pending at once: two distinct
// challengers each file a challenge against the SAME bond, and the bond-detail
// page must render BOTH per-challenge cards with their correct per-index status
// (Pending) AND per-index controls wired to distinct targets (index 0 and 1).
//
// Setup:
//   1. Create a bond with maxChallenges >= 2 (default 10) and a comfortable
//      acceptance window so the per-challenge concede controls render.
//   2. challenger1 files challenge #0; challenger2 files challenge #1.
//   3. Assert on-chain pendingCount == 2 (both live).
//   4. View as the POSTER (inside the concession window) and assert BOTH cards
//      (#ch-0, #ch-1) render Pending with DISTINCT per-index concede targets
//      (conc-0 / conc-1 textareas + concede buttons data-i=0 and data-i=1).
//
// NON-VACUOUS: if the queue only rendered the first/last challenge, or collapsed
// the two into one card, or mis-wired both controls to the same index, the
// two-distinct-targets + both-cards-Pending assertions would FAIL.

const { test, expect, KEYS } = require("./fixtures/wallet-with-node");
const { ethers } = require("ethers");
const {
    createBondViaUI,
    gotoBondDetail,
    readBond,
    readChallenge,
    getChallengeCount,
} = require("./fixtures/helpers");

async function fileChallenge(page, switchAccount, key, id, reason, wantCount, deployed) {
    await switchAccount(key);
    await page.reload();
    await gotoBondDetail(page, id);
    await page.fill("#chContent", reason);
    await page.locator("#challengeBtn").click();
    const start = Date.now();
    while (Date.now() - start < 60_000) {
        if ((await getChallengeCount(deployed, id)) === wantCount) break;
        await new Promise((r) => setTimeout(r, 500));
    }
    expect(await getChallengeCount(deployed, id)).toBe(wantCount);
}

test.describe("multi-challenger FIFO queue (#18)", () => {
    test("two simultaneous pending challenges render two distinct per-index cards", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(180_000);

        // 1) Bond with room for >= 2 challenges and a wide concession window.
        const id = await createBondViaUI(page, {
            maxChallenges: 3,
            acceptanceDelay: 3600,
            rulingBuffer: 3600,
        });
        {
            const b = await readBond(deployed, id);
            expect(b.maxChallenges).toBe(3n);
        }

        // 2) Two DIFFERENT challengers each file a challenge against the SAME bond.
        await fileChallenge(page, switchAccount, KEYS.challenger1, id, "challenger1: dispute A", 1n, deployed);
        await fileChallenge(page, switchAccount, KEYS.challenger2, id, "challenger2: dispute B", 2n, deployed);

        // 3) Both are live on-chain (FIFO queue depth 2).
        const b = await readBond(deployed, id);
        expect(b.pendingCount).toBe(2n);
        expect(await getChallengeCount(deployed, id)).toBe(2n);
        const c0 = await readChallenge(deployed, id, 0);
        const c1 = await readChallenge(deployed, id, 1);
        expect(c0.status).toBe(0n); // Pending
        expect(c1.status).toBe(0n); // Pending
        // Distinct challengers, in FIFO order.
        expect(c0.challenger.toLowerCase()).toBe(
            new ethers.Wallet(KEYS.challenger1).address.toLowerCase()
        );
        expect(c1.challenger.toLowerCase()).toBe(
            new ethers.Wallet(KEYS.challenger2).address.toLowerCase()
        );

        // 4) View as the POSTER (inside the concession window) — each pending
        //    challenge renders its own card with a DISTINCT per-index concede
        //    control. This is the proof the queue renders per-index, not as one.
        await switchAccount(KEYS.poster);
        await page.reload();
        await gotoBondDetail(page, id);

        // The Challenges header reflects both.
        await expect(page.locator(".card h3", { hasText: /^\s*Challenges\s*\(2\)/ }))
            .toBeVisible();

        // Both per-index cards exist and both read Pending.
        await expect(page.locator("#ch-0")).toBeVisible();
        await expect(page.locator("#ch-1")).toBeVisible();
        await expect(page.locator("#ch-0 .status-badge")).toContainText("Pending");
        await expect(page.locator("#ch-1 .status-badge")).toContainText("Pending");

        // Per-index controls are wired to DISTINCT targets (index 0 and index 1).
        await expect(page.locator('button[data-act="concede"][data-i="0"]')).toHaveCount(1);
        await expect(page.locator('button[data-act="concede"][data-i="1"]')).toHaveCount(1);
        // The concede reason textareas are likewise per-index.
        await expect(page.locator("#conc-0")).toBeVisible();
        await expect(page.locator("#conc-1")).toBeVisible();
        // The per-index concede control lives inside its OWN challenge card.
        await expect(
            page.locator('#ch-0 button[data-act="concede"][data-i="0"]')
        ).toHaveCount(1);
        await expect(
            page.locator('#ch-1 button[data-act="concede"][data-i="1"]')
        ).toHaveCount(1);

        // Concede ONLY index 1 and prove it targets the right challenge: #1 goes
        // Conceded while #0 stays Pending (FIFO entries are independent).
        await page.fill("#conc-1", "poster concedes the second challenge only");
        await page.locator('#ch-1 button[data-act="concede"][data-i="1"]').click();
        const start = Date.now();
        while (Date.now() - start < 60_000) {
            const cc1 = await readChallenge(deployed, id, 1);
            if (cc1.status === 3n /* Conceded */) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        expect((await readChallenge(deployed, id, 1)).status).toBe(3n); // Conceded
        expect((await readChallenge(deployed, id, 0)).status).toBe(0n); // still Pending
        const bAfter = await readBond(deployed, id);
        expect(bAfter.pendingCount).toBe(1n); // one resolved, one still live
    });
});
