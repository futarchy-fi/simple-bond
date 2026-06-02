// Tier (e): the backend boot guard. Proves a dangerous misconfig is flagged
// (and fatal in prod) while the healthy live config passes.
const { expect } = require("chai");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

function runEsm(src, env = {}) {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", src], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env },
  });
  return r;
}

describe("backend boot preflight", function () {
  this.timeout(15000);

  it("flags no-v6-chain, startBlock 0, and default HMAC as hard issues", () => {
    const src = `
      import { collectConfigIssues } from './backend/preflight.mjs';
      const r1 = collectConfigIssues({});                       // no chains
      const r2 = collectConfigIssues({ 1: { bondVersion: 6, startBlock: 0, rpc: 'https://x' } });
      console.log(JSON.stringify({ noChain: r1.hard.length, zeroStart: r2.hard.some(h=>/startBlock/.test(h)) }));
    `;
    const r = runEsm(src);
    expect(r.status, r.stderr).to.equal(0);
    const out = JSON.parse(r.stdout.trim().split("\n").pop());
    expect(out.noChain).to.be.greaterThan(0);
    expect(out.zeroStart).to.equal(true);
  });

  it("flags an unkeyed free RPC as a soft (warning) issue, not hard", () => {
    const src = `
      import { collectConfigIssues } from './backend/preflight.mjs';
      const r = collectConfigIssues({ 1: { bondVersion: 6, startBlock: 100, rpc: 'https://ethereum-rpc.publicnode.com' } });
      console.log(JSON.stringify({ soft: r.soft.length, hard: r.hard.length }));
    `;
    // Non-default HMAC so only the RPC check is exercised.
    const r = runEsm(src, { BOND_NOTIFY_HMAC_SECRET: "test-secret-not-default" });
    const out = JSON.parse(r.stdout.trim().split("\n").pop());
    expect(out.soft).to.be.greaterThan(0);
    expect(out.hard).to.equal(0);
  });

  it("exits non-zero in production on a hard misconfig", () => {
    const src = `
      import { assertBootConfig } from './backend/preflight.mjs';
      assertBootConfig({ chains: {}, env: { BOND_NOTIFY_ENV: 'production' } });
      console.log('SHOULD_NOT_REACH');
    `;
    const r = runEsm(src);
    expect(r.status).to.not.equal(0);
    expect(r.stdout).to.not.match(/SHOULD_NOT_REACH/);
  });

  it("does NOT exit in dev (warnings only) even with a hard misconfig", () => {
    const src = `
      import { assertBootConfig } from './backend/preflight.mjs';
      const { hard } = assertBootConfig({ chains: {}, env: {}, exit: true });
      console.log('REACHED hard=' + hard.length);
    `;
    const r = runEsm(src);
    expect(r.status, r.stderr).to.equal(0);
    expect(r.stdout).to.match(/REACHED hard=/);
  });
});
