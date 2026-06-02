// Tests for the guardrail linter (scripts/lint-guardrails.mjs). Proves the
// linter actually catches each banned pattern AND that the live tree passes
// its own baseline — so the gate is real, not theater.
const { expect } = require("chai");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const LINTER = path.join(ROOT, "scripts", "lint-guardrails.mjs");

// Invoke the linter's pure core in a child node process (it's an ESM module).
function lint(file, text) {
  const src = `
    import { lintSource } from ${JSON.stringify(LINTER)};
    const v = lintSource(${JSON.stringify(file)}, ${JSON.stringify(text)});
    process.stdout.write(JSON.stringify(v.map(x => x.rule).sort()));
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", src], {
    cwd: ROOT, encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`lint child failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

describe("guardrail linter", function () {
  this.timeout(20000);

  it("G1 — flags empty/no-op catch and .catch(()=>literal)", () => {
    expect(lint("backend/x.mjs", "try { f() } catch (e) {}")).to.include("G1");
    expect(lint("backend/x.mjs", "p().catch(() => [])")).to.include("G1");
  });

  it("G2 — flags a fabricated 1:1 sUSDS rate literal", () => {
    expect(lint("backend/x.mjs", "const r = { sharesPerAsset: 1, assetsPerShare: 1, decimals: 18 };"))
      .to.include("G2");
  });

  it("G3 — flags a signer-bound contract outside a write factory", () => {
    expect(lint("frontend/index.html", "<script>\nfunction wild(){ return new ethers.Contract(a, abi, signer); }\n</script>"))
      .to.include("G3");
  });

  it("G3 — exempts the sanctioned write factories", () => {
    expect(lint("frontend/index.html", "<script>\nfunction writeContract(a,abi){ return new ethers.Contract(a, abi, signer); }\n</script>"))
      .to.not.include("G3");
  });

  it("G4 — flags direct getLogs/queryFilter in the frontend outside queryFilterChunked", () => {
    expect(lint("frontend/index.html", "<script>\nfunction load(){ return bc.queryFilter(f, 0); }\n</script>"))
      .to.include("G4");
    expect(lint("frontend/index.html", "<script>\nfunction queryFilterChunked(){ return c.queryFilter(f, lo, hi); }\n</script>"))
      .to.not.include("G4");
  });

  it("the live tree passes its own baseline (the gate is green)", () => {
    const r = spawnSync(process.execPath, [LINTER], { cwd: ROOT, encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });
});
