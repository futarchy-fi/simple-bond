const { expect } = require("chai");
const fs = require("fs");
const path = require("path");
const { patchRuntimeConfig } = require("../scripts/v6/syncConfigFromDeployment");

const RUNTIME_CONFIG = path.resolve(__dirname, "..", "frontend", "runtime-config.js");
const DEPLOYMENTS_DIR = path.resolve(__dirname, "..", "deployments");

function sampleRecord(chainId) {
    return {
        chainId,
        network: chainId === 1 ? "mainnet" : "sepolia",
        deployer: "0x0000000000000000000000000000000000000099",
        approvedToken: "0x000000000000000000000000000000000000ABCD",
        manualJudgeOperator: "0x0000000000000000000000000000000000000099",
        directoryOwner: "0x0000000000000000000000000000000000000099",
        directoryAdmin: "0x0000000000000000000000000000000000000099",
        contracts: {
            judgeProfileRegistry: { address: "0x0000000000000000000000000000000000000001", blockNumber: 100 },
            posterProfileRegistry: { address: "0x0000000000000000000000000000000000000002", blockNumber: 101 },
            challengerProfileRegistry: { address: "0x0000000000000000000000000000000000000003", blockNumber: 102 },
            simpleBondV6: { address: "0x0000000000000000000000000000000000000004", blockNumber: 103 },
            manualJudgeV6: { address: "0x0000000000000000000000000000000000000005", blockNumber: 104 },
            officialBondDirectory: { address: "0x0000000000000000000000000000000000000006", blockNumber: 105 },
        },
        deployedAt: "2026-05-20T00:00:00.000Z",
    };
}

describe("syncConfigFromDeployment", function () {
    let original;
    let v6Baseline;
    before(() => {
        original = fs.readFileSync(RUNTIME_CONFIG, "utf8");
        // The LIVE config's Sepolia entry is bondVersion 7 (v0.7 staging cutover),
        // which the script now refuses to downgrade (audit AUDIT-v7 §6 TD2). The
        // v6 patch-path tests run against a v6-Sepolia baseline instead.
        v6Baseline = original.replace(
            /(11155111:\s*\{[\s\S]*?bondVersion:\s*)7/,
            "$16"
        );
    });
    after(() => {
        fs.writeFileSync(RUNTIME_CONFIG, original);
        // Clean up any test records
        for (const f of ["sepolia.json", "mainnet.json"]) {
            const p = path.join(DEPLOYMENTS_DIR, f);
            if (fs.existsSync(p) && fs.readFileSync(p, "utf8").includes("0x0000000000000000000000000000000000000004")) {
                fs.unlinkSync(p);
            }
        }
    });

    it("REFUSES to re-sync a chain whose live entry is bondVersion 7 (v7-downgrade guard)", () => {
        // Runs against the REAL (v7-Sepolia) config: this is the exact footgun
        // the guard exists for — a v6 re-sync silently reverting the cutover.
        expect(() => patchRuntimeConfig("sepolia", sampleRecord(11155111)))
            .to.throw(/V7-DOWNGRADE-BLOCKED/);
        // And the file was not touched.
        expect(fs.readFileSync(RUNTIME_CONFIG, "utf8")).to.equal(original);
    });

    it("patches runtime-config.js with a new sepolia chain entry", () => {
        fs.writeFileSync(RUNTIME_CONFIG, v6Baseline); // v6-Sepolia baseline
        const rec = sampleRecord(11155111);
        patchRuntimeConfig("sepolia", rec);
        const patched = fs.readFileSync(RUNTIME_CONFIG, "utf8");
        expect(patched).to.include("11155111:");
        expect(patched).to.include("0x0000000000000000000000000000000000000004"); // simpleBondV6
        expect(patched).to.include("sepolia.etherscan.io");
        expect(patched).to.include("bondVersion");
        // Mainnet (chain 1) entry kept intact across a sepolia patch.
        expect(patched).to.match(/1:\s*\{/);
    });

    it("idempotent — running twice produces the same file (no duplicate entries)", () => {
        fs.writeFileSync(RUNTIME_CONFIG, v6Baseline); // reset to v6-Sepolia baseline
        patchRuntimeConfig("sepolia", sampleRecord(11155111));
        const first = fs.readFileSync(RUNTIME_CONFIG, "utf8");
        patchRuntimeConfig("sepolia", sampleRecord(11155111));
        const second = fs.readFileSync(RUNTIME_CONFIG, "utf8");
        expect(second).to.equal(first);
    });

    it("can patch mainnet without removing sepolia", () => {
        fs.writeFileSync(RUNTIME_CONFIG, v6Baseline); // reset to v6-Sepolia baseline
        patchRuntimeConfig("sepolia", sampleRecord(11155111));
        patchRuntimeConfig("mainnet", sampleRecord(1));
        const patched = fs.readFileSync(RUNTIME_CONFIG, "utf8");
        expect(patched).to.include("1:");
        expect(patched).to.include("11155111:");
        expect(patched).to.include("etherscan.io");
    });

    it("mainnet (chain 1) patch does NOT false-trigger the v7 guard on the live v7-Sepolia config", () => {
        // Regression for the substring hazard: '1: {' must not match inside
        // '11155111: {'. Patching mainnet on the REAL config (Sepolia = v7)
        // must succeed and leave the Sepolia v7 entry untouched.
        fs.writeFileSync(RUNTIME_CONFIG, original);
        patchRuntimeConfig("mainnet", sampleRecord(1));
        const patched = fs.readFileSync(RUNTIME_CONFIG, "utf8");
        expect(patched).to.include("0x0000000000000000000000000000000000000004"); // mainnet patched
        expect(patched).to.match(/11155111:\s*\{[\s\S]*?bondVersion:\s*7/); // Sepolia v7 intact
    });
});
