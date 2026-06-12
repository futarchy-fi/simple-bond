// Read-only flows from FLOWS.md section A. No wallet, no signing.
// Runs against whichever baseURL the project specifies (live-mainnet,
// live-sepolia, or local).

const { test, expect } = require("@playwright/test");

test.describe("read-only flows", () => {
    test("A1 — site loads, title is ClaimBond, nav visible", async ({ page }) => {
        await page.goto("/");
        await expect(page).toHaveTitle(/ClaimBond/);
        // The rebuilt UI uses <button class="tab" data-route="…"> for nav.
        // 'view' is a per-bond detail page, not a tab.
        for (const route of ["create", "browse", "judges", "my"]) {
            await expect(page.locator(`button.tab[data-route="${route}"]`)).toBeVisible();
        }
        await expect(page.locator('button.tab[data-route="view"]')).toHaveCount(0);
        // Chain selector is hidden on single-chain hosts and replaced by a
        // #chainLabel pill. Multi-chain (localhost) keeps the dropdown.
        const labelVisible = await page.locator("#chainLabel:visible").count();
        const selectVisible = await page.locator("#chainSelect:visible").count();
        expect(labelVisible + selectVisible).toBeGreaterThanOrEqual(1);
    });

    test("A2 — Browse loads (or shows empty state) without decode errors", async ({ page }) => {
        const errors = [];
        page.on("pageerror", (err) => errors.push(String(err)));
        page.on("console", (msg) => {
            if (msg.type() === "error") errors.push(msg.text());
        });

        await page.goto("/#browse");
        // Click the Browse tab (or default if already routed). Wait for the main view to populate.
        await page.locator('button.tab[data-route="browse"]').click({ timeout: 5000 }).catch(() => {});
        await expect(page.locator("#view")).not.toBeEmpty({ timeout: 15_000 });

        // No "could not decode result data" or "BAD_DATA" errors.
        const decodeError = errors.find((e) => /could not decode|BAD_DATA/i.test(e));
        expect(decodeError, `unexpected decode error: ${decodeError}`).toBeUndefined();
    });

    test("Clicking Create without a wallet shows the Rabby-first install modal", async ({ page }) => {
        // Stub out window.ethereum so the page boots into the no-wallet state
        // regardless of where the test runs.
        await page.addInitScript(() => {
            try { delete window.ethereum; } catch (_) {}
            Object.defineProperty(window, "ethereum", { value: undefined, configurable: true });
        });
        await page.goto("/#create");
        await page.fill("#cb-claim", "no-wallet modal test");
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
        await expect(page.locator("#noWalletModal")).toBeVisible({ timeout: 10_000 });
        await expect(page.locator("#noWalletModal")).toContainText(/Rabby/);
        await expect(page.locator("#noWalletModal a[href*='rabby.io']")).toBeVisible();
        await expect(page.locator("#noWalletModal a[href*='metamask.io']")).toBeVisible();
        // Dismissible via Cancel.
        await page.locator("#noWalletCancel").click();
        await expect(page.locator("#noWalletModal")).toHaveCount(0);
    });

    test("Create wizard advances to Review with no wallet connected", async ({ page }) => {
        // The wizard must work end-to-end without window.ethereum so users
        // can see the shape of the bond they're about to post before any
        // wallet/funding friction. Connect/funding only fires at Create-click.
        await page.goto("/#create");
        // Step 1 — Claim
        await page.fill("#cb-claim", "wallet-less review test");
        await page.click("#wizNext");
        // Step 2 — Stake (defaults are pre-filled)
        await page.waitForSelector("#cb-bond");
        await page.click("#wizNext");
        // Step 3 — Judge (just type 0; resolution may fail because the page
        // uses chain RPC even without a wallet — that's fine)
        await page.waitForSelector("#cb-jpid");
        await page.fill("#cb-jpid", "0");
        // Either resolveJudgeFromProfile succeeded (mainnet/sepolia) or it
        // failed (smoke test against live URL where no profile exists yet).
        // Continue regardless.
        await page.click("#wizNext");
        // Step 4 — Timing (defaults are valid)
        await page.waitForSelector("#cb-ad");
        await page.click("#wizNext");
        // Step 5 — Review; the Create button must say 'Create Claim Bond' (no
        // 'Connect wallet to create' fallback).
        await expect(page.locator("#wizCreate")).toBeVisible();
        await expect(page.locator("#wizCreate")).toHaveText(/^Create Claim Bond$/);
    });

    test("A5 — /v6/smoke.html responds + has a 'Read nextBondId' button", async ({ page }) => {
        await page.goto("/v6/smoke.html");
        await expect(page.locator("#readNext")).toBeVisible();
        await expect(page.locator("#contract")).toHaveValue(/^0x[0-9a-fA-F]{40}$/);
    });
});

test.describe("hostname routing (H)", () => {
    test("H1 — mainnet site shows Ethereum label (selector hidden)", async ({ page, baseURL }) => {
        test.skip(!/bond\.futarchy\.fi/.test(baseURL || ""), "only relevant on mainnet host");
        await page.goto("/");
        await expect(page.locator("#chainLabel:visible")).toContainText(/Ethereum/);
        await expect(page.locator("#chainSelect")).toBeHidden();
    });

    test("H2 — staging site shows Sepolia label (selector hidden)", async ({ page, baseURL }) => {
        test.skip(
            !/staging\.bond\.futarchy\./.test(baseURL || ""),
            "only relevant on staging host"
        );
        await page.goto("/");
        await expect(page.locator("#chainLabel:visible")).toContainText(/Sepolia/);
        await expect(page.locator("#chainSelect")).toBeHidden();
    });

    test("H3 — local dev exposes both chains in the dropdown", async ({ page, baseURL }) => {
        test.skip(!/localhost/.test(baseURL || ""), "only relevant on localhost");
        await page.goto("/");
        await expect(page.locator("#chainSelect:visible")).toBeVisible();
        const opts = await page.locator("#chainSelect option").allTextContents();
        const hasMainnet = opts.some((t) => /Ethereum/.test(t));
        const hasSepolia = opts.some((t) => /Sepolia/.test(t));
        expect(hasMainnet, "missing mainnet").toBe(true);
        expect(hasSepolia, "missing sepolia").toBe(true);
    });
});
