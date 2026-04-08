const { expect } = require("chai");

const {
  parseJudgeRegistration,
  dedupeJudgesByAddress,
  getJudgeSelectEntries,
} = require("../frontend/judges.js");

describe("judge dropdown helpers", function () {
  it("normalizes judge registration getter results into booleans", function () {
    expect(parseJudgeRegistration(true)).to.equal(true);
    expect(parseJudgeRegistration(false)).to.equal(false);
    expect(parseJudgeRegistration({ registered: true })).to.equal(true);
    expect(parseJudgeRegistration({ registered: false })).to.equal(false);
    expect(parseJudgeRegistration([true])).to.equal(true);
    expect(parseJudgeRegistration([false])).to.equal(false);
    expect(parseJudgeRegistration({ 0: true })).to.equal(true);
    expect(parseJudgeRegistration({ 0: false })).to.equal(false);
    expect(parseJudgeRegistration({})).to.equal(false);
    expect(parseJudgeRegistration(null)).to.equal(false);
    expect(parseJudgeRegistration("true")).to.equal(false);
  });

  it("deduplicates judge entries by address and merges token fees case-insensitively", function () {
    const entries = [
      {
        address: "0x1111111111111111111111111111111111111111",
        tokenFees: new Map([
          ["0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", 1n],
        ]),
        bondCount: 1,
      },
      {
        address: "0x1111111111111111111111111111111111111111",
        tokenFees: new Map([
          ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", 2n],
        ]),
        bondCount: 3,
      },
    ];

    const deduped = dedupeJudgesByAddress(entries);

    expect(deduped).to.have.lengthOf(1);
    expect(deduped[0].address).to.equal(entries[0].address);
    expect(deduped[0].bondCount).to.equal(3);
    expect([...deduped[0].tokenFees.entries()]).to.deep.equal([
      ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 1n],
      ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", 2n],
    ]);
  });

  it("keeps the hardcoded Kleros option as a single preferred dropdown entry", function () {
    const klerosAddr = "0x2222222222222222222222222222222222222222";
    const judges = [
      {
        address: klerosAddr,
        tokenFees: new Map(),
        bondCount: 9,
      },
      {
        address: "0x3333333333333333333333333333333333333333",
        tokenFees: new Map(),
        bondCount: 1,
      },
      {
        address: "0x3333333333333333333333333333333333333333",
        tokenFees: new Map(),
        bondCount: 2,
      },
    ];

    const entries = getJudgeSelectEntries(judges, klerosAddr);

    expect(entries).to.deep.equal([
      {
        address: klerosAddr,
        kind: "kleros",
      },
      {
        address: "0x3333333333333333333333333333333333333333",
        kind: "judge",
        judge: judges[1],
      },
    ]);
  });
});
