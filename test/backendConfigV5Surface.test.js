const { expect } = require("chai");
const { readFileSync } = require("fs");
const { resolve } = require("path");

describe("backend chain config", function () {
  const backendConfigSource = readFileSync(
    resolve(__dirname, "..", "backend", "config.mjs"),
    "utf8"
  );

  it("keeps the live Gnosis v0.5 deployment as a hardcoded entry", function () {
    expect(backendConfigSource).to.include("contract: '0x7dF485C013f8671B656d585f1d1411640B1D2776'");
    expect(backendConfigSource).to.include("startBlock: 45569363");
    expect(backendConfigSource).to.include("SimpleBondV5 ABI subset");
    expect(backendConfigSource).to.not.include("name: 'Polygon'");
  });

  it("declares mainnet (1) and Sepolia (11155111) in CONFIRMATION_BLOCKS for v0.6 chains", function () {
    expect(backendConfigSource).to.match(/CONFIRMATION_BLOCKS = \{[^}]*100:\s*12/);
    expect(backendConfigSource).to.match(/CONFIRMATION_BLOCKS = \{[^}]*1:\s*12/);
    expect(backendConfigSource).to.match(/CONFIRMATION_BLOCKS = \{[^}]*11155111:\s*6/);
  });

  it("registers v0.6 chains only when MAINNET_V6_CONTRACT / SEPOLIA_V6_CONTRACT env vars are set", function () {
    expect(backendConfigSource).to.include("process.env.MAINNET_V6_CONTRACT");
    expect(backendConfigSource).to.include("process.env.SEPOLIA_V6_CONTRACT");
  });

  it("exports per-version ABIs and a chain-aware lookup", function () {
    expect(backendConfigSource).to.include("V5_CONTRACT_ABI");
    expect(backendConfigSource).to.include("V6_CONTRACT_ABI");
    expect(backendConfigSource).to.include("abiForChain");
  });
});
