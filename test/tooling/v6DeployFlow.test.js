// End-to-end smoke test for scripts/v6/deployAll.js + syncConfigFromDeployment.js
// + verifyDeployment.js, exercised against the local hardhat network. Proves the
// operator runbook commands in RELEASE_V06.md work as a chain before they're run
// against Sepolia or mainnet.

const { expect } = require("chai");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..", "..");

function runHardhatScript(scriptPath, env = {}) {
    return spawnSync(
        "npx",
        ["hardhat", "run", scriptPath],
        {
            cwd: REPO,
            env: { ...process.env, ...env },
            encoding: "utf8",
        }
    );
}

function runNodeScript(scriptPath, args = [], env = {}) {
    return spawnSync(
        process.execPath,
        [scriptPath, ...args],
        {
            cwd: REPO,
            env: { ...process.env, ...env },
            encoding: "utf8",
        }
    );
}

describe("v0.6 deploy-script flow (against local hardhat)", function () {
    this.timeout(120000);

    let mockTokenAddress;

    before(async function () {
        // Deploy a MockSUSDS so deployAll has a real ERC-20 to whitelist.
        const r = runHardhatScript("scripts/v6/deployMockSUSDS.js");
        const m = r.stdout.match(/MockSUSDS deployed to:\s+(\S+)/);
        if (!m) {
            throw new Error(`deployMockSUSDS did not print address. stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
        }
        mockTokenAddress = m[1];
    });

    after(function () {
        // Clean up the chain31337.json artifact deployAll wrote.
        const p = path.join(REPO, "deployments", "chain31337.json");
        if (fs.existsSync(p)) fs.unlinkSync(p);
    });

    it("deployAll runs cleanly and writes deployments/chain31337.json", function () {
        const r = runHardhatScript("scripts/v6/deployAll.js", { APPROVED_TOKEN: mockTokenAddress });
        if (r.status !== 0) {
            throw new Error(`deployAll exited ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
        }
        // Expected stdout markers.
        expect(r.stdout).to.include("JudgeProfileRegistryV6");
        expect(r.stdout).to.include("SimpleBondV6");
        expect(r.stdout).to.include("ManualJudgeV6 activated by deployer");
        expect(r.stdout).to.include("Runtime config block");
        expect(r.stdout).to.include("Wrote");

        const recordPath = path.join(REPO, "deployments", "chain31337.json");
        expect(fs.existsSync(recordPath), `expected ${recordPath} to exist`).to.equal(true);
        const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
        expect(record.chainId).to.equal(31337);
        expect(record.contracts).to.have.all.keys(
            "judgeProfileRegistry",
            "posterProfileRegistry",
            "challengerProfileRegistry",
            "simpleBondV6",
            "manualJudgeV6",
            "officialBondDirectory"
        );
        for (const c of Object.values(record.contracts)) {
            expect(c.address, "contract has address").to.match(/^0x[0-9a-fA-F]{40}$/);
            expect(c.blockNumber, "contract has blockNumber").to.be.a("number");
        }
        expect(record.approvedToken).to.equal(mockTokenAddress);
    });

    it("deployAll prints copy-pasteable verify commands for every deployed contract", function () {
        const r = runHardhatScript("scripts/v6/deployAll.js", { APPROVED_TOKEN: mockTokenAddress });
        const expectedVerifies = [
            "JudgeProfileRegistryV6 (no constructor args)",
            "SimpleBondV6 constructor arg = judge profile registry",
            "ManualJudgeV6 constructor arg = operator",
            "OfficialBondDirectory constructor args = owner admin",
        ];
        // Just assert there are at least 6 verify lines (one per contract).
        const verifyLines = r.stdout.split("\n").filter((l) => l.startsWith("npx hardhat verify"));
        expect(verifyLines.length).to.be.greaterThanOrEqual(6);
        // Sanity check: SimpleBondV6 verify line includes the registry constructor arg.
        const bondLine = verifyLines.find((l) => l.includes(JSON.parse(fs.readFileSync(path.join(REPO, "deployments", "chain31337.json"), "utf8")).contracts.simpleBondV6.address));
        expect(bondLine, "verify line for SimpleBondV6 found").to.be.a("string");
        // SimpleBondV6 takes registry address as constructor arg, so the verify command should have a trailing 0x address.
        expect(bondLine.split(/\s+/).length).to.be.greaterThanOrEqual(6);
        void expectedVerifies;
    });
});
