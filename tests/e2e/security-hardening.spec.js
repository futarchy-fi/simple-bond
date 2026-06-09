// Security hardening — H2 (untrusted-indexer XSS) and H3 (claim-text vs on-chain
// claimHash). Fully mocks the indexer + chain RPC via page.route (no wallet, no
// real node), so it runs on the `local` project against the static server.
//
// Run: ./scripts/e2e-docker.sh security-hardening.spec.js --project local

const { test, expect } = require("@playwright/test");
const { ethers } = require("ethers");

const CHAIN_ID = 31337;
const BOND_CONTRACT = "0x000000000000000000000000000000000000beef";
const TOKEN = "0x000000000000000000000000000000000000cafe";
const POSTER = "0x1111111111111111111111111111111111111111";
const JUDGE = "0x2222222222222222222222222222222222222222";
const API_ORIGIN = "https://indexer.example.test";
const RPC_URL = "https://rpc.example.test/";
const BOND_ID = 7;
const ZERO32 = "0x" + "0".repeat(64);
const hashOf = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

const bondIface = new ethers.Interface([
    "function nextBondId() view returns (uint256)",
    "function bonds(uint256) view returns (address poster, address judge, address token, uint256 bondAmount, uint256 challengeAmount, uint256 judgeFee, uint256 acceptanceDelay, uint256 rulingBuffer, uint256 maxChallenges, bytes32 claimHash, uint256 claimVersion, uint256 judgeProfileId, uint256 pendingCount, bool settled, bool closed)",
    "function getChallengeCount(uint256 bondId) view returns (uint256)",
]);

// RPC mock that returns a bonds() struct with a CHOSEN on-chain claimHash.
function makeRpc(onchainClaimHash) {
    return async function (route) {
        let body;
        try { body = JSON.parse(route.request().postData() || "{}"); } catch (_) { body = {}; }
        const reqs = Array.isArray(body) ? body : [body];
        const replies = reqs.map((r) => {
            const base = { jsonrpc: "2.0", id: r.id };
            switch (r.method) {
                case "eth_chainId": return { ...base, result: "0x" + CHAIN_ID.toString(16) };
                case "eth_blockNumber": return { ...base, result: "0x100" };
                case "eth_getLogs": return { ...base, result: [] };
                case "eth_call": {
                    const data = (r.params && r.params[0] && r.params[0].data) || "0x";
                    const sel = data.slice(0, 10);
                    if (sel === bondIface.getFunction("nextBondId").selector)
                        return { ...base, result: bondIface.encodeFunctionResult("nextBondId", [BigInt(BOND_ID) + 1n]) };
                    if (sel === bondIface.getFunction("bonds").selector)
                        return { ...base, result: bondIface.encodeFunctionResult("bonds", [
                            POSTER, JUDGE, TOKEN, 1000000000000000000n, 2000000000000000000n, 0n,
                            0n, 0n, 1n, onchainClaimHash, 1n, 0n, 0n, false, false]) };
                    if (sel === bondIface.getFunction("getChallengeCount").selector)
                        return { ...base, result: bondIface.encodeFunctionResult("getChallengeCount", [0n]) };
                    return { ...base, error: { code: -32000, message: "unmodelled" } };
                }
                default: return { ...base, result: null };
            }
        });
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(Array.isArray(body) ? replies : replies[0]) });
    };
}

function pointRead(claimContent, claimHash, posterOverride) {
    return {
        bond: {
            chainId: CHAIN_ID, bondId: BOND_ID, poster: posterOverride || POSTER, judge: JUDGE,
            judgeProfileId: 0, token: TOKEN, bondAmount: "1000000000000000000",
            challengeAmount: "2000000000000000000", judgeFee: "0", acceptanceDelay: "0",
            rulingBuffer: "0", maxChallenges: "1", claimHash, claimContent, claimVersion: 1,
            pendingCount: 0, challengeCount: 0, settled: false, closed: false,
        },
        challenges: [],
    };
}

async function configurePage(page) {
    await page.addInitScript(({ chainId, apiOrigin, rpc, bondContract, token }) => {
        Object.defineProperty(window, "SIMPLE_BOND_CONFIG", {
            value: {
                notifyApiBase: apiOrigin + "/api/notify",
                chains: { [chainId]: {
                    name: "MockChain", rpc, bondContract, deployBlock: 0,
                    judgeProfileRegistry: bondContract, posterProfileRegistry: bondContract,
                    challengerProfileRegistry: bondContract, manualJudgeV6: bondContract,
                    officialDirectory: bondContract, approvedToken: token,
                    explorer: "http://localhost", bondVersion: 6,
                } },
                defaultChainId: chainId, siteRole: "dev",
            }, writable: true, configurable: true,
        });
    }, { chainId: CHAIN_ID, apiOrigin: API_ORIGIN, rpc: RPC_URL, bondContract: BOND_CONTRACT, token: TOKEN });
}

test.describe("security hardening (H2 XSS, H3 claim-hash gate)", () => {
    test("H3: forged claim text (hash mismatch) shows the mismatch warning", async ({ page }) => {
        await configurePage(page);
        const onchain = hashOf("The REAL on-chain claim — short and specific.");
        await page.route(RPC_URL, makeRpc(onchain));
        await page.route(`**/api/bonds/${BOND_ID}*`, (route) => route.fulfill({
            status: 200, contentType: "application/json",
            body: JSON.stringify(pointRead("TAMPERED claim the indexer is showing you.", onchain)),
        }));
        await page.goto(`/#view/${BOND_ID}`);
        // The (untrusted) text still renders, but a prominent mismatch warning appears.
        await expect(page.locator(".card", { hasText: /Claim content/i })).toContainText("TAMPERED claim", { timeout: 8000 });
        await expect(page.locator(".msg-error").filter({ hasText: /does NOT match this bond.s on-chain claim hash/i }))
            .toBeVisible({ timeout: 8000 });
    });

    test("H3: matching claim text verifies cleanly (NO mismatch warning)", async ({ page }) => {
        await configurePage(page);
        const claim = "Test bond. The sky is blue on 2026-06-09.";
        const onchain = hashOf(claim);
        await page.route(RPC_URL, makeRpc(onchain));
        await page.route(`**/api/bonds/${BOND_ID}*`, (route) => route.fulfill({
            status: 200, contentType: "application/json",
            body: JSON.stringify(pointRead(claim, onchain)),
        }));
        await page.goto(`/#view/${BOND_ID}`);
        await expect(page.locator(".card", { hasText: /Claim content/i })).toContainText(claim, { timeout: 8000 });
        // Give the RPC enrich time to run, then assert NO mismatch warning was raised.
        await page.waitForTimeout(1500);
        await expect(page.locator(".msg-error").filter({ hasText: /on-chain claim hash/i })).toHaveCount(0);
    });

    test("H2: a malicious indexer poster field cannot inject script into Browse", async ({ page }) => {
        await configurePage(page);
        await page.route(RPC_URL, makeRpc(ZERO32));
        const XSS = '"><img src=x onerror="window.__xss=1">';
        await page.route(`**/api/bonds?*`, (route) => route.fulfill({
            status: 200, contentType: "application/json",
            body: JSON.stringify({
                bonds: [{
                    chainId: CHAIN_ID, bondId: BOND_ID, poster: XSS, judge: JUDGE, token: TOKEN,
                    bondAmount: "1000000000000000000", challengeAmount: "2000000000000000000",
                    judgeFee: "0", acceptanceDelay: "0", rulingBuffer: "0", maxChallenges: "1",
                    claimHash: "0x" + "ab".repeat(32), claimContent: "a normal-looking claim",
                    claimVersion: 1, pendingCount: 0, challengeCount: 0, settled: false, closed: false,
                }],
                meta: { blocksBehindHead: 1 },
            }),
        }));
        await page.goto(`/#browse`);
        await expect(page.locator(".bond-list-item").first()).toBeVisible({ timeout: 8000 });
        // The payload neither executed nor created a live <img onerror> node.
        expect(await page.evaluate(() => window.__xss)).toBeFalsy();
        expect(await page.locator('img[src="x"]').count()).toBe(0);
    });
});
