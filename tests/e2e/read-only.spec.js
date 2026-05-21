// Read-only flows from FLOWS.md section A. No wallet, no signing.
// Runs against whichever baseURL the project specifies (live-mainnet,
// live-sepolia, or local).

const { test, expect } = require("@playwright/test");

test.describe("read-only flows", () => {
    test("A1 — site loads, title is SimpleBond v0.6, nav visible", async ({ page }) => {
        await page.goto("/");
        await expect(page).toHaveTitle(/SimpleBond v0\.6/);
        // The rebuilt UI uses <button class="tab" data-route="…"> for nav.
        for (const route of ["create", "browse", "judges", "my", "view"]) {
            await expect(page.locator(`button.tab[data-route="${route}"]`)).toBeVisible();
        }
        // Chain selector renders at least one v0.6 chain option.
        const chainOptions = page.locator("#chainSelect option");
        expect(await chainOptions.count()).toBeGreaterThanOrEqual(1);
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

    test("A5 — /v6/smoke.html responds + has a 'Read nextBondId' button", async ({ page }) => {
        await page.goto("/v6/smoke.html");
        await expect(page.locator("#readNext")).toBeVisible();
        await expect(page.locator("#contract")).toHaveValue(/^0x[0-9a-fA-F]{40}$/);
    });
});

test.describe("hostname routing (H)", () => {
    test("H1 — mainnet site exposes chain 1 in the selector", async ({ page, baseURL }) => {
        test.skip(!/bond\.futarchy\.fi/.test(baseURL || ""), "only relevant on mainnet host");
        await page.goto("/");
        const opts = await page.locator("#chainSelect option").allTextContents();
        const onlyMainnet = opts.every((t) => /\b1\b|Ethereum/.test(t));
        expect(onlyMainnet, `expected only mainnet options, got: ${opts.join(", ")}`).toBe(true);
    });

    test("H2 — staging site exposes Sepolia in the selector", async ({ page, baseURL }) => {
        test.skip(
            !/staging\.bond\.futarchy\./.test(baseURL || ""),
            "only relevant on staging host"
        );
        await page.goto("/");
        const opts = await page.locator("#chainSelect option").allTextContents();
        const hasSepolia = opts.some((t) => /11155111|Sepolia/.test(t));
        expect(hasSepolia, `expected Sepolia in options, got: ${opts.join(", ")}`).toBe(true);
    });

    test("H3 — local dev exposes both chains", async ({ page, baseURL }) => {
        test.skip(!/localhost/.test(baseURL || ""), "only relevant on localhost");
        await page.goto("/");
        const opts = await page.locator("#chainSelect option").allTextContents();
        const hasMainnet = opts.some((t) => /\b1\b|Ethereum/.test(t));
        const hasSepolia = opts.some((t) => /11155111|Sepolia/.test(t));
        expect(hasMainnet, "missing mainnet").toBe(true);
        expect(hasSepolia, "missing sepolia").toBe(true);
    });
});
