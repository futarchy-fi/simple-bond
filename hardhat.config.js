const { task } = require("hardhat/config");

require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-verify");
require("dotenv").config();

const EIP170_LIMIT_BYTES = 24_576;

task("size-contracts", "Reports deployed contract sizes against the EIP-170 limit").setAction(
    async (_, hre) => {
        await hre.run("compile");

        const fullyQualifiedNames = await hre.artifacts.getAllFullyQualifiedNames();
        const contracts = [];

        for (const fullyQualifiedName of fullyQualifiedNames) {
            const artifact = await hre.artifacts.readArtifact(fullyQualifiedName);

            if (!artifact.sourceName.startsWith("contracts/")) {
                continue;
            }

            const deployedBytecode = artifact.deployedBytecode || "0x";

            if (deployedBytecode === "0x") {
                continue;
            }

            const sizeBytes = (deployedBytecode.length - 2) / 2;
            const usagePercent = (sizeBytes / EIP170_LIMIT_BYTES) * 100;

            contracts.push({
                contractName: artifact.contractName,
                sizeBytes,
                usagePercent,
                status:
                    sizeBytes > EIP170_LIMIT_BYTES
                        ? "OVER LIMIT"
                        : usagePercent >= 90
                          ? "NEAR LIMIT"
                          : "OK",
            });
        }

        contracts.sort((left, right) => right.sizeBytes - left.sizeBytes || left.contractName.localeCompare(right.contractName));

        if (contracts.length === 0) {
            console.log("No deployed contract artifacts found under contracts/.");
            return;
        }

        const nameWidth = Math.max(...contracts.map(({ contractName }) => contractName.length), "Contract".length);
        const sizeWidth = Math.max(...contracts.map(({ sizeBytes }) => String(sizeBytes).length), "Bytes".length);
        const pctWidth = Math.max(...contracts.map(({ usagePercent }) => usagePercent.toFixed(2).length), "% Limit".length);
        const statusWidth = Math.max(...contracts.map(({ status }) => status.length), "Status".length);

        console.log(`Deployed runtime sizes (EIP-170 limit: ${EIP170_LIMIT_BYTES} bytes)`);
        console.log(
            `${"Contract".padEnd(nameWidth)}  ${"Bytes".padStart(sizeWidth)}  ${"% Limit".padStart(pctWidth)}  ${"Status".padEnd(statusWidth)}`
        );

        for (const contract of contracts) {
            console.log(
                `${contract.contractName.padEnd(nameWidth)}  ${String(contract.sizeBytes).padStart(sizeWidth)}  ${contract.usagePercent
                    .toFixed(2)
                    .padStart(pctWidth)}  ${contract.status.padEnd(statusWidth)}`
            );
        }
    }
);

module.exports = {
    solidity: {
        version: "0.8.24",
        settings: { optimizer: { enabled: true, runs: 200 } },
    },
    networks: {
        hardhat: {},
        gnosis: {
            url: process.env.RPC_URL || "https://rpc.gnosischain.com",
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
            chainId: 100,
        },
        base: {
            url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
            chainId: 8453,
        },
        polygon: {
            url: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
            chainId: 137,
        },
        ethereum: {
            url: process.env.ETH_RPC_URL || "https://eth.llamarpc.com",
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
            chainId: 1,
        },
    },
    etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY || "",
    },
};
