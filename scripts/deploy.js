const defaultHre = require("hardhat");
const {
    printSimpleBondDeploymentChecklist: defaultPrintSimpleBondDeploymentChecklist,
} = require("./printSimpleBondDeploymentChecklist");

async function main({
    hre = defaultHre,
    log = console.log,
    printSimpleBondDeploymentChecklist = defaultPrintSimpleBondDeploymentChecklist,
} = {}) {
    const SimpleBondV4 = await hre.ethers.getContractFactory("SimpleBondV4");
    const bond = await SimpleBondV4.deploy();
    await bond.waitForDeployment();
    const addr = await bond.getAddress();
    log("SimpleBondV4 deployed to:", addr);

    const deployTx = bond.deploymentTransaction();
    let blockNumber;
    let txHash;

    if (deployTx) {
        txHash = deployTx.hash;
        log("Deploy tx hash:", txHash);
        blockNumber = (await deployTx.wait()).blockNumber;
        log("Block number:", blockNumber);
    }

    printSimpleBondDeploymentChecklist({
        network: hre.network.name,
        contractName: "SimpleBondV4",
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
    main,
};
