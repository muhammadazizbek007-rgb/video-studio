import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { initFirebase } from './firebase.js';
import { log } from './logger.js';

const SHUTDOWN_GRACE_MS = 10_000;

const config = loadConfig();
initFirebase(config);

const server = createApp(config).listen(config.port, () => {
  log('info', 'server listening', { port: config.port, projectId: config.projectId });
});

function shutdown(signal: string): void {
  log('info', 'shutting down', { signal });

  // Stop accepting connections, then let in-flight polls finish. A generation
  // that is already running on Vertex survives this process either way.
  server.close(() => {
    process.exit(0);
  });

  const timer = setTimeout(() => {
    log('warn', 'forcing shutdown, connections still open');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  timer.unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
