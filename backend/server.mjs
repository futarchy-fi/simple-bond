import { startApiServer } from './api-server.mjs';
import { startWatcher } from './watcher.mjs';

// Compatibility entrypoint for the current single-service deploy.
startApiServer({
  onListen: () => {
    console.log('[bond-notify] Starting combined API + worker mode');
    startWatcher();
  },
});
