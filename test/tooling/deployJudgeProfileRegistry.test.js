const { expect } = require("chai");

const {
  DEFAULT_OWNER,
  main,
} = require("../../scripts/deployJudgeProfileRegistry");

describe("deployJudgeProfileRegistry.js", function () {
  it("deploys with the default owner and deployer-admin by default", async function () {
    const logLines = [];
    let deployArgs;
    let requestedContract;
    let checklistArgs;

    const fakeTx = {
      hash: "0xregistrytx",
      wait: async () => ({ blockNumber: 4242 }),
    };
    const fakeRegistry = {
      waitForDeployment: async () => {},
      getAddress: async () => "0x000000000000000000000000000000000000c0de",
      deploymentTransaction: () => fakeTx,
    };
    const fakeHre = {
      network: {
        name: "gnosis",
      },
      ethers: {
        getSigners: async () => [{
          getAddress: async () => "0x000000000000000000000000000000000000aDmin",
        }],
        getContractFactory: async (contractName) => {
          requestedContract = contractName;
          return {
            deploy: async (...args) => {
              deployArgs = args;
              return fakeRegistry;
            },
          };
        },
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

    expect(requestedContract).to.equal("JudgeProfileRegistry");
    expect(deployArgs).to.deep.equal([
      DEFAULT_OWNER,
      "0x000000000000000000000000000000000000aDmin",
    ]);
    expect(logLines).to.deep.equal([
      "JudgeProfileRegistry deployed to: 0x000000000000000000000000000000000000c0de",
      `Owner: ${DEFAULT_OWNER}`,
      "Admin: 0x000000000000000000000000000000000000aDmin",
      "Deploy tx hash: 0xregistrytx",
      "Block number: 4242",
    ]);
    expect(checklistArgs).to.deep.equal({
      network: "gnosis",
      contractName: "JudgeProfileRegistry",
      address: "0x000000000000000000000000000000000000c0de",
      txHash: "0xregistrytx",
      blockNumber: 4242,
    });
  });

  it("accepts explicit owner and admin overrides", async function () {
    let deployArgs;
    let checklistArgs;

    const fakeRegistry = {
      waitForDeployment: async () => {},
      getAddress: async () => "0x000000000000000000000000000000000000beef",
      deploymentTransaction: () => undefined,
    };
    const fakeHre = {
      network: {
        name: "hardhat",
      },
      ethers: {
        getSigners: async () => [{
          getAddress: async () => "0x000000000000000000000000000000000000aDmin",
        }],
        getContractFactory: async () => ({
          deploy: async (...args) => {
            deployArgs = args;
            return fakeRegistry;
          },
        }),
      },
    };

    await main({
      hre: fakeHre,
      owner: "0x0000000000000000000000000000000000000F00",
      admin: "0x0000000000000000000000000000000000000BEE",
      log: () => {},
      printSimpleBondDeploymentChecklist: (args) => {
        checklistArgs = args;
      },
    });

    expect(deployArgs).to.deep.equal([
      "0x0000000000000000000000000000000000000F00",
      "0x0000000000000000000000000000000000000BEE",
    ]);
    expect(checklistArgs).to.deep.equal({
      network: "hardhat",
      contractName: "JudgeProfileRegistry",
      address: "0x000000000000000000000000000000000000beef",
      txHash: undefined,
      blockNumber: undefined,
    });
  });
});
