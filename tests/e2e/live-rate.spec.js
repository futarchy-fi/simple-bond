// Live-host check for incident I1: the create wizard's USD→sUSDS preview must
// show the REAL sUSDS rate (~0.91), never the 1:1 fabrication. Local e2e can't
// catch this — MockSUSDS is pinned 1:1, so the healthy value equals the bug
// value there. Only a real mainnet read distinguishes them.

const { test, expect } = require("@playwright/test");

test.describe("live sUSDS rate (I1)", () => {
    test.skip(({ baseURL }) => !/bond\.futarchy\.(fi|ai)/.test(baseURL || ""), "mainnet host only");

    test("$100 converts to a real sUSDS amount in [85, 96], not 100", async ({ page }) => {
        test.setTimeout(45_000);
        // Read the preview, retrying across reloads if the rate is transiently
        // unavailable (a real RPC blip is infra, not a code bug). Fail only on
        // a fabricated/wrong NUMBER — that's the I1 signal.
        let amount = null;
        for (let attempt = 0; attempt < 3 && amount === null; attempt++) {
            await page.goto("/#create");
            await page.fill("#cb-claim", "live rate smoke");
            await page.click("#wizNext");
            await page.waitForSelector("#cb-bond");
            await page.fill("#cb-bond", "100");
            await expect(page.locator("#cb-bond-conv")).toContainText(/sUSDS|unavailable/i, { timeout: 12_000 });
            const txt = (await page.locator("#cb-bond-conv").textContent()) || "";
            if (/unavailable/i.test(txt)) continue; // transient — retry
            const m = txt.match(/([\d,.]+)\s*sUSDS/);
            if (m) amount = parseFloat(m[1].replace(/,/g, ""));
        }
        test.skip(amount === null, "sUSDS rate transiently unavailable on all attempts (infra, not code)");
        // sUSDS appreciates vs USD, so $100 buys < 100 sUSDS. A 1:1 fabrication
        // (I1) lands at exactly 100. Band is wide to tolerate rate drift.
        expect(amount, `got ${amount} sUSDS for $100 (1:1 fabrication would be 100)`).toBeGreaterThan(85);
        expect(amount, `got ${amount} sUSDS for $100 (1:1 fabrication would be 100)`).toBeLessThan(96);
    });
});
