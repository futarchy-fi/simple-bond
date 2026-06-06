// Per-challenge phase timeline — action button presence/absence + the
// "why no action / when it changes" reason sentence.
//
// Backs the phaseFor() pure unit test (test/frontend/phaseFor.test.js) with an
// end-to-end check that the rendered bond-detail page, for a representative
// Pending challenge in each phase, shows:
//   - the correct phase highlighted in the concession -> ruling -> timeout track,
//   - the matching reason sentence (ALWAYS present, even when no button renders),
//   - the action button present/absent for the connected viewer.
//
// The viewer here is a *bystander* wallet (neither poster nor judge), so the
// concession/ruling buttons are correctly absent and the reason explains WHY +
// WHEN it changes — the dead-end we set out to kill. The timeout-claim button is
// "anyone", so it is PRESENT once the ruling window has passed.
//
// No real chain and no real-chain time-warp: the indexer point-read and the JSON
// -RPC are both mocked via page.route, and `now` is pinned by stubbing Date.now
// in an init script. We move the challenge between phases purely by choosing the
// mocked concession/ruling timing relative to that fixed `now`.
//
// Run: ./scripts/e2e-docker.sh --project local --grep "challenge phase timeline"

const { test, expect } = require("@playwright/test");
const { ethers } = require("ethers");

const CHAIN_ID = 31337;
const BOND_CONTRACT = "0x000000000000000000000000000000000000beef";
const TOKEN = "0x000000000000000000000000000000000000cafe";
const POSTER = "0x1111111111111111111111111111111111111111";
const JUDGE = "0x2222222222222222222222222222222222222222";
const CHALLENGER = "0x3333333333333333333333333333333333333333";
// The connected wallet — deliberately NOT the poster or judge (a bystander).
const BYSTANDER = "0x4444444444444444444444444444444444444444";
const API_ORIGIN = "https://indexer.example.test";
const RPC_URL = "https://rpc.example.test/";

const BOND_ID = 7;
const ZERO32 = "0x" + "0".repeat(64);

// Pinned wall clock (unix seconds) the page's Date.now() will report.
const NOW = 1_000_000;

// Per-phase mocked timing, chosen relative to NOW so each places the single
// Pending challenge in exactly one phase. concessionDeadline === rulingWindowStart
// (== T0) per SimpleBondV6.sol — the concession and ruling windows are adjacent
// at one instant, with NO gap phase between them.
const PHASES = {
    concession: { concessionDeadline: NOW + 1000, rulingWindowStart: NOW + 1000, rulingDeadline: NOW + 3000 },
    ruling: { concessionDeadline: NOW - 1000, rulingWindowStart: NOW - 1000, rulingDeadline: NOW + 1000 },
    timeout: { concessionDeadline: NOW - 2000, rulingWindowStart: NOW - 2000, rulingDeadline: NOW - 1000 },
};

const bondIface = new ethers.Interface([
    "function nextBondId() view returns (uint256)",
    "function bonds(uint256) view returns (address poster, address judge, address token, uint256 bondAmount, uint256 challengeAmount, uint256 judgeFee, uint256 acceptanceDelay, uint256 rulingBuffer, uint256 maxChallenges, bytes32 claimHash, uint256 claimVersion, uint256 judgeProfileId, uint256 pendingCount, bool settled, bool closed)",
    "function getChallengeCount(uint256 bondId) view returns (uint256)",
    "function getChallenge(uint256 bondId, uint256 index) view returns (tuple(address challenger, uint8 status, uint256 timestamp, uint256 challengeAtVersion, bytes32 claimHashAtChallenge, bytes32 metadataHash, bytes32 rulingMetadataHash))",
    "function concessionDeadline(uint256 bondId, uint256 i) view returns (uint256)",
    "function rulingWindowStart(uint256 bondId, uint256 i) view returns (uint256)",
    "function rulingDeadline(uint256 bondId, uint256 i) view returns (uint256)",
]);

function pointRead() {
    return {
        bond: {
            chainId: CHAIN_ID, bondId: BOND_ID, poster: POSTER, judge: JUDGE, judgeProfileId: 0,
            token: TOKEN, bondAmount: "1000000000000000000", challengeAmount: "2000000000000000000",
            judgeFee: "0", acceptanceDelay: "0", rulingBuffer: "0", maxChallenges: "1",
            claimHash: "0x" + "ab".repeat(32), claimContent: "CLAIM: phase timeline e2e",
            claimVersion: 1, pendingCount: 1, challengeCount: 1, settled: false, closed: false,
        },
        challenges: [
            { idx: 0, challenger: CHALLENGER, status: 0 /* Pending */, content: "CHALLENGE: phase timeline e2e" },
        ],
    };
}

function encodeCallResult(data, timing) {
    const selector = data.slice(0, 10);
    if (selector === bondIface.getFunction("nextBondId").selector) {
        return bondIface.encodeFunctionResult("nextBondId", [BigInt(BOND_ID) + 1n]);
    }
    if (selector === bondIface.getFunction("bonds").selector) {
        return bondIface.encodeFunctionResult("bonds", [
            POSTER, JUDGE, TOKEN,
            1000000000000000000n, 2000000000000000000n, 0n,
            0n, 0n, 1n,
            "0x" + "cd".repeat(32), 1n, 0n, 1n,
            false, false,
        ]);
    }
    if (selector === bondIface.getFunction("getChallengeCount").selector) {
        return bondIface.encodeFunctionResult("getChallengeCount", [1n]);
    }
    if (selector === bondIface.getFunction("getChallenge").selector) {
        return bondIface.encodeFunctionResult("getChallenge", [{
            challenger: CHALLENGER, status: 0, timestamp: BigInt(NOW - 10_000),
            challengeAtVersion: 1n, claimHashAtChallenge: ZERO32, metadataHash: ZERO32, rulingMetadataHash: ZERO32,
        }]);
    }
    if (selector === bondIface.getFunction("concessionDeadline").selector) {
        return bondIface.encodeFunctionResult("concessionDeadline", [BigInt(timing.concessionDeadline)]);
    }
    if (selector === bondIface.getFunction("rulingWindowStart").selector) {
        return bondIface.encodeFunctionResult("rulingWindowStart", [BigInt(timing.rulingWindowStart)]);
    }
    if (selector === bondIface.getFunction("rulingDeadline").selector) {
        return bondIface.encodeFunctionResult("rulingDeadline", [BigInt(timing.rulingDeadline)]);
    }
    return null;
}

function makeRpcHandler(timing) {
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
                    const res = encodeCallResult(data, timing);
                    if (res == null) return { ...base, error: { code: -32000, message: "unmodelled call" } };
                    return { ...base, result: res };
                }
                default: return { ...base, result: null };
            }
        });
        await route.fulfill({
            status: 200, contentType: "application/json",
            body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
        });
    };
}

// Install config + a fixed clock + a minimal bystander wallet (matching chain).
async function configurePage(page) {
    await page.addInitScript(({ chainId, apiOrigin, rpc, bondContract, token, now, addr }) => {
        // Pin the page wall clock so phase classification is deterministic.
        const RealDate = Date;
        const fixedMs = now * 1000;
        // eslint-disable-next-line no-global-assign
        Date = class extends RealDate {
            constructor(...args) { if (args.length === 0) { super(fixedMs); } else { super(...args); } }
            static now() { return fixedMs; }
        };

        // Minimal EIP-1193 wallet on the SAME chain as the config (no mismatch
        // banner) and as a bystander account (neither poster nor judge).
        const provider = {
            isMetaMask: true,
            _listeners: {},
            on(event, fn) { (this._listeners[event] ||= []).push(fn); },
            removeListener(event, fn) {
                const a = this._listeners[event] || [];
                const i = a.indexOf(fn);
                if (i >= 0) a.splice(i, 1);
            },
            async request({ method }) {
                switch (method) {
                    case "eth_chainId": return "0x" + chainId.toString(16);
                    case "eth_accounts":
                    case "eth_requestAccounts": return [addr];
                    case "wallet_switchEthereumChain": return null;
                    default: throw new Error(`mock provider does not implement ${method}`);
                }
            },
        };
        Object.defineProperty(window, "ethereum", { value: provider, writable: true, configurable: true });

        Object.defineProperty(window, "SIMPLE_BOND_CONFIG", {
            value: {
                notifyApiBase: apiOrigin + "/api/notify",
                chains: {
                    [chainId]: {
                        name: "MockChain", rpc, bondContract, deployBlock: 0,
                        judgeProfileRegistry: bondContract, posterProfileRegistry: bondContract,
                        challengerProfileRegistry: bondContract, manualJudgeV6: bondContract,
                        officialDirectory: bondContract, approvedToken: token,
                        explorer: "http://localhost", bondVersion: 6,
                    },
                },
                defaultChainId: chainId,
                siteRole: "dev",
            },
            writable: true, configurable: true,
        });
    }, { chainId: CHAIN_ID, apiOrigin: API_ORIGIN, rpc: RPC_URL, bondContract: BOND_CONTRACT, token: TOKEN, now: NOW, addr: BYSTANDER });
}

// Connect the (already-injected) wallet via the UI so `signer` is set and the
// per-challenge action buttons become eligible to render.
async function connectWallet(page) {
    const connect = page.locator("#connectBtn");
    if (await connect.isVisible().catch(() => false)) {
        await connect.click();
        await expect(page.locator("#walletInfo")).toBeVisible({ timeout: 10_000 });
    }
}

async function openBondInPhase(page, timing) {
    await configurePage(page);
    await page.route(RPC_URL, makeRpcHandler(timing));
    await page.route(`**/api/bonds/${BOND_ID}*`, async (route) => {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pointRead()) });
    });
    await page.goto(`/#view/${BOND_ID}`);
    await connectWallet(page);
    // Wait until the enrich has produced the phase block (it needs live timing).
    await expect(page.locator("#ch-0 .ci-phase")).toBeVisible({ timeout: 15_000 });
}

test.describe("challenge phase timeline — highlight + reason + button gating", () => {
    test("concession phase: no Concede button for a bystander; reason explains why + when", async ({ page }) => {
        await openBondInPhase(page, PHASES.concession);

        const phase = page.locator("#ch-0 .ci-phase");
        await expect(phase).toHaveAttribute("data-active", "pending-concession");
        // The concession step is the highlighted one.
        await expect(page.locator("#ch-0 .ci-phase-step.active")).toHaveText(/concession/i);
        // Reason sentence is present and explains the absence of an action.
        await expect(phase.locator(".ci-phase-reason")).toContainText("In the concession window until");
        await expect(phase.locator(".ci-phase-reason")).toContainText("only the poster can concede");
        // BUG-2 guard: the reason must NOT falsely imply concede is the only move —
        // it must note the judge may reject out-of-scope at any pending instant.
        await expect(phase.locator(".ci-phase-reason")).toContainText("reject this challenge as out-of-scope");
        // Bystander sees NO concede / rule / timeout button.
        await expect(page.locator('#ch-0 button[data-act="concede"]')).toHaveCount(0);
        await expect(page.locator('#ch-0 button[data-act="ruleForPoster"]')).toHaveCount(0);
        await expect(page.locator('#ch-0 button[data-act="claimTimeout"]')).toHaveCount(0);
    });

    test("ruling phase: no Rule button for a bystander; reason explains judge-only + timeout-after", async ({ page }) => {
        await openBondInPhase(page, PHASES.ruling);

        const phase = page.locator("#ch-0 .ci-phase");
        await expect(phase).toHaveAttribute("data-active", "pending-ruling");
        await expect(page.locator("#ch-0 .ci-phase-step.active")).toHaveText(/ruling/i);
        await expect(phase.locator(".ci-phase-reason")).toContainText("In the ruling window until");
        await expect(phase.locator(".ci-phase-reason")).toContainText("only the assigned judge can rule");
        // BUG-2 guard: the judge may rule OR reject out-of-scope in this window.
        await expect(phase.locator(".ci-phase-reason")).toContainText("reject this challenge as out-of-scope");
        await expect(page.locator('#ch-0 button[data-act="ruleForPoster"]')).toHaveCount(0);
        await expect(page.locator('#ch-0 button[data-act="ruleForChallenger"]')).toHaveCount(0);
        await expect(page.locator('#ch-0 button[data-act="claimTimeout"]')).toHaveCount(0);
    });

    test("timeout phase: Claim-timeout button PRESENT for anyone; reason explains anyone-can-claim", async ({ page }) => {
        await openBondInPhase(page, PHASES.timeout);

        const phase = page.locator("#ch-0 .ci-phase");
        await expect(phase).toHaveAttribute("data-active", "timeout-claimable");
        await expect(page.locator("#ch-0 .ci-phase-step.active")).toHaveText(/timeout/i);
        await expect(phase.locator(".ci-phase-reason")).toContainText("Ruling window passed");
        await expect(phase.locator(".ci-phase-reason")).toContainText("anyone can now claim the timeout refund");
        // BUG-2 guard: the judge can STILL reject out-of-scope while pending, even
        // after the ruling deadline, until a timeout claim settles the bond.
        await expect(phase.locator(".ci-phase-reason")).toContainText("reject this challenge as out-of-scope");
        // The "anyone" action IS available now.
        await expect(page.locator('#ch-0 button[data-act="claimTimeout"]')).toHaveCount(1);
        await expect(page.locator('#ch-0 button[data-act="claimTimeout"]')).toBeVisible();
    });

    // LOW-8: concessionDeadline === rulingWindowStart on-chain (== T0), so the timing
    // grid used to render TWO rows ("concession deadline" and "ruling window start")
    // showing the IDENTICAL timestamp — confusing visual noise implying two distinct
    // instants. The fix collapses them into ONE "concession ends / ruling opens (T0)"
    // row plus the distinct "ruling deadline" row: exactly TWO deadline rows, and no
    // two identical timestamps. We use the ruling phase where rulingDeadline != T0.
    test("timing grid collapses the identical T0 rows: exactly two deadline rows, no duplicate timestamps", async ({
        page,
    }) => {
        // PHASES.ruling: concessionDeadline == rulingWindowStart == NOW-1000 (T0),
        // rulingDeadline == NOW+1000 — so T0 and the ruling deadline are DISTINCT.
        await openBondInPhase(page, PHASES.ruling);
        // Wait until the enrich has loaded the live timing (phase resolves to ruling).
        // Until then the timing grid isn't rendered (phase is TIMING_UNAVAILABLE).
        await expect(page.locator("#ch-0 .ci-phase")).toHaveAttribute("data-active", "pending-ruling", {
            timeout: 15_000,
        });

        // The timing grid is the .ci-grid that carries the deadline labels (the other
        // .ci-grid in the challenge item holds challenger/filed-at metadata).
        const grids = page.locator("#ch-0 .ci-grid");
        // Find the grid whose text includes "ruling deadline" — that's the timing grid.
        let timingIdx = -1;
        const count = await grids.count();
        for (let i = 0; i < count; i++) {
            const txt = await grids.nth(i).innerText();
            if (/ruling deadline/i.test(txt)) { timingIdx = i; break; }
        }
        expect(timingIdx, "timing grid not found").toBeGreaterThanOrEqual(0);
        const timingGrid = grids.nth(timingIdx);
        const gridText = await timingGrid.innerText();

        // The collapsed single T0 row is present.
        expect(gridText).toMatch(/concession ends \/ ruling opens \(T0\)/i);
        // The distinct ruling-deadline row is present.
        expect(gridText).toMatch(/ruling deadline/i);
        // The OLD separate rows are GONE (this is the regression guard).
        expect(gridText).not.toMatch(/ruling window start/i);
        // "concession deadline" as a STANDALONE label is gone too (it now only
        // appears inside the combined "concession ends / ruling opens" label).
        expect(gridText).not.toMatch(/concession deadline/i);

        // Exactly TWO label rows (T0 + ruling deadline). The grid is a 2-col layout:
        // label, value, label, value -> 4 cells for 2 rows.
        const cells = timingGrid.locator("div");
        await expect(cells).toHaveCount(4);

        // No two IDENTICAL rendered timestamps among the two value cells. With T0 !=
        // rulingDeadline the two timestamp strings must differ (the old grid rendered
        // T0 twice -> a duplicate).
        const v0 = (await cells.nth(1).innerText()).trim();
        const v1 = (await cells.nth(3).innerText()).trim();
        expect(v0).not.toBe(v1);
    });
});
