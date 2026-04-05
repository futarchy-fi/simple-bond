const RUNTIME_CONFIG_TARGETS = {
    gnosis: {
        chainId: 100,
        name: "Gnosis",
    },
    polygon: {
        chainId: 137,
        name: "Polygon",
    },
};

function printSimpleBondDeploymentChecklist({
    network,
    contractName,
    address,
    txHash,
    blockNumber,
    log = console.log,
}) {
    const runtimeConfig = RUNTIME_CONFIG_TARGETS[network];

    log("");
    log("Post-deploy checklist:");
    log(`  Contract: ${contractName}`);
    log(`  Network: ${network}`);
    log(`  Address: ${address}`);

    if (txHash) {
        log(`  Deploy tx hash: ${txHash}`);
    }

    if (blockNumber != null) {
        log(`  Deploy block: ${blockNumber}`);
    }

    if (network === "hardhat") {
        log("  1. Skip explorer verification on the local hardhat network.");
    } else {
        log("  1. Verify on block explorer:");
        log(`     npx hardhat verify --network ${network} ${address}`);
    }

    if (runtimeConfig) {
        log(`  2. If this should be the live ${runtimeConfig.name} deployment, update frontend/index.html:`);
        log(`     set CHAINS[${runtimeConfig.chainId}].contract = "${address}"`);

        if (blockNumber != null) {
            log(`     set CHAINS[${runtimeConfig.chainId}].deployBlock = ${blockNumber}`);
        }

        log("  3. If the notification backend should watch this deployment, update backend/config.mjs:");
        log(`     set CHAINS[${runtimeConfig.chainId}].contract = "${address}"`);

        if (blockNumber != null) {
            log(`     set CHAINS[${runtimeConfig.chainId}].startBlock = ${blockNumber}`);
        }

        log("  4. If this deployment is canonical, update README.md's Addresses table.");
        log("  5. Record the deployed address, tx hash, and block number in your release notes or ops log.");
        return;
    }

    log("  2. frontend/index.html and backend/config.mjs currently ship active SimpleBond runtime config only for Gnosis and Polygon.");
    log("     If this deployment should be product-supported, add the new chain/address/block there before treating it as live.");
    log("  3. If this deployment is canonical, update README.md's Addresses table.");
    log("  4. Record the deployed address, tx hash, and block number in your release notes or ops log.");
}

function parseCliArgs(argv) {
    const parsed = {};

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (!arg.startsWith("--")) {
            continue;
        }

        const key = arg.slice(2);
        const value = argv[index + 1];

        if (!value || value.startsWith("--")) {
            throw new Error(`Missing value for --${key}`);
        }

        parsed[key] = value;
        index += 1;
    }

    return parsed;
}

if (require.main === module) {
    try {
        const args = parseCliArgs(process.argv.slice(2));
        const network = args.network;
        const address = args.address;
        const contractName = args["contract-name"] || args.contract || "SimpleBondV4";

        if (!network || !address) {
            throw new Error(
                "Usage: node scripts/printSimpleBondDeploymentChecklist.js --network <network> --address <address> [--contract-name <name>] [--tx-hash <hash>] [--block-number <number>]"
            );
        }

        printSimpleBondDeploymentChecklist({
            network,
            contractName,
            address,
            txHash: args["tx-hash"],
            blockNumber: args["block-number"] != null ? Number(args["block-number"]) : undefined,
        });
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

module.exports = {
    printSimpleBondDeploymentChecklist,
};
