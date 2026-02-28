require("@nomicfoundation/hardhat-ethers");
require("dotenv").config();

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
    },
};
