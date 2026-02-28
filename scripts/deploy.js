const hre = require("hardhat");

async function main() {
    const SimpleBond = await hre.ethers.getContractFactory("SimpleBond");
    const bond = await SimpleBond.deploy();
    await bond.waitForDeployment();
    const addr = await bond.getAddress();
    console.log("SimpleBond deployed to:", addr);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
