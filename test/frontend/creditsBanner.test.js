const { expect } = require("chai");
const { myCreditsBannerHtml, toBig } = require("../../frontend/credits-banner.js");

// backlog #2 — the My-Bonds GLOBAL claimable-credits banner markup decision. The
// pure helper (frontend/credits-banner.js) returns "" when nothing is claimable
// (credit <= 0) and otherwise the msg-success banner HTML carrying the USD string
// and a claim affordance. It must be PURE and NEVER throw on garbage input.
describe("credits-banner (myCreditsBannerHtml)", function () {
    it("returns empty string for a zero credit", function () {
        expect(myCreditsBannerHtml({ creditWei: 0n, usdStr: "0.00" })).to.equal("");
    });

    it("returns empty string for a negative credit", function () {
        expect(myCreditsBannerHtml({ creditWei: -5n, usdStr: "1.23" })).to.equal("");
    });

    it("returns empty string when creditWei is missing/undefined", function () {
        expect(myCreditsBannerHtml({})).to.equal("");
        expect(myCreditsBannerHtml()).to.equal("");
        expect(myCreditsBannerHtml({ usdStr: "9.99" })).to.equal("");
    });

    it("renders a success banner with the usd string and a claim affordance for a positive credit", function () {
        const html = myCreditsBannerHtml({ creditWei: 1000000000000000000n, usdStr: "12.34" });
        expect(html).to.not.equal("");
        // The dollar figure appears in the copy.
        expect(html).to.include("$12.34");
        // Prominent success styling.
        expect(html).to.include("msg-success");
        // The container id the My Bonds page wires onto.
        expect(html).to.include('id="myCreditsBanner');
        // A claim affordance (button) the My Bonds handler binds to.
        expect(html).to.match(/<button[^>]*id="myCreditsClaimBtn"[^>]*>/);
        expect(html).to.include("Claim");
        // The aggregate framing across bonds.
        expect(html).to.include("claimable across your bonds");
        // A message slot for claim progress/result.
        expect(html).to.include('id="myCreditsMsg"');
    });

    it("accepts numeric-string and number credit shapes (coerced to bigint)", function () {
        expect(myCreditsBannerHtml({ creditWei: "5", usdStr: "1.00" })).to.include("$1.00");
        expect(myCreditsBannerHtml({ creditWei: 5, usdStr: "1.00" })).to.include("$1.00");
        // "0" string and 0 number => no banner.
        expect(myCreditsBannerHtml({ creditWei: "0", usdStr: "0.00" })).to.equal("");
        expect(myCreditsBannerHtml({ creditWei: 0, usdStr: "0.00" })).to.equal("");
    });

    it("renders the shared '—' placeholder when usdStr is the rate-miss placeholder", function () {
        const html = myCreditsBannerHtml({ creditWei: 7n, usdStr: "—" });
        expect(html).to.include("~$—");
    });

    it("falls back to '—' when usdStr is absent but a positive credit exists", function () {
        const html = myCreditsBannerHtml({ creditWei: 7n });
        expect(html).to.include("~$—");
    });

    it("NEVER throws on garbage input (pure, defensive)", function () {
        expect(() => myCreditsBannerHtml({ creditWei: "not-a-number", usdStr: {} })).to.not.throw();
        expect(() => myCreditsBannerHtml({ creditWei: null })).to.not.throw();
        expect(() => myCreditsBannerHtml({ creditWei: undefined })).to.not.throw();
        expect(() => myCreditsBannerHtml(null)).to.not.throw();
        // Garbage creditWei coerces to 0n => no banner.
        expect(myCreditsBannerHtml({ creditWei: "not-a-number" })).to.equal("");
    });

    it("toBig coerces bigint/number/string/garbage safely", function () {
        expect(toBig(5n)).to.equal(5n);
        expect(toBig(5)).to.equal(5n);
        expect(toBig("5")).to.equal(5n);
        expect(toBig(null)).to.equal(0n);
        expect(toBig(undefined)).to.equal(0n);
        expect(toBig("")).to.equal(0n);
        expect(toBig("garbage")).to.equal(0n);
    });
});
