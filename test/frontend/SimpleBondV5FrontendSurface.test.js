const { expect } = require("chai");
const { readFileSync } = require("fs");
const { resolve } = require("path");

const FRONTEND_PATH = resolve(__dirname, "..", "..", "frontend", "index.html");
const RUNTIME_CONFIG_PATH = resolve(__dirname, "..", "..", "frontend", "runtime-config.js");

describe("SimpleBondV5 frontend surface", function () {
  const frontendSource = readFileSync(FRONTEND_PATH, "utf8");
  const runtimeConfigSource = readFileSync(RUNTIME_CONFIG_PATH, "utf8");

  it("uses the V5 refund batching surface instead of the old judge registry ABI", function () {
    expect(frontendSource).to.include("function claimRefunds(uint256 bondId, uint256 maxCount)");
    expect(frontendSource).to.include("function refundCursor(uint256 bondId) view returns (uint256)");
    expect(frontendSource).to.include("function refundEnd(uint256 bondId) view returns (uint256)");

    expect(frontendSource).to.not.include("function registerAsJudge()");
    expect(frontendSource).to.not.include("function deregisterAsJudge()");
    expect(frontendSource).to.not.include("function setJudgeFee(address token, uint256 minFee)");
    expect(frontendSource).to.not.include("event JudgeRegistered(address indexed judge)");
    expect(frontendSource).to.not.include("event JudgeFeeUpdated(address indexed judge, address indexed token, uint256 newMinFee)");
  });

  it("treats the app as Gnosis-only and runtime-configured for the V5 deployment", function () {
    expect(frontendSource).to.include('<option value="100">Gnosis</option>');
    expect(frontendSource).to.not.include('<option value="137">Polygon</option>');
    expect(frontendSource).to.not.include('<option value="1">Ethereum</option>');
    expect(frontendSource).to.include("Select a judge contract...");
    expect(frontendSource).to.include("contract: window.SIMPLE_BOND_CONFIG?.gnosisBondContract || null");
    expect(frontendSource).to.include("judgeProfileRegistry: window.SIMPLE_BOND_CONFIG?.gnosisJudgeProfileRegistry || null");
    expect(frontendSource).to.include("officialDirectory: window.SIMPLE_BOND_CONFIG?.gnosisOfficialDirectory || null");
    expect(frontendSource).to.include("function setProfile(address judge, string displayName, string statement, string linkURI, string metadataURI)");
    expect(frontendSource).to.include("function judgeCount() view returns (uint256)");
    expect(frontendSource).to.include("function tokenCount() view returns (uint256)");
    expect(frontendSource).to.include('const judgeProfileRouteId = getJudgeProfileRouteId()');
    expect(frontendSource).to.include('const judgeParam = params.get("judge")');

    expect(runtimeConfigSource).to.include('gnosisBondContract: "0x7dF485C013f8671B656d585f1d1411640B1D2776"');
    expect(runtimeConfigSource).to.include("gnosisDeployBlock: 45569363");
    expect(runtimeConfigSource).to.include('gnosisJudgeProfileRegistry: "0x5f2000E438533662A689311672a41aca3EDC88DD"');
    expect(runtimeConfigSource).to.include("gnosisOfficialDirectory: null");
    expect(runtimeConfigSource).to.not.include("judgeApiBase");
  });
});
