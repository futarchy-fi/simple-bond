// Backlog #5: process-level crash guard. backend/server.mjs runs the API and
// the chain indexer in ONE process; a single unhandled rejection / uncaught
// exception would otherwise terminate BOTH. These tests prove the guards:
//   - unhandledRejection logs and KEEPS SERVING (no onFatal/exit),
//   - uncaughtException logs AND calls the injected onFatal with the error,
//   - registration is idempotent,
// all without emitting real process events (which would disturb the mocha
// runner) and without leaking listeners into the rest of the suite.
const { expect } = require("chai");

// The module is ESM (.mjs); load it once via dynamic import.
let mod;
before(async () => {
  mod = await import("../../backend/process-guards.mjs");
});

describe("backend process guards", function () {
  // Snapshot the listeners that existed before each test so we can restore
  // EXACTLY them afterwards — leaking handlers would corrupt the rest of the
  // hardhat suite (e.g. a stray uncaughtException handler).
  let before_unhandled;
  let before_uncaught;

  beforeEach(() => {
    before_unhandled = process.listeners("unhandledRejection");
    before_uncaught = process.listeners("uncaughtException");
  });

  afterEach(() => {
    // Remove anything the test (or registerProcessGuards) added, restoring the
    // pre-test listener set so no global state leaks.
    for (const l of process.listeners("unhandledRejection")) {
      if (!before_unhandled.includes(l)) process.removeListener("unhandledRejection", l);
    }
    for (const l of process.listeners("uncaughtException")) {
      if (!before_uncaught.includes(l)) process.removeListener("uncaughtException", l);
    }
    // Reset the module's idempotency flag so each test starts clean. Done by
    // re-importing a fresh module graph is not possible with ESM caching, so we
    // rely on registerProcessGuards being callable across tests; the resetGuards
    // export (if present) clears the internal flag.
    if (typeof mod.__resetForTests === "function") mod.__resetForTests();
  });

  it("attaches an unhandledRejection AND an uncaughtException listener", () => {
    const beforeR = process.listenerCount("unhandledRejection");
    const beforeE = process.listenerCount("uncaughtException");

    mod.registerProcessGuards({ log: () => {}, onFatal: () => {} });

    expect(process.listenerCount("unhandledRejection")).to.equal(beforeR + 1);
    expect(process.listenerCount("uncaughtException")).to.equal(beforeE + 1);
  });

  it("unhandledRejection handler LOGS and does NOT exit / call onFatal", () => {
    const logged = [];
    let fatalCalls = 0;
    const { onUnhandledRejection } = mod.registerProcessGuards({
      log: (...args) => logged.push(args),
      onFatal: () => { fatalCalls += 1; },
    });

    const err = new Error("transient fire-and-forget RPC failure");
    // Invoke the registered handler DIRECTLY — do not emit a real event.
    onUnhandledRejection(err, Promise.reject(err).catch(() => {}));

    expect(logged.length, "should log").to.be.greaterThan(0);
    expect(fatalCalls, "must NOT call onFatal / exit").to.equal(0);
  });

  it("uncaughtException handler LOGS and calls onFatal once with the error", () => {
    const logged = [];
    const fatalArgs = [];
    const { onUncaughtException } = mod.registerProcessGuards({
      log: (...args) => logged.push(args),
      onFatal: (e) => { fatalArgs.push(e); },
    });

    const err = new Error("genuinely unknown state");
    // Invoke directly — never the real process.exit.
    onUncaughtException(err, "uncaughtException");

    expect(logged.length, "should log").to.be.greaterThan(0);
    expect(fatalArgs.length, "onFatal called exactly once").to.equal(1);
    expect(fatalArgs[0], "onFatal receives the error").to.equal(err);
  });

  it("is idempotent: a second registerProcessGuards adds no duplicate listeners", () => {
    const beforeR = process.listenerCount("unhandledRejection");
    const beforeE = process.listenerCount("uncaughtException");

    const first = mod.registerProcessGuards({ log: () => {}, onFatal: () => {} });
    const afterFirstR = process.listenerCount("unhandledRejection");
    const afterFirstE = process.listenerCount("uncaughtException");

    const second = mod.registerProcessGuards({ log: () => {}, onFatal: () => {} });

    expect(afterFirstR, "first call adds one rejection listener").to.equal(beforeR + 1);
    expect(afterFirstE, "first call adds one exception listener").to.equal(beforeE + 1);
    expect(process.listenerCount("unhandledRejection"), "no duplicate rejection listener")
      .to.equal(afterFirstR);
    expect(process.listenerCount("uncaughtException"), "no duplicate exception listener")
      .to.equal(afterFirstE);
    expect(first.alreadyRegistered).to.equal(false);
    expect(second.alreadyRegistered).to.equal(true);
  });
});
