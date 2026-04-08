const defaultHre = require("hardhat");
const {
    printSimpleBondDeploymentChecklist: defaultPrintSimpleBondDeploymentChecklist,
} = require("./printSimpleBondDeploymentChecklist");

const DEFAULT_OWNER = "0x645A3D9208523bbFEE980f7269ac72C61Dd3b552";

async function main({
    hre = defaultHre,
    owner = DEFAULT_OWNER,
    admin,
    log = console.log,
    printSimpleBondDeploymentChecklist = defaultPrintSimpleBondDeploymentChecklist,
} = {}) {
    const [deployer] = await hre.ethers.getSigners();
    const adminAddress = admin || (await deployer.getAddress());

    const JudgeProfileRegistry = await hre.ethers.getContractFactory("JudgeProfileRegistry");
    const registry = await JudgeProfileRegistry.deploy(owner, adminAddress);
    await registry.waitForDeployment();

    const addr = await registry.getAddress();
    log("JudgeProfileRegistry deployed to:", addr);
    log("Owner:", owner);
    log("Admin:", adminAddress);

    const deployTx = registry.deploymentTransaction();
    let txHash;
    let blockNumber;

    if (deployTx) {
        txHash = deployTx.hash;
        log("Deploy tx hash:", txHash);
        const receipt = await deployTx.wait();
        blockNumber = receipt.blockNumber;
        log("Block number:", blockNumber);
    }

    printSimpleBondDeploymentChecklist({
        network: hre.network?.name,
        contractName: "JudgeProfileRegistry",
        address: addr,
        txHash,
        blockNumber,
    });
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = {
    DEFAULT_OWNER,
    main,
};
