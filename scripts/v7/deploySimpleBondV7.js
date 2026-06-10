// Deploy ONLY SimpleBondV7, reusing the existing v0.6 registries/judge/token on
// the target network (from deployments/<network>.json). v0.7 is a new bond core
// that snapshots judge profiles from the SAME JudgeProfileRegistryV6, so no new
// registries are needed. Writes deployments/<network>-v7.json.
//
//   npx hardhat run scripts/v7/deploySimpleBondV7.js --network sepolia
//
// Safety: refuses to send if the deployer balance does not cover the estimated
// deploy cost with a 15% margin (avoids a mid-deploy out-of-gas that burns funds).

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function recordName(chainId) {
  if (chainId === 11155111) return "sepolia.json";
  if (chainId === 1) return "mainnet.json";
  return `chain${chainId}.json`;
}

async function main() {
  const net = hre.network.name;
  const chainId = hre.network.config.chainId;
  const dir = path.resolve(__dirname, "..", "..", "deployments");
  const recPath = path.join(dir, recordName(chainId));
  if (!fs.existsSync(recPath)) throw new Error(`No deployment record ${recPath} — need the v6 stack first`);
  const rec = JSON.parse(fs.readFileSync(recPath, "utf8"));

  // Overwrite guard (audit AUDIT-v7 §6 TD0): a re-run would silently clobber the
  // canonical record of an already-live core. Require an explicit FORCE, and even
  // then keep a timestamped backup of the old record. Checked BEFORE deploying so
  // a refusal doesn't waste a deploy.
  const outPath = path.join(dir, recordName(chainId).replace(".json", "-v7.json"));
  if (fs.existsSync(outPath)) {
    if (process.env.FORCE_V7_RECORD !== "1") {
      const prev = JSON.parse(fs.readFileSync(outPath, "utf8"));
      throw new Error(`RECORD-EXISTS: ${outPath} already records SimpleBondV7 ${prev.contracts?.simpleBondV7?.address}. Re-deploying replaces the canonical staging core. Set FORCE_V7_RECORD=1 to proceed (old record will be backed up).`);
    }
    const bak = outPath.replace(/\.json$/, `.bak-${Date.now()}.json`);
    fs.copyFileSync(outPath, bak);
    console.log(`FORCE_V7_RECORD=1: backed up existing record to ${bak}`);
  }

  const registry = rec.contracts?.judgeProfileRegistry?.address;
  if (!registry) throw new Error("No judgeProfileRegistry in the record to reuse");
  const directory = rec.contracts?.officialBondDirectory?.address;
  if (!directory) throw new Error("No officialBondDirectory in the record to reuse (v0.7 createBond gates on directory.hasToken)");

  // V7-1 pre-flight: the directory MUST already curate the approved token, or every
  // createBond on the new core would revert "Token not approved". Fail closed here.
  const dirContract = await hre.ethers.getContractAt("OfficialBondDirectory", directory);
  const approved = rec.approvedToken;
  if (!approved) throw new Error("No approvedToken in the record to pre-flight the directory gate");
  if (!(await dirContract.hasToken(approved))) {
    throw new Error(`DIRECTORY-GATE-BLOCKED: directory ${directory} has no token entry for approvedToken ${approved}. Register it (setToken) before deploying v0.7.`);
  }

  const [deployer] = await hre.ethers.getSigners();
  const prov = hre.ethers.provider;
  const bal = await prov.getBalance(deployer.address);

  const F = await hre.ethers.getContractFactory("SimpleBondV7");
  const deployTx = await F.getDeployTransaction(registry, directory);
  const gas = await prov.estimateGas({ from: deployer.address, data: deployTx.data });
  const fee = await prov.getFeeData();
  const price = fee.maxFeePerGas || fee.gasPrice;
  const est = gas * price;
  const need = (est * 115n) / 100n;
  console.log(`Network ${net} (chainId ${chainId})`);
  console.log(`Deployer ${deployer.address}  balance ${hre.ethers.formatEther(bal)} ETH`);
  console.log(`Reusing JudgeProfileRegistryV6 ${registry}`);
  console.log(`Reusing OfficialBondDirectory ${directory} (hasToken(${approved}) ✅)`);
  console.log(`Estimated deploy: gas ${gas} @ ${hre.ethers.formatUnits(price, "gwei")} gwei = ${hre.ethers.formatEther(est)} ETH (need ${hre.ethers.formatEther(need)} w/ margin)`);
  if (bal < need) {
    throw new Error(`GAS-BLOCKED: balance ${hre.ethers.formatEther(bal)} < ${hre.ethers.formatEther(need)} ETH needed. Fund the deployer with Sepolia ETH and retry.`);
  }

  console.log("Deploying SimpleBondV7…");
  const c = await F.deploy(registry, directory);
  await c.waitForDeployment();
  const addr = await c.getAddress();
  const block = (await c.deploymentTransaction().wait()).blockNumber;
  console.log(`SimpleBondV7 deployed at ${addr} (block ${block})`);

  const out = {
    chainId, network: net, deployer: deployer.address,
    approvedToken: rec.approvedToken,
    reusedFromV6: {
      judgeProfileRegistry: registry,
      officialBondDirectoryAsConstructorDep: directory,
      posterProfileRegistry: rec.contracts?.posterProfileRegistry?.address,
      challengerProfileRegistry: rec.contracts?.challengerProfileRegistry?.address,
      manualJudgeV6: rec.contracts?.manualJudgeV6?.address,
      officialBondDirectory: rec.contracts?.officialBondDirectory?.address,
    },
    contracts: { simpleBondV7: { address: addr, blockNumber: block } },
  };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${outPath}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
