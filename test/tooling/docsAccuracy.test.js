// Doc-as-test: fail the build if the prose docs drift from the deployed reality.
//
// This closes RCA gap #7 — the I11 prose-drift class where the README claimed the
// wrong live version (e.g. "v0.7 live on mainnet" before any mainnet cutover, or a
// stale bondVersion/address after a runtime-config change). Pure Node + chai, no
// browser: we load frontend/runtime-config.js in a vm sandbox with a fake `window`
// and NO `location`, so the hostname-filtering IIFE leaves BOTH chains intact and we
// read the authoritative, unfiltered config. We then assert the docs agree with BOTH
// the runtime-config AND the deployments/*.json records.
//
// Ground truth as of the v0.7 staging cutover (2026-06-05):
//   - Mainnet (chain 1)        -> SimpleBondV6, bondVersion 6 (what bond.futarchy.ai serves)
//   - Sepolia (chain 11155111) -> SimpleBondV7, bondVersion 7 (what staging.* serves)
//   - Mainnet v0.7 cutover is NOT done (a separate later gate).

const { expect } = require("chai");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");

const ROOT = resolve(__dirname, "..", "..");
const RUNTIME_CONFIG = resolve(ROOT, "frontend", "runtime-config.js");
const MAINNET_JSON = resolve(ROOT, "deployments", "mainnet.json");
const SEPOLIA_V7_JSON = resolve(ROOT, "deployments", "sepolia-v7.json");
const README = resolve(ROOT, "README.md");
const CHANGELOG = resolve(ROOT, "CHANGELOG.md");
const SPEC_V07 = resolve(ROOT, "SPEC_V07.md");

const MAINNET_ID = 1;
const SEPOLIA_ID = 11155111;

// Load runtime-config.js for real (not via regex) so we test the actual values the
// app ships, not whatever the prose copied. No `location` is provided, so the
// hostname IIFE hits its `else` branch and keeps every chain (no deletions).
function loadRuntimeConfig() {
  const src = readFileSync(RUNTIME_CONFIG, "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "runtime-config.js" });
  const cfg = sandbox.window.SIMPLE_BOND_CONFIG;
  if (!cfg || !cfg.chains) throw new Error("runtime-config did not define SIMPLE_BOND_CONFIG.chains");
  return cfg;
}

const cfg = loadRuntimeConfig();
const mainnetDeploy = JSON.parse(readFileSync(MAINNET_JSON, "utf8"));
const sepoliaDeploy = JSON.parse(readFileSync(SEPOLIA_V7_JSON, "utf8"));
const readme = readFileSync(README, "utf8");
const changelog = readFileSync(CHANGELOG, "utf8");

const lc = (s) => String(s).toLowerCase();
const eqAddr = (a, b) => lc(a) === lc(b);

describe("docs accuracy (doc-as-test, RCA gap #7 / I11 prose-drift)", function () {
  // --- runtime-config is internally what the docs claim --------------------

  it("runtime-config: mainnet (chain 1) is bondVersion 6, Sepolia (11155111) is bondVersion 7", function () {
    expect(cfg.chains[MAINNET_ID], "chains[1] present").to.be.an("object");
    expect(cfg.chains[SEPOLIA_ID], "chains[11155111] present").to.be.an("object");
    expect(cfg.chains[MAINNET_ID].bondVersion, "mainnet bondVersion").to.equal(6);
    expect(cfg.chains[SEPOLIA_ID].bondVersion, "sepolia bondVersion").to.equal(7);
  });

  // --- runtime-config vs the deployments record (drift catcher) ------------
  // These FAIL if someone edits a bondContract/address in runtime-config without
  // updating the deployments record (or vice versa) — the exact silent drift the
  // task asks us to guard.

  it("runtime-config mainnet bondContract === deployments/mainnet.json simpleBondV6.address", function () {
    const fromConfig = cfg.chains[MAINNET_ID].bondContract;
    const fromDeploy = mainnetDeploy.contracts.simpleBondV6.address;
    expect(
      eqAddr(fromConfig, fromDeploy),
      `mainnet bondContract drift: runtime-config ${fromConfig} vs deployments/mainnet.json ${fromDeploy}`
    ).to.equal(true);
  });

  it("runtime-config Sepolia bondContract === deployments/sepolia-v7.json simpleBondV7.address", function () {
    const fromConfig = cfg.chains[SEPOLIA_ID].bondContract;
    const fromDeploy = sepoliaDeploy.contracts.simpleBondV7.address;
    expect(
      eqAddr(fromConfig, fromDeploy),
      `Sepolia bondContract drift: runtime-config ${fromConfig} vs deployments/sepolia-v7.json ${fromDeploy}`
    ).to.equal(true);
  });

  it("deployments records carry the chainIds the docs claim", function () {
    expect(mainnetDeploy.chainId, "mainnet.json chainId").to.equal(MAINNET_ID);
    expect(sepoliaDeploy.chainId, "sepolia-v7.json chainId").to.equal(SEPOLIA_ID);
    // The Sepolia v7 record must actually be a V7 record (a simpleBondV7 key), not a V6 one.
    expect(sepoliaDeploy.contracts, "sepolia-v7.json contracts").to.have.property("simpleBondV7");
  });

  // --- README must NOT prematurely claim v0.7 on mainnet -------------------
  // This is the headline anti-overclaim guard: any sentence putting v0.7 /
  // SimpleBondV7 / bondVersion 7 on Ethereum mainnet must fail.

  it("README does NOT claim v0.7 / SimpleBondV7 is on mainnet (anti-overclaim)", function () {
    const lines = readme.split("\n");
    // A line is a violation if it mentions a v0.7 token AND a mainnet token.
    const v7 = /\bv0\.7\b|simplebondv7|bondversion:?\s*7|bondversion\s*7/;
    const mainnetWord = /\bmainnet\b|ethereum mainnet|chain(?:id)?\s*1\b|chains\[1\]/;
    const offenders = [];
    lines.forEach((line, i) => {
      const L = lc(line);
      if (v7.test(L) && mainnetWord.test(L)) {
        // Allow lines that explicitly state v0.7 is NOT / not yet on mainnet, or
        // that the mainnet cutover is pending/separate/later — those are correct.
        const negated = /\bnot\b|\bn't\b|pending|separate later gate|not yet|later gate|stays on `?v0\.6/.test(L);
        if (!negated) offenders.push(`README.md:${i + 1}  ${line.trim()}`);
      }
    });
    expect(
      offenders,
      `README appears to claim v0.7 is live on mainnet (it is NOT — mainnet is v0.6):\n${offenders.join("\n")}`
    ).to.deep.equal([]);
  });

  it("README still affirms v0.6 IS live on mainnet (keeps the accurate claim)", function () {
    const L = lc(readme);
    expect(L).to.match(/v0\.6[\s\S]{0,80}live[\s\S]{0,80}mainnet|v0\.6.*mainnet/);
    expect(L, "README should name SimpleBondV6").to.include("simplebondv6");
  });

  // --- README must mention v0.7 on staging/Sepolia ------------------------

  it("README mentions v0.7 on staging / Sepolia and points to SPEC_V07.md", function () {
    const lines = readme.split("\n");
    const v7 = /\bv0\.7\b|simplebondv7/;
    const stagingWord = /\bsepolia\b|staging/;
    const hasV7Staging = lines.some((line) => {
      const L = lc(line);
      return v7.test(L) && stagingWord.test(L);
    });
    expect(hasV7Staging, "README should state v0.7 runs on staging/Sepolia").to.equal(true);
    expect(readme, "README should reference SPEC_V07.md").to.include("SPEC_V07.md");
  });

  it("README mentions the C1 + C2 mechanism summary for v0.7", function () {
    const L = lc(readme);
    expect(L, "README should mention C1").to.match(/\bc1\b/);
    expect(L, "README should mention C2").to.match(/\bc2\b/);
  });

  // --- README addresses agree with the live values ------------------------
  // Catches the case where the runtime-config / deployments address changes but
  // the README address table is left stale.

  it("README addresses table lists the live mainnet V6 and staging V7 bond addresses", function () {
    expect(
      readme,
      "README missing live mainnet SimpleBondV6 address"
    ).to.include(mainnetDeploy.contracts.simpleBondV6.address);
    expect(
      readme,
      "README missing staging Sepolia SimpleBondV7 address"
    ).to.include(sepoliaDeploy.contracts.simpleBondV7.address);
  });

  // --- CHANGELOG records the dated v0.7 staging cutover -------------------

  it("CHANGELOG notes the v0.7 staging/Sepolia deploy with a date", function () {
    const L = lc(changelog);
    expect(L, "CHANGELOG should mention v0.7").to.match(/\bv0\.7\b/);
    expect(L, "CHANGELOG should tie v0.7 to staging/Sepolia").to.match(/sepolia|staging/);
    expect(changelog, "CHANGELOG should carry a date for the v0.7 entry").to.match(/2026-06-05/);
  });

  it("CHANGELOG does NOT claim v0.7 is on mainnet", function () {
    const offenders = changelog.split("\n").filter((line) => {
      const L = lc(line);
      const v7 = /\bv0\.7\b|simplebondv7/;
      const mainnetWord = /\bmainnet\b|chain id 1\b|chain 1\b/;
      if (!(v7.test(L) && mainnetWord.test(L))) return false;
      const negated = /\bnot\b|stays on `?v0\.6|separate later gate|later gate/.test(L);
      return !negated;
    });
    expect(
      offenders,
      `CHANGELOG appears to claim v0.7 on mainnet:\n${offenders.join("\n")}`
    ).to.deep.equal([]);
  });

  // --- SPEC_V07.md exists and describes V7 as testnet-first / not-yet-mainnet

  it("SPEC_V07.md exists and frames v0.7 as testnet-first (not yet on mainnet)", function () {
    const spec = readFileSync(SPEC_V07, "utf8");
    const L = lc(spec);
    expect(L, "SPEC_V07 should name SimpleBondV7").to.include("simplebondv7");
    expect(
      L,
      "SPEC_V07 should frame v0.7 as testnet-first / mainnet a later gate"
    ).to.match(/testnet-first|separate later gate|before any\s*\n?\s*mainnet cutover|later gate/);
  });
});
