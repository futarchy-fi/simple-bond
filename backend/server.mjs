import { startApiServer } from './api-server.mjs';
import { startWatcher } from './watcher.mjs';
import { assertBootConfig } from './preflight.mjs';
import { registerProcessGuards } from './process-guards.mjs';

// Install process-level crash guards FIRST, before any boot/serve work, so an
// unhandledRejection during boot logs-and-keeps-serving and an uncaughtException
// logs-and-exits cleanly (the docker-compose `restart: unless-stopped`
// supervisor then restarts the service). Without this a single stray rejection
// would take down the combined API + indexer process.
registerProcessGuards();

// Fail fast on a dangerous misconfiguration before serving anything.
assertBootConfig();

// Compatibility entrypoint for the current single-service deploy.
startApiServer({
  onListen: () => {
    console.log('[bond-notify] Starting combined API + worker mode');
    startWatcher();
  },
});
