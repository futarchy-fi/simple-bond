// e2e #13 — fail-closed when the configured bondContract has NO bytecode (RCA
// gap #6 / getCode page-chain probe).
//
// A real user landed on a chain where the configured bondContract address had NO
// deployed code (wrong network, or a stale/misconfigured address). Every read
// came back empty and every write hit a cryptic low-level revert with nothing
// telling them WHY. The frontend now probes provider.getCode(bondContract) once
// per chain (probeContractPresence in index.html, classification in
// frontend/contract-probe.js) and, on GENUINE absence ('0x'), fails CLOSED: a
// prominent #contractAbsentBanner on Browse and a blocked write surfacing the
// absent message — but a FLAKY RPC (getCode threw) must NOT brick a real
// deployment, so that 'unknown'/transport case shows only a SOFT note and the
// page keeps working.
//
// We drive this with the real wallet-with-node fixture (so reads/writes actually
// work) and intercept ONLY eth_getCode for the configured bondContract via
// page.route, passing every other RPC call through to the live node.
//
// Case A (absent '0x'): #contractAbsentBanner visible on Browse; a write attempt
//   surfaces the absent message instead of sending a tx.
// Case B (getCode ERRORS): the SOFT transport note appears and the page STILL
//   FUNCTIONS — no fail-closed banner, the bond list still renders.

const { test, expect, KEYS } = require("./fixtures/wallet-with-node");
const { createBondViaUI } = require("./fixtures/helpers");

// Build a route handler for the node RPC that intercepts eth_getCode for the
// given contract address and applies `modeRef.mode`:
//   'absent' -> reply result "0x" (no bytecode)
//   'error'  -> reply a JSON-RPC error (transport failure -> classifies 'unknown')
//   'off'    -> pass through to the real node (route.fallback to the fixture route)
// Every NON-getCode request (and getCode for OTHER addresses) passes through.
function makeGetCodeInterceptor(contractAddr, modeRef) {
    const target = contractAddr.toLowerCase();
    return async function (route) {
        let body;
        try { body = JSON.parse(route.request().postData() || "{}"); } catch (_) { body = {}; }
        const reqs = Array.isArray(body) ? body : [body];
        const isTargetGetCode = (r) =>
            r && r.method === "eth_getCode" &&
            String((r.params && r.params[0]) || "").toLowerCase() === target;
        const anyTarget = reqs.some(isTargetGetCode);
        if (modeRef.mode === "off" || !anyTarget) {
            return route.fallback(); // defer to the fixture's node-forwarding route
        }
        const replies = reqs.map((r) => {
            const base = { jsonrpc: "2.0", id: r.id };
            if (isTargetGetCode(r)) {
                if (modeRef.mode === "absent") return { ...base, result: "0x" };
                // 'error' -> a JSON-RPC error so getCode REJECTS -> 'unknown'.
                return { ...base, error: { code: -32000, message: "injected getCode transport fault" } };
            }
            // A non-target call inside a batch we intercepted: we cannot forward a
            // partial batch, so reply benign nulls for those (the probe batches
            // alone in practice, so this branch is defensive only).
            return { ...base, result: null };
        });
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
        });
    };
}

test.describe("contract-absent fail-closed (gap #6)", () => {
    test("Case A — getCode '0x' (absent): Browse fails closed + writes blocked", async ({
        page,
        deployed,
    }) => {
        test.setTimeout(120_000);
        const modeRef = { mode: "absent" };
        await page.route(deployed.rpc, makeGetCodeInterceptor(deployed.bondContract, modeRef));

        // Browse must fail CLOSED: the prominent #contractAbsentBanner, no list.
        await page.goto("/#browse");
        const banner = page.locator("#contractAbsentBanner");
        await expect(banner).toBeVisible({ timeout: 20_000 });
        await expect(banner).toContainText(/No SimpleBond contract found|wrong network/i);

        // A write attempt now surfaces the absent message rather than sending a tx.
        // The browse probe has cached the 'absent' verdict; requireWalletOnActiveChain
        // (the central write choke-point) throws it. Drive the Create submit.
        await page.goto("/#create");
        await page.waitForSelector("#cb-claim", { timeout: 15_000 });
        await page.fill("#cb-claim", "absent-contract create attempt");
        await page.click("#wizNext");
        await page.waitForSelector("#cb-bond");
        await page.click("#wizNext");
        await page.waitForSelector("#cb-jpid");
        await page.fill("#cb-jpid", "0");
        // Judge resolves over a normal eth_call (not getCode), so this still works.
        await page.waitForFunction(
            () => document.getElementById("cb-judgeResolved")?.textContent?.includes("0x"),
            null,
            { timeout: 15_000 }
        ).catch(() => {});
        await page.click("#wizNext");
        await page.waitForSelector("#cb-ad");
        await page.click("#wizNext");
        await page.waitForSelector("#wizCreate");
        await page.click("#wizCreate");

        // The create message slot shows the fail-closed absent message — the write
        // was blocked at the choke-point, NOT attempted on-chain.
        await expect(page.locator("#createMsg")).toContainText(
            /No SimpleBond contract found|wrong network/i,
            { timeout: 15_000 }
        );
        await expect(page.locator("#createMsg")).not.toContainText(/Bond created/i);
    });

    test("Case B — getCode ERRORS (transport): soft note, page still functions", async ({
        page,
        deployed,
    }) => {
        test.setTimeout(120_000);
        const modeRef = { mode: "off" };
        await page.route(deployed.rpc, makeGetCodeInterceptor(deployed.bondContract, modeRef));

        // First create a real bond with the probe disarmed, so the list has a row
        // to prove the page keeps working under the transport fault.
        const id = await createBondViaUI(page);

        // Now arm the getCode transport fault and reload Browse.
        modeRef.mode = "error";
        await page.goto("/#browse");

        // SOFT transport note appears (NOT the fail-closed banner).
        await expect(page.locator("#contractProbeTransportBanner")).toBeVisible({ timeout: 20_000 });
        await expect(page.locator("#contractProbeTransportBanner"))
            .toContainText(/network\/RPC issue|transient|Could not verify/i);
        // Crucially NOT hard-blocked: the absent banner must be ABSENT.
        await expect(page.locator("#contractAbsentBanner")).toHaveCount(0);

        // The page STILL FUNCTIONS: the bond we created still lists (reads work;
        // an 'unknown' probe never blocks the read path).
        await expect(
            page.locator(`#browseBonds .bond-list-item[data-bondid="${id}"]`)
        ).toBeVisible({ timeout: 20_000 });
    });
});
