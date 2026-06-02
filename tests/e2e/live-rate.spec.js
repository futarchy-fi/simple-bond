// Live-host check for incident I1: the create wizard's USD→sUSDS preview must
// show the REAL sUSDS rate (~0.91), never the 1:1 fabrication. Local e2e can't
// catch this — MockSUSDS is pinned 1:1, so the healthy value equals the bug
// value there. Only a real mainnet read distinguishes them.

const { test, expect } = require("@playwright/test");

test.describe("live sUSDS rate (I1)", () => {
    test.skip(({ baseURL }) => !/bond\.futarchy\.(fi|ai)/.test(baseURL || ""), "mainnet host only");

    test("$100 converts to a real sUSDS amount in [85, 96], not 100", async ({ page }) => {
        test.setTimeout(40_000);
        // Same load path as the (reliable) judge-resolution smoke: one default
        // goto, then reach the Stake step.
        await page.goto("/#create");
        await page.fill("#cb-claim", "live rate smoke");
        await page.click("#wizNext");
        await page.waitForSelector("#cb-bond");

        // Read the preview; if the rate is transiently unavailable (infra, not
        // a code bug) re-type to retrigger the read a couple of times.
        let amount = null;
        for (let attempt = 0; attempt < 3 && amount === null; attempt++) {
            await page.fill("#cb-bond", attempt % 2 === 0 ? "100" : "100 ");
            await page.fill("#cb-bond", "100");
            await expect(page.locator("#cb-bond-conv")).toContainText(/sUSDS|unavailable/i, { timeout: 10_000 });
            const txt = (await page.locator("#cb-bond-conv").textContent()) || "";
            if (/unavailable/i.test(txt)) { await page.waitForTimeout(1500); continue; }
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
