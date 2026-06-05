// PRIMARY pure unit test for the contract-presence probe (frontend/contract-probe.js).
//
// RCA gap #6 — getCode page-chain probe. A user landed on a chain where the
// configured bondContract address had NO bytecode (wrong network / stale
// address) and got a cryptic failure ("No contract code at 0x… on Ethereum" /
// silent empty reads). classifyContractCode() turns a raw eth_getCode result
// into one of three states, and contractPresenceMessage() turns that verdict
// into user-facing copy. Both are DOM-free, chain-free, I/O-free pure functions
// exercised directly here (no browser, no provider).
//
// STATE TRUTH:
//   'absent'  — null/undefined/''/'0x'/'0X'/'0x0' (case-insensitive, trimmed):
//               eth_getCode returns '0x' for an address with no code. This is the
//               genuine-absence signal the frontend fails CLOSED on.
//   'present' — a hex string carrying real deployed bytecode.
//   'unknown' — a NON-string input: the caller's thrown-error sentinel when
//               getCode rejected. A transport problem, NOT a confirmed absence,
//               so the frontend must NOT permanently hard-block on it.
const { expect } = require("chai");
const {
  classifyContractCode,
  contractPresenceMessage,
  CONTRACT_PRESENCE,
} = require("../../frontend/contract-probe.js");

describe("contract-probe — classifyContractCode", function () {
  describe("absent (empty / no-code answers from a RESOLVED getCode)", function () {
    it("null => absent", function () {
      expect(classifyContractCode(null)).to.equal("absent");
    });
    it("undefined => absent", function () {
      expect(classifyContractCode(undefined)).to.equal("absent");
    });
    it("empty string => absent", function () {
      expect(classifyContractCode("")).to.equal("absent");
    });
    it("'0x' (the canonical no-code answer) => absent", function () {
      expect(classifyContractCode("0x")).to.equal("absent");
    });
    it("'0X' (uppercase prefix) => absent", function () {
      expect(classifyContractCode("0X")).to.equal("absent");
    });
    it("' 0x ' (whitespace-padded) => absent", function () {
      expect(classifyContractCode(" 0x ")).to.equal("absent");
    });
    it("'0x0' (degenerate) => absent", function () {
      expect(classifyContractCode("0x0")).to.equal("absent");
    });
    it("' 0X0 ' (padded + uppercase) => absent", function () {
      expect(classifyContractCode(" 0X0 ")).to.equal("absent");
    });
    it("matches the CONTRACT_PRESENCE.ABSENT constant", function () {
      expect(classifyContractCode("0x")).to.equal(CONTRACT_PRESENCE.ABSENT);
    });
  });

  describe("present (real bytecode hex string)", function () {
    it("a real '0x6080…' bytecode => present", function () {
      const code =
        "0x6080604052348015600f57600080fd5b506004361060285760003560e01c8063";
      expect(classifyContractCode(code)).to.equal("present");
    });
    it("a minimal non-empty hex word => present", function () {
      expect(classifyContractCode("0x60")).to.equal("present");
    });
    it("padded/uppercase real bytecode still => present", function () {
      expect(classifyContractCode("  0X6080FE  ")).to.equal("present");
    });
    it("matches the CONTRACT_PRESENCE.PRESENT constant", function () {
      expect(classifyContractCode("0x6080")).to.equal(
        CONTRACT_PRESENCE.PRESENT
      );
    });
  });

  describe("unknown (non-string sentinel — getCode threw)", function () {
    it("an Error instance => unknown (transport, not absence)", function () {
      expect(classifyContractCode(new Error("network down"))).to.equal(
        "unknown"
      );
    });
    it("a number => unknown", function () {
      expect(classifyContractCode(42)).to.equal("unknown");
    });
    it("an object => unknown", function () {
      expect(classifyContractCode({})).to.equal("unknown");
    });
    it("a boolean => unknown", function () {
      expect(classifyContractCode(false)).to.equal("unknown");
    });
    it("matches the CONTRACT_PRESENCE.UNKNOWN constant", function () {
      expect(classifyContractCode(new Error("x"))).to.equal(
        CONTRACT_PRESENCE.UNKNOWN
      );
    });
  });
});

describe("contract-probe — contractPresenceMessage", function () {
  const ADDR = "0xAbCdEf0000000000000000000000000000001234";
  const CHAIN = "Ethereum";

  it("absent: contains the address and chain name, and warns about wrong network/misconfig", function () {
    const msg = contractPresenceMessage({
      state: "absent",
      address: ADDR,
      chainName: CHAIN,
    });
    expect(msg).to.be.a("string").and.not.equal("");
    expect(msg).to.include(ADDR);
    expect(msg).to.include(CHAIN);
    expect(msg).to.match(/no simplebond contract found/i);
    expect(msg).to.match(/wrong network|misconfigured/i);
  });

  it("unknown: a transport-style message naming address + chain, not a hard 'not found'", function () {
    const msg = contractPresenceMessage({
      state: "unknown",
      address: ADDR,
      chainName: CHAIN,
    });
    expect(msg).to.be.a("string").and.not.equal("");
    expect(msg).to.include(ADDR);
    expect(msg).to.include(CHAIN);
    expect(msg).to.match(/network|rpc/i);
    // Must NOT assert a confirmed absence — that's the fail-closed message.
    expect(msg).to.not.match(/no simplebond contract found/i);
  });

  it("present: empty string (no banner)", function () {
    expect(
      contractPresenceMessage({ state: "present", address: ADDR, chainName: CHAIN })
    ).to.equal("");
  });

  it("present: empty even with no address/chain supplied", function () {
    expect(contractPresenceMessage({ state: "present" })).to.equal("");
  });

  it("absent: still produces a usable message with placeholders when address/chain are omitted", function () {
    const msg = contractPresenceMessage({ state: "absent" });
    expect(msg).to.match(/no simplebond contract found/i);
    expect(msg).to.include("the configured address");
    expect(msg).to.include("this network");
  });

  it("is robust to a missing/garbage args object (defaults, no throw)", function () {
    expect(() => contractPresenceMessage()).to.not.throw();
    expect(contractPresenceMessage()).to.equal("");
    expect(contractPresenceMessage({})).to.equal("");
  });

  it("end-to-end: a '0x' getCode answer classifies absent and yields the fail-closed message", function () {
    const state = classifyContractCode("0x");
    const msg = contractPresenceMessage({ state, address: ADDR, chainName: CHAIN });
    expect(state).to.equal("absent");
    expect(msg).to.include(ADDR).and.to.include(CHAIN);
  });
});
