const hre = require("hardhat");

// --- Configuration ---
// Update these for your target chain before deploying.

const CONFIG = {
    gnosis: {
        // KlerosLiquid on Gnosis Chain
        arbitrator: "0x9C1dA9A04925bDfDedf0f6421bC7EEa8305F9002",
        // SimpleBondV4 on Gnosis
        simpleBond: "0xCe8799303AeaEC861142470d754F74E09EfD1C45",
        // General Court (subcourt 0), 3 jurors
        arbitratorExtraData:
            "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003",
        // Owner grace period: 3 days (259200 seconds)
        ownerGracePeriod: 259200,
        // ERC-1497 meta-evidence — update with actual IPFS hash after upload
        metaEvidence: "/ipfs/QmTODO_UPLOAD_META_EVIDENCE_JSON",
    },
};

async function main() {
    const network = hre.network.name;
    const config = CONFIG[network];
    if (!config) {
        console.error(`No config for network "${network}". Add it to CONFIG.`);
        console.error("Available:", Object.keys(CONFIG).join(", "));
        process.exit(1);
    }

    console.log(`Deploying KlerosJudgeV2 on ${network}...`);
    console.log("  Arbitrator:", config.arbitrator);
    console.log("  SimpleBondV4:", config.simpleBond);
    console.log("  Grace period:", config.ownerGracePeriod, "seconds");

    const KlerosJudgeV2 = await hre.ethers.getContractFactory("KlerosJudgeV2");
    const judge = await KlerosJudgeV2.deploy(
        config.arbitrator,
        config.simpleBond,
        config.arbitratorExtraData,
        config.ownerGracePeriod,
        config.metaEvidence
    );
    await judge.waitForDeployment();
    const addr = await judge.getAddress();
    console.log("KlerosJudgeV2 deployed to:", addr);

    const deployTx = judge.deploymentTransaction();
    if (deployTx) {
        console.log("Deploy tx hash:", deployTx.hash);
        console.log("Block number:", (await deployTx.wait()).blockNumber);
    }

    console.log("\nPost-deploy checklist:");
    console.log("  1. Verify on block explorer:");
    console.log(`     npx hardhat verify --network ${network} ${addr} \\`);
    console.log(`       ${config.arbitrator} ${config.simpleBond} \\`);
    console.log(`       ${config.arbitratorExtraData} ${config.ownerGracePeriod} "${config.metaEvidence}"`);
    console.log("  2. Update frontend with KlerosJudgeV2 address");
    console.log("  3. Upload meta-evidence JSON to IPFS if not done");
    console.log("  4. Pre-fund bonds via fundBond() if desired");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
