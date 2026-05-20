// Deploy the full v0.6 stack: profile registries, SimpleBondV6, ManualJudgeV6,
// OfficialBondDirectory. Writes deployments/<network>.json with all addresses
// and prints a runtime-config block ready to paste into
// frontend/runtime-config.js and backend/config.mjs.
//
// Env:
//   PRIVATE_KEY   deployer (also default owner/admin of the directory).
//   OWNER         optional override for OfficialBondDirectory owner.
//   ADMIN         optional override for OfficialBondDirectory admin.
//   MANUAL_JUDGE_OPERATOR  optional; defaults to the deployer.
//   APPROVED_TOKEN  ERC-20 to whitelist as the canonical bond token.
//                   On mainnet pass sUSDS: 0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD.
//                   On Sepolia pass the MockSUSDS address from deployMockSUSDS.js.
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const network = hre.network.name;
    const chainId = hre.network.config.chainId;
    const [deployer] = await hre.ethers.getSigners();
    console.log(`Deployer:                        ${deployer.address}`);
    console.log(`Network:                         ${network} (chainId ${chainId})`);
    console.log(``);

    const owner = process.env.OWNER || deployer.address;
    const admin = process.env.ADMIN || deployer.address;
    const operator = process.env.MANUAL_JUDGE_OPERATOR || deployer.address;
    const approvedToken = process.env.APPROVED_TOKEN;
    if (!approvedToken) {
        throw new Error("APPROVED_TOKEN env required (canonical bond token address)");
    }

    const out = {};

    out.judgeProfileRegistry = await deploySimple("JudgeProfileRegistryV6", []);
    out.posterProfileRegistry = await deploySimple("PosterProfileRegistry", []);
    out.challengerProfileRegistry = await deploySimple("ChallengerProfileRegistry", []);

    out.simpleBondV6 = await deploySimple("SimpleBondV6", [out.judgeProfileRegistry.address]);

    out.manualJudgeV6 = await deploySimple("ManualJudgeV6", [operator]);

    // Operator activates the judge if they are the deployer (common in scripted deploys).
    if (operator.toLowerCase() === deployer.address.toLowerCase()) {
        const judge = await hre.ethers.getContractAt("ManualJudgeV6", out.manualJudgeV6.address);
        await (await judge.acceptOperatorRole()).wait();
        console.log(`ManualJudgeV6 activated by deployer (${deployer.address})`);
    } else {
        console.log(`ManualJudgeV6 awaiting acceptOperatorRole() from ${operator}`);
    }

    out.officialBondDirectory = await deploySimple("OfficialBondDirectory", [owner, admin]);

    // Curate the approved token in the directory (best-effort: directory may revert
    // if owner/admin is a multisig that has to confirm separately).
    try {
        const directory = await hre.ethers.getContractAt(
            "OfficialBondDirectory",
            out.officialBondDirectory.address
        );
        const tx = await directory.setToken(
            approvedToken,
            true,    // enabled
            true,    // isDefaultToken
            false,   // isWrappedNative
            18,      // decimals (uint8)
            0,       // sortOrder (uint32)
            "sUSDS",
            "Savings USDS"
        );
        await tx.wait();
        console.log(`Approved ${approvedToken} as canonical token in OfficialBondDirectory`);
    } catch (e) {
        console.log(`Skipping setToken (likely owner/admin is not the deployer): ${e.message}`);
    }

    // Persist deployment record to deployments/<network>.json.
    const deploymentRecord = {
        chainId,
        network,
        deployer: deployer.address,
        approvedToken,
        manualJudgeOperator: operator,
        directoryOwner: owner,
        directoryAdmin: admin,
        contracts: Object.fromEntries(
            Object.entries(out).map(([k, v]) => [k, { address: v.address, blockNumber: v.blockNumber }])
        ),
        deployedAt: new Date().toISOString(),
    };
    const recordDir = path.resolve(__dirname, "..", "..", "deployments");
    fs.mkdirSync(recordDir, { recursive: true });
    const recordPath = path.join(recordDir, `${networkSafeName(network, chainId)}.json`);
    fs.writeFileSync(recordPath, JSON.stringify(deploymentRecord, null, 2) + "\n");
    console.log(``);
    console.log(`Wrote ${recordPath}`);

    console.log(``);
    console.log(`=== Runtime config block (paste into frontend/runtime-config.js) ===`);
    const networkKey = chainId === 1 ? "mainnet" : chainId === 11155111 ? "sepolia" : `chain${chainId}`;
    console.log(JSON.stringify(
        {
            chains: {
                [chainId]: {
                    name: networkKey,
                    bondContract: out.simpleBondV6.address,
                    deployBlock: out.simpleBondV6.blockNumber,
                    judgeProfileRegistry: out.judgeProfileRegistry.address,
                    posterProfileRegistry: out.posterProfileRegistry.address,
                    challengerProfileRegistry: out.challengerProfileRegistry.address,
                    officialDirectory: out.officialBondDirectory.address,
                    approvedToken,
                    explorer: chainId === 1
                        ? "https://etherscan.io"
                        : chainId === 11155111
                        ? "https://sepolia.etherscan.io"
                        : "",
                },
            },
        },
        null,
        2
    ));
    console.log(``);
    console.log(`=== Backend CHAINS[${chainId}] config (paste into backend/config.mjs) ===`);
    console.log(JSON.stringify(
        {
            [chainId]: {
                name: networkKey,
                rpc: chainId === 1 ? "https://eth.llamarpc.com" : "https://ethereum-sepolia-rpc.publicnode.com",
                contract: out.simpleBondV6.address,
                startBlock: out.simpleBondV6.blockNumber,
                explorer: chainId === 1
                    ? "https://etherscan.io"
                    : chainId === 11155111
                    ? "https://sepolia.etherscan.io"
                    : "",
            },
        },
        null,
        2
    ));
    console.log(``);
    console.log(`=== Verify commands ===`);
    for (const [name, info] of Object.entries(out)) {
        const args = info.constructorArgs.join(" ");
        console.log(`npx hardhat verify --network ${network} ${info.address}${args ? " " + args : ""}`);
    }
}

function networkSafeName(network, chainId) {
    if (network === "ethereum") return "mainnet";
    if (network === "sepolia") return "sepolia";
    return `chain${chainId}`;
}

async function deploySimple(name, args) {
    const F = await hre.ethers.getContractFactory(name);
    const c = await F.deploy(...args);
    await c.waitForDeployment();
    const address = await c.getAddress();
    const tx = c.deploymentTransaction();
    const receipt = tx ? await tx.wait() : null;
    const blockNumber = receipt ? receipt.blockNumber : null;
    console.log(`${name.padEnd(30)} ${address}  (block ${blockNumber})`);
    return { address, blockNumber, constructorArgs: args };
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { main };
