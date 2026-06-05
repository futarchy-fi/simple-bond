// Backlog #6: the synthetic monitor (scripts/monitor.mjs) probes ONE chain per run
// via CHAIN_ID. The v0.7 staging chain (Sepolia, 11155111) had no synthetic
// monitoring, and a Sepolia run would also false-alarm on its mock token / empty
// read-model. This pins the testable core: evaluateHealth() is a PURE per-chain
// evaluator (no network) so a stale Sepolia entry alerts even when mainnet (chain
// 1) in the SAME /health payload is green.
//
// monitor.mjs is ESM (.mjs) and import-safe (the live probes run only when invoked
// directly), so we load it via dynamic import (same pattern as the other backend
// tests).
const { expect } = require("chai");

let monitor;
before(async () => {
  monitor = await import("../../scripts/monitor.mjs");
});

describe("monitor evaluateHealth (backlog #6 — per-chain, Sepolia-safe)", function () {
  // One payload, two chains: mainnet healthy, Sepolia stale on all three axes.
  const HEALTH = {
    indexer: [
      { chainId: 1, blocksBehindHead: 5, deadLetters: 0, headAgeSeconds: 5, blockedFromBlock: null },
      { chainId: 11155111, blocksBehindHead: 5000, deadLetters: 2, headAgeSeconds: 9999, blockedFromBlock: 10994000 },
    ],
  };
  const OPTS = { lagThreshold: 200, tickThreshold: 180 };

  it("mainnet (chain 1) is GREEN — no alerts", function () {
    const r = monitor.evaluateHealth(HEALTH, { chainId: 1, ...OPTS });
    expect(r.alerts, `unexpected alerts: ${r.alerts.join("; ")}`).to.deep.equal([]);
    expect(r.oks.length).to.equal(3); // lag, dead-letters, tick all ok
  });

  it("Sepolia (11155111) ALERTS even though mainnet in the same payload is green", function () {
    const r = monitor.evaluateHealth(HEALTH, { chainId: 11155111, ...OPTS });
    expect(r.alerts.length).to.equal(3);
    const joined = r.alerts.join(" | ");
    expect(joined, "lag alert").to.match(/lag 5000 blocks > 200 \(chain 11155111\)/);
    expect(joined, "dead-letter alert").to.match(/dead-lettered range\(s\).*chain 11155111/);
    expect(joined, "tick alert").to.match(/tick age 9999s > 180s \(chain 11155111\)/);
  });

  it("a missing chain in the payload alerts (never silently passes)", function () {
    const r = monitor.evaluateHealth(HEALTH, { chainId: 999, ...OPTS });
    expect(r.alerts).to.deep.equal(["health has no indexer status for chain 999"]);
  });

  it("a never-ticked chain (null headAgeSeconds) is flagged stale", function () {
    const h = { indexer: [{ chainId: 1, blocksBehindHead: 1, deadLetters: 0, headAgeSeconds: null }] };
    const r = monitor.evaluateHealth(h, { chainId: 1, ...OPTS });
    expect(r.alerts.join(" | ")).to.match(/never ticked/);
  });

  it("isTickStale stays exported and correct (used by evaluateHealth)", function () {
    expect(monitor.isTickStale(9999, 180)).to.equal(true);
    expect(monitor.isTickStale(5, 180)).to.equal(false);
    expect(monitor.isTickStale(null, 180)).to.equal(true);
  });
});
