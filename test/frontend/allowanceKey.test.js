// PRIMARY pure unit test for the allowance-cache key builder
// (frontend/allowance-key.js).
//
// RCA gap #5 — allowanceCache not keyed by account. The ERC-20 allowance cache
// was keyed only by `${token}:${spender}`, with NO account and NO chainId. But
// allowance() is read PER ACCOUNT on-chain, so connecting account A (which had
// approved the bond contract) then switching MetaMask to account B (which had
// NOT) served A's allowance under the shared key — the UI SKIPPED the Approve
// step and B's createBond/challenge REVERTED for insufficient allowance.
//
// allowanceKey({chainId, account, token, spender}) must build a key that
// uniquely identifies the (chainId, account, token, spender) tuple the allowance
// was actually read for, so a stored value can only ever be served back to the
// SAME account on the SAME chain. It is a DOM-free, chain-free, I/O-free pure
// function exercised directly here (no browser, no provider).
const { expect } = require("chai");
const { allowanceKey } = require("../../frontend/allowance-key.js");

// A pair of distinct, real-looking checksum-ish addresses (case varied on
// purpose to exercise the lowercasing).
const ACCT_A = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
const ACCT_B = "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb";
const TOKEN = "0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc";
const SPENDER = "0xDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDd";

describe("allowance-key — allowanceKey", function () {
  it("is exported as a function", function () {
    expect(allowanceKey).to.be.a("function");
  });

  // THE REGRESSION THAT PROVES THE BUG IS FIXED: two different accounts with
  // identical token+spender+chainId MUST produce different keys, so account B
  // can never read account A's cached allowance.
  it("gives DIFFERENT keys for two different accounts (same token+spender+chainId)", function () {
    const keyA = allowanceKey({ chainId: 1, account: ACCT_A, token: TOKEN, spender: SPENDER });
    const keyB = allowanceKey({ chainId: 1, account: ACCT_B, token: TOKEN, spender: SPENDER });
    expect(keyA).to.not.equal(keyB);
  });

  it("gives DIFFERENT keys across chainIds (same account+token+spender)", function () {
    const mainnet = allowanceKey({ chainId: 1, account: ACCT_A, token: TOKEN, spender: SPENDER });
    const sepolia = allowanceKey({ chainId: 11155111, account: ACCT_A, token: TOKEN, spender: SPENDER });
    expect(mainnet).to.not.equal(sepolia);
  });

  it("gives IDENTICAL keys for mixed-case-but-equal inputs (addresses are case-insensitive)", function () {
    const upper = allowanceKey({ chainId: 1, account: ACCT_A, token: TOKEN, spender: SPENDER });
    const lower = allowanceKey({
      chainId: 1,
      account: ACCT_A.toLowerCase(),
      token: TOKEN.toLowerCase(),
      spender: SPENDER.toLowerCase(),
    });
    expect(upper).to.equal(lower);
  });

  it("treats chainId number and its string form as the same key", function () {
    const asNum = allowanceKey({ chainId: 1, account: ACCT_A, token: TOKEN, spender: SPENDER });
    const asStr = allowanceKey({ chainId: "1", account: ACCT_A, token: TOKEN, spender: SPENDER });
    expect(asNum).to.equal(asStr);
  });

  it("includes the lowercased account, token and spender in the key", function () {
    const key = allowanceKey({ chainId: 1, account: ACCT_A, token: TOKEN, spender: SPENDER });
    expect(key).to.include(ACCT_A.toLowerCase());
    expect(key).to.include(TOKEN.toLowerCase());
    expect(key).to.include(SPENDER.toLowerCase());
    // chainId is present too.
    expect(key).to.include("1");
  });

  it("does not throw on a null account (uses a sentinel, not the address)", function () {
    let key;
    expect(() => {
      key = allowanceKey({ chainId: 1, account: null, token: TOKEN, spender: SPENDER });
    }).to.not.throw();
    expect(key).to.be.a("string");
    // The null-account sentinel must NOT collide with a real account's key.
    const real = allowanceKey({ chainId: 1, account: ACCT_A, token: TOKEN, spender: SPENDER });
    expect(key).to.not.equal(real);
  });

  it("does not throw on an undefined account or a missing args object", function () {
    expect(() => allowanceKey({ chainId: 1, token: TOKEN, spender: SPENDER })).to.not.throw();
    expect(() => allowanceKey()).to.not.throw();
    expect(allowanceKey()).to.be.a("string");
  });

  it("is pure: repeated calls with the same inputs return the same string", function () {
    const args = { chainId: 1, account: ACCT_A, token: TOKEN, spender: SPENDER };
    expect(allowanceKey(args)).to.equal(allowanceKey(args));
  });
});
