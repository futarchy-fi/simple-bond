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
      contractName: "SimpleBondV5",
      address,
      txHash: "0xtxhash",
      blockNumber: 123456,
    });

    expect(lines).to.deep.equal([
      "",
      "Post-deploy checklist:",
      "  Contract: SimpleBondV5",
      "  Network: gnosis",
      `  Address: ${address}`,
      "  Deploy tx hash: 0xtxhash",
      "  Deploy block: 123456",
      "  1. Verify on block explorer:",
      `     npx hardhat verify --network gnosis ${address}`,
      "  2. If this should be the live Gnosis deployment, update frontend/runtime-config.js:",
      `     set window.SIMPLE_BOND_CONFIG.gnosisBondContract = "${address}"`,
      "     set window.SIMPLE_BOND_CONFIG.gnosisDeployBlock = 123456",
      "  3. If email notifications should watch this deployment, update backend/config.mjs:",
      `     set CHAINS[100].contract = "${address}"`,
      "     set CHAINS[100].startBlock = 123456",
      "  4. If this deployment is canonical, update README.md's Addresses table.",
      "  5. Record the deployed address, tx hash, and block number in your release notes or ops log.",
    ]);
  });

  it("prints the Gnosis runtime-config checklist for JudgeProfileRegistry deployments", function () {
    const address = "0x000000000000000000000000000000000000bEEF";
    const lines = captureChecklist({
      network: "gnosis",
      contractName: "JudgeProfileRegistry",
      address,
      txHash: "0xregistry",
      blockNumber: 4242,
    });

    expect(lines).to.deep.equal([
      "",
      "Post-deploy checklist:",
      "  Contract: JudgeProfileRegistry",
      "  Network: gnosis",
      `  Address: ${address}`,
      "  Deploy tx hash: 0xregistry",
      "  Deploy block: 4242",
      "  1. Verify on block explorer:",
      `     npx hardhat verify --network gnosis ${address}`,
      "  2. If this should be the live Gnosis judge profile registry, update frontend/runtime-config.js:",
      `     set window.SIMPLE_BOND_CONFIG.gnosisJudgeProfileRegistry = "${address}"`,
      "  3. If this deployment is canonical, update README.md's Addresses table.",
      "  4. Record the deployed address, tx hash, and block number in your release notes or ops log.",
    ]);
  });

  it("prints the Gnosis runtime-config checklist for OfficialBondDirectory deployments", function () {
    const address = "0x0000000000000000000000000000000000000Ff1";
    const lines = captureChecklist({
      network: "gnosis",
      contractName: "OfficialBondDirectory",
      address,
      txHash: "0xdirectory",
      blockNumber: 5150,
    });

    expect(lines).to.deep.equal([
      "",
      "Post-deploy checklist:",
      "  Contract: OfficialBondDirectory",
      "  Network: gnosis",
      `  Address: ${address}`,
      "  Deploy tx hash: 0xdirectory",
      "  Deploy block: 5150",
      "  1. Verify on block explorer:",
      `     npx hardhat verify --network gnosis ${address}`,
      "  2. If this should be the live Gnosis official directory, update frontend/runtime-config.js:",
      `     set window.SIMPLE_BOND_CONFIG.gnosisOfficialDirectory = "${address}"`,
      "  3. If this deployment is canonical, update README.md's Addresses table.",
      "  4. Record the deployed address, tx hash, and block number in your release notes or ops log.",
    ]);
  });

  it("prints the unsupported-network warning for Ethereum deployments", function () {
    const address = "0x000000000000000000000000000000000000dEaD";
    const lines = captureChecklist({
      network: "ethereum",
      contractName: "SimpleBondV5",
      address,
      txHash: "0xeth",
      blockNumber: 999,
    });

    expect(lines).to.deep.equal([
      "",
      "Post-deploy checklist:",
      "  Contract: SimpleBondV5",
      "  Network: ethereum",
      `  Address: ${address}`,
      "  Deploy tx hash: 0xeth",
      "  Deploy block: 999",
      "  1. Verify on block explorer:",
      `     npx hardhat verify --network ethereum ${address}`,
      "  2. The product frontend currently ships active runtime config only for Gnosis in frontend/runtime-config.js.",
      "     If this deployment should be product-supported, add the new chain/address/block there before treating it as live.",
      "  3. If email notifications should watch this deployment, also update backend/config.mjs.",
      "  4. If this deployment is canonical, update README.md's Addresses table.",
      "  5. Record the deployed address, tx hash, and block number in your release notes or ops log.",
    ]);
  });

  it("skips explorer verification on the local hardhat network", function () {
    const address = "0x000000000000000000000000000000000000f00d";
    const lines = captureChecklist({
      network: "hardhat",
      contractName: "SimpleBondV5",
      address,
      txHash: "0xlocal",
      blockNumber: 111,
    });

    expect(lines).to.deep.equal([
      "",
      "Post-deploy checklist:",
      "  Contract: SimpleBondV5",
      "  Network: hardhat",
      `  Address: ${address}`,
      "  Deploy tx hash: 0xlocal",
      "  Deploy block: 111",
      "  1. Skip explorer verification on the local hardhat network.",
      "  2. The product frontend currently ships active runtime config only for Gnosis in frontend/runtime-config.js.",
      "     If this deployment should be product-supported, add the new chain/address/block there before treating it as live.",
      "  3. If email notifications should watch this deployment, also update backend/config.mjs.",
      "  4. If this deployment is canonical, update README.md's Addresses table.",
      "  5. Record the deployed address, tx hash, and block number in your release notes or ops log.",
    ]);
  });

  it("defaults the CLI contract name to SimpleBondV5", function () {
    const address = "0x000000000000000000000000000000000000beef";
    const result = spawnSync(
      process.execPath,
      [CLI_SCRIPT, "--network", "gnosis", "--address", address],
      { encoding: "utf8" }
    );

    expect(result.status).to.equal(0);
    expect(result.stderr).to.equal("");
    expect(result.stdout).to.contain("  Contract: SimpleBondV5");
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
