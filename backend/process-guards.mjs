// Process-level crash guards for the combined API + indexer service.
//
// backend/server.mjs runs ONE process that both serves the HTTP API and runs
// the chain watcher. On modern Node a single unhandled promise rejection (or an
// uncaught exception) TERMINATES the process — which here kills the API AND the
// indexer at once, blanking the live site and freezing indexing until an
// external restart. The watcher has per-tick try/catch, but fire-and-forget
// async paths elsewhere are unguarded. These guards close that gap.
//
// Restart policy (deploy/docker-compose.yml): `restart: unless-stopped`. So the
// service IS supervised. On an uncaughtException (a genuinely-unknown state) we
// log loudly and then exit, letting the supervisor restart cleanly. On an
// unhandledRejection (typically a transient async error, e.g. a fire-and-forget
// RPC failure) we log and KEEP SERVING — these must not take down the service.

// Module-level idempotency flag so a second registerProcessGuards() call is a
// no-op and never double-registers listeners.
let registered = false;

// Exported individual handlers (factory functions) so tests can build and
// invoke them directly without emitting real process events.

export function makeUnhandledRejectionHandler({ log = console.error } = {}) {
  return function onUnhandledRejection(reason, promise) {
    // Transient async failure — log with context and KEEP SERVING. Do NOT exit.
    log('[process-guards] unhandledRejection (keeping service alive):', {
      reason: reason instanceof Error ? reason.stack || reason.message : reason,
      promise,
    });
  };
}

export function makeUncaughtExceptionHandler({
  log = console.error,
  onFatal = () => process.exit(1),
} = {}) {
  return function onUncaughtException(err, origin) {
    // Genuinely-unknown state — log loudly, then hand off to onFatal. With the
    // `restart: unless-stopped` supervisor, the default onFatal exits so the
    // service is restarted cleanly. onFatal is injectable so tests can assert
    // it WITHOUT killing the test process.
    log('[process-guards] uncaughtException (fatal):', {
      error: err instanceof Error ? err.stack || err.message : err,
      origin,
    });
    onFatal(err);
  };
}

// Registers the process guards idempotently. Returns the registered handler
// functions so callers/tests can reference or invoke them directly.
//
//   opts.log     — structured logger (default console.error)
//   opts.onFatal — invoked after logging an uncaughtException
//                  (default process.exit(1); restart-policied supervisor recovers)
export function registerProcessGuards({
  log = console.error,
  onFatal = () => process.exit(1),
} = {}) {
  const onUnhandledRejection = makeUnhandledRejectionHandler({ log });
  const onUncaughtException = makeUncaughtExceptionHandler({ log, onFatal });

  if (registered) {
    return { onUnhandledRejection, onUncaughtException, alreadyRegistered: true };
  }
  registered = true;

  process.on('unhandledRejection', onUnhandledRejection);
  process.on('uncaughtException', onUncaughtException);

  return { onUnhandledRejection, onUncaughtException, alreadyRegistered: false };
}

// Test-only: clears the idempotency flag so a fresh registration can be made.
// This does NOT remove any installed listeners — tests are responsible for that
// (see test/backend/processGuards.test.js afterEach). Not for production use.
export function __resetForTests() {
  registered = false;
}
