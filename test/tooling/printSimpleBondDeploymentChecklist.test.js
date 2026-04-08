const { spawnSync } = require("child_process");
const path = require("path");
const { expect } = require("chai");
const {
  printSimpleBondDeploymentChecklist,
} = require("../../scripts/printSimpleBondDeploymentChecklist");

const CLI_SCRIPT = path.join(
  __dirname,
  "..",
  "..",
  "scripts",
  "printSimpleBondDeploymentChecklist.js"
);

describe("printSimpleBondDeploymentChecklist", function () {
  function captureChecklist(args) {
    const lines = [];

    printSimpleBondDeploymentChecklist({
      ...args,
      log: (line) => {
        lines.push(line);
      },
    });

    return lines;
  }

  it("prints the supported-network checklist for Gnosis deployments", function () {
    const address = "0x000000000000000000000000000000000000c0de";
    const lines = captureChecklist({
      network: "gnosis",
      contractName: "SimpleBondV4",
      address,
      txHash: "0xtxhash",
      blockNumber: 123456,
    });

    expect(lines).to.deep.equal([
      "",
      "Post-deploy checklist:",
      "  Contract: SimpleBondV4",
      "  Network: gnosis",
      `  Address: ${address}`,
      "  Deploy tx hash: 0xtxhash",
      "  Deploy block: 123456",
      "  1. Verify on block explorer:",
      `     npx hardhat verify --network gnosis ${address}`,
      "  2. If this should be the live Gnosis deployment, update frontend/index.html:",
      `     set CHAINS[100].contract = "${address}"`,
      "     set CHAINS[100].deployBlock = 123456",
      "  3. If the notification backend should watch this deployment, update backend/config.mjs:",
      `     set CHAINS[100].contract = "${address}"`,
      "     set CHAINS[100].startBlock = 123456",
      "  4. If this deployment is canonical, update README.md's Addresses table.",
      "  5. Record the deployed address, tx hash, and block number in your release notes or ops log.",
    ]);
  });

  it("prints the unsupported-network warning for Ethereum deployments", function () {
    const address = "0x000000000000000000000000000000000000dEaD";
    const lines = captureChecklist({
      network: "ethereum",
      contractName: "SimpleBondV4",
      address,
      txHash: "0xeth",
      blockNumber: 999,
    });

    expect(lines).to.deep.equal([
      "",
      "Post-deploy checklist:",
      "  Contract: SimpleBondV4",
      "  Network: ethereum",
      `  Address: ${address}`,
      "  Deploy tx hash: 0xeth",
      "  Deploy block: 999",
      "  1. Verify on block explorer:",
      `     npx hardhat verify --network ethereum ${address}`,
      "  2. frontend/index.html and backend/config.mjs currently ship active SimpleBond runtime config only for Gnosis and Polygon.",
      "     If this deployment should be product-supported, add the new chain/address/block there before treating it as live.",
      "  3. If this deployment is canonical, update README.md's Addresses table.",
      "  4. Record the deployed address, tx hash, and block number in your release notes or ops log.",
    ]);
  });

  it("skips explorer verification on the local hardhat network", function () {
    const address = "0x000000000000000000000000000000000000f00d";
    const lines = captureChecklist({
      network: "hardhat",
      contractName: "SimpleBondV4",
      address,
      txHash: "0xlocal",
      blockNumber: 111,
    });

    expect(lines).to.deep.equal([
      "",
      "Post-deploy checklist:",
      "  Contract: SimpleBondV4",
      "  Network: hardhat",
      `  Address: ${address}`,
      "  Deploy tx hash: 0xlocal",
      "  Deploy block: 111",
      "  1. Skip explorer verification on the local hardhat network.",
      "  2. frontend/index.html and backend/config.mjs currently ship active SimpleBond runtime config only for Gnosis and Polygon.",
      "     If this deployment should be product-supported, add the new chain/address/block there before treating it as live.",
      "  3. If this deployment is canonical, update README.md's Addresses table.",
      "  4. Record the deployed address, tx hash, and block number in your release notes or ops log.",
    ]);
  });

  it("defaults the CLI contract name to SimpleBondV4", function () {
    const address = "0x000000000000000000000000000000000000beef";
    const result = spawnSync(
      process.execPath,
      [CLI_SCRIPT, "--network", "gnosis", "--address", address],
      { encoding: "utf8" }
    );

    expect(result.status).to.equal(0);
    expect(result.stderr).to.equal("");
    expect(result.stdout).to.contain("  Contract: SimpleBondV4");
    expect(result.stdout).to.contain(
      `     npx hardhat verify --network gnosis ${address}`
    );
  });

  it("prints usage and exits non-zero when required CLI args are missing", function () {
    const result = spawnSync(process.execPath, [CLI_SCRIPT, "--network", "gnosis"], {
      encoding: "utf8",
    });

    expect(result.status).to.equal(1);
    expect(result.stdout).to.equal("");
    expect(result.stderr).to.contain(
      "Usage: node scripts/printSimpleBondDeploymentChecklist.js --network <network> --address <address>"
    );
  });
});
