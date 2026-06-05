// USD-consistency e2e (unit-drift fix).
//
// The SAME bond must read the IDENTICAL USD amount in three places:
//   - the Browse list row
//   - the My-Bonds list row (as poster)
//   - the bond detail page ("Bond amount" / "Challenge amount" fields)
//
// Before the fix, Browse used the canonical USD formatter while My-Bonds and the
// risk/reward card used the raw-units formatter (fmtUnits), so a bond could read
// "$10" in one view and "10" (raw sUSDS) in another. This test seeds a known
// bond and asserts the dollar strings match across all three views.
//
// NOTE: the local MockSUSDS rate is pinned 1:1, so this e2e proves the
// cross-view IDENTITY, not the non-1:1 conversion math — that is covered by the
// pure unit test test/frontend/usdConsistency.test.js.

const { test, expect } = require("./fixtures/wallet-with-node");
const { createBondViaUI, gotoBondDetail } = require("./fixtures/helpers");

// Pull the first dollar amount ("$1,234.56") out of an element's text.
function dollar(text) {
    const m = String(text).match(/\$\s*([\d,]+\.\d{2})/);
    return m ? m[1] : null;
}

test.describe("USD consistency — Browse / My-Bonds / detail agree", () => {
    test("the same bond reads the identical USD amount in all three views", async ({ page }) => {
        test.setTimeout(120_000);

        // Seed a bond with a clear, non-default bond amount so we can find its
        // row unambiguously. Challenge keeps the wizard default.
        const id = await createBondViaUI(page, { claim: "usd-consistency e2e", bondAmount: "42" });

        // ── Browse row ──────────────────────────────────────────────────────
        await page.goto("/#browse");
        await page.locator('button.tab[data-route="browse"]').click({ timeout: 5000 }).catch(() => {});
        const browseRow = page.locator(`.bond-list-item[data-bondid="${id}"]`);
        await expect(browseRow).toBeVisible({ timeout: 20_000 });
        const browseStats = browseRow.locator(".bli-meta .stat-val");
        const browseBond = dollar(await browseStats.nth(0).innerText());
        const browseChallenge = dollar(await browseStats.nth(1).innerText());
        expect(browseBond, "Browse bond amount must be a USD figure").not.toBeNull();
        expect(browseChallenge, "Browse challenge amount must be a USD figure").not.toBeNull();
        // Sanity: a $-prefixed figure, and the bond we set was 42 (1:1 -> 42.00).
        expect(browseBond).toBe("42.00");

        // ── My-Bonds row (poster) ───────────────────────────────────────────
        await page.goto("/#my");
        await page.locator('button.tab[data-route="my"]').click({ timeout: 5000 }).catch(() => {});
        const myRow = page.locator(`#myPoster .bond-list-item[data-bondid="${id}"]`);
        await expect(myRow).toBeVisible({ timeout: 20_000 });
        const myStats = myRow.locator(".bli-meta .stat-val");
        const myBond = dollar(await myStats.nth(0).innerText());
        const myChallenge = dollar(await myStats.nth(1).innerText());
        expect(myBond, "My-Bonds bond amount must be a USD figure").not.toBeNull();
        expect(myChallenge, "My-Bonds challenge amount must be a USD figure").not.toBeNull();

        // ── Bond detail page ────────────────────────────────────────────────
        await gotoBondDetail(page, id);
        // Wait for the enrich pass to render the USD figures (fmtUsdAndSusds
        // shows "$X (Y sUSDS)" once the token rate resolves).
        const detailBondField = page.locator(".bond-field", { hasText: "Bond amount" });
        const detailChallengeField = page.locator(".bond-field", { hasText: "Challenge amount" });
        await expect(detailBondField.locator(".value")).toContainText("$", { timeout: 20_000 });
        const detailBond = dollar(await detailBondField.locator(".value").innerText());
        const detailChallenge = dollar(await detailChallengeField.locator(".value").innerText());
        expect(detailBond, "detail bond amount must be a USD figure").not.toBeNull();
        expect(detailChallenge, "detail challenge amount must be a USD figure").not.toBeNull();

        // ── The core assertion: all three views agree, character-for-character.
        expect(myBond, "My-Bonds bond amount must equal Browse").toBe(browseBond);
        expect(detailBond, "detail bond amount must equal Browse").toBe(browseBond);
        expect(myChallenge, "My-Bonds challenge amount must equal Browse").toBe(browseChallenge);
        expect(detailChallenge, "detail challenge amount must equal Browse").toBe(browseChallenge);
    });
});
