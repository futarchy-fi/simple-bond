// FLOWS.md B1: connect wallet shows truncated address. Uses the no-backend
// EIP-1193 mock (fixtures/wallet.js). Read flows still talk to the chain's
// own RPC; only the connect handshake is faked.

const { test, expect, FAKE_ADDR } = require("./fixtures/wallet");

test("B1 — wallet auto-reconnect on page load shows truncated address", async ({ page }) => {
    // The rebuilt UI silently calls eth_accounts on boot and, if the mocked
    // provider returns an address, the connect button is hidden and the
    // address chip shown — no click required. If your wallet had blocked the
    // silent reconnect the Connect button stays visible; clicking it then
    // triggers eth_requestAccounts. We assert the truncated address renders
    // either way.
    await page.goto("/");

    // If the connect button is visible (user hasn't approved before),
    // click it; otherwise skip to the assertion.
    const connectBtn = page.locator("#connectBtn:visible");
    if (await connectBtn.count()) {
        await connectBtn.click();
    }
    const short = `${FAKE_ADDR.slice(0, 6)}…${FAKE_ADDR.slice(-4)}`;
    await expect(page.locator("body")).toContainText(short, { timeout: 10_000 });
});
