// Wizard draft persistence — partially-filled bond inputs survive a reload
// via localStorage and are cleared once the user discards the draft.

const { test, expect } = require("@playwright/test");

test.describe("create-bond draft", () => {
    test("saved inputs are restored after reload and cleared on discard", async ({ page }) => {
        await page.goto("/#create");
        // Type a claim and tweak the bond amount so a non-empty draft persists.
        await page.fill("#cb-claim", "draft persistence test claim");
        await page.click("#wizNext");
        await page.waitForSelector("#cb-bond");
        await page.fill("#cb-bond", "42");
        // Saver is debounced at 400ms.
        await page.waitForTimeout(700);
        // Force a full reload — same behavior as crash / browser quit.
        await page.reload();
        // Route lands on default tab; force the create tab.
        await page.goto("/#create");
        // Banner should be visible, claim restored, the stepper should have
        // bounced back to the step the user was on (step 2 = Stake).
        await expect(page.locator("#draftBanner")).toBeVisible();
        await expect(page.locator("#draftBanner")).toContainText(/Resumed from your saved draft/i);
        await expect(page.locator("#cb-bond")).toHaveValue("42");
        // Step 1's claim is also still there — go back and check.
        await page.click("#wizPrev");
        await expect(page.locator("#cb-claim")).toHaveValue("draft persistence test claim");
        // Discard wipes the draft and resets to the empty form.
        await page.click("#draftDiscard");
        await expect(page.locator("#draftBanner")).toHaveCount(0);
        await expect(page.locator("#cb-claim")).toHaveValue("");
        // Reload again to confirm storage was actually cleared.
        await page.reload();
        await page.goto("/#create");
        await expect(page.locator("#draftBanner")).toHaveCount(0);
        await expect(page.locator("#cb-claim")).toHaveValue("");
    });
});
