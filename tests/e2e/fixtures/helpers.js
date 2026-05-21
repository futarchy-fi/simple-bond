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
// the per-challenge acceptance / ruling windows.
async function timeTravel(deployed, seconds) {
    await rpc(deployed).send("evm_increaseTime", [seconds]);
    await rpc(deployed).send("evm_mine", []);
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
    timeTravel,
};
