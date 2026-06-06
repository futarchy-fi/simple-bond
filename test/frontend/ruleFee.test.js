// PRIMARY pure unit test for parseRuleFee() (frontend/rule-fee.js).
//
// MED-3: doRule() rendered the ruling-fee input with the token's REAL decimals
// (challengeHtml uses ethers.formatUnits(b.judgeFee, tokenDec)) but parsed the
// string back with a HARDCODED 18, corrupting the on-chain amount for any
// non-18-decimal token. parseRuleFee() does the version-correct parse + the SAME
// judgeFee clamp using the token's real decimals. These tests lock that in and
// would FAIL against the old hardcoded-18 logic.
const { expect } = require("chai");
const { ethers } = require("ethers");
const { parseRuleFee } = require("../../frontend/rule-fee.js");

// The exact production call shape: ethers.parseUnits is injected.
function parse(feeStr, judgeFee, tokenDec) {
    return parseRuleFee({ feeStr, judgeFee, tokenDec, parseUnits: ethers.parseUnits });
}

describe("parseRuleFee — token-decimal-aware ruling fee parse (MED-3)", function () {
    it("is a genuinely importable pure function", function () {
        expect(parseRuleFee).to.be.a("function");
    });

    // The headline regression: a 6-decimal token, judgeFee 0.5 == 500000 (0.5e6).
    // Old code: parseUnits("0.5", 18) = 5e17, clamped to judgeFee (500000) — i.e.
    // the operator could NOT charge less than the max and the wallet showed an
    // amount unrelated to "0.5". New code parses with 6 decimals -> exactly 500000.
    describe("6-decimal token (the bug)", function () {
        const DEC = 6;
        const judgeFee = ethers.parseUnits("0.5", DEC); // 500000

        it("the rendered default '0.5' parses to exactly judgeFee (500000), NOT 0.5e18", function () {
            const fee = parse("0.5", judgeFee, DEC);
            expect(fee).to.equal(500000n);
            expect(fee).to.equal(judgeFee);
            // Prove it is NOT the old hardcoded-18 result.
            expect(fee).to.not.equal(ethers.parseUnits("0.5", 18));
        });

        it("a SMALLER fee (0.2) parses to 200000 and is NOT clamped to the max", function () {
            const fee = parse("0.2", judgeFee, DEC);
            expect(fee).to.equal(200000n);
            expect(fee).to.be.lessThan(judgeFee);
            // OLD code: parseUnits("0.2",18)=2e17 > judgeFee -> clamped to 500000.
            // That silent over-charge is exactly the bug; the new code does not.
            expect(fee).to.not.equal(judgeFee);
        });

        it("an empty input falls back to exactly the full judgeFee", function () {
            expect(parse("", judgeFee, DEC)).to.equal(judgeFee);
            expect(parse(undefined, judgeFee, DEC)).to.equal(judgeFee);
        });

        it("a fee above judgeFee is clamped to judgeFee", function () {
            const fee = parse("0.9", judgeFee, DEC);
            expect(fee).to.equal(judgeFee); // 0.9e6 > 0.5e6 -> clamp
        });
    });

    // 18-decimal token: behaviour unchanged from before (the common case).
    describe("18-decimal token (unchanged behaviour)", function () {
        const DEC = 18;
        const judgeFee = ethers.parseUnits("0.5", DEC); // 5e17

        it("'0.5' -> 0.5e18 == judgeFee", function () {
            expect(parse("0.5", judgeFee, DEC)).to.equal(judgeFee);
        });
        it("'0.3' -> 3e17 (not clamped)", function () {
            expect(parse("0.3", judgeFee, DEC)).to.equal(ethers.parseUnits("0.3", 18));
        });
        it("empty -> full judgeFee", function () {
            expect(parse("", judgeFee, DEC)).to.equal(judgeFee);
        });
    });

    // Another non-18 case for good measure: a 0-decimal token.
    it("0-decimal token: '5' parses to 5 base units", function () {
        const judgeFee = 10n;
        expect(parse("5", judgeFee, 0)).to.equal(5n);
    });

    describe("defensive input handling", function () {
        it("missing tokenDec defaults to 18", function () {
            const judgeFee = ethers.parseUnits("1", 18);
            expect(parseRuleFee({ feeStr: "1", judgeFee, parseUnits: ethers.parseUnits })).to.equal(judgeFee);
        });
        it("accepts a numeric-string judgeFee", function () {
            const fee = parseRuleFee({ feeStr: "0.5", judgeFee: "500000", tokenDec: 6, parseUnits: ethers.parseUnits });
            expect(fee).to.equal(500000n);
        });
        it("throws a clear error when parseUnits is not injected", function () {
            expect(() => parseRuleFee({ feeStr: "0.5", judgeFee: 1n, tokenDec: 6 })).to.throw(/parseUnits/);
        });
    });
});
