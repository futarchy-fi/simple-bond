// PRIMARY pure unit test for the async-timeout helper (frontend/async-util.js).
//
// RCA gap #3 — a timeout/error masquerades as "empty". The frontend's
// withTimeout(promise, ms, fallback) silently resolves to the caller's fallback
// on timeout, so a timed-out read is indistinguishable from a genuinely empty
// one — the UI then renders a misleading "no bonds" empty state when the network
// actually failed. withTimeoutResult(promise, ms) fixes that by resolving (never
// rejecting) to a TAGGED object that distinguishes the three outcomes:
//   { status: 'ok', value }     — the promise resolved first.
//   { status: 'error', error }  — the promise rejected first.
//   { status: 'timeout' }       — ms elapsed before the promise settled.
//
// It is a DOM-free, chain-free, I/O-free pure function exercised directly here
// (no browser, no provider) with SMALL ms so the suite stays fast.
const { expect } = require("chai");
const { withTimeoutResult } = require("../../frontend/async-util.js");

// A promise that never settles — forces the timeout branch deterministically.
const NEVER = new Promise(() => {});

describe("async-util — withTimeoutResult", function () {
  it("is exported as a function", function () {
    expect(withTimeoutResult).to.be.a("function");
  });

  it("returns {status:'ok', value} for a resolved promise", async function () {
    const r = await withTimeoutResult(Promise.resolve(42), 1000);
    expect(r).to.deep.equal({ status: "ok", value: 42 });
  });

  it("preserves a falsy resolved value (0n) as ok — NOT a fallback/empty", async function () {
    // The browse bug was a real 0n being indistinguishable from a timeout.
    // Here a genuine 0n must come back tagged ok so the caller can show the
    // normal empty state only for ok-0, never for a timeout.
    const r = await withTimeoutResult(Promise.resolve(0n), 1000);
    expect(r.status).to.equal("ok");
    expect(r.value).to.equal(0n);
  });

  it("returns {status:'timeout'} for a never-resolving promise after a small ms", async function () {
    const r = await withTimeoutResult(NEVER, 10);
    expect(r).to.deep.equal({ status: "timeout" });
  });

  it("returns {status:'error', error} for a rejected promise", async function () {
    const boom = new Error("boom");
    const r = await withTimeoutResult(Promise.reject(boom), 1000);
    expect(r.status).to.equal("error");
    expect(r.error).to.equal(boom);
  });

  it("the promise outcome WINS when it settles before the timer", async function () {
    // Determinism note: an ALREADY-settled promise resolves on a microtask,
    // which always runs before any setTimeout macrotask, so it wins the race
    // regardless of event-loop load. (A real-timer `fast` promise here was
    // flaky under full-suite CPU saturation — RCA gap #3, iter 23.) A huge
    // timeout makes the point unmistakable: the resolved value, not 'timeout'.
    const r = await withTimeoutResult(Promise.resolve("quick"), 100000);
    expect(r).to.deep.equal({ status: "ok", value: "quick" });
  });

  it("the promise outcome WINS (error) when it settles before the timer", async function () {
    // Same determinism rationale: an already-rejected promise's microtask beats
    // the macrotask timer, so this reliably reports the error, never a timeout.
    const err = new Error("fast-fail");
    const r = await withTimeoutResult(Promise.reject(err), 100000);
    expect(r.status).to.equal("error");
    expect(r.error).to.equal(err);
  });

  it("NEVER rejects, even when the inner promise rejects", async function () {
    // Reverting to a plain race that propagates the rejection would make this
    // throw; withTimeoutResult must always resolve to a tagged object.
    let threw = false;
    let r;
    try {
      r = await withTimeoutResult(Promise.reject(new Error("nope")), 1000);
    } catch (_) {
      threw = true;
    }
    expect(threw, "withTimeoutResult must not reject").to.equal(false);
    expect(r.status).to.equal("error");
  });

  it("accepts a non-promise value (coerces via Promise.resolve)", async function () {
    const r = await withTimeoutResult("plain", 1000);
    expect(r).to.deep.equal({ status: "ok", value: "plain" });
  });
});
