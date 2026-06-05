// Notify bell — opt-in email subscription wired to the EXISTING backend.
//
// The bell (header) is a real subscribe control: connect wallet, open the bell,
// enter an email, sign a fixed message (no gas), POST /api/notify/register, then
// reflect /api/notify/status. Email delivery is STUBBED today (backend/mailer.mjs
// EMAIL_ENABLED=false), so the copy must be HONEST — it must NOT promise a
// delivered email; it must say the subscription is recorded / delivery is coming.
//
// Runs on the `local` project against the plain static server: we mock both the
// EIP-1193 wallet (incl. personal_sign) and the /api/notify endpoints via
// page.route. No real node, no real backend.
//
// Run: ./scripts/e2e-docker.sh --project local --grep "Notify bell"

const { test: base, expect } = require("@playwright/test");

const FAKE_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // Hardhat #0
const CHAIN_ID = 1;
const API_ORIGIN = "https://notify.example.test";
const NOTIFY_BASE = `${API_ORIGIN}/api/notify`;
const FAKE_SIG = "0x" + "ab".repeat(65);

// EIP-1193 mock that also answers personal_sign so signer.signMessage resolves.
// Captures the signed message via window.__signedMessages for assertions.
const test = base.extend({
    page: async ({ page }, use) => {
        await page.addInitScript(({ addr, sig, apiBase, chainId }) => {
            window.__signedMessages = [];
            const provider = {
                isMetaMask: true,
                _listeners: {},
                on(event, fn) { (this._listeners[event] ||= []).push(fn); },
                removeListener(event, fn) {
                    const a = this._listeners[event] || [];
                    const i = a.indexOf(fn);
                    if (i >= 0) a.splice(i, 1);
                },
                async request({ method, params }) {
                    switch (method) {
                        case "eth_chainId":
                            return "0x" + chainId.toString(16);
                        case "eth_accounts":
                        case "eth_requestAccounts":
                            return [addr];
                        case "wallet_switchEthereumChain":
                            return null;
                        case "personal_sign": {
                            // ethers v6: params = [hexMessage, address]. Decode the
                            // hex message to UTF-8 so the test can assert the exact
                            // string the backend will re-derive.
                            const hex = (params && params[0]) || "0x";
                            let text = "";
                            try {
                                const bytes = hex.replace(/^0x/, "").match(/.{1,2}/g) || [];
                                text = decodeURIComponent(bytes.map((b) => "%" + b).join(""));
                            } catch (_) { text = hex; }
                            window.__signedMessages.push(text);
                            return sig;
                        }
                        default:
                            throw new Error(`mock provider does not implement ${method}`);
                    }
                },
            };
            Object.defineProperty(window, "ethereum", {
                value: provider, writable: true, configurable: true,
            });
            // Single-chain config pointing the notify API at an interceptable base.
            Object.defineProperty(window, "SIMPLE_BOND_CONFIG", {
                value: {
                    notifyApiBase: apiBase,
                    chains: {
                        [chainId]: {
                            name: "Ethereum",
                            rpc: "https://rpc.example.test/",
                            bondContract: "0x000000000000000000000000000000000000beef",
                            deployBlock: 0,
                            judgeProfileRegistry: "0x000000000000000000000000000000000000beef",
                            posterProfileRegistry: "0x000000000000000000000000000000000000beef",
                            challengerProfileRegistry: "0x000000000000000000000000000000000000beef",
                            manualJudgeV6: "0x000000000000000000000000000000000000beef",
                            officialDirectory: "0x000000000000000000000000000000000000beef",
                            approvedToken: "0x000000000000000000000000000000000000cafe",
                            explorer: "https://etherscan.io",
                            bondVersion: 6,
                        },
                    },
                    defaultChainId: chainId,
                },
                writable: true, configurable: true,
            });
        }, { addr: FAKE_ADDR, sig: FAKE_SIG, apiBase: NOTIFY_BASE, chainId: CHAIN_ID });

        await use(page);
    },
});

async function ensureConnected(page) {
    const connectBtn = page.locator("#connectBtn:visible");
    if (await connectBtn.count()) await connectBtn.click();
    const short = `${FAKE_ADDR.slice(0, 6)}…${FAKE_ADDR.slice(-4)}`;
    await expect(page.locator("body")).toContainText(short, { timeout: 10_000 });
}

test.describe("Notify bell — opt-in subscribe wired to /api/notify", () => {
    test("subscribe: signs the fixed message, POSTs the exact register contract, reflects subscribed + HONEST copy", async ({ page }) => {
        // status starts NOT registered; register returns the backend's 200 shape.
        let registerBody = null;
        let statusRegistered = false;
        await page.route(`${NOTIFY_BASE}/status*`, async (route) => {
            await route.fulfill({
                status: 200, contentType: "application/json",
                body: JSON.stringify(
                    statusRegistered
                        ? { registered: true, verified: false, email: "a***@example.com" }
                        : { registered: false }
                ),
            });
        });
        await page.route(`${NOTIFY_BASE}/register`, async (route) => {
            registerBody = JSON.parse(route.request().postData() || "{}");
            statusRegistered = true; // subsequent status reads now report registered
            // Mirror handleRegister's 200 body. The message says "verification
            // email sent" — the UI must NOT echo that (email is stubbed).
            await route.fulfill({
                status: 200, contentType: "application/json",
                body: JSON.stringify({ ok: true, message: "Verification email sent. Check your inbox." }),
            });
        });

        await page.goto("/");
        await ensureConnected(page);

        // The bell is a real, visible control (no longer hidden / dead).
        const bell = page.locator("#notifyBellBtn");
        await expect(bell).toBeVisible({ timeout: 10_000 });
        await bell.click();

        const pop = page.locator("#notifyPop");
        await expect(pop).toBeVisible();

        // HONEST copy BEFORE submit: no false "we emailed you" promise; it must
        // mention delivery isn't live / coming soon.
        const popText0 = (await pop.innerText()).toLowerCase();
        expect(popText0).not.toMatch(/we (?:have )?emailed you|you will receive an email|check your inbox|sent you an email|email (?:has been |was )?sent/);
        expect(popText0).toMatch(/coming soon|isn'?t live|not (?:yet )?(?:enabled|live)|recorded/);

        await page.fill("#notifyEmail", "alice@example.com");
        await page.click("#notifySubmit");

        // The register POST fired with the EXACT backend contract.
        await expect.poll(() => registerBody, { timeout: 10_000 }).not.toBeNull();
        expect(Object.keys(registerBody).sort()).toEqual(
            ["address", "chainId", "email", "signature", "timestamp"]
        );
        expect(registerBody.address.toLowerCase()).toBe(FAKE_ADDR.toLowerCase());
        expect(registerBody.email).toBe("alice@example.com");
        expect(registerBody.chainId).toBe(CHAIN_ID);
        expect(registerBody.signature).toBe(FAKE_SIG);
        expect(typeof registerBody.timestamp).toBe("number");

        // The signed message is the fixed, backend-verifiable string.
        const signed = await page.evaluate(() => window.__signedMessages);
        expect(signed.length).toBeGreaterThan(0);
        expect(signed[signed.length - 1]).toBe(
            `Enable SimpleBond notifications for alice@example.com on chain ${CHAIN_ID}. Timestamp: ${registerBody.timestamp}`
        );

        // The bell reflects "subscribed" (success class). After the POST the UI
        // reconciles with GET /api/notify/status (now registered) and the popover
        // transitions to the subscribed view.
        await expect(page.locator("#notifyBellBtn.subscribed")).toBeVisible({ timeout: 10_000 });
        // The resulting copy is HONEST: it says the subscription is recorded and
        // that delivery isn't live yet — and NEVER promises a delivered email.
        await expect.poll(
            async () => (await page.locator("#notifyPop").innerText()).toLowerCase(),
            { timeout: 10_000 }
        ).toMatch(/recorded/);
        const finalText = (await page.locator("#notifyPop").innerText()).toLowerCase();
        expect(finalText).not.toMatch(/we (?:have )?emailed you|you will receive an email|check your inbox|email (?:has been |was )?sent/);
        expect(finalText).toMatch(/coming soon|isn'?t (?:enabled|live)|not (?:yet )?(?:enabled|live)/);
    });

    test("status reflects an already-registered wallet on open (subscribed bell)", async ({ page }) => {
        await page.route(`${NOTIFY_BASE}/status*`, async (route) => {
            await route.fulfill({
                status: 200, contentType: "application/json",
                body: JSON.stringify({ registered: true, verified: false, email: "a***@example.com" }),
            });
        });

        await page.goto("/");
        await ensureConnected(page);

        // On connect, refreshNotifyBell pulls status -> the bell shows subscribed.
        await expect(page.locator("#notifyBellBtn.subscribed")).toBeVisible({ timeout: 10_000 });
        await page.locator("#notifyBellBtn").click();
        const pop = page.locator("#notifyPop");
        await expect(pop).toBeVisible();
        const text = (await pop.innerText()).toLowerCase();
        expect(text).toMatch(/subscrib/);
        expect(text).toMatch(/a\*\*\*@example\.com/);
        // Still honest: no false delivered-email promise on the subscribed view.
        expect(text).not.toMatch(/we (?:have )?emailed you|you will receive an email|check your inbox|email (?:has been |was )?sent/);
        expect(text).toMatch(/coming soon|isn'?t (?:enabled|live)|not (?:yet )?(?:enabled|live)/);
    });

    test("degrades gracefully when the notify API is unreachable (no crash, bell stays usable)", async ({ page }) => {
        // status fails (network error); the bell must not crash the page.
        await page.route(`${NOTIFY_BASE}/status*`, async (route) => { await route.abort(); });

        await page.goto("/");
        await ensureConnected(page);

        // Bell is still present and the page is alive (header + tabs render).
        await expect(page.locator("#notifyBellBtn")).toBeVisible({ timeout: 10_000 });
        await page.locator("#notifyBellBtn").click();
        // The unsubscribed subscribe affordance is shown (not a subscribed state)
        // because status couldn't be confirmed — honest default, no crash.
        await expect(page.locator("#notifyPop")).toBeVisible();
        await expect(page.locator("#notifyEmail")).toBeVisible();
        await expect(page.locator("#notifyBellBtn.subscribed")).toHaveCount(0);
    });

    test("bell is hidden (not a dead control) when no notify backend is configured", async ({ page }) => {
        // Override config to drop notifyApiBase entirely.
        await page.addInitScript(() => {
            Object.defineProperty(window, "SIMPLE_BOND_CONFIG", {
                value: {
                    notifyApiBase: "",
                    chains: {
                        1: {
                            name: "Ethereum", rpc: "https://rpc.example.test/",
                            bondContract: "0x000000000000000000000000000000000000beef",
                            deployBlock: 0, bondVersion: 6, explorer: "https://etherscan.io",
                            approvedToken: "0x000000000000000000000000000000000000cafe",
                        },
                    },
                    defaultChainId: 1,
                },
                writable: true, configurable: true,
            });
        });

        await page.goto("/");
        // No bell button rendered; the host stays .hidden. The page still works.
        await expect(page.locator("#notifyBell.hidden")).toHaveCount(1, { timeout: 10_000 });
        await expect(page.locator("#notifyBellBtn")).toHaveCount(0);
    });
});
