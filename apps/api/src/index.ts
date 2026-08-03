import { buildApp } from './app.js';
import { connectDb, disconnectDb } from './db/connect.js';
import { getEnv } from './env.js';
import { logger } from './logger.js';

const SHUTDOWN_GRACE_MS = 10_000;

async function main(): Promise<void> {
  const env = getEnv();

  await connectDb(env.mongoUri);

  const app = await buildApp();
  await app.listen({ host: '0.0.0.0', port: env.port });

  logger.info(
    {
      port: env.port,
      nodeEnv: env.nodeEnv,
      mcpEnabled: env.mcpEnabled,
      fakeVertex: env.fakeVertex,
    },
    'video-studio api listening',
  );

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    // A stuck connection must never keep the container alive past the grace window;
    // unref'd so the timer itself is not what holds the process open.
    const timer = setTimeout(() => {
      logger.error('graceful shutdown timed out, exiting');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    timer.unref();

    void (async () => {
      try {
        await app.close();
        await disconnectDb();
        logger.info('shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error({ err: error }, 'shutdown failed');
        process.exit(1);
      }
    })();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'failed to start the api');
  process.exit(1);
});
