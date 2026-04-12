const defaultHre = require("hardhat");
const {
    printSimpleBondDeploymentChecklist: defaultPrintSimpleBondDeploymentChecklist,
} = require("./printSimpleBondDeploymentChecklist");

const DEFAULT_OWNER = "0x645A3D9208523bbFEE980f7269ac72C61Dd3b552";

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

async function main({
    hre = defaultHre,
    owner = DEFAULT_OWNER,
    admin,
    log = console.log,
    printSimpleBondDeploymentChecklist = defaultPrintSimpleBondDeploymentChecklist,
} = {}) {
    const [deployer] = await hre.ethers.getSigners();
    const adminAddress = admin || (await deployer.getAddress());

    const JudgeRegistry = await hre.ethers.getContractFactory("JudgeRegistry");
    const registry = await JudgeRegistry.deploy(owner, adminAddress);
    await registry.waitForDeployment();

    const addr = await registry.getAddress();
    log("JudgeRegistry deployed to:", addr);
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
        contractName: "JudgeRegistry",
        address: addr,
        txHash,
        blockNumber,
    });
}

if (require.main === module) {
    try {
        const args = parseCliArgs(process.argv.slice(2));

        main({
            owner: args.owner || DEFAULT_OWNER,
            admin: args.admin,
        }).catch((err) => {
            console.error(err);
            process.exit(1);
        });
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
}

module.exports = {
    DEFAULT_OWNER,
    main,
    parseCliArgs,
};
