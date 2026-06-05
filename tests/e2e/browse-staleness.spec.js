// Browse staleness meta — consume /api/bonds meta.blocksBehindHead.
//
// Closes RCA gap #2: a silently-stale indexer list shown as truth. Above a
// lag threshold (STALE_THRESHOLD = 50 blocks in the frontend, comfortably
// above the ~12-block confirmation margin) Browse must (a) show a small,
// non-alarming staleness banner and (b) transparently fall back to a direct
// on-chain read so the list is current. Below threshold it must do neither.
//
// We don't need a wallet or a real node here — we fully mock both the indexer
// (/api/bonds) and the chain RPC via page.route, so this runs on the `local`
// project against the plain static server.

const { test, expect } = require("@playwright/test");
const { ethers } = require("ethers");

const CHAIN_ID = 31337;
// All-lowercase so ethers v6 skips EIP-55 checksum validation when encoding.
const BOND_CONTRACT = "0x000000000000000000000000000000000000beef";
const TOKEN = "0x000000000000000000000000000000000000cafe";
const POSTER = "0x1111111111111111111111111111111111111111";
const JUDGE = "0x2222222222222222222222222222222222222222";
// Absolute API base so indexerBondsBase() yields a real /api/bonds URL we can
// intercept. The path is irrelevant — only the origin is used.
const API_ORIGIN = "https://indexer.example.test";
const RPC_URL = "https://rpc.example.test/";

// Minimal ABI fragments for the reads the direct-RPC fallback performs.
const bondIface = new ethers.Interface([
    "function nextBondId() view returns (uint256)",
    "function bonds(uint256) view returns (address poster, address judge, address token, uint256 bondAmount, uint256 challengeAmount, uint256 judgeFee, uint256 acceptanceDelay, uint256 rulingBuffer, uint256 maxChallenges, bytes32 claimHash, uint256 claimVersion, uint256 judgeProfileId, uint256 pendingCount, bool settled, bool closed)",
]);

// One indexer bond record (shape from backend serializeBond / rowFromIndexerBond).
function indexerBond(bondId) {
    return {
        bondId,
        poster: POSTER,
        judge: JUDGE,
        token: TOKEN,
        bondAmount: "1000000000000000000",
        challengeAmount: "2000000000000000000",
        claimHash: "0x" + "ab".repeat(32),
        claimVersion: 0,
        judgeProfileId: 0,
        pendingCount: 0,
        settled: false,
        closed: false,
        claimContent: `indexer claim #${bondId}`,
    };
}

// Encode a single eth_call result given its selector. Returns null for calls
// we don't model (e.g. the sUSDS rate read) so the page degrades gracefully.
function encodeCallResult(data) {
    const selector = data.slice(0, 10);
    if (selector === bondIface.getFunction("nextBondId").selector) {
        // 5 bonds on chain -> the fallback enumerates ids 4..0.
        return bondIface.encodeFunctionResult("nextBondId", [5n]);
    }
    if (selector === bondIface.getFunction("bonds").selector) {
        const [id] = bondIface.decodeFunctionData("bonds", data);
        return bondIface.encodeFunctionResult("bonds", [
            POSTER, JUDGE, TOKEN,
            1000000000000000000n, 2000000000000000000n,
            0n, 0n, 0n, 1n,
            "0x" + "cd".repeat(32),
            0n, 0n, 0n,
            false, false,
        ]);
    }
    return null; // unmodelled (e.g. convertToShares) -> let the page's catch handle it
}

// Selectors that constitute a *bond enumeration* (the direct-read fallback) —
// distinct from the sUSDS rate / token-meta reads the indexer happy path also
// makes. We count these to assert the fallback fired (or didn't).
const ENUM_SELECTORS = new Set([
    bondIface.getFunction("nextBondId").selector,
    bondIface.getFunction("bonds").selector,
]);

// page.route handler for the mock JSON-RPC endpoint. Handles single + batched
// requests (ethers may batch up to batchMaxCount). `counter.enum` is bumped for
// every enumeration eth_call so tests can assert on the fallback precisely.
function makeRpcHandler(counter) {
    return async function rpcHandler(route) {
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
                    if (ENUM_SELECTORS.has(data.slice(0, 10))) counter.enum++;
                    const res = encodeCallResult(data);
                    if (res == null) return { ...base, error: { code: -32000, message: "unmodelled call" } };
                    return { ...base, result: res };
                }
                default: return { ...base, result: null };
            }
        });
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
        });
    };
}

// Install a single-chain config pointing the indexer at API_ORIGIN and the RPC
// at our mocked URL, so both indexer and chain reads are interceptable.
async function configurePage(page) {
    await page.addInitScript(({ chainId, apiOrigin, rpc, bondContract, token }) => {
        Object.defineProperty(window, "SIMPLE_BOND_CONFIG", {
            value: {
                notifyApiBase: apiOrigin + "/api/notify",
                chains: {
                    [chainId]: {
                        name: "MockChain",
                        rpc,
                        bondContract,
                        deployBlock: 0,
                        judgeProfileRegistry: bondContract,
                        posterProfileRegistry: bondContract,
                        challengerProfileRegistry: bondContract,
                        manualJudgeV6: bondContract,
                        officialDirectory: bondContract,
                        approvedToken: token,
                        explorer: "http://localhost",
                        bondVersion: 6,
                    },
                },
                defaultChainId: chainId,
                siteRole: "dev",
            },
            writable: true,
            configurable: true,
        });
    }, { chainId: CHAIN_ID, apiOrigin: API_ORIGIN, rpc: RPC_URL, bondContract: BOND_CONTRACT, token: TOKEN });
}

test.describe("Browse staleness banner + threshold direct-read fallback", () => {
    test("above threshold — banner renders AND a direct-read fallback fires", async ({ page }) => {
        await configurePage(page);

        // Count bond-enumeration eth_calls (proves the direct-read fallback
        // fired). The indexer happy path never enumerates bonds over RPC.
        const counter = { enum: 0 };
        await page.route(RPC_URL, makeRpcHandler(counter));

        // Indexer says it's far behind head (200 >> STALE_THRESHOLD of 50),
        // but still returns bonds. The page must distrust them and re-read.
        await page.route("**/api/bonds*", async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    bonds: [indexerBond(99)],
                    meta: {
                        chainId: CHAIN_ID,
                        indexedThroughBlock: 56,
                        headBlock: 256,
                        blocksBehindHead: 200,
                        headUpdatedAt: Date.now(),
                    },
                }),
            });
        });

        await page.goto("/#browse");
        await page.locator('button.tab[data-route="browse"]').click({ timeout: 5000 }).catch(() => {});

        // (a) The staleness banner is shown.
        await expect(page.locator("#browseStaleBanner")).toBeVisible({ timeout: 15_000 });
        await expect(page.locator("#browseStaleBanner")).toContainText(/behind/i);
        await expect(page.locator("#browseStaleBanner")).toContainText(/live on-chain read/i);

        // (b) The direct-read fallback fired (bonds enumerated over RPC).
        expect(counter.enum, "expected the direct-RPC fallback to enumerate bonds").toBeGreaterThan(0);

        // The list still populates — from the RPC enumeration, not the stale
        // indexer row. nextBondId()=5 -> bonds #4..#0 enumerated.
        await expect(page.locator(".bond-list-item")).toHaveCount(5, { timeout: 15_000 });
        // The stale indexer row (#99) must NOT be what's shown.
        await expect(page.locator('.bond-list-item[data-bondid="99"]')).toHaveCount(0);
        await expect(page.locator('.bond-list-item[data-bondid="4"]')).toHaveCount(1);
    });

    test("below threshold — NO banner and NO extra bond enumeration", async ({ page }) => {
        await configurePage(page);

        // Any bond enumeration here would mean a needless direct read past the
        // already-fresh indexer. (Rate/token-meta reads may still occur — those
        // are part of the normal indexer happy path, not an enumeration.)
        const counter = { enum: 0 };
        await page.route(RPC_URL, makeRpcHandler(counter));

        let apiHits = 0;
        await page.route("**/api/bonds*", async (route) => {
            apiHits++;
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    bonds: [indexerBond(7), indexerBond(8)],
                    meta: {
                        chainId: CHAIN_ID,
                        indexedThroughBlock: 250,
                        headBlock: 256,
                        blocksBehindHead: 6, // healthy lag, < STALE_THRESHOLD (50)
                        headUpdatedAt: Date.now(),
                    },
                }),
            });
        });

        await page.goto("/#browse");
        await page.locator('button.tab[data-route="browse"]').click({ timeout: 5000 }).catch(() => {});

        // The indexer rows render directly.
        await expect(page.locator(".bond-list-item")).toHaveCount(2, { timeout: 15_000 });
        await expect(page.locator('.bond-list-item[data-bondid="7"]')).toHaveCount(1);
        await expect(page.locator('.bond-list-item[data-bondid="8"]')).toHaveCount(1);

        // No banner.
        await expect(page.locator("#browseStaleBanner")).toHaveCount(0);

        // No extra enumeration: the indexer was consulted, no bonds re-read.
        expect(apiHits, "indexer should have been queried").toBeGreaterThan(0);
        expect(counter.enum, "no direct-RPC bond enumeration below threshold").toBe(0);
    });
});
