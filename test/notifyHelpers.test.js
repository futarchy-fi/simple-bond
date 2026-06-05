// Unit tests for the PURE notify helpers (frontend/notify.js). These lock the
// /api/notify/register request contract and the /api/notify/status
// interpretation to the backend (backend/api-server.mjs handleRegister/
// handleStatus). If the message string or payload shape drifts, every real
// signature 403s — so these guard the exact contract.

const { expect } = require("chai");
const notify = require("../frontend/notify.js");

const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const EMAIL = "alice@example.com";
const CHAIN_ID = 1;
const TS = 1_700_000_000;
const SIG = "0x" + "ab".repeat(65);

describe("notify helpers (frontend/notify.js)", function () {
    describe("notifyRegisterMessage", function () {
        it("matches the EXACT string the backend re-derives and verifies", () => {
            // Mirrors handleRegister():
            //   `Enable SimpleBond notifications for ${email} on chain ${chainId}. Timestamp: ${timestamp}`
            const msg = notify.notifyRegisterMessage(EMAIL, CHAIN_ID, TS);
            expect(msg).to.equal(
                "Enable SimpleBond notifications for alice@example.com on chain 1. Timestamp: 1700000000"
            );
        });
    });

    describe("isValidEmail", function () {
        it("accepts a normal address and rejects malformed ones", () => {
            expect(notify.isValidEmail("a@b.co")).to.equal(true);
            expect(notify.isValidEmail("no-at-sign")).to.equal(false);
            expect(notify.isValidEmail("a@b")).to.equal(false);
            expect(notify.isValidEmail("")).to.equal(false);
            expect(notify.isValidEmail("  spaced @x.com")).to.equal(false);
        });
    });

    describe("buildNotifyRegisterPayload", function () {
        it("builds the exact field set the backend requires", () => {
            const payload = notify.buildNotifyRegisterPayload({
                address: ADDR, email: EMAIL, chainId: CHAIN_ID, signature: SIG, timestamp: TS,
            });
            // handleRegister destructures { address, email, chainId, signature, timestamp }
            expect(payload).to.deep.equal({
                address: ADDR,
                email: EMAIL,
                chainId: 1,
                signature: SIG,
                timestamp: 1_700_000_000,
            });
            expect(Object.keys(payload).sort()).to.deep.equal(
                ["address", "chainId", "email", "signature", "timestamp"]
            );
        });

        it("coerces chainId to Number and timestamp to an integer (unix seconds)", () => {
            const payload = notify.buildNotifyRegisterPayload({
                address: ADDR, email: EMAIL, chainId: "1", signature: SIG, timestamp: 1_700_000_000.9,
            });
            expect(payload.chainId).to.equal(1);
            expect(payload.timestamp).to.equal(1_700_000_000);
        });

        it("trims the email", () => {
            const payload = notify.buildNotifyRegisterPayload({
                address: ADDR, email: "  alice@example.com  ", chainId: CHAIN_ID, signature: SIG, timestamp: TS,
            });
            expect(payload.email).to.equal("alice@example.com");
        });

        it("throws on a missing field rather than sending a malformed request", () => {
            expect(() => notify.buildNotifyRegisterPayload({
                address: ADDR, email: EMAIL, chainId: CHAIN_ID, signature: SIG, /* no timestamp */
            })).to.throw(/timestamp/i);
            expect(() => notify.buildNotifyRegisterPayload({
                address: "", email: EMAIL, chainId: CHAIN_ID, signature: SIG, timestamp: TS,
            })).to.throw(/address/i);
            expect(() => notify.buildNotifyRegisterPayload({
                address: ADDR, email: "bad", chainId: CHAIN_ID, signature: SIG, timestamp: TS,
            })).to.throw(/email/i);
        });
    });

    describe("interpretNotifyStatus", function () {
        it("maps { registered: false } to the 'none' state", () => {
            expect(notify.interpretNotifyStatus({ registered: false })).to.deep.equal({
                state: "none", registered: false, verified: false, email: "",
            });
        });

        it("treats null / non-object as not subscribed (no crash on transport failure)", () => {
            expect(notify.interpretNotifyStatus(null).state).to.equal("none");
            expect(notify.interpretNotifyStatus(undefined).registered).to.equal(false);
        });

        it("maps registered+unverified to 'subscribed' and carries the masked email", () => {
            const s = notify.interpretNotifyStatus({ registered: true, verified: false, email: "a***@example.com" });
            expect(s.state).to.equal("subscribed");
            expect(s.registered).to.equal(true);
            expect(s.verified).to.equal(false);
            expect(s.email).to.equal("a***@example.com");
        });

        it("maps registered+verified to 'verified'", () => {
            const s = notify.interpretNotifyStatus({ registered: true, verified: true, email: "a***@example.com" });
            expect(s.state).to.equal("verified");
            expect(s.verified).to.equal(true);
        });
    });
});
