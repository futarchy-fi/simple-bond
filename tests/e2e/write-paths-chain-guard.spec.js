// Tier (c) — table-driven wrong-chain guard over the entry write paths.
// Incident I4 (FAOSale) happened because only ONE write path was guarded.
// Each path here must, on a wrong-chain wallet, surface the friendly switch
// message and NEVER leak a raw cross-chain revert ("FAOSale" / "fallback not
// allowed"). The guardrail linter (G3) separately proves no UNGUARDED signer
// path exists; this proves the guarded ones behave.

const { test, expect } = require("./fixtures/wallet-with-node");

// Drive each write path to its trigger, returning the message-slot selector.
const PATHS = [
    {
        name: "register poster profile (#pp-go)",
        msg: "#pp-msg",
        run: async (page) => {
            await page.goto("/#judges");
            await page.waitForSelector("#walletInfo:not(.hidden)");
            await page.locator('summary:has-text("Poster & challenger profiles")').click();
            await page.fill("#pp-content", "wrong-chain poster");
            await page.click("#pp-go");
        },
    },
    {
        name: "register challenger profile (#cp-go)",
        msg: "#cp-msg",
        run: async (page) => {
            await page.goto("/#judges");
            await page.waitForSelector("#walletInfo:not(.hidden)");
            await page.locator('summary:has-text("Poster & challenger profiles")').click();
            await page.fill("#cp-content", "wrong-chain challenger");
            await page.click("#cp-go");
        },
    },
    {
        name: "deploy judge contract (#jp-deploy-new)",
        msg: "#judgeMsg",
        run: async (page) => {
            await page.goto("/#judges");
            await page.waitForSelector("#walletInfo:not(.hidden)");
            await page.locator("#judgeOfferDetails > summary").click();
            await page.click("#jp-deploy-new");
        },
    },
    {
        name: "create bond (#wizCreate)",
        msg: "#createMsg",
        run: async (page) => {
            await page.goto("/#create");
            await page.fill("#cb-claim", "wrong-chain create");
            await page.click("#wizNext");
            await page.waitForSelector("#cb-bond");
            await page.click("#wizNext");
            await page.waitForSelector("#cb-jpid");
            await page.fill("#cb-jpid", "0");
            await page.click("#wizNext");
            await page.waitForSelector("#cb-ad");
            await page.click("#wizNext");
            await page.waitForSelector("#wizCreate");
            await page.click("#wizCreate");
        },
    },
];

test.describe("wrong-chain guard over write paths (I4)", () => {
    for (const p of PATHS) {
        test(`${p.name} is blocked on the wrong chain, no cross-chain revert leak`, async ({ page }) => {
            test.setTimeout(45_000);
            // Wallet sits on Gnosis (100); the page is the Hardhat chain.
            await page.addInitScript(() => { window.__mockChainId = 100; });
            await p.run(page);
            await expect(page.locator(p.msg)).toContainText(/chain 100|switch/i, { timeout: 15_000 });
            await expect(page.locator(p.msg)).not.toContainText(/FAOSale/i);
            await expect(page.locator(p.msg)).not.toContainText(/fallback not allowed/i);
        });
    }
});
