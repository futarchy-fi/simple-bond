const { expect } = require("chai");
const { readFileSync } = require("fs");
const { resolve } = require("path");

describe("backend v0.5 surface", function () {
  const backendConfigSource = readFileSync(
    resolve(__dirname, "..", "backend", "config.mjs"),
    "utf8"
  );

  it("watches the live Gnosis v0.5 deployment only", function () {
    expect(backendConfigSource).to.include("contract: '0x7dF485C013f8671B656d585f1d1411640B1D2776'");
    expect(backendConfigSource).to.include("startBlock: 45569363");
    expect(backendConfigSource).to.include("CONFIRMATION_BLOCKS = { 100: 12 }");
    expect(backendConfigSource).to.not.include("name: 'Polygon'");
    expect(backendConfigSource).to.include("SimpleBondV5 ABI subset");
  });
});
