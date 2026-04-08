const { expect } = require("chai");

const {
  dedupeJudgesByAddress,
  getJudgeSelectEntries,
} = require("../../frontend/judges.js");

describe("judge dropdown helpers", function () {
  it("deduplicates judge entries by address and keeps the richest discovered metadata", function () {
    const entries = [
      {
        address: "0x1111111111111111111111111111111111111111",
        bondCount: 1,
        kind: "generic",
        profile: {
          displayName: "First pass",
        },
      },
      {
        address: "0x1111111111111111111111111111111111111111",
        bondCount: 3,
        kind: "manual",
        operator: "0x2222222222222222222222222222222222222222",
        active: true,
        profile: {
          displayName: "Alice Court",
        },
      },
    ];

    const deduped = dedupeJudgesByAddress(entries);

    expect(deduped).to.deep.equal([
      {
        address: "0x1111111111111111111111111111111111111111",
        bondCount: 3,
        kind: "manual",
        operator: "0x2222222222222222222222222222222222222222",
        active: true,
        profile: {
          displayName: "First pass",
        },
      },
    ]);
  });

  it("builds select entries from discovered judge contracts without a hardcoded registry or Kleros row", function () {
    const judges = [
      {
        address: "0x3333333333333333333333333333333333333333",
        bondCount: 2,
        kind: "manual",
        operator: "0x4444444444444444444444444444444444444444",
        active: true,
        profile: {
          displayName: "Alice Court",
        },
      },
      {
        address: "0x3333333333333333333333333333333333333333",
        bondCount: 1,
        kind: "generic",
      },
      {
        address: "0x5555555555555555555555555555555555555555",
        bondCount: 4,
        kind: "generic",
      },
    ];

    const entries = getJudgeSelectEntries(judges);

    expect(entries).to.deep.equal([
      {
        address: "0x3333333333333333333333333333333333333333",
        judge: {
          address: "0x3333333333333333333333333333333333333333",
          bondCount: 2,
          kind: "manual",
          operator: "0x4444444444444444444444444444444444444444",
          active: true,
          profile: {
            displayName: "Alice Court",
          },
        },
      },
      {
        address: "0x5555555555555555555555555555555555555555",
        judge: {
          address: "0x5555555555555555555555555555555555555555",
          bondCount: 4,
          kind: "generic",
          operator: null,
          active: null,
          profile: null,
        },
      },
    ]);
  });
});
