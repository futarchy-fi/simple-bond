const { ethers } = require("hardhat");

async function deployMockSUSDS() {
    const F = await ethers.getContractFactory("MockSUSDS");
    const t = await F.deploy("Mock sUSDS", "msUSDS");
    await t.waitForDeployment();
    return t;
}

async function deployJudgeProfileRegistry() {
    const F = await ethers.getContractFactory("JudgeProfileRegistryV6");
    const r = await F.deploy();
    await r.waitForDeployment();
    return r;
}

async function deployBond(judgeProfileRegistryAddress) {
    const F = await ethers.getContractFactory("SimpleBondV6");
    const b = await F.deploy(judgeProfileRegistryAddress);
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

async function deployBondHarness({ withForwardingJudge = false } = {}) {
    const registry = await deployJudgeProfileRegistry();
    const bond = await deployBond(await registry.getAddress());
    const judge = withForwardingJudge
        ? await deployForwardingJudge()
        : await deployAcceptJudge();
    const tx = await registry.registerProfile(await judge.getAddress(), "default test judge profile");
    const r = await tx.wait();
    const log = r.logs.find((l) => l.fragment && l.fragment.name === "ProfileRegistered");
    const judgeProfileId = log.args.entryId;
    return { registry, bond, judge, judgeProfileId };
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
    deployBond,
    deployAcceptJudge,
    deployForwardingJudge,
    deployBondHarness,
    createDefaultBond,
    fundAndApprove,
    DEFAULT_BOND_PARAMS,
};
