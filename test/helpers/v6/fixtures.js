const { ethers } = require("hardhat");

async function deployMockSUSDS() {
    const F = await ethers.getContractFactory("MockSUSDS");
    const t = await F.deploy("Mock sUSDS", "msUSDS");
    await t.waitForDeployment();
    return t;
}

async function deployBond() {
    const F = await ethers.getContractFactory("SimpleBondV6");
    const b = await F.deploy();
    await b.waitForDeployment();
    return b;
}

async function deployAcceptJudge() {
    const F = await ethers.getContractFactory("TestAcceptJudgeV6");
    const j = await F.deploy();
    await j.waitForDeployment();
    return j;
}

async function deployForwardingJudge() {
    const F = await ethers.getContractFactory("TestForwardingJudgeV6");
    const j = await F.deploy();
    await j.waitForDeployment();
    return j;
}

const DEFAULT_BOND_PARAMS = {
    bondAmount: ethers.parseEther("10"),
    challengeAmount: ethers.parseEther("3"),
    judgeFee: ethers.parseEther("0.5"),
    acceptanceDelay: 7 * 24 * 3600,
    rulingBuffer: 7 * 24 * 3600,
    maxChallenges: 10,
    judgeProfileId: 0,
    claimContent: "ipfs://example-claim",
};

async function fundAndApprove(token, bond, signer, amount) {
    await token.mint(signer.address, amount);
    await token.connect(signer).approve(await bond.getAddress(), amount);
}

module.exports = {
    deployMockSUSDS,
    deployBond,
    deployAcceptJudge,
    deployForwardingJudge,
    fundAndApprove,
    DEFAULT_BOND_PARAMS,
};
