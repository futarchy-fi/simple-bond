// FLOWS.md section C — poster wallet-driven flows.

const { test, expect, KEYS } = require("./fixtures/wallet-with-node");
const { ethers } = require("ethers");
const {
    createBondViaUI,
    gotoBondDetail,
    readBond,
    nextBondId,
    timeTravel,
} = require("./fixtures/helpers");

test.describe("C — poster flows", () => {
    test("typing in stake inputs does not lose focus (regression)", async ({ page }) => {
        // Bug: re-rendering the entire stage on every keystroke unmounted the
        // input the user was typing into, dropping focus after each digit.
        // Fix is a surgical update of the belief-thresholds card instead.
        await page.goto("/#create");
        await page.fill("#cb-claim", "regression test");
        await page.click("#wizNext");
        await page.waitForSelector("#cb-bond");
        await page.focus("#cb-bond");
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Backspace");
        await page.keyboard.type("12345", { delay: 30 });
        await expect(page.locator("#cb-bond")).toBeFocused();
        await expect(page.locator("#cb-bond")).toHaveValue("12345");
        // Same for challenge and judgeFee.
        await page.focus("#cb-ch");
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Backspace");
        await page.keyboard.type("987", { delay: 30 });
        await expect(page.locator("#cb-ch")).toBeFocused();
        await expect(page.locator("#cb-ch")).toHaveValue("987");
    });

    test("C1 — create bond walks the wizard and emits BondCreated", async ({ page, deployed }) => {
        test.setTimeout(120_000);
        const before = await nextBondId(deployed);
        const id = await createBondViaUI(page);
        expect(BigInt(id)).toEqual(before);
        const after = await nextBondId(deployed);
        expect(after).toEqual(before + 1n);
        const b = await readBond(deployed, id);
        expect(b.poster.toLowerCase()).toBe(new ethers.Wallet(KEYS.poster).address.toLowerCase());
        expect(b.claimVersion).toBe(1n);
        expect(b.settled).toBe(false);
        expect(b.closed).toBe(false);
    });

    test("C2 — poster modifies claim text when queue is empty", async ({ page, deployed }) => {
        test.setTimeout(120_000);
        const id = await createBondViaUI(page, { claim: "v1 original" });
        await gotoBondDetail(page, id);
        // Modify-claim affordance lives inside a <details> labelled "Modify claim".
        await page.locator("details summary", { hasText: /^Modify claim$/i }).first().click();
        await page.fill("#modText", "v2 updated claim");
        await page.locator("#modBtn").click();

        const start = Date.now();
        while (Date.now() - start < 60_000) {
            const b = await readBond(deployed, id);
            if (b.claimVersion === 2n) return;
            await new Promise((r) => setTimeout(r, 1000));
        }
        const b = await readBond(deployed, id);
        expect(b.claimVersion).toBe(2n);
    });

    test("C4 — poster closes a bond", async ({ page, deployed }) => {
        test.setTimeout(120_000);
        const id = await createBondViaUI(page);
        await gotoBondDetail(page, id);
        await page.locator("button", { hasText: /^Close bond$/i }).first().click();
        const start = Date.now();
        while (Date.now() - start < 30_000) {
            const b = await readBond(deployed, id);
            if (b.closed) return;
            await new Promise((r) => setTimeout(r, 500));
        }
        const b = await readBond(deployed, id);
        expect(b.closed).toBe(true);
    });

    test("C5 — poster re-opens a closed bond", async ({ page, deployed }) => {
        test.setTimeout(120_000);
        const id = await createBondViaUI(page);
        await gotoBondDetail(page, id);
        await page.locator("button", { hasText: /^Close bond$/i }).first().click();
        // Wait for closed in storage, then click Open.
        const closedStart = Date.now();
        while (Date.now() - closedStart < 30_000) {
            const b = await readBond(deployed, id);
            if (b.closed) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        await page.reload();
        await gotoBondDetail(page, id);
        await page.locator("button", { hasText: /^Open bond$/i }).first().click();
        const openStart = Date.now();
        while (Date.now() - openStart < 30_000) {
            const b = await readBond(deployed, id);
            if (!b.closed && !b.settled) return;
            await new Promise((r) => setTimeout(r, 500));
        }
        const b = await readBond(deployed, id);
        expect(b.closed).toBe(false);
        expect(b.settled).toBe(false);
    });

    test("C6 — poster withdraws after close (no pending challenges)", async ({ page, deployed }) => {
        test.setTimeout(120_000);
        const id = await createBondViaUI(page);
        await gotoBondDetail(page, id);
        await page.locator("button", { hasText: /^Close bond$/i }).first().click();
        // Wait for closed in storage, then reload to enable Withdraw button.
        const closedStart = Date.now();
        while (Date.now() - closedStart < 30_000) {
            const b = await readBond(deployed, id);
            if (b.closed) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        await page.reload();
        await gotoBondDetail(page, id);
        // Auto-accept the confirm() dialog.
        page.once("dialog", (d) => d.accept());
        await page.locator("#withdrawBtn").click();
        const start = Date.now();
        while (Date.now() - start < 30_000) {
            const b = await readBond(deployed, id);
            if (b.settled) return;
            await new Promise((r) => setTimeout(r, 500));
        }
        const b = await readBond(deployed, id);
        expect(b.settled).toBe(true);
    });
});
