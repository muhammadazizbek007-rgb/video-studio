import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  API_ORIGIN,
  mediaRoot,
  mongoDataRoot,
  mongoUri,
  runRoot,
  usesExternalMongo,
  WEB_ORIGIN,
} from './constants.js';

/**
 * Playwright brings every `webServer` entry up and waits for its URL *before* this runs, so
 * nothing the servers depend on can be provisioned here — start-api.ts owns the database for
 * exactly that reason. What is left is publishing the run's shape: module state does not
 * cross Playwright's process boundaries, so the record goes to a file whose path travels in
 * an environment variable set by playwright.config.ts.
 */

export const STATE_FILE_ENV_VAR = 'VS_E2E_STATE_FILE';
export const stateFile = join(runRoot, 'state.json');

export interface E2EState {
  apiOrigin: string;
  webOrigin: string;
  mongoUri: string;
  managedMongo: boolean;
  mediaRoot: string;
  mongoDataRoot: string;
  runRoot: string;
  startedAt: string;
}

export default async function globalSetup(): Promise<void> {
  await mkdir(runRoot, { recursive: true });

  const state: E2EState = {
    apiOrigin: API_ORIGIN,
    webOrigin: WEB_ORIGIN,
    mongoUri,
    managedMongo: !usesExternalMongo,
    mediaRoot,
    mongoDataRoot,
    runRoot,
    startedAt: new Date().toISOString(),
  };

  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
