// BACKLOG #1 / e2e #4 (HIGH) — challenge-capacity gate on the LIVE v0.6 chain.
//
// On SimpleBondV6.sol (LIVE on mainnet) the challenge() cap is TOTAL-EVER:
//   require(challenges[bondId].length < b.maxChallenges, "Max challenges reached")
// NOT pending-at-once. The frontend used to gate the Challenge card on
// pendingCount, so on a v6 bond where maxChallenges challenges had already been
// filed-and-resolved (pendingCount back to 0, but challenges[].length ==
// maxChallenges) the UI STILL rendered the Challenge card. A real user then paid
// a real ERC-20 approve tx + a challenge() tx that reverted "Max challenges
// reached" — wasted gas on production. hasChallengeCapacity() (frontend/
// challenge-capacity.js) now gates v6 on the TOTAL-EVER count.
//
// This spec locks that fix end-to-end:
//   1. Create a v6 bond with maxChallenges = 1.
//   2. challenger1 files the ONE allowed challenge.
//   3. The poster CONCEDES it (per-challenge concede) so pendingCount returns to
//      0 while getChallengeCount stays at 1 == maxChallenges.
//   4. Reload the bond detail as a NON-poster (challenger2) and assert the
//      Challenge card (#challengeBtn) is HIDDEN — the UI will not send a
//      challenge() that the v6 contract would revert — and the max-challenges
//      affordance is shown (Max challenges = 1, Challenges (1) == the cap).
//
// NON-VACUOUS: if the gate regressed to pendingCount (the old bug), pendingCount
// would be 0 < 1 and the Challenge card WOULD render, failing the count-0 assert.

const { test, expect, KEYS } = require("./fixtures/wallet-with-node");
const {
    createBondViaUI,
    gotoBondDetail,
    readBond,
    readChallenge,
    getChallengeCount,
} = require("./fixtures/helpers");

test.describe("challenge-capacity full on v6 (backlog #1)", () => {
    test("maxChallenges=1 + one resolved challenge hides the Challenge card for a non-poster", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(180_000);

        // 1) Create a bond with the total-ever cap = 1.
        const id = await createBondViaUI(page, { maxChallenges: 1 });

        // 2) challenger1 files the single allowed challenge.
        await switchAccount(KEYS.challenger1);
        await page.reload();
        await gotoBondDetail(page, id);
        await page.fill("#chContent", "the one and only challenge");
        await page.locator("#challengeBtn").click();
        {
            const start = Date.now();
            while (Date.now() - start < 60_000) {
                if ((await getChallengeCount(deployed, id)) === 1n) break;
                await new Promise((r) => setTimeout(r, 500));
            }
        }
        expect(await getChallengeCount(deployed, id)).toBe(1n);
        {
            const b = await readBond(deployed, id);
            expect(b.pendingCount).toBe(1n);
        }

        // 3) Poster concedes challenge #0 -> Conceded (status 3); pendingCount -> 0
        //    while getChallengeCount stays 1 (== maxChallenges).
        await switchAccount(KEYS.poster);
        await page.reload();
        await gotoBondDetail(page, id);
        await page.locator('button[data-act="concede"][data-i="0"]').click();
        {
            const start = Date.now();
            while (Date.now() - start < 60_000) {
                const c = await readChallenge(deployed, id, 0);
                if (c.status === 3n /* Conceded */) break;
                await new Promise((r) => setTimeout(r, 500));
            }
        }
        const c0 = await readChallenge(deployed, id, 0);
        expect(c0.status).toBe(3n); // Conceded
        const bAfter = await readBond(deployed, id);
        // The exact post-bug state: capacity is FULL by total-ever count, yet the
        // pending set is empty and the bond is neither closed nor settled.
        expect(bAfter.pendingCount).toBe(0n);
        expect(bAfter.settled).toBe(false);
        expect(bAfter.closed).toBe(false);
        expect(await getChallengeCount(deployed, id)).toBe(1n);
        expect(bAfter.maxChallenges).toBe(1n);

        // 4) Reload as a NON-poster (challenger2, who never challenged this bond)
        //    and assert the Challenge card is HIDDEN — the regression lock.
        await switchAccount(KEYS.challenger2);
        await page.reload();
        await gotoBondDetail(page, id);

        // The Challenge card + #challengeBtn render ONLY when canChallenge is true.
        // With total-ever count (1) == maxChallenges (1), capacity is full -> the
        // card must be ABSENT. If the gate regressed to pendingCount (0 < 1) this
        // would FAIL.
        await expect(page.locator("#challengeBtn")).toHaveCount(0);
        await expect(page.locator("#chContent")).toHaveCount(0);
        await expect(page.locator(".card h3", { hasText: /Challenge this claim/i }))
            .toHaveCount(0);

        // Max-challenges affordance: the bond detail surfaces the cap (1) and the
        // Challenges header shows the count has reached it.
        const maxField = page.locator(".bond-field", { hasText: "Max challenges" });
        await expect(maxField).toContainText("1");
        await expect(page.locator(".card h3", { hasText: /^\s*Challenges\s*\(1\)/ }))
            .toBeVisible();

        // The single challenge card is still rendered with its resolved status.
        await expect(page.locator("#ch-0")).toBeVisible();
        await expect(page.locator("#ch-0 .status-badge")).toContainText("Conceded");
    });
});
