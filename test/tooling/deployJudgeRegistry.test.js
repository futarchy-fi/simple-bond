const { expect } = require("chai");

const {
  DEFAULT_OWNER,
  main,
  parseCliArgs,
} = require("../../scripts/deployJudgeRegistry");

describe("deployJudgeRegistry.js", function () {
  it("parses CLI owner and admin overrides", async function () {
    expect(parseCliArgs(["--owner", "0xowner", "--admin", "0xadmin"])).to.deep.equal({
      owner: "0xowner",
      admin: "0xadmin",
    });
  });

  it("rejects missing CLI override values", async function () {
    expect(() => parseCliArgs(["--owner"])).to.throw("Missing value for --owner");
  });

  it("deploys with the default owner and deployer-admin by default", async function () {
    const logLines = [];
    let deployArgs;
    let requestedContract;
    let checklistArgs;

    const fakeTx = {
      hash: "0xjudgeregistry",
      wait: async () => ({ blockNumber: 9911 }),
    };
    const fakeRegistry = {
      waitForDeployment: async () => {},
      getAddress: async () => "0x0000000000000000000000000000000000000aa1",
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

    expect(requestedContract).to.equal("JudgeRegistry");
    expect(deployArgs).to.deep.equal([
      DEFAULT_OWNER,
      "0x000000000000000000000000000000000000aDmin",
    ]);
    expect(logLines).to.deep.equal([
      "JudgeRegistry deployed to: 0x0000000000000000000000000000000000000aa1",
      `Owner: ${DEFAULT_OWNER}`,
      "Admin: 0x000000000000000000000000000000000000aDmin",
      "Deploy tx hash: 0xjudgeregistry",
      "Block number: 9911",
    ]);
    expect(checklistArgs).to.deep.equal({
      network: "gnosis",
      contractName: "JudgeRegistry",
      address: "0x0000000000000000000000000000000000000aa1",
      txHash: "0xjudgeregistry",
      blockNumber: 9911,
    });
  });

  it("accepts explicit owner and admin overrides", async function () {
    let deployArgs;
    let checklistArgs;

    const fakeRegistry = {
      waitForDeployment: async () => {},
      getAddress: async () => "0x0000000000000000000000000000000000000aa2",
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
      contractName: "JudgeRegistry",
      address: "0x0000000000000000000000000000000000000aa2",
      txHash: undefined,
      blockNumber: undefined,
    });
  });
});
