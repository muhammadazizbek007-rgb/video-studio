import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const API_ORIGIN_ENV_VAR = 'VS_E2E_API_ORIGIN';
export const WEB_ORIGIN_ENV_VAR = 'VS_E2E_WEB_ORIGIN';

export const API_ORIGIN = 'http://127.0.0.1:8080';
export const WEB_ORIGIN = 'http://127.0.0.1:5173';

/**
 * A fixed port rather than an ephemeral one: playwright.config.ts has to spell out
 * MONGODB_URI when it builds the webServer entry, long before anything has started, so the
 * URI cannot depend on a port the server picks for itself at boot.
 */
export const MONGO_PORT = Number(process.env.VS_E2E_MONGO_PORT ?? 27077);
export const MONGO_DB_NAME = 'video_studio_e2e';

export const runRoot = join(tmpdir(), 'video-studio-e2e');
export const mediaRoot = join(runRoot, 'media');
export const mongoDataRoot = join(runRoot, 'mongo');

/** An externally provisioned Mongo (a CI service container) wins over the in-memory one. */
const externalMongoUri = process.env.VS_E2E_MONGODB_URI?.trim() ?? '';

export const usesExternalMongo = externalMongoUri.length > 0;

export const mongoUri = usesExternalMongo
  ? externalMongoUri
  : `mongodb://127.0.0.1:${MONGO_PORT}/${MONGO_DB_NAME}`;
