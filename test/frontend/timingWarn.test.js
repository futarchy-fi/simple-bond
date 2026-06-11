// timingWarning(acceptanceDelay, rulingBuffer) — pure ruling-window advisory
// (audit M6). Loaded as a plain <script> in the browser; required() here.

const { expect } = require("chai");
const path = require("path");
const { timingWarning } = require(path.resolve(__dirname, "../../frontend/timing-warn.js"));

describe("timingWarning (M6 ruling-window advisory)", function () {
    it("returns null for a safe window (>= 6h)", function () {
        expect(timingWarning(86400, 7 * 86400)).to.equal(null);
        expect(timingWarning(0, 6 * 3600)).to.equal(null);
    });

    it("errors when ruling buffer is below 1h (claimTimeout would always favor the poster)", function () {
        const w = timingWarning(3600, 1800);
        expect(w).to.not.equal(null);
        expect(w.level).to.equal("error");
        expect(w.text).to.match(/too short|1h/i);
    });

    it("errors at exactly 0 / invalid ruling buffer", function () {
        expect(timingWarning(3600, 0).level).to.equal("error");
        expect(timingWarning(3600, -5).level).to.equal("error");
        expect(timingWarning(3600, NaN).level).to.equal("error");
    });

    it("warns (not errors) for a tight-but-usable window (1h..6h)", function () {
        const w = timingWarning(3600, 2 * 3600);
        expect(w.level).to.equal("warn");
        expect(w.text).to.match(/tight/i);
    });

    it("boundary: exactly 1h is the lowest non-error; exactly 6h is the lowest null", function () {
        expect(timingWarning(0, 3600).level).to.equal("warn"); // 1h: tight but allowed
        expect(timingWarning(0, 3599).level).to.equal("error"); // 1s under 1h: error
        expect(timingWarning(0, 6 * 3600)).to.equal(null); // 6h: fine
        expect(timingWarning(0, 6 * 3600 - 1).level).to.equal("warn"); // just under 6h: tight
    });
});
