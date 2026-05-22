// Regression coverage for the wrong-chain footgun.
//
// Before this guard, a wallet sitting on Gnosis Chain (chainId 100) while the
// page was wired to mainnet would happily fire registerProfile at the mainnet
// JudgeProfileRegistry address — and that address on Gnosis is occupied by an
// unrelated "FAOSale" contract, producing the misleading
//   "FAOSale: fallback not allowed"
// revert. requireWalletOnActiveChain() refuses to hand out a signer-bound
// contract until the chain matches.
//
// We simulate by mutating window.__mockChainId in the wallet fixture so the
// EIP-1193 stub returns the wrong chain id.

const { test, expect } = require("./fixtures/wallet-with-node");

test.describe("wrong-chain guard", () => {
    test("registering a poster profile from a wallet on the wrong chain shows a friendly error, not a raw revert", async ({ page }) => {
        // Pre-stage the mock wallet on Gnosis (100) before any page code runs,
        // so eth_chainId returns 100 from the very first connect call. The
        // fixture auto-connects on page load, so no explicit click needed.
        await page.addInitScript(() => { window.__mockChainId = 100; });
        await page.goto("/#judges");
        await page.waitForSelector("#walletInfo:not(.hidden)");
        // The banner should appear advertising the mismatch (wallet says 100,
        // page is wired to Hardhat 31337).
        await expect(page.locator("#networkBanner:not(.hidden)")).toBeVisible({ timeout: 5_000 });
        // Try to register a poster profile. The form lives inside a collapsed
        // <details> on the Judges page — open it first. Then click Register;
        // the guard must block before any tx leaves the page.
        await page.locator('summary:has-text("Poster & challenger profiles")').click();
        await page.fill("#pp-content", "should never reach the chain");
        await page.click("#pp-go");
        await expect(page.locator("#pp-msg")).toContainText(/Wallet is on chain 100/i, { timeout: 5_000 });
        // The friendly message names the chain we want.
        await expect(page.locator("#pp-msg")).toContainText(/switch to/i);
        // And critically: NO raw revert string leaking through.
        await expect(page.locator("#pp-msg")).not.toContainText(/fallback not allowed/i);
        await expect(page.locator("#pp-msg")).not.toContainText(/FAOSale/i);
    });
});
