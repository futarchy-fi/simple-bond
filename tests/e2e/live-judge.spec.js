// Live-host smoke test for the create-bond wizard's Judge step.
// Regressions in the read-side RPC config (FallbackProvider hangs, wrong
// ABI, broken public RPC) used to silently slow this page to a crawl;
// every other test runs against the in-process Hardhat node and can't
// catch that. This test only runs when the baseURL points at a live
// host because there is no judge profile #0 on the local Hardhat fixture
// by default.

const { test, expect } = require("@playwright/test");

test.describe("create wizard — judge resolution", () => {
    test.skip(({ baseURL }) => !/futarchy\.(fi|ai)/.test(baseURL || ""),
        "live-host only");

    test("profile #0 resolves to a hex address within 8s", async ({ page }) => {
        const consoleErrors = [];
        page.on("pageerror", (e) => consoleErrors.push(String(e)));
        page.on("console", (m) => {
            if (m.type() === "error") consoleErrors.push(m.text());
        });

        await page.goto("/#create");
        await page.fill("#cb-claim", "judge-resolution smoke test");
        await page.click("#wizNext");
        await page.waitForSelector("#cb-bond");
        await page.click("#wizNext");
        await page.waitForSelector("#cb-jpid");
        await page.click("#cb-use-default-judge");

        // Resolution should finish well under 8s. The bug we just fixed
        // (un-pinned network + broken RPCs in the fallback list) was
        // observed in the 20s+ range. The UI renders the resolved
        // address truncated as "0x1234…abcd", so we match either form.
        await expect.poll(
            async () => (await page.locator("#cb-judgeResolved").textContent()) || "",
            { timeout: 8000, intervals: [200, 400, 800] }
        ).toMatch(/Profile #0\s*→\s*judge contract\s*0x[0-9a-fA-F]{4}[…\.]+[0-9a-fA-F]{4}/i);

        // And no "not found / unreadable" message.
        const txt = await page.locator("#cb-judgeResolved").textContent();
        expect(txt || "").not.toMatch(/not found|unreadable/i);

        // And no BAD_DATA / could-not-decode noise in the console.
        const decodeErr = consoleErrors.find((e) => /BAD_DATA|could not decode/i.test(e));
        expect(decodeErr, `unexpected decode error: ${decodeErr}`).toBeUndefined();
    });
});
