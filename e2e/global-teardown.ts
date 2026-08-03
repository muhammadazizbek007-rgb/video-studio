import { rm } from 'node:fs/promises';
import { mediaRoot } from './constants.js';
import { stateFile } from './global-setup.js';

export default async function globalTeardown(): Promise<void> {
  // Teardown runs in reverse order, so the API — and with it the mongod that start-api.ts
  // owns — is still alive here. The generated media is nobody's any more and goes now; the
  // database directory is deliberately left for start-api.ts to recycle on its next boot,
  // rather than pulled out from under a process that is still holding it open.
  await rm(stateFile, { force: true });
  await rm(mediaRoot, { recursive: true, force: true });
}
