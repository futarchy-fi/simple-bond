// Deploy MockSUSDS to a testnet (Sepolia). NEVER run this on mainnet — production
// uses real sUSDS at 0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD.
const hre = require("hardhat");

async function main() {
    const network = hre.network.name;
    if (network === "ethereum" || network === "mainnet") {
        throw new Error(`Refusing to deploy MockSUSDS on '${network}'. Use real sUSDS on mainnet.`);
    }

    const F = await hre.ethers.getContractFactory("MockSUSDS");
    const token = await F.deploy("Mock sUSDS", "msUSDS");
    await token.waitForDeployment();
    const addr = await token.getAddress();
    const deployTx = token.deploymentTransaction();
    const receipt = deployTx ? await deployTx.wait() : null;

    console.log(`MockSUSDS deployed to:           ${addr}`);
    console.log(`Network:                         ${network} (chainId ${hre.network.config.chainId})`);
    if (receipt) console.log(`Deploy block:                    ${receipt.blockNumber}`);
    if (deployTx) console.log(`Tx hash:                         ${deployTx.hash}`);

    // Optionally mint to the deployer for smoke testing.
    const mintAmount = hre.ethers.parseEther("1000000");
    const [deployer] = await hre.ethers.getSigners();
    await (await token.mint(deployer.address, mintAmount)).wait();
    console.log(`Minted ${hre.ethers.formatEther(mintAmount)} msUSDS to ${deployer.address}`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { main };
