const { expect } = require("chai");
const { readFileSync } = require("fs");
const { resolve } = require("path");

const V6_HTML = resolve(__dirname, "..", "..", "frontend", "v6", "index.html");
const V6_ABI = resolve(__dirname, "..", "..", "frontend", "v6", "abi.js");
const V6_SMOKE = resolve(__dirname, "..", "..", "frontend", "v6", "smoke.html");
const RUNTIME_CONFIG = resolve(__dirname, "..", "..", "frontend", "runtime-config.js");

describe("SimpleBond v0.6 frontend surface", function () {
    const v6html = readFileSync(V6_HTML, "utf8");
    const v6abi = readFileSync(V6_ABI, "utf8");
    const v6smoke = readFileSync(V6_SMOKE, "utf8");
    const runtimeConfig = readFileSync(RUNTIME_CONFIG, "utf8");

    it("v6/abi.js exports every v0.6 entrypoint the UI calls", function () {
        // Reads
        expect(v6abi).to.include("function nextBondId() view returns (uint256)");
        expect(v6abi).to.include("function bonds(uint256)");
        expect(v6abi).to.include("claimVersion");
        expect(v6abi).to.include("judgeProfileId");
        expect(v6abi).to.include("pendingCount");
        expect(v6abi).to.include("function getChallengeCount(uint256 bondId)");
        expect(v6abi).to.include("function getChallenge(uint256 bondId, uint256 index)");
        expect(v6abi).to.include("function concessionDeadline(uint256 bondId, uint256 i)");
        expect(v6abi).to.include("function rulingWindowStart(uint256 bondId, uint256 i)");
        expect(v6abi).to.include("function rulingDeadline(uint256 bondId, uint256 i)");
        expect(v6abi).to.include("function refundCursor(uint256)");
        expect(v6abi).to.include("function judgeProfileRegistry()");

        // Writes (every v0.6 entrypoint)
        expect(v6abi).to.include("function createBond(");
        expect(v6abi).to.include("function modifyClaim(uint256 bondId, string calldata newContent)");
        expect(v6abi).to.include("function challenge(uint256 bondId, uint256 expectedVersion, string calldata content)");
        expect(v6abi).to.include("function concede(uint256 bondId, uint256 i, string calldata content)");
        expect(v6abi).to.include("function closeBond(uint256 bondId)");
        expect(v6abi).to.include("function openBond(uint256 bondId)");
        expect(v6abi).to.include("function withdrawBond(uint256 bondId)");
        expect(v6abi).to.include("function claimTimeout(uint256 bondId, uint256 i)");
        expect(v6abi).to.include("function claimRefunds(uint256 bondId, uint256 maxCount)");

        // Events
        for (const name of [
            "BondCreated",
            "ClaimModified",
            "Challenged",
            "ClaimConceded",
            "RuledForPoster",
            "RuledForChallenger",
            "ChallengeRejected",
            "BondRejectedByJudge",
            "BondClosed",
            "BondOpened",
            "BondWithdrawn",
            "BondTimedOut",
            "ChallengeRefunded",
        ]) {
            expect(v6abi, `missing event ${name}`).to.include(`event ${name}`);
        }

        // Registry ABIs
        expect(v6abi).to.include("SIMPLE_BOND_V6_REGISTRY_ABI");
        expect(v6abi).to.include("SIMPLE_BOND_V6_JUDGE_REGISTRY_ABI");
        expect(v6abi).to.include("function registerProfile(address judgeContract, string calldata content)");
        expect(v6abi).to.include("SIMPLE_BOND_V6_MANUAL_JUDGE_ABI");
        expect(v6abi).to.include("function acceptOperatorRole()");
    });

    it("v6/index.html wires the v0.6 action set into the UI", function () {
        // Loads runtime-config + v6 ABI.
        expect(v6html).to.include('src="../runtime-config.js"');
        expect(v6html).to.include('src="./abi.js"');

        // Iterates runtime-config.chains for the v0.6 selector.
        expect(v6html).to.include("cfg.chains");
        // The chain filter now uses the positive form
        // `!c.bondVersion || c.bondVersion === 6` since the dropdown is
        // hidden entirely on single-chain hosts.
        expect(v6html).to.match(/bondVersion(\s*===\s*6|\s*!==\s*6)/);

        // Wallet + network switch via MetaMask.
        expect(v6html).to.include("window.ethereum");
        expect(v6html).to.include("wallet_switchEthereumChain");
        expect(v6html).to.include("BrowserProvider");

        // All v0.6 write paths are reachable from the UI (method names appear in tx calls).
        expect(v6html).to.include(".createBond(");
        expect(v6html).to.include(".modifyClaim(");
        expect(v6html).to.match(/\.challenge\(\s*bondId/);
        expect(v6html).to.match(/\.concede\(\s*bondId/);
        expect(v6html).to.include(".closeBond(bondId");
        expect(v6html).to.include(".openBond(bondId");
        expect(v6html).to.include(".withdrawBond(bondId");
        expect(v6html).to.include(".claimRefunds(bondId");
        expect(v6html).to.include(".claimTimeout(bondId");

        // Per-challenge timing surfaced to user.
        expect(v6html).to.include("concessionDeadline");
        expect(v6html).to.include("rulingDeadline");

        // Profile registries reachable (judge registry surfaced; bond pins judgeProfileId).
        expect(v6html).to.include("registerProfile");
        expect(v6html).to.include("judgeProfileRegistry");

        // Hash+content pattern visible: status badges named after ChallengeStatus enum.
        for (const s of ["Pending", "Won", "Lost", "Conceded", "RejectedByJudge", "Refunded"]) {
            expect(v6html, `missing status name ${s}`).to.include(s);
        }
    });

    it("v6/smoke.html provides a read-only verification page", function () {
        expect(v6smoke).to.include("readNext");
        expect(v6smoke).to.include("readBond");
        expect(v6smoke).to.include("SIMPLE_BOND_V6_ABI");
    });

    it("runtime-config exposes the chains[] schema with mainnet + sepolia entries and defaults to mainnet", function () {
        expect(runtimeConfig).to.include("chains:");
        expect(runtimeConfig).to.include("defaultChainId: 1");
        expect(runtimeConfig).to.match(/1:\s*\{[\s\S]*bondVersion:\s*6/);
        expect(runtimeConfig).to.match(/11155111:\s*\{[\s\S]*bondVersion:\s*6/);
        // Gnosis legacy entry + gnosis* keys retired at v0.6 cutover.
        expect(runtimeConfig).to.not.include("gnosisBondContract:");
        expect(runtimeConfig).to.not.match(/100:\s*\{/);
    });
});
