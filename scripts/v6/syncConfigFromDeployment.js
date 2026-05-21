// Reads deployments/<network>.json and patches frontend/runtime-config.js
// to add (or replace) the chain entry. Also prints the backend env block
// the operator should set in production.
//
// Usage:
//   node scripts/v6/syncConfigFromDeployment.js sepolia
//   node scripts/v6/syncConfigFromDeployment.js mainnet
//
// Idempotent: re-running overwrites the existing chain entry with the latest
// addresses from the JSON record.

const fs = require("fs");
const path = require("path");

const NETWORK_TO_CHAIN_ID = {
    mainnet: 1,
    sepolia: 11155111,
};

function loadRecord(network) {
    const p = path.resolve(__dirname, "..", "..", "deployments", `${network}.json`);
    if (!fs.existsSync(p)) {
        throw new Error(`Missing ${p}. Run scripts/v6/deployAll.js --network ${network} first.`);
    }
    return { record: JSON.parse(fs.readFileSync(p, "utf8")), path: p };
}

function patchRuntimeConfig(network, record) {
    const cfgPath = path.resolve(__dirname, "..", "..", "frontend", "runtime-config.js");
    const src = fs.readFileSync(cfgPath, "utf8");
    const chainId = record.chainId;
    const explorer =
        chainId === 1
            ? "https://etherscan.io"
            : chainId === 11155111
            ? "https://sepolia.etherscan.io"
            : "";

    const entry = {
        name: network === "mainnet" ? "Ethereum" : "Sepolia",
        bondContract: record.contracts.simpleBondV6.address,
        deployBlock: record.contracts.simpleBondV6.blockNumber,
        judgeProfileRegistry: record.contracts.judgeProfileRegistry.address,
        posterProfileRegistry: record.contracts.posterProfileRegistry.address,
        challengerProfileRegistry: record.contracts.challengerProfileRegistry.address,
        manualJudgeV6: record.contracts.manualJudgeV6.address,
        officialDirectory: record.contracts.officialBondDirectory.address,
        approvedToken: record.approvedToken,
        explorer,
        bondVersion: 6,
    };

    const entryJson = JSON.stringify(entry, null, 6).replace(/^/gm, "      ").trimStart();
    // Insert/replace the `chains[<chainId>]` entry. Look for an existing entry
    // for this chainId and replace, or insert before the closing "}," of the chains map.
    const chainBlockRegex = new RegExp(
        `(      ${chainId}:\\s*\\{)[\\s\\S]*?(\\n      \\}(?:,?))`,
        "m"
    );
    let next;
    let matched;
    if (chainBlockRegex.test(src)) {
        matched = true;
        next = src.replace(chainBlockRegex, `      ${chainId}: ${entryJson},`);
        next = next.replace(/,\s*,/g, ",");
    } else {
        matched = false;
        next = src.replace(
            /chains:\s*\{\s*\n/,
            (m) => `${m}      ${chainId}: ${entryJson},\n`
        );
    }

    if (!matched && next === src) {
        throw new Error("Could not patch frontend/runtime-config.js (chains block not found).");
    }
    fs.writeFileSync(cfgPath, next);
    if (next === src) {
        console.log(`Chain ${chainId} already up-to-date in ${cfgPath} (no-op).`);
    } else {
        console.log(`Patched ${cfgPath} with chain ${chainId}`);
    }
}

function printBackendEnv(network, record) {
    const upper = network === "mainnet" ? "MAINNET" : "SEPOLIA";
    console.log(``);
    console.log(`=== Backend env block (export before starting the watcher) ===`);
    console.log(`${upper}_V6_CONTRACT=${record.contracts.simpleBondV6.address}`);
    console.log(`${upper}_V6_START_BLOCK=${record.contracts.simpleBondV6.blockNumber}`);
    if (network === "mainnet") console.log(`# Also set MAINNET_RPC if you don't want the default llamarpc.`);
    if (network === "sepolia") console.log(`# Also set SEPOLIA_RPC if you don't want the default publicnode.`);
}

function main() {
    const arg = process.argv[2];
    if (!arg || !NETWORK_TO_CHAIN_ID[arg]) {
        console.error("Usage: node scripts/v6/syncConfigFromDeployment.js <mainnet|sepolia>");
        process.exit(1);
    }
    const { record, path: recordPath } = loadRecord(arg);
    if (record.chainId !== NETWORK_TO_CHAIN_ID[arg]) {
        throw new Error(`Record chainId ${record.chainId} != expected ${NETWORK_TO_CHAIN_ID[arg]}`);
    }
    console.log(`Loaded ${recordPath}`);
    patchRuntimeConfig(arg, record);
    printBackendEnv(arg, record);
    console.log(``);
    console.log(`Done. Commit the runtime-config change, then deploy frontend + restart watcher.`);
}

if (require.main === module) {
    main();
}

module.exports = { main, patchRuntimeConfig, loadRecord };
