// Bond-level lifecycle/role banner (SECONDARY e2e for the bondBanner change).
//
// A5 adds ONE plain-language banner at the top of the bond-detail page that says
// the bond's lifecycle (open / disputed / closed / settled) and THE VIEWER's next
// move. The whole point is that it derives from the SAME gating flags the action
// cards use (isPoster / isJudgeOperator / canChallenge + settled/closed/pending),
// so it can NEVER contradict the buttons below it.
//
// This spec proves that invariant against the REAL rendered page for three
// representative (role x state) combos, asserting the banner text matches WHICH
// action cards actually render:
//
//   1. poster-of-open: banner says "Open ... you can modify the claim or close it";
//      the Poster-controls card IS present; the Challenge card is NOT (poster can't
//      challenge their own bond).
//   2. challenger-eligible-of-open: a connected non-poster sees "You can challenge
//      this claim" IFF the #challengeBtn control is present.
//   3. judge-of-disputed: with a pending challenge, the judge sees "rule or reject
//      each pending challenge below" IFF the Judge-controls card renders AND a
//      per-challenge ruling button is present.
//   3b. judge-of-CLOSED-with-pending: closeBond() only blocks NEW challenges;
//      EXISTING Pending ones still resolve and the judge keeps full rule/reject
//      power. The badge is "closed" (label precedence) but the banner STILL says
//      "rule or reject each pending challenge below" IFF the Judge-controls card +
//      a per-challenge reject button render on the closed bond. This guards the
//      bug where the closed label suppressed the judge's next-move clause.
//   4. settled: after the judge voids the bond, the banner is exactly "Settled —
//      this bond is resolved." with NO action verb, and NONE of the action cards
//      (poster / judge / challenge) render — the banner advertises nothing the
//      cards don't.
//
// Single source of truth: because the banner reads the same flags, "banner says
// you can challenge" <=> "#challengeBtn present", "banner says you can rule" <=>
// "judge controls present", and a settled bond's banner claims no move <=> no
// action card renders.

const { test, expect, KEYS } = require("./fixtures/wallet-with-node");
const { ethers } = require("ethers");
const {
    createBondViaUI,
    gotoBondDetail,
    readBond,
    getChallengeCount,
    timeTravel,
} = require("./fixtures/helpers");

const BANNER = ".bond-banner";

// Register the canonical judge in localStorage so the UI marks the connected
// wallet as the judge operator on the detail page (mirrors judge-flows.spec.js).
async function asJudgeOperator(page, deployed, switchAccount) {
    await switchAccount(KEYS.judgeOperator);
    await page.evaluate(
        ({ judge, chainId, addr }) => {
            localStorage.setItem(`myJudgeContract:${chainId}:${addr.toLowerCase()}`, judge);
        },
        {
            judge: deployed.manualJudgeV6,
            chainId: deployed.chainId,
            addr: new ethers.Wallet(KEYS.judgeOperator).address,
        }
    );
}

async function fileChallenge(page, deployed, switchAccount, id, key, reason) {
    await switchAccount(key);
    await page.reload();
    await gotoBondDetail(page, id);
    await page.fill("#chContent", reason);
    await page.locator("#challengeBtn").click();
    const start = Date.now();
    while (Date.now() - start < 30_000) {
        if ((await getChallengeCount(deployed, id)) > 0n) break;
        await new Promise((r) => setTimeout(r, 500));
    }
}

test.describe("Bond lifecycle/role banner matches the rendered action cards", () => {
    test("poster-of-open: banner names open + modify/close; poster card present, no challenge card", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(120_000);
        const id = await createBondViaUI(page);
        // Default account is the poster.
        await switchAccount(KEYS.poster);
        await page.reload();
        await gotoBondDetail(page, id);

        // Banner: open lifecycle + the poster's bond-level move.
        await expect(page.locator(BANNER)).toHaveAttribute("data-state", "open");
        await expect(page.locator(BANNER)).toHaveAttribute("data-role", "poster");
        await expect(page.locator(BANNER)).toContainText(
            "Open — no challenges yet. Your bond is open; you can modify the claim or close it."
        );

        // The banner's claim matches the cards: poster controls render; the
        // challenge card does NOT (a poster can't challenge their own bond).
        await expect(page.getByRole("heading", { name: "Poster controls" })).toBeVisible();
        await expect(page.locator("#challengeBtn")).toHaveCount(0);
    });

    test("challenger-eligible-of-open: banner says 'You can challenge' IFF the challenge control renders", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(120_000);
        const id = await createBondViaUI(page);
        // View as a connected non-poster: canChallenge is true on this open bond.
        await switchAccount(KEYS.challenger1);
        await page.reload();
        await gotoBondDetail(page, id);

        await expect(page.locator(BANNER)).toHaveAttribute("data-state", "open");
        await expect(page.locator(BANNER)).toHaveAttribute("data-role", "challenger-eligible");
        await expect(page.locator(BANNER)).toContainText("You can challenge this claim.");

        // The single source of truth: banner says you can challenge <=> the
        // challenge control IS rendered. Poster controls are NOT shown to a
        // non-poster.
        await expect(page.locator("#challengeBtn")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Poster controls" })).toHaveCount(0);
    });

    test("judge-of-disputed: banner says rule/reject IFF judge controls + a per-challenge ruling button render", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(180_000);
        const id = await createBondViaUI(page, { acceptanceDelay: 60, rulingBuffer: 600 });
        await fileChallenge(page, deployed, switchAccount, id, KEYS.challenger1, "banner-disputed");
        expect(await getChallengeCount(deployed, id)).toBe(1n);
        expect((await readBond(deployed, id)).pendingCount).toBe(1n);
        // Advance past the acceptance window so the ruling buttons are live.
        await timeTravel(deployed, 120, page);

        // View as the judge operator.
        await asJudgeOperator(page, deployed, switchAccount);
        await page.reload();
        await gotoBondDetail(page, id);

        await expect(page.locator(BANNER)).toHaveAttribute("data-state", "disputed");
        await expect(page.locator(BANNER)).toHaveAttribute("data-role", "judge");
        await expect(page.locator(BANNER)).toContainText(
            "Disputed — 1 challenge pending. You are the judge; rule or reject each pending challenge below."
        );

        // Banner says you can rule/reject <=> the Judge-controls card renders AND
        // at least one per-challenge ruling button is present.
        await expect(page.getByRole("heading", { name: "Judge controls" })).toBeVisible();
        await expect(page.locator('button[data-act="rejectChallenge"][data-i="0"]')).toBeVisible();
    });

    test("judge-of-CLOSED-with-pending: banner STILL says rule/reject IFF judge controls + per-challenge reject button render on a closed bond", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(180_000);
        // closeBond() only blocks NEW challenges; EXISTING Pending ones still
        // resolve and the judge keeps full power (ruleForPoster/ruleForChallenger in
        // the ruling window; rejectChallenge out-of-scope at ANY time while Pending).
        // So a CLOSED bond can have pendingCount > 0 with the judge fully able to act.
        const id = await createBondViaUI(page, { acceptanceDelay: 60, rulingBuffer: 600 });

        // File a challenge so there is a Pending challenge in flight.
        await fileChallenge(page, deployed, switchAccount, id, KEYS.challenger1, "banner-closed-pending");
        expect(await getChallengeCount(deployed, id)).toBe(1n);
        expect((await readBond(deployed, id)).pendingCount).toBe(1n);

        // The POSTER closes the bond — pending challenges are retained.
        await switchAccount(KEYS.poster);
        await page.reload();
        await gotoBondDetail(page, id);
        await page.locator("#closeBtn").click();
        let start = Date.now();
        while (Date.now() - start < 60_000) {
            if ((await readBond(deployed, id)).closed) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        const closedBond = await readBond(deployed, id);
        expect(closedBond.closed).toBe(true);
        // The bond is CLOSED but STILL has the pending challenge.
        expect(closedBond.pendingCount).toBe(1n);

        // View the closed-with-pending bond as the judge operator.
        await asJudgeOperator(page, deployed, switchAccount);
        await page.reload();
        await gotoBondDetail(page, id);

        // The status badge / data-state is 'closed' (closed precedence wins over
        // disputed), matching the lifecycle badge…
        await expect(page.locator(BANNER)).toHaveAttribute("data-state", "closed");
        await expect(page.locator(BANNER)).toHaveAttribute("data-role", "judge");
        // …but the next-move clause is keyed off ACTUAL ACTIONABILITY: the judge can
        // STILL rule/reject the pending challenge on a closed bond. This is the bug
        // being fixed — previously the banner said "no challenges are pending to rule
        // on" for closed+pending. The lifecycle clause stays "existing disputes
        // still resolve".
        await expect(page.locator(BANNER)).toContainText(
            "Closed — no new challenges; existing disputes still resolve. You are the judge; rule or reject each pending challenge below."
        );
        await expect(page.locator(BANNER)).not.toContainText("no challenges are pending to rule on");

        // Single source of truth on a CLOSED bond: banner says rule/reject <=> the
        // Judge-controls card renders (gated on isJudgeOperator && !settled, NOT on
        // !closed) AND a per-challenge reject button renders (gated on
        // isJudgeOperator + Pending, NOT on !closed). rejectChallenge is allowed at
        // ANY time while Pending, so the reject button is present even on a closed
        // bond regardless of the ruling window.
        await expect(page.getByRole("heading", { name: "Judge controls" })).toBeVisible();
        await expect(page.locator('button[data-act="rejectChallenge"][data-i="0"]')).toBeVisible();
    });

    test("settled: banner is exactly 'Settled — this bond is resolved.' with NO action verb and NO action cards", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(240_000);
        const id = await createBondViaUI(page, { acceptanceDelay: 60, rulingBuffer: 600 });
        await fileChallenge(page, deployed, switchAccount, id, KEYS.challenger1, "banner-settled");
        expect(await getChallengeCount(deployed, id)).toBe(1n);

        // Judge voids the whole bond (rejectBond): settles it.
        await asJudgeOperator(page, deployed, switchAccount);
        await page.reload();
        await gotoBondDetail(page, id);
        page.once("dialog", (d) => d.accept());
        await page.locator("#rejectBondBtn").click();
        const start = Date.now();
        while (Date.now() - start < 60_000) {
            if ((await readBond(deployed, id)).settled) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        expect((await readBond(deployed, id)).settled).toBe(true);

        // View the settled bond as the judge (a !settled-gated viewer with the
        // strongest role) — the banner must STILL advertise no move.
        await page.reload();
        await gotoBondDetail(page, id);

        await expect(page.locator(BANNER)).toHaveAttribute("data-state", "settled");
        // Exact text — no next-move clause appended.
        await expect(page.locator(BANNER)).toHaveText("Settled — this bond is resolved.");
        // No action verbs leaked into the banner.
        await expect(page.locator(BANNER)).not.toContainText(/you can|rule or reject|modify|close|reopen|challenge/i);

        // Single source of truth: a settled bond renders NONE of the action cards,
        // matching the banner's silence.
        await expect(page.getByRole("heading", { name: "Poster controls" })).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "Judge controls" })).toHaveCount(0);
        await expect(page.locator("#challengeBtn")).toHaveCount(0);
    });
});
