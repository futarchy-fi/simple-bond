const { expect } = require("chai");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const hre = require("hardhat");

const EXPECTED_CONTRACTS = [
  "SimpleBondV4",
  "SimpleBondV5",
  "SimpleBondV3",
  "KlerosJudge",
  "SimpleBond",
  "TestToken",
  "ManualJudge",
  "JudgeProfileRegistry",
  "OfficialBondDirectory",
  "MockArbitrator",
];

const INTERFACE_ARTIFACTS = [
  "contracts/interfaces/IArbitrator.sol:IArbitrator",
  "contracts/interfaces/IArbitrator.sol:IArbitrable",
  "contracts/interfaces/IArbitrator.sol:IEvidence",
  "contracts/interfaces/IBondJudgeV5.sol:IBondJudgeV5",
  "contracts/interfaces/IJudgeProfileControlled.sol:IJudgeProfileControlled",
  "contracts/legacy/KlerosJudge.sol:ISimpleBondV4",
  "contracts/judges/ManualJudge.sol:IBondJudgeTarget",
];

function parseReportRows(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .map((line) => line.match(/^([A-Za-z0-9_]+)\s+(\d+)\s+(\d+\.\d+)\s+(OK|NEAR LIMIT|OVER LIMIT)$/))
    .filter(Boolean)
    .map(([, contractName, sizeBytes, usagePercent, status]) => ({
      contractName,
      sizeBytes: Number(sizeBytes),
      usagePercent: Number(usagePercent),
      status,
    }));
}

describe("size report command", function () {
  this.timeout(120000);

  it("verifies npm run size reports deployed contract sizes for concrete contracts only", async function () {
    const { scripts } = require("../../package.json");
    expect(scripts.size).to.equal("hardhat size-contracts");

    const result = spawnSync("npm", ["run", "--silent", "size"], {
      cwd: path.resolve(__dirname, "../.."),
      encoding: "utf8",
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status, output).to.equal(0);
    expect(output).to.match(/Compiled \d+ Solidity files successfully|Nothing to compile/);
    expect(output).to.include("Deployed runtime sizes (EIP-170 limit: 24576 bytes)");

    const rows = parseReportRows(output);
    const reportedNames = rows.map(({ contractName }) => contractName);
    const rowsByName = new Map(rows.map((row) => [row.contractName, row]));

    expect(reportedNames).to.have.members(EXPECTED_CONTRACTS);
    expect(reportedNames).to.have.lengthOf(EXPECTED_CONTRACTS.length);

    for (const artifactName of INTERFACE_ARTIFACTS) {
      const artifact = await hre.artifacts.readArtifact(artifactName);
      const contractName = artifactName.split(":")[1];

      expect(artifact.deployedBytecode).to.equal("0x");
      expect(reportedNames).to.not.include(contractName);
    }

    for (const contractName of EXPECTED_CONTRACTS) {
      const artifact = await hre.artifacts.readArtifact(contractName);
      const runtimeSizeBytes = (artifact.deployedBytecode.length - 2) / 2;

      expect(rowsByName.get(contractName).sizeBytes).to.equal(runtimeSizeBytes);
    }

    for (const contractName of ["SimpleBondV4", "KlerosJudge", "TestToken"]) {
      const artifact = await hre.artifacts.readArtifact(contractName);
      const creationSizeBytes = (artifact.bytecode.length - 2) / 2;

      expect(rowsByName.get(contractName).sizeBytes).to.not.equal(creationSizeBytes);
    }
  });
});
