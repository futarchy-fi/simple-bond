// Bond detail — indexer-first paint (RCA gap #9).
//
// The most-shared page (#view/<id>) must paint claim text + each challenge's
// status INSTANTLY from the indexer point-read (GET /api/bonds/:id), with NO
// browser eth_getLogs on the claim-paint path and no multi-second spinner. A
// background eth_call enrich then fills in live timing/flags for action-gating.
// When the indexer point-read is unavailable, the page must still render via the
// pure-RPC fallback (no dead-end).
//
// Like browse-staleness.spec.js, this needs no wallet and no real node: we fully
// mock both the indexer (/api/bonds/:id) and the chain RPC via page.route, so it
// runs on the `local` project against the plain static server.
//
// Run: ./scripts/e2e-docker.sh --project local --grep "Bond detail — indexer-first"

const { test, expect } = require("@playwright/test");
const { ethers } = require("ethers");

const CHAIN_ID = 31337;
// All-lowercase so ethers v6 skips EIP-55 checksum validation when encoding.
const BOND_CONTRACT = "0x000000000000000000000000000000000000beef";
const TOKEN = "0x000000000000000000000000000000000000cafe";
const POSTER = "0x1111111111111111111111111111111111111111";
const JUDGE = "0x2222222222222222222222222222222222222222";
const CHALLENGER = "0x3333333333333333333333333333333333333333";
// Absolute API base so indexerBondsBase() yields a real /api/bonds URL we can
// intercept. The path is irrelevant — only the origin is used.
const API_ORIGIN = "https://indexer.example.test";
const RPC_URL = "https://rpc.example.test/";

const BOND_ID = 7;
const INDEXER_CLAIM = "INDEXER-CLAIM: the sky is blue on 2026-06-04";
const INDEXER_CHALLENGE = "INDEXER-CHALLENGE: it was overcast";
const ZERO32 = "0x" + "0".repeat(64);

// ABI fragments for the eth_call reads the enrich / RPC fallback performs.
const bondIface = new ethers.Interface([
    "function nextBondId() view returns (uint256)",
    "function bonds(uint256) view returns (address poster, address judge, address token, uint256 bondAmount, uint256 challengeAmount, uint256 judgeFee, uint256 acceptanceDelay, uint256 rulingBuffer, uint256 maxChallenges, bytes32 claimHash, uint256 claimVersion, uint256 judgeProfileId, uint256 pendingCount, bool settled, bool closed)",
    "function getChallengeCount(uint256 bondId) view returns (uint256)",
    "function getChallenge(uint256 bondId, uint256 index) view returns (tuple(address challenger, uint8 status, uint256 timestamp, uint256 challengeAtVersion, bytes32 claimHashAtChallenge, bytes32 metadataHash, bytes32 rulingMetadataHash))",
    "function concessionDeadline(uint256 bondId, uint256 i) view returns (uint256)",
    "function rulingWindowStart(uint256 bondId, uint256 i) view returns (uint256)",
    "function rulingDeadline(uint256 bondId, uint256 i) view returns (uint256)",
]);

// The indexer point-read response shape (backend handleBondGet):
// { bond, challenges:[{ idx, challenger, status, content }] }.
function pointRead() {
    return {
        bond: {
            chainId: CHAIN_ID,
            bondId: BOND_ID,
            poster: POSTER,
            judge: JUDGE,
            judgeProfileId: 0,
            token: TOKEN,
            bondAmount: "1000000000000000000",
            challengeAmount: "2000000000000000000",
            judgeFee: "0",
            acceptanceDelay: "0",
            rulingBuffer: "0",
            maxChallenges: "1",
            claimHash: "0x" + "ab".repeat(32),
            claimContent: INDEXER_CLAIM,
            claimVersion: 1,
            pendingCount: 1,
            challengeCount: 1,
            settled: false,
            closed: false,
        },
        challenges: [
            { idx: 0, challenger: CHALLENGER, status: 0 /* Pending */, content: INDEXER_CHALLENGE },
        ],
    };
}

// Encode a single eth_call result given its calldata. Returns null for calls we
// don't model (token symbol/decimals, sUSDS rate) so the page degrades.
function encodeCallResult(data) {
    const selector = data.slice(0, 10);
    if (selector === bondIface.getFunction("nextBondId").selector) {
        return bondIface.encodeFunctionResult("nextBondId", [BigInt(BOND_ID) + 1n]);
    }
    if (selector === bondIface.getFunction("bonds").selector) {
        return bondIface.encodeFunctionResult("bonds", [
            POSTER, JUDGE, TOKEN,
            1000000000000000000n, 2000000000000000000n, 0n,
            0n, 0n, 1n,
            "0x" + "cd".repeat(32),
            1n, 0n, 1n,
            false, false,
        ]);
    }
    if (selector === bondIface.getFunction("getChallengeCount").selector) {
        return bondIface.encodeFunctionResult("getChallengeCount", [1n]);
    }
    if (selector === bondIface.getFunction("getChallenge").selector) {
        return bondIface.encodeFunctionResult("getChallenge", [{
            challenger: CHALLENGER,
            status: 0,
            timestamp: 1_700_000_000n,
            challengeAtVersion: 1n,
            claimHashAtChallenge: ZERO32,
            metadataHash: ZERO32,
            rulingMetadataHash: ZERO32,
        }]);
    }
    if (selector === bondIface.getFunction("concessionDeadline").selector) {
        return bondIface.encodeFunctionResult("concessionDeadline", [0n]);
    }
    if (selector === bondIface.getFunction("rulingWindowStart").selector) {
        return bondIface.encodeFunctionResult("rulingWindowStart", [0n]);
    }
    if (selector === bondIface.getFunction("rulingDeadline").selector) {
        return bondIface.encodeFunctionResult("rulingDeadline", [0n]);
    }
    return null; // unmodelled (token meta / rate) -> let the page's catch handle it
}

// page.route handler for the mock JSON-RPC endpoint. Handles single + batched
// requests. `counter.getLogs` bumps for any eth_getLogs (must stay 0 — the
// claim-paint path is forbidden from issuing browser getLogs). `counter.struct`
// bumps for the live bonds() struct read so we can prove the enrich ran. An
// optional `counter.delayMs` lets us hold the RPC so we can assert the indexer
// paint lands first.
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
                case "eth_getLogs":
                    counter.getLogs++;
                    return { ...base, result: [] };
                case "eth_call": {
                    const data = (r.params && r.params[0] && r.params[0].data) || "0x";
                    if (data.slice(0, 10) === bondIface.getFunction("bonds").selector) counter.struct++;
                    const res = encodeCallResult(data);
                    if (res == null) return { ...base, error: { code: -32000, message: "unmodelled call" } };
                    return { ...base, result: res };
                }
                default: return { ...base, result: null };
            }
        });
        if (counter.delayMs) await new Promise((res) => setTimeout(res, counter.delayMs));
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

test.describe("Bond detail — indexer-first paint (gap #9)", () => {
    test("(a) indexer point-read served — claim + challenge paint fast, NO getLogs", async ({ page }) => {
        await configurePage(page);

        // Hold every RPC reply 1.5s so the eth_call enrich cannot be what paints
        // the claim/challenge first. The indexer paint must win the race.
        const counter = { getLogs: 0, struct: 0, delayMs: 1500 };
        await page.route(RPC_URL, makeRpcHandler(counter));

        let pointReadHits = 0;
        // Only the per-bond point-read (/api/bonds/<id>...), not the list.
        await page.route(`**/api/bonds/${BOND_ID}*`, async (route) => {
            pointReadHits++;
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(pointRead()),
            });
        });

        await page.goto(`/#view/${BOND_ID}`);

        // Claim text from the indexer renders fast (well under the 1.5s RPC hold).
        const claim = page.locator(".card", { hasText: /Claim content/i });
        await expect(claim).toContainText(INDEXER_CLAIM, { timeout: 1200 });
        // The challenge row (idx/challenger/status/content) is present from the
        // indexer too. Status 0 -> "Pending" badge.
        await expect(page.locator("#challengeList")).toContainText("Pending", { timeout: 1200 });
        await expect(page.locator("#ch-0")).toBeVisible({ timeout: 1200 });

        // The point-read was consulted, and NO eth_getLogs was issued on the
        // claim-paint path (the whole reason gap #9 existed).
        expect(pointReadHits, "indexer point-read should have been queried").toBeGreaterThan(0);
        expect(counter.getLogs, "no eth_getLogs on the claim-paint path").toBe(0);

        // The background enrich eventually runs (live bonds() struct read) and the
        // page stays coherent — claim text still shown after enrich re-renders.
        await expect.poll(() => counter.struct, { timeout: 10_000 }).toBeGreaterThan(0);
        await expect(page.locator(".card", { hasText: /Claim content/i }))
            .toContainText(INDEXER_CLAIM, { timeout: 10_000 });
        // Still no getLogs even after the enrich completes.
        expect(counter.getLogs, "enrich must not issue getLogs either").toBe(0);
    });

    test("(b) indexer point-read unavailable (500) — RPC fallback still renders", async ({ page }) => {
        await configurePage(page);

        const counter = { getLogs: 0, struct: 0, delayMs: 0 };
        await page.route(RPC_URL, makeRpcHandler(counter));

        let pointReadHits = 0;
        await page.route(`**/api/bonds/${BOND_ID}*`, async (route) => {
            pointReadHits++;
            await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "down" }) });
        });

        await page.goto(`/#view/${BOND_ID}`);

        // No dead-end: the page renders the bond via the pure-RPC fallback.
        await expect(page.locator("h2", { hasText: `Bond #${BOND_ID}` })).toBeVisible({ timeout: 15_000 });
        await expect(page.locator(".card", { hasText: /Claim content/i })).toBeVisible({ timeout: 15_000 });
        await expect(page.locator(".card", { hasText: /^\s*Challenges/i }).first()).toBeVisible({ timeout: 15_000 });
        // The challenge row is read over RPC (getChallenge) in the fallback.
        await expect(page.locator("#ch-0")).toBeVisible({ timeout: 15_000 });

        // The point-read was attempted (and failed), and the live struct was read.
        expect(pointReadHits, "indexer point-read should have been attempted").toBeGreaterThan(0);
        await expect.poll(() => counter.struct, { timeout: 15_000 }).toBeGreaterThan(0);
        // The fallback must NOT reintroduce browser getLogs for the claim text.
        expect(counter.getLogs, "fallback must not issue getLogs").toBe(0);
    });
});
