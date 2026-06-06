// Shared helpers for wallet-driven e2e specs.

const { ethers } = require("ethers");

const BOND_ABI = [
    "function nextBondId() view returns (uint256)",
    "function bonds(uint256) view returns (address poster, address judge, address token, uint256 bondAmount, uint256 challengeAmount, uint256 judgeFee, uint256 acceptanceDelay, uint256 rulingBuffer, uint256 maxChallenges, bytes32 claimHash, uint256 claimVersion, uint256 judgeProfileId, uint256 pendingCount, bool settled, bool closed)",
    "function getChallengeCount(uint256 bondId) view returns (uint256)",
    "function getChallenge(uint256 bondId, uint256 i) view returns (tuple(address challenger, uint8 status, uint256 timestamp, uint256 challengeAtVersion, bytes32 claimHashAtChallenge, bytes32 metadataHash, bytes32 rulingMetadataHash))",
];

function rpc(deployed) {
    return new ethers.JsonRpcProvider(deployed.rpc);
}

function bond(deployed) {
    return new ethers.Contract(deployed.bondContract, BOND_ABI, rpc(deployed));
}

async function nextBondId(deployed) {
    return bond(deployed).nextBondId();
}

async function readBond(deployed, bondId) {
    return bond(deployed).bonds(bondId);
}

async function readChallenge(deployed, bondId, i) {
    return bond(deployed).getChallenge(bondId, i);
}

async function getChallengeCount(deployed, bondId) {
    return bond(deployed).getChallengeCount(bondId);
}

// Drive the Create wizard end-to-end. Returns the new bondId.
async function createBondViaUI(page, opts = {}) {
    const claim = opts.claim || "e2e claim";
    await page.goto("/#create");
    await page.waitForSelector("#cb-claim", { timeout: 15_000 });
    await page.fill("#cb-claim", claim);
    await page.click("#wizNext");
    await page.waitForSelector("#cb-bond");
    if (opts.bondAmount) await page.fill("#cb-bond", opts.bondAmount);
    await page.click("#wizNext");
    await page.waitForSelector("#cb-jpid");
    await page.fill("#cb-jpid", String(opts.judgeProfileId ?? 0));
    await page.waitForFunction(
        () => document.getElementById("cb-judgeResolved")?.textContent?.includes("0x"),
        null,
        { timeout: 15_000 }
    );
    await page.click("#wizNext");
    await page.waitForSelector("#cb-ad");
    // Use shorter timing for tests (in seconds).
    if (opts.acceptanceDelay !== undefined) await page.fill("#cb-ad", String(opts.acceptanceDelay));
    if (opts.rulingBuffer !== undefined) await page.fill("#cb-rb", String(opts.rulingBuffer));
    // maxChallenges lives on the same (timing) step as #cb-ad/#cb-rb. Fill it so
    // callers that pin the challenge cap (e.g. capacity / multi-challenger specs)
    // actually get the cap they ask for instead of the wizard default (10).
    if (opts.maxChallenges !== undefined) await page.fill("#cb-max", String(opts.maxChallenges));
    await page.click("#wizNext");
    await page.waitForSelector("#wizCreate");
    await page.click("#wizCreate");
    await page.waitForFunction(
        () => /Bond created!|Bond #\d+|Create failed/.test(document.body.innerText),
        null,
        { timeout: 90_000 }
    );
    const txt = await page.evaluate(() => document.body.innerText);
    if (/Create failed/.test(txt)) {
        throw new Error("Create failed: " + (txt.match(/Create failed[^\n]*/)?.[0] || txt.slice(0, 400)));
    }
    const m = txt.match(/Bond #(\d+)/);
    if (!m) throw new Error("Could not parse bond id from success surface");
    return Number(m[1]);
}

// Open the bond detail page. Caller is responsible for any waits inside.
async function gotoBondDetail(page, bondId) {
    await page.goto(`/#view/${bondId}`);
    await page.waitForFunction(
        (id) => document.body.innerText.includes(`Bond #${id}`) ||
                document.body.innerText.toLowerCase().includes("status"),
        bondId,
        { timeout: 30_000 }
    );
}

// Time-travel the hardhat node forward by `seconds`. Useful for getting past
// the per-challenge acceptance / ruling windows. Also syncs the page's
// Date.now to the chain's block.timestamp so the UI's wall-clock gating
// matches what the contract sees.
async function timeTravel(deployed, seconds, page) {
    await rpc(deployed).send("evm_increaseTime", [seconds]);
    await rpc(deployed).send("evm_mine", []);
    if (page) await syncDateToChain(deployed, page);
}

// Set the page's Date.now() to match the chain's latest block.timestamp.
// Necessary when previous tests in the same worker already advanced chain
// time — the per-test localStorage offset isn't enough to catch up.
async function syncDateToChain(deployed, page) {
    const block = await rpc(deployed).send("eth_getBlockByNumber", ["latest", false]);
    const chainNow = parseInt(block.timestamp, 16);
    await page.evaluate((cn) => {
        const realNow = Math.floor(Date.now() / 1000) -
            Math.floor((parseInt(localStorage.getItem("__dateOffsetSec") || "0", 10) || 0));
        // realNow is unaffected by our offset; difference = chainNow - realNow.
        const newOffset = cn - realNow + 1; // +1 to be safely > rulingStart
        localStorage.setItem("__dateOffsetSec", String(newOffset));
    }, chainNow);
}

// Open the My Bonds page and wait until the CONNECTED variant renders. We
// FULL-reload at #my (re-navigating) until the role-section headings appear —
// the unconnected variant shows a "Connect a wallet" card instead, and under
// full-suite load the page can briefly show that transitional state, which made
// naive `goto('/#my')` assertions order-dependent/flaky. Re-navigate until the
// connected page is up so My-Bonds listing assertions are deterministic.
async function gotoMyBonds(page) {
    const start = Date.now();
    while (Date.now() - start < 60_000) {
        await page.goto("/#my");
        await page.reload();
        try {
            await page.waitForFunction(
                () => /As challenger/i.test(document.body.innerText),
                null,
                { timeout: 10_000 }
            );
            // Let the late banner/role-section reads settle; the caller's
            // assertions still own the verdict.
            await new Promise((r) => setTimeout(r, 800));
            return;
        } catch (_) {
            await new Promise((r) => setTimeout(r, 500));
        }
    }
    throw new Error("My Bonds page never rendered the connected role sections");
}

module.exports = {
    BOND_ABI,
    rpc,
    bond,
    nextBondId,
    readBond,
    readChallenge,
    getChallengeCount,
    createBondViaUI,
    gotoBondDetail,
    gotoMyBonds,
    timeTravel,
    syncDateToChain,
};
