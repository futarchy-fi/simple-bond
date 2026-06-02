import { startApiServer } from './api-server.mjs';
import { startWatcher } from './watcher.mjs';
import { assertBootConfig } from './preflight.mjs';

// Fail fast on a dangerous misconfiguration before serving anything.
assertBootConfig();

// Compatibility entrypoint for the current single-service deploy.
startApiServer({
  onListen: () => {
    console.log('[bond-notify] Starting combined API + worker mode');
    startWatcher();
  },
});
