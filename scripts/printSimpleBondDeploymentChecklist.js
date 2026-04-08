const RUNTIME_CONFIG_TARGETS = {
    gnosis: {
        chainId: 100,
        name: "Gnosis",
        bondContractKey: "gnosisBondContract",
        deployBlockKey: "gnosisDeployBlock",
        judgeProfileRegistryKey: "gnosisJudgeProfileRegistry",
        officialDirectoryKey: "gnosisOfficialDirectory",
    },
};

function printV5FrontendConfigChecklist(runtimeConfig, address, blockNumber, log) {
    log(`  2. If this should be the live ${runtimeConfig.name} deployment, update frontend/runtime-config.js:`);
    log(`     set window.SIMPLE_BOND_CONFIG.${runtimeConfig.bondContractKey} = "${address}"`);

    if (blockNumber != null) {
        log(`     set window.SIMPLE_BOND_CONFIG.${runtimeConfig.deployBlockKey} = ${blockNumber}`);
    }

    log("  3. If email notifications should watch this deployment, update backend/config.mjs:");
    log(`     set CHAINS[${runtimeConfig.chainId}].contract = "${address}"`);

    if (blockNumber != null) {
        log(`     set CHAINS[${runtimeConfig.chainId}].startBlock = ${blockNumber}`);
    }

    log("  4. If this deployment is canonical, update README.md's Addresses table.");
    log("  5. Record the deployed address, tx hash, and block number in your release notes or ops log.");
}

function printJudgeProfileRegistryChecklist(runtimeConfig, address, log) {
    log(`  2. If this should be the live ${runtimeConfig.name} judge profile registry, update frontend/runtime-config.js:`);
    log(`     set window.SIMPLE_BOND_CONFIG.${runtimeConfig.judgeProfileRegistryKey} = "${address}"`);
    log("  3. If this deployment is canonical, update README.md's Addresses table.");
    log("  4. Record the deployed address, tx hash, and block number in your release notes or ops log.");
}

function printOfficialDirectoryChecklist(runtimeConfig, address, log) {
    log(`  2. If this should be the live ${runtimeConfig.name} official directory, update frontend/runtime-config.js:`);
    log(`     set window.SIMPLE_BOND_CONFIG.${runtimeConfig.officialDirectoryKey} = "${address}"`);
    log("  3. If this deployment is canonical, update README.md's Addresses table.");
    log("  4. Record the deployed address, tx hash, and block number in your release notes or ops log.");
}

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

    if (runtimeConfig && contractName === "SimpleBondV5") {
        printV5FrontendConfigChecklist(runtimeConfig, address, blockNumber, log);
        return;
    }

    if (runtimeConfig && contractName === "JudgeProfileRegistry") {
        printJudgeProfileRegistryChecklist(runtimeConfig, address, log);
        return;
    }

    if (runtimeConfig && contractName === "OfficialBondDirectory") {
        printOfficialDirectoryChecklist(runtimeConfig, address, log);
        return;
    }

    log("  2. The product frontend currently ships active runtime config only for Gnosis in frontend/runtime-config.js.");
    log("     If this deployment should be product-supported, add the new chain/address/block there before treating it as live.");
    log("  3. If email notifications should watch this deployment, also update backend/config.mjs.");
    log("  4. If this deployment is canonical, update README.md's Addresses table.");
    log("  5. Record the deployed address, tx hash, and block number in your release notes or ops log.");
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
        const contractName = args["contract-name"] || args.contract || "SimpleBondV5";

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
