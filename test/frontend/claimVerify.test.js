// Unit tests for the pure claim-text ↔ on-chain claimHash verifier
// (frontend/claim-verify.js), security finding H3.

const { expect } = require("chai");
const { ethers } = require("ethers");
const { claimVerification } = require("../../frontend/claim-verify.js");

// The real hashing the browser uses (contract: keccak256(bytes(content))).
const hashFn = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const HASH = (s) => hashFn(s);

describe("claim-verify helper (pure)", function () {
  it("is importable and returns a stable shape", function () {
    expect(claimVerification).to.be.a("function");
    const out = claimVerification("hi", HASH("hi"), hashFn);
    expect(out).to.have.all.keys(["status", "computed"]);
  });

  it("verified: displayed text hashes to the on-chain claimHash", function () {
    const text = "Test bond for TGGP. Please reject this claim.";
    const r = claimVerification(text, HASH(text), hashFn);
    expect(r.status).to.equal("verified");
  });

  it("mismatch: displayed text does NOT match the on-chain hash (the H3 attack)", function () {
    const shown = "A benign-looking claim the indexer shows you.";
    const onchain = HASH("The REAL on-chain claim is something else entirely.");
    const r = claimVerification(shown, onchain, hashFn);
    expect(r.status).to.equal("mismatch");
  });

  it("match is case-insensitive on the hex", function () {
    const text = "case test";
    const r = claimVerification(text, HASH(text).toUpperCase().replace("0X", "0x"), hashFn);
    expect(r.status).to.equal("verified");
  });

  it("unknown: no claim text shown (nothing to mislead)", function () {
    expect(claimVerification("", HASH("x"), hashFn).status).to.equal("unknown");
    expect(claimVerification(null, HASH("x"), hashFn).status).to.equal("unknown");
  });

  it("unknown: no/invalid on-chain hash to compare against", function () {
    expect(claimVerification("text", "", hashFn).status).to.equal("unknown");
    expect(claimVerification("text", "0xnothex", hashFn).status).to.equal("unknown");
    expect(claimVerification("text", undefined, hashFn).status).to.equal("unknown");
  });

  it("unknown: a throwing/invalid hash function never throws out (fails safe to unknown, not verified)", function () {
    expect(claimVerification("text", HASH("text"), () => { throw new Error("boom"); }).status).to.equal("unknown");
    expect(claimVerification("text", HASH("text"), () => "not-a-hash").status).to.equal("unknown");
    expect(claimVerification("text", HASH("text"), undefined).status).to.equal("unknown");
  });

  it("never returns 'verified' for forged text even if hashes look similar", function () {
    // A near-miss hash (flip last nibble) must be a mismatch, not verified.
    const text = "claim";
    const h = HASH(text);
    const tampered = h.slice(0, -1) + (h.slice(-1) === "0" ? "1" : "0");
    expect(claimVerification(text, tampered, hashFn).status).to.equal("mismatch");
  });
});
