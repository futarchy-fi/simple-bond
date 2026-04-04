const hre = require("hardhat");
const { printSimpleBondDeploymentChecklist } = require("./printSimpleBondDeploymentChecklist");

async function main() {
    const SimpleBondV4 = await hre.ethers.getContractFactory("SimpleBondV4");
    const bond = await SimpleBondV4.deploy();
    await bond.waitForDeployment();
    const addr = await bond.getAddress();
    console.log("SimpleBondV4 deployed to:", addr);

    const deployTx = bond.deploymentTransaction();
    let blockNumber;

    if (deployTx) {
        console.log("Deploy tx hash:", deployTx.hash);
        blockNumber = (await deployTx.wait()).blockNumber;
        console.log("Block number:", blockNumber);
    }

    printSimpleBondDeploymentChecklist({
        network: hre.network.name,
        contractName: "SimpleBondV4",
        address: addr,
        txHash: deployTx ? deployTx.hash : undefined,
        blockNumber,
    });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
