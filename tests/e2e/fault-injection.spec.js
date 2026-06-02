// Tier (c) — reproduce the production RPC failure modes the mock wallet +
// always-up Hardhat node can't, and assert the app degrades honestly instead
// of fabricating values or posting wrong amounts.

const { test, expect } = require("./fixtures/wallet-with-node");

// convertToShares(uint256) selector — used to fault ONLY the sUSDS rate read.
const CONVERT_TO_SHARES = "c6e6f592";

test.describe("RPC fault — sUSDS rate (incident I1)", () => {
    test("a transport failure on convertToShares never shows a fabricated rate and blocks create", async ({ page }) => {
        test.setTimeout(60_000);
        // Arm the fault BEFORE the wizard reads the rate.
        page.injectRpcFault({ bodyIncludes: CONVERT_TO_SHARES, status: 500 });

        await page.goto("/#create");
        await page.fill("#cb-claim", "rate-unavailable fault test");
        await page.click("#wizNext");
        await page.waitForSelector("#cb-bond");
        await page.fill("#cb-bond", "100");
        // The conversion preview must say unavailable — NEVER a number, and in
        // particular never "100.00 sUSDS" (the 1:1 fabrication of I1).
        await expect(page.locator("#cb-bond-conv")).toContainText(/unavailable/i, { timeout: 10_000 });
        const conv = await page.locator("#cb-bond-conv").textContent();
        expect(conv || "").not.toMatch(/100\.00/);
        expect(conv || "").not.toMatch(/≈\s*100\b/);

        // Drive through to Create — it must refuse rather than post a wrong
        // amount computed from a fabricated 1:1 rate.
        await page.click("#wizNext");
        await page.waitForSelector("#cb-jpid");
        await page.fill("#cb-jpid", "0");
        await page.waitForFunction(
            () => document.getElementById("cb-judgeResolved")?.textContent?.includes("0x"),
            null, { timeout: 10_000 }
        ).catch(() => {});
        await page.click("#wizNext");
        await page.waitForSelector("#cb-ad");
        await page.click("#wizNext");
        await page.waitForSelector("#wizCreate");
        await page.click("#wizCreate");
        // Create is blocked with an explicit rate message — not a success card,
        // not a silent wrong-amount tx.
        await expect(page.locator("#createMsg")).toContainText(/rate/i, { timeout: 20_000 });
        await expect(page.locator("#createMsg")).not.toContainText(/Bond created/i);

        // Recovery: clear the fault, and the preview resolves to a real number.
        page.clearRpcFault();
        await page.click("#wizPrev"); // back to timing
        // Walk back to stake and re-type to retrigger the rate read.
        await page.click("#wizPrev"); await page.click("#wizPrev");
        await page.waitForSelector("#cb-bond");
        await page.fill("#cb-bond", "100");
        await expect(page.locator("#cb-bond-conv")).toContainText(/sUSDS/, { timeout: 10_000 });
        await expect(page.locator("#cb-bond-conv")).not.toContainText(/unavailable/i);
    });
});
