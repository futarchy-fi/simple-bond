// LIVE v0.7 capability journey against the deployed Sepolia SimpleBondV7.
//
//   npx hardhat run scripts/v7/liveJourneySepolia.js --network sepolia
//
// Drives the real v0.7 mechanism end-to-end on a live testnet with the funded
// deployer key (which is ALSO the active ManualJudgeV6 operator, so it can rule):
//   Setup : register a judge profile -> manualJudgeV6; mint+approve MockSUSDS.
//   Bond A: create -> self-challenge -> ruleForChallenger (judge) -> claim credit.  (judge ruling + C2)
//   Bond B: create -> self-challenge -> concede -> claim credit.                     (concede + C2)
//   Bond C: create -> withdrawBond.                                                  (clean poster exit)
// Reads all addresses from deployments/sepolia-v7.json. Prints every tx hash and
// asserts credit/balance deltas. Idempotent-friendly: each run uses fresh bondIds.
// Writes a machine-readable summary to deployments/sepolia-v7-journey.json.

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const ethers = hre.ethers;
const E = (n) => ethers.parseEther(String(n));
const fmt = (w) => ethers.formatEther(w);

async function txline(label, promise) {
  const tx = await promise;
  const rc = await tx.wait();
  console.log(`  ✓ ${label}  tx=${rc.hash}  gas=${rc.gasUsed}`);
  return rc;
}

async function main() {
  const net = hre.network.name;
  const chainId = hre.network.config.chainId;
  if (chainId !== 11155111) throw new Error(`Refusing to run: expected Sepolia (11155111), got ${chainId} (${net}). NEVER mainnet.`);

  const rec = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", "deployments", "sepolia-v7.json"), "utf8"));
  const BOND = rec.contracts.simpleBondV7.address;
  const REG = rec.reusedFromV6.judgeProfileRegistry;
  const JUDGE = rec.reusedFromV6.manualJudgeV6;
  const TOKEN = rec.approvedToken;

  const [signer] = await ethers.getSigners();
  const me = signer.address;
  const startBal = await ethers.provider.getBalance(me);
  console.log(`Network ${net} (chainId ${chainId})`);
  console.log(`Signer/poster/challenger/judge-operator: ${me}`);
  console.log(`ETH balance: ${fmt(startBal)}`);
  console.log(`SimpleBondV7 ${BOND}\nJudgeProfileRegistry ${REG}\nManualJudgeV6 ${JUDGE}\nMockSUSDS ${TOKEN}\n`);

  const bond = await ethers.getContractAt("SimpleBondV7", BOND, signer);
  const reg = await ethers.getContractAt("JudgeProfileRegistryV6", REG, signer);
  const judge = await ethers.getContractAt("ManualJudgeV6", JUDGE, signer);
  const token = await ethers.getContractAt("MockSUSDS", TOKEN, signer);

  // Preconditions
  const active = await judge.active();
  const operator = await judge.operator();
  if (!active) throw new Error("Judge not active — cannot validateBond");
  console.log(`Judge active=${active} operator=${operator} (operator is me: ${operator.toLowerCase() === me.toLowerCase()})\n`);

  const summary = { network: net, chainId, contract: BOND, signer: me, steps: [], bonds: {} };
  const stamp = (label, rc, extra = {}) => summary.steps.push({ label, tx: rc.hash, gas: rc.gasUsed.toString(), ...extra });

  // ── Setup: register a judge profile pointing at manualJudgeV6 ──────────────
  console.log("SETUP — register judge profile + mint/approve token");
  let rc = await txline("registerProfile(judge)", reg.registerProfile(JUDGE, "live-journey judge profile"));
  let profId;
  for (const lg of rc.logs) {
    try { const pl = reg.interface.parseLog(lg); if (pl && pl.name === "ProfileRegistered") { profId = pl.args.entryId; break; } } catch (_) {}
  }
  if (profId === undefined) throw new Error("Could not read judgeProfileId from ProfileRegistered");
  console.log(`  judgeProfileId = ${profId}`);
  stamp("registerProfile", rc, { judgeProfileId: profId.toString() });

  const MINT = E(1000);
  rc = await txline("MockSUSDS.mint(me, 1000)", token.mint(me, MINT));
  stamp("mint", rc);
  rc = await txline("approve(bond, 1000)", token.approve(BOND, MINT));
  stamp("approve", rc);

  const params = (acceptanceDelay) => [E(10), E(3), E("0.5"), JUDGE, acceptanceDelay, 3600, 10, profId];
  const tokenBalOf = async () => token.balanceOf(me);
  const creditOf = async () => bond.credits(me, TOKEN);
  // Sepolia public RPC pools can serve reads from a node lagging a block or two
  // behind a just-mined tx. Poll until the post-tx balance is visible rather than
  // asserting on a single (possibly stale) read.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const confirmIncrease = async (before, minDelta) => {
    for (let i = 0; i < 12; i++) {
      const now = await tokenBalOf();
      if (now - before >= minDelta) return now;
      await sleep(3000);
    }
    throw new Error(`balance did not increase by >= ${fmt(minDelta)} within ~36s (before ${fmt(before)})`);
  };

  // ── Bond A: create -> self-challenge -> ruleForChallenger -> claim ─────────
  console.log("\nBOND A — judge-ruling path (create -> challenge -> ruleForChallenger -> claim)");
  rc = await txline("createBond(A, acceptanceDelay=0)", bond.createBond(TOKEN, ...params(0), "live: claim A — judge rules for challenger"));
  const idA = (await bond.nextBondId()) - 1n;
  console.log(`  bondId A = ${idA}`);
  stamp("createBond.A", rc, { bondId: idA.toString() });
  rc = await txline("challenge(A)", bond.challenge(idA, await bond.bonds(idA).then(b => b.claimVersion), "live: challenge A"));
  stamp("challenge.A", rc);
  const beforeRuleCredit = await creditOf();
  rc = await txline("judge.ruleForChallenger(A, i=0, fee=0.5)", judge.ruleForChallenger(BOND, idA, 0, E("0.5"), "live: ruled for challenger"));
  stamp("ruleForChallenger.A", rc);
  const afterRuleCredit = await creditOf();
  console.log(`  credit after rule: ${fmt(afterRuleCredit)} (was ${fmt(beforeRuleCredit)}) — challenger credited via C2`);
  summary.bonds.A = { bondId: idA.toString(), creditAfterRule: fmt(afterRuleCredit) };
  // claim the credit
  const balBeforeClaimA = await tokenBalOf();
  rc = await txline("claim(token) [Bond A credit]", bond.claim(TOKEN));
  stamp("claim.A", rc);
  const balAfterClaimA = await confirmIncrease(balBeforeClaimA, E("12.5")); // 10 bond + 3 challenge - 0.5 fee
  console.log(`  token balance: ${fmt(balBeforeClaimA)} -> ${fmt(balAfterClaimA)} (+${fmt(balAfterClaimA - balBeforeClaimA)})`);
  summary.bonds.A.claimedDelta = fmt(balAfterClaimA - balBeforeClaimA);

  // ── Bond B: create -> self-challenge -> concede -> claim ───────────────────
  console.log("\nBOND B — concede path (create -> challenge -> concede -> claim)");
  rc = await txline("createBond(B, acceptanceDelay=600)", bond.createBond(TOKEN, ...params(600), "live: claim B — poster concedes"));
  const idB = (await bond.nextBondId()) - 1n;
  console.log(`  bondId B = ${idB}`);
  stamp("createBond.B", rc, { bondId: idB.toString() });
  rc = await txline("challenge(B)", bond.challenge(idB, await bond.bonds(idB).then(b => b.claimVersion), "live: challenge B"));
  stamp("challenge.B", rc);
  rc = await txline("concede(B, i=0)", bond.concede(idB, 0, "live: poster concedes B"));
  stamp("concede.B", rc);
  const creditAfterConcede = await creditOf();
  console.log(`  credit after concede: ${fmt(creditAfterConcede)} — challenger refunded via C2`);
  const balBeforeClaimB = await tokenBalOf();
  rc = await txline("claim(token) [Bond B credit]", bond.claim(TOKEN));
  stamp("claim.B", rc);
  const balAfterClaimB = await confirmIncrease(balBeforeClaimB, E("3")); // challenger's 3-token deposit refunded
  console.log(`  token balance: ${fmt(balBeforeClaimB)} -> ${fmt(balAfterClaimB)} (+${fmt(balAfterClaimB - balBeforeClaimB)})`);
  summary.bonds.B = { bondId: idB.toString(), creditAfterConcede: fmt(creditAfterConcede), claimedDelta: fmt(balAfterClaimB - balBeforeClaimB) };

  // ── Bond C: create -> withdrawBond (clean poster exit) ─────────────────────
  console.log("\nBOND C — clean poster exit (create -> withdrawBond)");
  rc = await txline("createBond(C, acceptanceDelay=0)", bond.createBond(TOKEN, ...params(0), "live: claim C — withdrawn unchallenged"));
  const idC = (await bond.nextBondId()) - 1n;
  console.log(`  bondId C = ${idC}`);
  stamp("createBond.C", rc, { bondId: idC.toString() });
  rc = await txline("closeBond(C)", bond.closeBond(idC));            // withdraw requires closed + 0 pending
  stamp("closeBond.C", rc);
  rc = await txline("withdrawBond(C)", bond.withdrawBond(idC));
  stamp("withdrawBond.C", rc);
  // v0.7 C2: withdrawBond CREDITS the poster (pull-payment) — claim to receive it.
  const creditAfterWithdraw = await creditOf();
  console.log(`  credit after withdraw: ${fmt(creditAfterWithdraw)} — poster's bond credited via C2`);
  const balBeforeClaimC = await tokenBalOf();
  rc = await txline("claim(token) [Bond C withdrawn bond]", bond.claim(TOKEN));
  stamp("claim.C", rc);
  const balAfterClaimC = await confirmIncrease(balBeforeClaimC, E("10")); // bondAmount returned to poster
  console.log(`  token balance: ${fmt(balBeforeClaimC)} -> ${fmt(balAfterClaimC)} (+${fmt(balAfterClaimC - balBeforeClaimC)})`);
  summary.bonds.C = { bondId: idC.toString(), claimedDelta: fmt(balAfterClaimC - balBeforeClaimC) };

  const endBal = await ethers.provider.getBalance(me);
  summary.gasSpentEth = fmt(startBal - endBal);
  summary.capabilities = { createBond: true, challenge: true, ruleForChallenger: true, concede: true, claim: true, withdrawBond: true };
  console.log(`\n✅ LIVE v0.7 JOURNEY COMPLETE on Sepolia. Gas spent: ${fmt(startBal - endBal)} ETH. Bonds: A=${idA} B=${idB} C=${idC}`);
  console.log(`Explorer: https://sepolia.etherscan.io/address/${BOND}`);

  const outPath = path.resolve(__dirname, "..", "..", "deployments", "sepolia-v7-journey.json");
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n");
  console.log(`Wrote ${outPath}`);
}

main().catch((e) => { console.error("JOURNEY FAILED:", e.message || e); process.exit(1); });
