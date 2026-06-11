// REAL parse gate for the page's inline <script> (the blob that string-grep
// "surface" tests never execute). A duplicate `const` / stray bracket / any
// load-time SyntaxError blanks the whole dapp; this catches that class in ms by
// running `node --check` on every inline script in both mirrored HTML files.
//
// Regression origin: 2026-06-11 a duplicate `const isV7` (added 04:52 in the
// release-hardening commit, colliding with one from 06-05) shipped to
// bond.futarchy.ai behind "1168 passing" + a cached "e2e ✅" — because NOTHING
// parsed the inline script. This test is that missing gate.
const { expect } = require("chai");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

describe("frontend inline <script> parse gate", function () {
  this.timeout(20000);

  it("every inline page script in index.html + v6/index.html parses (no load-time SyntaxError)", () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "check-inline-scripts.mjs")], {
      cwd: ROOT,
      encoding: "utf8",
    });
    // On failure, surface the parser's own message (file + line + error) so the
    // suite output points straight at the offending construct.
    if (r.status !== 0) throw new Error("inline script parse gate FAILED:\n" + r.stdout + r.stderr);
    expect(r.status).to.equal(0);
    expect(r.stdout).to.match(/0 failure\(s\)/);
  });
});
