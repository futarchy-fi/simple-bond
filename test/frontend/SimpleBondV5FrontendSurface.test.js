const { expect } = require("chai");
const { readFileSync } = require("fs");
const { resolve } = require("path");

// frontend/index.html is the v0.6 UI as of the v0.6 cutover; the v0.5 UI is
// archived under frontend/legacy/v5-index.html. This suite continues to
// assert v0.5 frontend invariants against the archived file so anyone
// forking or pinning the v0.5 line still gets the same behavioural contract.
// Runtime-config assertions on legacy gnosis* keys are dropped because the
// Gnosis chain is retired from the live UI (Phase 11 of PLAN_V06.md).
const FRONTEND_PATH = resolve(__dirname, "..", "..", "frontend", "legacy", "v5-index.html");

describe("SimpleBond v0.5 frontend surface (archived)", function () {
  const frontendSource = readFileSync(FRONTEND_PATH, "utf8");

  it("uses the v0.5 refund batching surface instead of the old judge registry ABI", function () {
    expect(frontendSource).to.include("function claimRefunds(uint256 bondId, uint256 maxCount)");
    expect(frontendSource).to.include("function refundCursor(uint256 bondId) view returns (uint256)");
    expect(frontendSource).to.include("function refundEnd(uint256 bondId) view returns (uint256)");

    expect(frontendSource).to.not.include("function registerAsJudge()");
    expect(frontendSource).to.not.include("function deregisterAsJudge()");
    expect(frontendSource).to.not.include("function setJudgeFee(address token, uint256 minFee)");
    expect(frontendSource).to.not.include("event JudgeRegistered(address indexed judge)");
    expect(frontendSource).to.not.include("event JudgeFeeUpdated(address indexed judge, address indexed token, uint256 newMinFee)");
  });

  it("treats the app as Gnosis-only and runtime-configured for the v0.5 deployment", function () {
    expect(frontendSource).to.include('<option value="100">Gnosis</option>');
    expect(frontendSource).to.not.include('<option value="137">Polygon</option>');
    expect(frontendSource).to.not.include('<option value="1">Ethereum</option>');
    expect(frontendSource).to.include("Select a judge contract...");
    expect(frontendSource).to.include("Become a Judge");
    expect(frontendSource).to.include("Import Custom Contract");
    expect(frontendSource).to.include("Use Existing Judge");
    expect(frontendSource).to.include("function acceptOperatorRole()");
    expect(frontendSource).to.include("function judgeOf(address operator) view returns (address)");
    expect(frontendSource).to.include("New judges you create here appear immediately for you");
    expect(frontendSource).to.include("contract: window.SIMPLE_BOND_CONFIG?.gnosisBondContract || null");
    expect(frontendSource).to.include("judgeProfileRegistry: window.SIMPLE_BOND_CONFIG?.gnosisJudgeProfileRegistry || null");
    expect(frontendSource).to.include("judgeRegistry: window.SIMPLE_BOND_CONFIG?.gnosisJudgeRegistry || null");
    expect(frontendSource).to.include("officialDirectory: window.SIMPLE_BOND_CONFIG?.gnosisOfficialDirectory || null");
    expect(frontendSource).to.include("function setProfile(address judge, string displayName, string statement, string linkURI, string metadataURI)");
    expect(frontendSource).to.include("function judgeCount() view returns (uint256)");
    expect(frontendSource).to.include("function tokenCount() view returns (uint256)");
    expect(frontendSource).to.include('const judgeProfileRouteId = getJudgeProfileRouteId()');
    expect(frontendSource).to.include('const judgeParam = params.get("judge")');
  });
});
