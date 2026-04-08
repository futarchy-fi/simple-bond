const { expect } = require("chai");

const {
  compareJudges,
  dedupeJudgesByAddress,
  getJudgeDisplayName,
  getJudgeExternalLink,
  getJudgeSelectEntries,
  getJudgeStatement,
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
        official: true,
        officialSortOrder: 2,
        officialDisplayName: "Official Alice",
        officialStatement: "Use plain-language evidence.",
        officialLinkURI: "https://futarchy.ai/judges/alice",
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
        official: true,
        officialSortOrder: 2,
        officialDisplayName: "Official Alice",
        officialStatement: "Use plain-language evidence.",
        officialLinkURI: "https://futarchy.ai/judges/alice",
      },
    ]);
  });

  it("prefers official judges and curated metadata in the select list", function () {
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
        address: "0x5555555555555555555555555555555555555555",
        bondCount: 0,
        kind: "manual",
        official: true,
        officialSortOrder: 1,
        officialDisplayName: "Robin Court",
        officialStatement: "Futarchy-curated official judge.",
        officialLinkURI: "https://futarchy.ai/judges/robin",
      },
      {
        address: "0x3333333333333333333333333333333333333333",
        bondCount: 1,
        kind: "generic",
      },
    ];

    const entries = getJudgeSelectEntries(judges);

    expect(entries).to.deep.equal([
      {
        address: "0x5555555555555555555555555555555555555555",
        judge: {
          address: "0x5555555555555555555555555555555555555555",
          bondCount: 0,
          kind: "manual",
          operator: null,
          active: null,
          profile: null,
          official: true,
          officialSortOrder: 1,
          officialDisplayName: "Robin Court",
          officialStatement: "Futarchy-curated official judge.",
          officialLinkURI: "https://futarchy.ai/judges/robin",
        },
      },
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
          official: false,
          officialSortOrder: null,
          officialDisplayName: "",
          officialStatement: "",
          officialLinkURI: "",
        },
      },
    ]);
  });

  it("exposes helper accessors for curated judge metadata", function () {
    const officialJudge = {
      address: "0x5555555555555555555555555555555555555555",
      official: true,
      officialDisplayName: "Robin Court",
      officialStatement: "Futarchy-curated official judge.",
      officialLinkURI: "https://futarchy.ai/judges/robin",
      profile: {
        displayName: "Ignored profile name",
        statement: "Ignored profile statement",
        linkURI: "https://example.com",
      },
    };

    const discoveredJudge = {
      address: "0x3333333333333333333333333333333333333333",
      bondCount: 2,
      profile: {
        displayName: "Alice Court",
        statement: "Self-published profile statement.",
        linkURI: "https://alice.example",
      },
    };

    expect(getJudgeDisplayName(officialJudge)).to.equal("Robin Court");
    expect(getJudgeStatement(officialJudge)).to.equal("Futarchy-curated official judge.");
    expect(getJudgeExternalLink(officialJudge)).to.equal("https://futarchy.ai/judges/robin");

    expect(getJudgeDisplayName(discoveredJudge)).to.equal("Alice Court");
    expect(getJudgeStatement(discoveredJudge)).to.equal("Self-published profile statement.");
    expect(getJudgeExternalLink(discoveredJudge)).to.equal("https://alice.example");
  });

  it("sorts official judges before discovered-only judges", function () {
    const officialJudge = {
      address: "0x5555555555555555555555555555555555555555",
      official: true,
      officialSortOrder: 5,
    };
    const discoveredJudge = {
      address: "0x3333333333333333333333333333333333333333",
      bondCount: 100,
    };

    expect(compareJudges(officialJudge, discoveredJudge)).to.be.lessThan(0);
    expect(compareJudges(discoveredJudge, officialJudge)).to.be.greaterThan(0);
  });
});
