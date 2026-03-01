const hre = require("hardhat");

async function main() {
    const SimpleBondV4 = await hre.ethers.getContractFactory("SimpleBondV4");
    const bond = await SimpleBondV4.deploy();
    await bond.waitForDeployment();
    const addr = await bond.getAddress();
    console.log("SimpleBondV4 deployed to:", addr);

    const deployTx = bond.deploymentTransaction();
    if (deployTx) {
        console.log("Deploy tx hash:", deployTx.hash);
        console.log("Block number:", (await deployTx.wait()).blockNumber);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
