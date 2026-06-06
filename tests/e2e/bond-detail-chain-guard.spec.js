// e2e #16 — wrong-chain guard on the BOND-DETAIL write paths.
//
// Mirrors write-paths-chain-guard.spec.js (the table-driven guard over the entry
// write paths) but for actions reachable only from the bond-detail page. Incident
// I4 (FAOSale) happened because a write fired against a same-address contract on
// the WRONG chain; the guardrail linter proves no UNGUARDED signer path exists and
// the entry-path spec proves those guards behave — this proves the bond-detail
// ones do too.
//
// Setup: the bond is created on the correct (Hardhat 31337) chain. Then the wallet
// is moved to a WRONG chain (Gnosis 100, which is NOT in the page's single-chain
// config) and a bond-detail write is attempted. Each must surface the friendly
// "switch to <chain>" guard message in its own message slot, send NO cross-chain
// tx, and NEVER leak a raw cross-chain revert.
//
// NON-VACUOUS: if requireWalletOnActiveChain() were removed from bondWriteContract
// (or a path bypassed it), the click would attempt the tx against chain 100,
// surfacing a raw ethers/RPC error (or actually mutating nothing while looking
// like it tried) instead of the friendly switch message — failing these asserts.
// We also assert the on-chain state is UNCHANGED, so no cross-chain tx leaked.

const { test, expect, KEYS } = require("./fixtures/wallet-with-node");
const {
    createBondViaUI,
    gotoBondDetail,
    readBond,
    getChallengeCount,
} = require("./fixtures/helpers");

const WRONG_CHAIN = 100; // Gnosis — not present in the page's single-chain config.

// Each path: who must be connected to make its card render, the message slot, and
// the click sequence. The bond is already created (correct chain) before run().
const PATHS = [
    {
        name: "challenge (#challengeBtn)",
        key: KEYS.challenger1, // non-poster -> Challenge card renders
        msg: "#challengeMsg",
        run: async (page) => {
            await page.fill("#chContent", "wrong-chain challenge attempt");
            await page.locator("#challengeBtn").click();
        },
    },
    {
        name: "close bond (#closeBtn)",
        key: KEYS.poster, // poster -> Poster controls card renders
        msg: "#posterMsg",
        run: async (page) => {
            await page.locator("#closeBtn").click();
        },
    },
];

test.describe("wrong-chain guard over bond-detail write paths (I4)", () => {
    for (const p of PATHS) {
        test(`${p.name} is blocked on the wrong chain, no cross-chain tx / revert leak`, async ({
            page,
            deployed,
            switchAccount,
        }) => {
            test.setTimeout(120_000);

            // Create the bond on the CORRECT chain (poster, 31337).
            const id = await createBondViaUI(page);
            const before = await readBond(deployed, id);
            expect(before.closed).toBe(false);
            expect(await getChallengeCount(deployed, id)).toBe(0n);

            // Move the wallet to the WRONG chain. addInitScript re-applies on every
            // navigation/reload so the mock provider reports chain 100 from boot;
            // the page's silent-reconnect then sets walletChainId = 100, while the
            // page config (and all reads) stay on 31337.
            await page.addInitScript((wrong) => { window.__mockChainId = wrong; }, WRONG_CHAIN);

            // Connect as the role whose card renders for this path.
            await switchAccount(p.key);
            await page.reload();
            await gotoBondDetail(page, id);

            // Trigger the bond-detail write while on the wrong chain.
            await p.run(page);

            // Friendly switch guard surfaces in this path's message slot.
            await expect(page.locator(p.msg)).toContainText(/chain 100|switch/i, {
                timeout: 15_000,
            });
            // No raw cross-chain revert leak.
            await expect(page.locator(p.msg)).not.toContainText(/FAOSale/i);
            await expect(page.locator(p.msg)).not.toContainText(/fallback not allowed/i);
            await expect(page.locator(p.msg)).not.toContainText(/could not coalesce/i);

            // Give any (erroneously-sent) tx time to land, then prove on-chain
            // state is UNCHANGED — no cross-chain tx leaked through the guard.
            await page.waitForTimeout(2000);
            const after = await readBond(deployed, id);
            expect(after.closed).toBe(false);
            expect(after.settled).toBe(false);
            expect(await getChallengeCount(deployed, id)).toBe(0n);
        });
    }
});
