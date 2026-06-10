const { ethers } = require("hardhat");

async function deployMockSUSDS() {
    const F = await ethers.getContractFactory("MockSUSDS");
    const t = await F.deploy("Mock sUSDS", "msUSDS");
    await t.waitForDeployment();
    return t;
}

async function deployJudgeProfileRegistry() {
    // v0.7 REUSES the deployed v0.6 registries + ManualJudgeV6 — keep the V6 names.
    const F = await ethers.getContractFactory("JudgeProfileRegistryV6");
    const r = await F.deploy();
    await r.waitForDeployment();
    return r;
}

// V7-1: the core now takes the OfficialBondDirectory and gates createBond on
// directory.hasToken(token), so the test harness deploys a real directory and
// registers each token a test intends to use.
async function deployOfficialDirectory() {
    const [deployer] = await ethers.getSigners();
    const F = await ethers.getContractFactory("OfficialBondDirectory");
    const d = await F.deploy(deployer.address, deployer.address);
    await d.waitForDeployment();
    return d;
}

async function directoryRegisterToken(directory, token) {
    const addr = typeof token === "string" ? token : await token.getAddress();
    // enabled, not default, not wrapped-native; cosmetic fields are irrelevant to hasToken().
    const tx = await directory.setToken(addr, true, false, false, 18, 0, "MOCK", "Mock test token");
    await tx.wait();
}

async function deployBond(judgeProfileRegistryAddress, officialDirectoryAddress) {
    const F = await ethers.getContractFactory("SimpleBondV7");
    const b = await F.deploy(judgeProfileRegistryAddress, officialDirectoryAddress);
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

async function deployBondHarness({ withForwardingJudge = false, tokens = [] } = {}) {
    const registry = await deployJudgeProfileRegistry();
    const directory = await deployOfficialDirectory();
    for (const t of tokens) await directoryRegisterToken(directory, t);
    const bond = await deployBond(await registry.getAddress(), await directory.getAddress());
    const judge = withForwardingJudge
        ? await deployForwardingJudge()
        : await deployAcceptJudge();
    const tx = await registry.registerProfile(await judge.getAddress(), "default test judge profile");
    const r = await tx.wait();
    const log = r.logs.find((l) => l.fragment && l.fragment.name === "ProfileRegistered");
    const judgeProfileId = log.args.entryId;
    return { registry, directory, bond, judge, judgeProfileId };
}

const DEFAULT_BOND_PARAMS = {
    bondAmount: ethers.parseEther("10"),
    challengeAmount: ethers.parseEther("3"),
    judgeFee: ethers.parseEther("0.5"),
    acceptanceDelay: 7 * 24 * 3600,
    rulingBuffer: 7 * 24 * 3600,
    maxChallenges: 10,
    claimContent: "ipfs://example-claim",
};

async function fundAndApprove(token, bond, signer, amount) {
    await token.mint(signer.address, amount);
    await token.connect(signer).approve(await bond.getAddress(), amount);
}

async function createDefaultBond(bond, poster, token, judge, judgeProfileId, overrides = {}) {
    const p = { ...DEFAULT_BOND_PARAMS, ...overrides };
    return bond.connect(poster).createBond(
        await token.getAddress(),
        p.bondAmount,
        p.challengeAmount,
        p.judgeFee,
        await judge.getAddress(),
        p.acceptanceDelay,
        p.rulingBuffer,
        p.maxChallenges,
        judgeProfileId,
        p.claimContent
    );
}

module.exports = {
    deployMockSUSDS,
    deployJudgeProfileRegistry,
    deployOfficialDirectory,
    directoryRegisterToken,
    deployBond,
    deployAcceptJudge,
    deployForwardingJudge,
    deployBondHarness,
    createDefaultBond,
    fundAndApprove,
    DEFAULT_BOND_PARAMS,
};
