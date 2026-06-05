// v0.7 per-address credit/claim refund UX on bond detail (PRIMARY e2e for the
// version-aware frontend change).
//
// In v0.7 the shared-drain refund model is GONE (SimpleBondV7.sol removes
// claimRefunds/refundCursor). Every refund/payout is credited to
// credits[recipient][token] and pulled via claim(token). The frontend is
// VERSION-AWARE per chain (runtime-config chains[id].bondVersion): a bondVersion:7
// chain must show a per-address "You are owed ~$X" affordance + a Claim button
// calling claim(token), NOT the v0.6 drain card.
//
// Journey (all on the V7 deploy from the v7 fixture):
//   1. Poster creates a bond.
//   2. challenger1 files a challenge (stakes challengeAmount).
//   3. Poster concedes that challenge -> SimpleBondV7.concede() credits the
//      challenger their challengeAmount (Credited event; status Conceded(3)).
//   4. Open the detail page as challenger1 -> assert "You are owed ~$X" + a Claim
//      button (and NO v0.6 drain control: no #refundsBtn / "Drain refunds").
//   5. Click Claim -> claim(token) fires; the challenger's MockSUSDS balance moves
//      by EXACTLY challengeAmount; the credit zeroes; the affordance clears.
//
// Note: in v0.6 a conceded challenge is refunded INLINE (no claim needed), so the
// v6 spec (refunds-affordance.spec.js) asserts a conceded challenge shows NO
// control. v0.7 inverts this: concede now CREDITS (pull payment), so the conceded
// challenger is exactly who should see the Claim affordance. Same on-chain journey,
// opposite UI — that contrast is the version-awareness this change delivers.

const { test, expect, KEYS } = require("./fixtures/wallet-with-node-v7");
const { ethers } = require("ethers");
const {
    createBondViaUI,
    gotoBondDetail,
    readBond,
    readChallenge,
    getChallengeCount,
} = require("./fixtures/helpers");

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
const CREDITS_ABI = ["function credits(address,address) view returns (uint256)"];

function tokenBalance(deployed, addr) {
    const provider = new ethers.JsonRpcProvider(deployed.rpc);
    return new ethers.Contract(deployed.approvedToken, ERC20_ABI, provider).balanceOf(addr);
}

function readCredit(deployed, recipient) {
    const provider = new ethers.JsonRpcProvider(deployed.rpc);
    return new ethers.Contract(deployed.bondContract, CREDITS_ABI, provider).credits(
        recipient,
        deployed.approvedToken
    );
}

// Open the My Bonds page as the currently-mocked account and wait until the
// CONNECTED variant renders. We FULL-reload at #my so no stale, in-flight
// bond-detail render (scheduled by the prior accountsChanged/render) can survive
// and overwrite #view after we navigate. boot() then silent-reconnects (the mock
// always reports the account as already-permitted) and renders #my; the
// role-section headings only appear once signer+account are set. We re-reload
// until the connected page is up.
async function gotoMyBonds(page) {
    const start = Date.now();
    while (Date.now() - start < 60_000) {
        await page.goto("/#my");
        await page.reload();
        try {
            // Connected My Bonds page: role-section headings present (the
            // unconnected variant shows a "Connect a wallet" card instead).
            await page.waitForFunction(
                () => /As challenger/i.test(document.body.innerText),
                null,
                { timeout: 10_000 }
            );
            // Give the late banner read (after the role-section Promise.all) a
            // moment to settle; the assertions that follow still own the verdict.
            await new Promise((r) => setTimeout(r, 800));
            return;
        } catch (_) {
            // Not connected yet (connect card showing) — re-navigate and retry.
            await new Promise((r) => setTimeout(r, 500));
        }
    }
    throw new Error("My Bonds page never rendered the connected role sections");
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

test.describe("v0.7 credit/claim refund UX on bond detail", () => {
    test("conceded -> challenger is owed -> claim moves balance + clears affordance", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(240_000);

        // 1) Poster creates a bond.
        const id = await createBondViaUI(page);

        // 2) challenger1 challenges (stakes challengeAmount).
        await fileChallenge(page, deployed, switchAccount, id, KEYS.challenger1, "v7-credit-path");
        expect(await getChallengeCount(deployed, id)).toBe(1n);

        const bond = await readBond(deployed, id);
        const challengerAddr = new ethers.Wallet(KEYS.challenger1).address;

        // 3) Poster concedes -> SimpleBondV7 credits the challenger (status Conceded(3)).
        await switchAccount(KEYS.poster);
        await page.reload();
        await gotoBondDetail(page, id);
        await page.locator('button[data-act="concede"][data-i="0"]').click();
        const concedeStart = Date.now();
        while (Date.now() - concedeStart < 60_000) {
            if ((await readChallenge(deployed, id, 0)).status === 3n) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        expect((await readChallenge(deployed, id, 0)).status).toBe(3n);
        // The credit ledger now holds the challenger's stake (NOT pushed inline).
        expect(await readCredit(deployed, challengerAddr)).toBe(bond.challengeAmount);

        // 4) View as the credited challenger: the v0.7 Claim affordance appears,
        //    and the v0.6 drain control does NOT.
        await switchAccount(KEYS.challenger1);
        await page.reload();
        await gotoBondDetail(page, id);
        await expect(page.getByRole("heading", { name: "Refunds" })).toBeVisible();
        await expect(page.locator("#claimBtn")).toBeVisible();
        // "You are owed ~$X" with a dollar figure.
        await expect(page.locator(".card", { hasText: "You are owed" })).toContainText(
            /You are owed ~\$[\d.,]+/
        );
        // No v0.6 shared-drain UI on a v7 chain.
        await expect(page.locator("#refundsBtn")).toHaveCount(0);
        await expect(page.getByText("Drain refunds")).toHaveCount(0);

        // 5) Claim -> balance moves by exactly challengeAmount, credit zeroes,
        //    affordance clears.
        const balBefore = await tokenBalance(deployed, challengerAddr);
        await page.locator("#claimBtn").click();
        const claimStart = Date.now();
        while (Date.now() - claimStart < 60_000) {
            if ((await readCredit(deployed, challengerAddr)) === 0n) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        expect(await readCredit(deployed, challengerAddr)).toBe(0n);

        const balAfter = await tokenBalance(deployed, challengerAddr);
        expect(balAfter - balBefore).toBe(bond.challengeAmount);

        // The UI auto-refreshes after the claim (doClaimCredit re-renders). With
        // the credit zeroed, the affordance must disappear.
        const goneStart = Date.now();
        let gone = false;
        while (Date.now() - goneStart < 30_000) {
            if ((await page.locator("#claimBtn").count()) === 0) { gone = true; break; }
            await new Promise((r) => setTimeout(r, 500));
        }
        if (!gone) {
            await page.reload();
            await gotoBondDetail(page, id);
        }
        await expect(page.locator("#claimBtn")).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "Refunds" })).toHaveCount(0);
    });

    // backlog #2 — the GLOBAL claimable-credits indicator on the My Bonds page.
    // Since v0.7 refunds are PULLED (not pushed), a credited user otherwise only
    // discovers their credit on the exact bond detail page. The My Bonds page must
    // surface a GLOBAL "you have ~$X claimable across your bonds" banner so the
    // credit is discoverable from a top-level nav target; clicking Claim must pull
    // it (balance moves) and the banner must clear.
    test("conceded -> My Bonds shows the global claimable banner -> Claim pulls it + banner clears", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(240_000);

        // 1) Poster creates a bond.
        const id = await createBondViaUI(page);

        // 2) challenger1 challenges (stakes challengeAmount).
        await fileChallenge(page, deployed, switchAccount, id, KEYS.challenger1, "v7-mybonds-credit");
        expect(await getChallengeCount(deployed, id)).toBe(1n);

        const bond = await readBond(deployed, id);
        const challengerAddr = new ethers.Wallet(KEYS.challenger1).address;

        // 3) Poster concedes -> SimpleBondV7 credits the challenger.
        await switchAccount(KEYS.poster);
        await page.reload();
        await gotoBondDetail(page, id);
        await page.locator('button[data-act="concede"][data-i="0"]').click();
        const concedeStart = Date.now();
        while (Date.now() - concedeStart < 60_000) {
            if ((await readChallenge(deployed, id, 0)).status === 3n) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        expect((await readChallenge(deployed, id, 0)).status).toBe(3n);
        expect(await readCredit(deployed, challengerAddr)).toBe(bond.challengeAmount);

        // 4) As the credited challenger, open the My Bonds page (a top-level nav
        //    target, NOT the per-bond detail) and assert the GLOBAL banner appears.
        await switchAccount(KEYS.challenger1);
        await gotoMyBonds(page);
        // The global banner appears and frames the credit as aggregate across bonds.
        await expect(page.locator("#myCreditsBanner")).toContainText(
            /You have ~\$[\d.,]+ claimable across your bonds\./,
            { timeout: 30_000 }
        );
        await expect(page.locator("#myCreditsClaimBtn")).toBeVisible();

        // 5) Click the My-Bonds Claim -> balance moves by exactly challengeAmount,
        //    credit zeroes, and the global banner clears.
        const balBefore = await tokenBalance(deployed, challengerAddr);
        await page.locator("#myCreditsClaimBtn").click();
        const claimStart = Date.now();
        while (Date.now() - claimStart < 60_000) {
            if ((await readCredit(deployed, challengerAddr)) === 0n) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        expect(await readCredit(deployed, challengerAddr)).toBe(0n);

        const balAfter = await tokenBalance(deployed, challengerAddr);
        expect(balAfter - balBefore).toBe(bond.challengeAmount);

        // The My Bonds page re-renders after the claim (doClaimCreditMyBonds ->
        // renderMyBonds). With the credit zeroed, the global banner must be empty.
        const goneStart = Date.now();
        let gone = false;
        while (Date.now() - goneStart < 30_000) {
            const txt = await page.locator("#myCreditsBanner").innerText().catch(() => "x");
            if (txt.trim() === "") { gone = true; break; }
            await new Promise((r) => setTimeout(r, 500));
        }
        if (!gone) {
            await gotoMyBonds(page);
        }
        await expect(page.locator("#myCreditsClaimBtn")).toHaveCount(0);
    });
});
