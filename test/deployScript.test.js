const { expect } = require("chai");
const { main } = require("../scripts/deploy");

describe("deploy.js", function () {
  it("prints deployment metadata and passes it to the checklist helper", async function () {
    const logLines = [];
    let requestedContract;
    let checklistArgs;

    const fakeTx = {
      hash: "0xtxhash",
      wait: async () => ({ blockNumber: 123456 }),
    };
    const fakeBond = {
      waitForDeployment: async () => {},
      getAddress: async () => "0x000000000000000000000000000000000000c0de",
      deploymentTransaction: () => fakeTx,
    };
    const fakeHre = {
      ethers: {
        getContractFactory: async (contractName) => {
          requestedContract = contractName;
          return {
            deploy: async () => fakeBond,
          };
        },
      },
      network: {
        name: "hardhat",
      },
    };

    await main({
      hre: fakeHre,
      log: (...args) => {
        logLines.push(args.join(" "));
      },
      printSimpleBondDeploymentChecklist: (args) => {
        checklistArgs = args;
      },
    });

    expect(requestedContract).to.equal("SimpleBondV4");
    expect(logLines).to.deep.equal([
      "SimpleBondV4 deployed to: 0x000000000000000000000000000000000000c0de",
      "Deploy tx hash: 0xtxhash",
      "Block number: 123456",
    ]);
    expect(checklistArgs).to.deep.equal({
      network: "hardhat",
      contractName: "SimpleBondV4",
      address: "0x000000000000000000000000000000000000c0de",
      txHash: "0xtxhash",
      blockNumber: 123456,
    });
  });

  it("still prints the checklist when deployment metadata is unavailable", async function () {
    const logLines = [];
    let checklistArgs;

    const fakeBond = {
      waitForDeployment: async () => {},
      getAddress: async () => "0x000000000000000000000000000000000000beef",
      deploymentTransaction: () => undefined,
    };
    const fakeHre = {
      ethers: {
        getContractFactory: async () => ({
          deploy: async () => fakeBond,
        }),
      },
      network: {
        name: "hardhat",
      },
    };

    await main({
      hre: fakeHre,
      log: (...args) => {
        logLines.push(args.join(" "));
      },
      printSimpleBondDeploymentChecklist: (args) => {
        checklistArgs = args;
      },
    });

    expect(logLines).to.deep.equal([
      "SimpleBondV4 deployed to: 0x000000000000000000000000000000000000beef",
    ]);
    expect(checklistArgs).to.deep.equal({
      network: "hardhat",
      contractName: "SimpleBondV4",
      address: "0x000000000000000000000000000000000000beef",
      txHash: undefined,
      blockNumber: undefined,
    });
  });
});
