// Stale-signer regression (mainnet incident 2026-06-10): the accountsChanged
// handler updated `account` and re-rendered the role-gated UI, but never rebuilt
// the ethers signer — which is PINNED to the address it was created with. After
// a wallet account switch, every write was silently sent FROM THE PREVIOUS
// account, so the contract rejected it with the other account's role error
// ("Only operator" / "Not poster") and the only cure was a hard refresh.
//
// This spec records the `from` of every eth_sendTransaction the app emits and
// asserts that, after switchAccount, writes are signed by the NEW account.
// (The wallet mock signs with the current key regardless — the bug lives in the
// `from` the app's stale signer populates, which is exactly what we record.)
//
// Run: ./scripts/e2e-docker.sh account-switch-signer.spec.js --project local

const { test, expect, KEYS } = require("./fixtures/wallet-with-node");
const { ethers } = require("ethers");
const { createBondViaUI } = require("./fixtures/helpers");

test.describe("account switch rebinds the write signer", () => {
    test("after switchAccount, writes go FROM the new account, not the boot account", async ({ page, switchAccount }) => {
        test.setTimeout(120_000);
        // Boot connected as the default account (poster) so the app builds its
        // signer for it, then start recording outgoing transaction `from`s.
        await page.goto("/#browse");
        await page.waitForFunction(() => document.getElementById("walletAddr")?.textContent?.includes("…"));
        await page.evaluate(() => {
            window.__sentFroms = [];
            const orig = window.ethereum.request.bind(window.ethereum);
            window.ethereum.request = async (args) => {
                if (args && args.method === "eth_sendTransaction") {
                    const tx = (args.params || [])[0] || {};
                    window.__sentFroms.push(String(tx.from || "").toLowerCase());
                }
                return orig(args);
            };
        });

        const challenger = new ethers.Wallet(KEYS.challenger1).address;
        await switchAccount(KEYS.challenger1);
        // The handler is async (it rebuilds provider+signer); wait until the
        // header shows the new account before driving a write.
        await page.waitForFunction(
            (tail) => document.getElementById("walletAddr")?.textContent?.toLowerCase().includes(tail),
            challenger.slice(-4).toLowerCase()
        );

        // Any write works; the create wizard exercises approve + createBond.
        await createBondViaUI(page, { claim: "stale-signer regression bond" });

        const froms = await page.evaluate(() => window.__sentFroms);
        expect(froms.length).toBeGreaterThan(0);
        for (const f of froms) expect(f).toBe(challenger.toLowerCase());
    });
});
