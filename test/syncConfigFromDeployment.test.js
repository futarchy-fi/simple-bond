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
    before(() => {
        original = fs.readFileSync(RUNTIME_CONFIG, "utf8");
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

    it("patches runtime-config.js with a new sepolia chain entry", () => {
        const rec = sampleRecord(11155111);
        patchRuntimeConfig("sepolia", rec);
        const patched = fs.readFileSync(RUNTIME_CONFIG, "utf8");
        expect(patched).to.include("11155111:");
        expect(patched).to.include("0x0000000000000000000000000000000000000004"); // simpleBondV6
        expect(patched).to.include("sepolia.etherscan.io");
        expect(patched).to.include("bondVersion");
        // Legacy gnosis keys preserved.
        expect(patched).to.include("0x7dF485C013f8671B656d585f1d1411640B1D2776");
    });

    it("idempotent — running twice produces the same file (no duplicate entries)", () => {
        fs.writeFileSync(RUNTIME_CONFIG, original); // reset
        patchRuntimeConfig("sepolia", sampleRecord(11155111));
        const first = fs.readFileSync(RUNTIME_CONFIG, "utf8");
        patchRuntimeConfig("sepolia", sampleRecord(11155111));
        const second = fs.readFileSync(RUNTIME_CONFIG, "utf8");
        expect(second).to.equal(first);
    });

    it("can patch mainnet without removing sepolia", () => {
        fs.writeFileSync(RUNTIME_CONFIG, original); // reset
        patchRuntimeConfig("sepolia", sampleRecord(11155111));
        patchRuntimeConfig("mainnet", sampleRecord(1));
        const patched = fs.readFileSync(RUNTIME_CONFIG, "utf8");
        expect(patched).to.include("1:");
        expect(patched).to.include("11155111:");
        expect(patched).to.include("etherscan.io");
    });
});
