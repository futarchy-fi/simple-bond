// FLOWS funding-card flow.
// When the connected wallet doesn't hold enough sUSDS to post the bond,
// submitCreate renders a tailored funding card instead of throwing a
// raw revert. The card surfaces:
//   - the user's USD balance and the bond's USD requirement,
//   - a primary CTA tied to whatever the wallet does hold (USDS, DAI, etc.),
//   - a list of secondary paths.
//
// Verifying via the fixture: the worker pre-mints 1M MockSUSDS to each test
// key. Setting bondAmount > 1M triggers the insufficient-balance branch.

const { test, expect } = require("./fixtures/wallet-with-node");

test.describe("funding card", () => {
    test("shows tailored card when sUSDS balance is below bondAmount", async ({ page }) => {
        test.setTimeout(60_000);
        await page.goto("/#create");
        // Step 1 — Claim
        await page.fill("#cb-claim", "funding-card test");
        await page.click("#wizNext");
        // Step 2 — Stake. Set bondAmount above the fixture's 1M mint so the
        // poster runs out of sUSDS.
        await page.waitForSelector("#cb-bond");
        await page.fill("#cb-bond", "2000000");
        await page.click("#wizNext");
        // Step 3 — Judge
        await page.waitForSelector("#cb-jpid");
        await page.fill("#cb-jpid", "0");
        await page.waitForFunction(
            () => document.getElementById("cb-judgeResolved")?.textContent?.includes("0x"),
            null,
            { timeout: 10_000 }
        );
        await page.click("#wizNext");
        // Step 4 — Timing
        await page.waitForSelector("#cb-ad");
        await page.click("#wizNext");
        // Step 5 — Review + Create
        await page.click("#wizCreate");
        // The funding card replaces the standard error.
        await expect(page.locator("body")).toContainText(/Not enough sUSDS yet/i, { timeout: 30_000 });
        await expect(page.locator("body")).toContainText(/\$1,000,000/);   // balance line
        await expect(page.locator("body")).toContainText(/\$2,000,000/);   // need line
        await expect(page.locator("body")).toContainText(/Balances detected/);
    });
});
