const { expect } = require("chai");
const { readFileSync } = require("fs");
const { resolve } = require("path");
const { ethers } = require("ethers");

// USD-consistency unit test (unit-drift fix).
//
// The same bond MUST read the identical USD amount in the Browse row, the
// My-Bonds row, and the bond detail page. Every one of those views formats a
// bond's sUSDS BigInt through the single canonical formatter
// `susdsBigIntToUsdString(amount, rate)`. So if we pin that ONE function's
// behaviour for a given (amount, rate), we have pinned what all three views
// show — they cannot drift as long as none of them goes back to a raw-units
// formatter (fmtUnits) for a bond amount.
//
// The local MockSUSDS used by the e2e harness is hard-pinned 1:1, so a non-1:1
// sUSDS->USD conversion (where raw shares differ from dollars) can ONLY be
// exercised here, not in e2e. We use assetsPerShare ~= 1.098 so 10 sUSDS shares
// render as ~$10.98 — clearly different from the raw "10" a fmtUnits view showed.

const INDEX_HTML = resolve(__dirname, "..", "..", "frontend", "index.html");
const V6_HTML = resolve(__dirname, "..", "..", "frontend", "v6", "index.html");

// Pull a top-level `function NAME(...) { ... }` definition out of the inline
// <script>. We first skip the parameter list (paren-matched, so destructuring
// params like `{ id, b }` don't confuse us), then brace-match the body.
function extractFunction(html, name) {
  const sig = `function ${name}(`;
  const start = html.indexOf(sig);
  if (start === -1) throw new Error(`function ${name} not found`);
  // Skip the parameter list by matching the opening paren of the signature.
  const parenStart = start + sig.length - 1;
  let pdepth = 0;
  let bodyBrace = -1;
  for (let i = parenStart; i < html.length; i++) {
    const ch = html[i];
    if (ch === "(") pdepth++;
    else if (ch === ")") {
      pdepth--;
      if (pdepth === 0) {
        bodyBrace = html.indexOf("{", i);
        break;
      }
    }
  }
  if (bodyBrace === -1) throw new Error(`could not locate body of ${name}`);
  let depth = 0;
  for (let i = bodyBrace; i < html.length; i++) {
    const ch = html[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

// Build a live, callable copy of a pure formatter from the HTML source, with
// `ethers` injected (the function references `ethers.formatUnits`). This runs
// the REAL production code, not a re-implementation.
function loadFormatter(html, name) {
  const src = extractFunction(html, name);
  // eslint-disable-next-line no-new-func
  const factory = new Function("ethers", `${src}; return ${name};`);
  return factory(ethers);
}

describe("USD consistency across Browse / My-Bonds / detail", function () {
  const indexHtml = readFileSync(INDEX_HTML, "utf8");
  const v6Html = readFileSync(V6_HTML, "utf8");

  const fmtUsd = loadFormatter(indexHtml, "susdsBigIntToUsdString");

  // assetsPerShare ~ 1.098: 1 sUSDS share is worth ~$1.098, so the USD figure
  // is intentionally NOT equal to the raw share count.
  const nonUnityRate = { assetsPerShare: 1.098, sharesPerAsset: 1 / 1.098, decimals: 18 };
  const unavailableRate = { unavailable: true, decimals: 18 };

  it("converts a sUSDS BigInt to USD using a NON-1:1 rate (not the raw share count)", function () {
    // 10 sUSDS shares (10e18) at 1.098 assets/share => 10.98 dollars.
    const tenShares = ethers.parseUnits("10", 18);
    const usd = fmtUsd(tenShares, nonUnityRate);

    // The canonical formatter rounds to 2 dp: 10 * 1.098 = 10.98.
    expect(usd).to.equal("10.98");
    // And it is explicitly NOT the raw-units string a fmtUnits() view showed.
    const rawUnits = parseFloat(ethers.formatUnits(tenShares, 18))
      .toLocaleString(undefined, { maximumFractionDigits: 4 });
    expect(rawUnits).to.equal("10");
    expect(usd).to.not.equal(rawUnits);
  });

  it("produces the value every view renders for the same bond+rate (single source of truth)", function () {
    // Whatever a bond's bondAmount/challengeAmount is, Browse, My-Bonds, and the
    // detail page all pass it through THIS function with the resolved rate, so
    // this one expectation is what all three must show.
    const bondAmount = ethers.parseUnits("123.456789", 18);
    const expected = fmtUsd(bondAmount, nonUnityRate);
    // 123.456789 * 1.098 = 135.5555... -> rounds to 135.56.
    expect(expected).to.equal("135.56");

    // The v6 mirror's formatter must agree byte-for-byte (the two files are
    // kept in sync; a divergence here would mean a bond reads differently on v6).
    const fmtUsdV6 = loadFormatter(v6Html, "susdsBigIntToUsdString");
    expect(fmtUsdV6(bondAmount, nonUnityRate)).to.equal(expected);
  });

  it("returns the SHARED placeholder when the rate is unavailable (no raw fallback)", function () {
    const amount = ethers.parseUnits("10", 18);
    // Every view shows the SAME '—' placeholder on a rate miss — never a raw
    // sUSDS number in one place and '—' in another.
    expect(fmtUsd(amount, unavailableRate)).to.equal("—");
    expect(fmtUsd(amount, null)).to.equal("—");
    expect(fmtUsd(amount, undefined)).to.equal("—");
  });

  it("formats zero as a real USD figure, not the placeholder", function () {
    expect(fmtUsd(0n, nonUnityRate)).to.equal("0.00");
  });

  it("risk/reward 'if you win' and 'your risk' use the same USD basis as the belief card", function () {
    // The risk/reward card derives its dollar figures from the SAME
    // bondAmount/challengeAmount/judgeFee the belief card uses, formatted via the
    // canonical formatter. winAmount = (bondAmount - judgeFee) + challengeAmount.
    const bondAmount = ethers.parseUnits("100", 18);
    const challengeAmount = ethers.parseUnits("50", 18);
    const judgeFee = ethers.parseUnits("5", 18);
    const winAmount = bondAmount - judgeFee + challengeAmount; // 145 shares

    // What riskRewardHtml now renders for "if you win" / "your risk".
    expect(fmtUsd(winAmount, nonUnityRate)).to.equal("159.21"); // 145 * 1.098
    expect(fmtUsd(challengeAmount, nonUnityRate)).to.equal("54.90"); // 50 * 1.098
  });

  it("My-Bonds rows and the risk/reward card no longer use the raw-units formatter for bond amounts", function () {
    // Guard against regressing to fmtUnits for bond amounts in these views.
    // My-Bonds row markup must route bond/challenge through susdsBigIntToUsdString.
    const myRow = extractFunction(indexHtml, "myRowHtml");
    expect(myRow, "My-Bonds row must use the canonical USD formatter").to.match(
      /susdsBigIntToUsdString\(b\.bondAmount/);
    expect(myRow).to.match(/susdsBigIntToUsdString\(b\.challengeAmount/);
    expect(myRow, "My-Bonds row must not show raw sUSDS via fmtUnits").to.not.match(
      /fmtUnits\(/);

    const rr = extractFunction(indexHtml, "riskRewardHtml");
    expect(rr, "risk/reward must use the canonical USD formatter").to.include(
      "susdsBigIntToUsdString");
    expect(rr, "risk/reward must not show raw sUSDS via fmtUnits").to.not.match(
      /fmtUnits\(/);

    // And the v6 mirror must match on both counts.
    const myRowV6 = extractFunction(v6Html, "myRowHtml");
    expect(myRowV6).to.match(/susdsBigIntToUsdString\(b\.bondAmount/);
    expect(myRowV6).to.not.match(/fmtUnits\(/);
    const rrV6 = extractFunction(v6Html, "riskRewardHtml");
    expect(rrV6).to.include("susdsBigIntToUsdString");
    expect(rrV6).to.not.match(/fmtUnits\(/);
  });
});
