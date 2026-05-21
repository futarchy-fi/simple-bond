// Read a deployments/<network>.json record and run read-only sanity checks
// against the live chain to confirm the deployment is healthy.
//
// Usage:
//   npx hardhat run scripts/v6/verifyDeployment.js --network sepolia
//   npx hardhat run scripts/v6/verifyDeployment.js --network ethereum

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function recordPathFor(chainId) {
    if (chainId === 1) return "mainnet.json";
    if (chainId === 11155111) return "sepolia.json";
    return `chain${chainId}.json`;
}

async function main() {
    const network = hre.network.name;
    const chainId = hre.network.config.chainId;
    const recordFile = path.resolve(__dirname, "..", "..", "deployments", recordPathFor(chainId));
    if (!fs.existsSync(recordFile)) {
        throw new Error(`No deployment record at ${recordFile}. Run scripts/v6/deployAll.js first.`);
    }
    const record = JSON.parse(fs.readFileSync(recordFile, "utf8"));
    if (record.chainId !== chainId) {
        throw new Error(`Record chainId ${record.chainId} != current network chainId ${chainId}`);
    }
    console.log(`Verifying deployment on ${network} (chainId ${chainId})`);
    console.log(`Record: ${recordFile}`);
    console.log(``);

    const C = record.contracts;
    const checks = [];

    // 1. SimpleBondV6 reads.
    const bond = await hre.ethers.getContractAt("SimpleBondV6", C.simpleBondV6.address);
    const reg = await bond.judgeProfileRegistry();
    const nextId = await bond.nextBondId();
    checks.push(["SimpleBondV6.judgeProfileRegistry == record", reg.toLowerCase() === C.judgeProfileRegistry.address.toLowerCase()]);
    checks.push(["SimpleBondV6.nextBondId returns a uint", typeof nextId === "bigint"]);

    // 2. JudgeProfileRegistryV6 reads.
    const jp = await hre.ethers.getContractAt("JudgeProfileRegistryV6", C.judgeProfileRegistry.address);
    const jpCount = await jp.entryCount();
    checks.push(["JudgeProfileRegistryV6.entryCount returns a uint", typeof jpCount === "bigint"]);

    // 3. Profile registries respond.
    const pp = await hre.ethers.getContractAt("PosterProfileRegistry", C.posterProfileRegistry.address);
    const cp = await hre.ethers.getContractAt("ChallengerProfileRegistry", C.challengerProfileRegistry.address);
    checks.push(["PosterProfileRegistry.entryCount", typeof (await pp.entryCount()) === "bigint"]);
    checks.push(["ChallengerProfileRegistry.entryCount", typeof (await cp.entryCount()) === "bigint"]);

    // 4. ManualJudgeV6 is active.
    const mj = await hre.ethers.getContractAt("ManualJudgeV6", C.manualJudgeV6.address);
    const active = await mj.active();
    const operator = await mj.operator();
    checks.push(["ManualJudgeV6.active == true", active === true]);
    checks.push(["ManualJudgeV6.operator matches record", operator.toLowerCase() === record.manualJudgeOperator.toLowerCase()]);

    // 5. OfficialBondDirectory has the approved token enabled.
    const dir = await hre.ethers.getContractAt("OfficialBondDirectory", C.officialBondDirectory.address);
    try {
        const entry = await dir.getToken(record.approvedToken);
        checks.push(["OfficialBondDirectory.getToken(approvedToken).enabled", entry.enabled === true]);
    } catch (e) {
        checks.push(["OfficialBondDirectory.getToken call", `ERR ${e.message.slice(0, 80)}`]);
    }

    // 6. APPROVED_TOKEN has bytecode.
    const code = await hre.ethers.provider.getCode(record.approvedToken);
    checks.push(["APPROVED_TOKEN has bytecode on chain", code !== "0x"]);

    // Report.
    let allOk = true;
    for (const [name, result] of checks) {
        const ok = result === true;
        if (!ok) allOk = false;
        console.log(`${ok ? "PASS" : "FAIL"}  ${name}${typeof result === "string" ? "  -> " + result : ""}`);
    }
    console.log(``);
    if (!allOk) {
        console.log("Some checks failed.");
        process.exit(1);
    }
    console.log(`All ${checks.length} checks passed. Deployment looks healthy.`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { main };
