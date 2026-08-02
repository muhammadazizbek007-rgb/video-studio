import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  MONGO_DB_NAME,
  MONGO_PORT,
  mediaRoot,
  mongoDataRoot,
  usesExternalMongo,
} from './constants';

/**
 * Playwright starts every `webServer` entry and waits for its URL *before* it runs
 * globalSetup, so the database cannot be provisioned there — the API would be asked to boot
 * against a Mongo that does not exist yet, and gating the command on a file globalSetup
 * writes just deadlocks the two against each other. Owning the database here, in the same
 * process that owns the API, makes the ordering question disappear: Mongo is up before the
 * server is spawned, and it dies with it.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

let mongo: MongoMemoryServer | undefined;
let child: ReturnType<typeof spawn> | undefined;
let shuttingDown = false;

async function stopMongo(): Promise<void> {
  const server = mongo;
  mongo = undefined;
  if (server) await server.stop({ doCleanup: true, force: true });
}

async function shutdown(code: number): Promise<never> {
  shuttingDown = true;
  child?.kill('SIGTERM');
  await stopMongo().catch(() => undefined);
  process.exit(code);
}

async function main(): Promise<void> {
  // A previous run's media must not survive: the dashboard specs assert on counts, and a
  // stale file would also outlive the database row that explains it.
  await rm(mediaRoot, { recursive: true, force: true });
  await mkdir(mediaRoot, { recursive: true });

  if (!usesExternalMongo) {
    await rm(mongoDataRoot, { recursive: true, force: true });
    await mkdir(mongoDataRoot, { recursive: true });
    mongo = await MongoMemoryServer.create({
      instance: { port: MONGO_PORT, dbName: MONGO_DB_NAME, dbPath: mongoDataRoot },
    });
  }

  child = spawn('pnpm', ['--filter', '@video-studio/api', 'dev'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code) => {
    if (!shuttingDown) void shutdown(code ?? 0);
  });
  child.on('error', (error) => {
    console.error('failed to start the API dev server:', error);
    void shutdown(1);
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(0);
  });
}

main().catch(async (error: unknown) => {
  console.error('e2e API bootstrap failed:', error);
  await shutdown(1);
});
