// e2e #12 — a user-rejected tx yields a CLEAN, retryable state.
//
// When a user clicks "Reject" in their wallet, ethers/EIP-1193 surfaces a
// userRejectedRequest error (code 4001 / ACTION_REJECTED). The UI must:
//   1. show the friendly "Transaction cancelled." (friendlyError/isUserRejection
//      in index.html:722-729) — NOT a scary raw error, and
//   2. NOT get stuck: the action button is re-enabled (no permanent spinner
//      lock) so the user can retry, and a retry actually succeeds.
//
// FIXTURE-ONLY HOOK (allowed by the task; fixtures only, never app code): the
// injected EIP-1193 provider in tests/e2e/fixtures/wallet-with-node.js honors a
// single-shot window.__rejectNextSend flag — when armed, the NEXT
// eth_sendTransaction throws an EIP-1193 code-4001 error, exactly like a user
// rejecting in a real wallet. The flag clears on use, so the retry goes through.
//
// NON-VACUOUS: if friendlyError/isUserRejection regressed (e.g. surfaced the raw
// error) the "Transaction cancelled." assert fails; if the button stayed disabled
// or the spinner stuck (no finally{} re-enable), the not-disabled assert + the
// successful-retry assert fail.

const { test, expect, KEYS } = require("./fixtures/wallet-with-node");
const {
    createBondViaUI,
    gotoBondDetail,
    getChallengeCount,
} = require("./fixtures/helpers");

test.describe("user-rejected tx is clean + retryable (#12)", () => {
    test("challenge: a 4001-rejected tx shows 'Transaction cancelled.' and is retryable", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(180_000);

        // Poster creates the bond; challenger1 will try to challenge it.
        const id = await createBondViaUI(page);
        await switchAccount(KEYS.challenger1);
        await page.reload();
        await gotoBondDetail(page, id);

        await page.fill("#chContent", "I will reject the first signature.");

        // Arm the single-shot rejection so the NEXT signed tx (the first send the
        // challenge flow issues) rejects with code 4001 — a user "Reject" click.
        await page.evaluate(() => { window.__rejectNextSend = true; });
        await page.locator("#challengeBtn").click();

        // 1) Friendly cancellation message — not a raw error.
        await expect(page.locator("#challengeMsg")).toContainText("Transaction cancelled.", {
            timeout: 15_000,
        });
        // No raw rejection wording leaks through.
        await expect(page.locator("#challengeMsg")).not.toContainText(/ACTION_REJECTED/i);
        await expect(page.locator("#challengeMsg")).not.toContainText(/could not coalesce/i);

        // 2) Not stuck: the Challenge button is re-enabled and the spinner is gone
        //    (doChallenge's finally{} restores it). The flag is single-shot, so it
        //    is already disarmed for the retry below.
        const btn = page.locator("#challengeBtn");
        await expect(btn).toBeEnabled({ timeout: 10_000 });
        await expect(btn).not.toContainText(/Processing/i);
        await expect(page.locator("#challengeBtn .spinner")).toHaveCount(0);

        // The rejected attempt sent NOTHING on-chain.
        expect(await getChallengeCount(deployed, id)).toBe(0n);

        // 3) Retry succeeds — the page was genuinely retryable, not just unlocked.
        await page.locator("#challengeBtn").click();
        const start = Date.now();
        while (Date.now() - start < 90_000) {
            if ((await getChallengeCount(deployed, id)) === 1n) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        expect(await getChallengeCount(deployed, id)).toBe(1n);
        await expect(page.locator("#challengeMsg")).toContainText(/Challenge filed/i, {
            timeout: 15_000,
        });
    });
});
