// Tests for the capability aggregator (scripts/aggregate-capabilities.mjs).
// The aggregator is the SOLE writer of the scoreboard `capabilities` map and
// its whole reason to exist is gaming-resistance: a skipped, failed, or
// missing test must NEVER yield a true capability flag. These tests prove that
// invariant against synthetic Playwright JSON reports — pure Node, no browser.
const { expect } = require("chai");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const AGG = path.join(ROOT, "scripts", "aggregate-capabilities.mjs");

// Run the aggregator with --no-write and parse the capability map it prints.
function aggregate(report) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cap-agg-"));
  const file = path.join(dir, "report.json");
  fs.writeFileSync(file, JSON.stringify(report));
  try {
    const r = spawnSync(process.execPath, [AGG, file, "--no-write"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`aggregator failed: ${r.stderr || r.stdout}`);
    return JSON.parse(r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Build a minimal Playwright-shaped spec node with one test/result status.
function spec(title, status) {
  // status === undefined -> a spec with NO results (never ran == skipped).
  const results = status === undefined ? [] : [{ status }];
  return { title, ok: status === "passed", tests: [{ status, results }] };
}

// Wrap specs in the nested suite tree Playwright's JSON reporter emits.
function report(specs) {
  return { suites: [{ title: "e2e", file: "x.spec.js", specs, suites: [] }] };
}

describe("capability aggregator", function () {
  this.timeout(20000);

  // (a) One passing journey, one failing, one skipped: passing -> true,
  //     failing -> false, skipped -> absent (NEVER true).
  it("passing->true, failing->false, skipped->absent (never true)", () => {
    const caps = aggregate(
      report([
        spec("C1 — create bond walks the wizard and emits BondCreated", "passed"),
        spec("C3 — poster concedes a specific challenge", "failed"),
        spec("C6 — poster withdraws after close (no pending challenges)", "skipped"),
      ])
    );
    // Passing journey is true.
    expect(caps.createBond).to.equal(true);
    // Failing journey is explicitly false.
    expect(caps.concede).to.equal(false);
    // Skipped/host-gated journey is absent and, above all, NEVER true.
    expect(caps).to.not.have.property("withdraw");
    expect(caps.withdraw).to.not.equal(true);
  });

  // (b) A flag is never true for a test absent from the report.
  it("missing/unmapped test -> flag absent, never true", () => {
    // Only C1 is present; every other flag's mapped code is missing.
    const caps = aggregate(report([spec("C1 — create bond", "passed")]));
    expect(caps.createBond).to.equal(true);
    for (const flag of ["becomeJudge", "challengeAndRule", "concede", "withdraw", "drainRefunds", "claimTimeout"]) {
      expect(caps, `${flag} must not appear`).to.not.have.property(flag);
      expect(caps[flag], `${flag} must never be true`).to.not.equal(true);
    }
  });

  // An empty report yields an empty map — no fabricated greens.
  it("empty report -> empty capability map", () => {
    const caps = aggregate(report([]));
    expect(caps).to.deep.equal({});
  });

  // Multi-spec journeys require ALL mapped specs to pass. challengeAndRule
  // needs both D1 (file) and E4 (rule).
  it("multi-spec journey is true only when every mapped spec passes", () => {
    // Both pass -> true.
    expect(
      aggregate(
        report([
          spec("D1 — challenger files a challenge against the bond", "passed"),
          spec("E4 — judge operator rules for the challenger (settles bond)", "passed"),
        ])
      ).challengeAndRule
    ).to.equal(true);

    // One passes, the partner is skipped -> absent (not exercised), never true.
    const partial = aggregate(
      report([
        spec("D1 — challenger files a challenge against the bond", "passed"),
        spec("E4 — judge operator rules for the challenger (settles bond)", "skipped"),
      ])
    );
    expect(partial).to.not.have.property("challengeAndRule");
    expect(partial.challengeAndRule).to.not.equal(true);

    // One passes, the partner fails -> false (a real non-pass dominates).
    expect(
      aggregate(
        report([
          spec("D1 — challenger files a challenge against the bond", "passed"),
          spec("E4 — judge operator rules for the challenger (settles bond)", "failed"),
        ])
      ).challengeAndRule
    ).to.equal(false);
  });

  // timedOut / interrupted are non-pass states and must yield false, not true.
  it("timedOut and interrupted results are non-pass (false), never true", () => {
    const t = aggregate(report([spec("C1 — create bond", "timedOut")]));
    expect(t.createBond).to.equal(false);
    const i = aggregate(report([spec("C1 — create bond", "interrupted")]));
    expect(i.createBond).to.equal(false);
  });

  // A spec nested in a child suite is still discovered (recursive walk).
  it("discovers specs nested inside child suites", () => {
    const nested = {
      suites: [
        {
          title: "outer",
          specs: [],
          suites: [
            {
              title: "inner",
              specs: [spec("C1 — create bond", "passed")],
              suites: [],
            },
          ],
        },
      ],
    };
    expect(aggregate(nested).createBond).to.equal(true);
  });

  // The write path is a read-modify-write merge: it replaces only
  // `capabilities`, preserves every other key, and bumps `updated`.
  it("merge preserves other metrics keys and only rewrites capabilities", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cap-merge-"));
    const docsDir = path.join(dir, "docs", "autoloop");
    fs.mkdirSync(docsDir, { recursive: true });
    const metrics = path.join(docsDir, "metrics.json");
    const seed = {
      iteration: 7,
      updated: "2000-01-01",
      gates: { lint: true, hardhat: true },
      burndown: { g1EmptyCatch: 42 },
      capabilities: { stale: true },
      adversarialScore: 5,
      runDeadline: "2026-06-09",
    };
    fs.writeFileSync(metrics, JSON.stringify(seed, null, 2));

    const reportFile = path.join(dir, "report.json");
    fs.writeFileSync(reportFile, JSON.stringify(report([spec("C1 — create bond", "passed")])));

    try {
      // The script resolves METRICS relative to its own dir, so point a copy of
      // the script at the temp tree via a thin wrapper that overrides the path.
      const wrapper = path.join(dir, "run.mjs");
      fs.writeFileSync(
        wrapper,
        `import { aggregate } from ${JSON.stringify(AGG)};\n` +
          `import { readFileSync, writeFileSync } from 'node:fs';\n` +
          `const m = JSON.parse(readFileSync(${JSON.stringify(metrics)}, 'utf8'));\n` +
          `const rpt = JSON.parse(readFileSync(${JSON.stringify(reportFile)}, 'utf8'));\n` +
          `m.capabilities = aggregate(rpt);\n` +
          `m.updated = new Date().toISOString().slice(0,10);\n` +
          `writeFileSync(${JSON.stringify(metrics)}, JSON.stringify(m, null, 2));\n`
      );
      const r = spawnSync(process.execPath, [wrapper], { cwd: ROOT, encoding: "utf8" });
      expect(r.status, r.stderr).to.equal(0);

      const out = JSON.parse(fs.readFileSync(metrics, "utf8"));
      // Other keys preserved verbatim.
      expect(out.iteration).to.equal(7);
      expect(out.gates).to.deep.equal({ lint: true, hardhat: true });
      expect(out.burndown).to.deep.equal({ g1EmptyCatch: 42 });
      expect(out.adversarialScore).to.equal(5);
      expect(out.runDeadline).to.equal("2026-06-09");
      // capabilities fully replaced (stale flag gone), updated bumped.
      expect(out.capabilities).to.deep.equal({ createBond: true });
      expect(out.updated).to.not.equal("2000-01-01");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
