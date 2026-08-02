import type { Config } from './config.js';

/**
 * Several modules need the config but cannot take it as an argument: the
 * middleware contract is `requireAuth()` / `requireAllowedEmail()` with no
 * parameters, and the Vertex contract is `getAccessToken()` / `modelUrl(model)`.
 * They read it from here instead of each calling loadConfig() again, so the
 * process has exactly one Config and one place that validated it.
 *
 * createApp() is the single writer and it runs before the server accepts a
 * connection, so every reader below is on a request path that cannot run first.
 */
let current: Config | undefined;

export function setRuntimeConfig(config: Config): void {
  current = config;
}

export function getRuntimeConfig(): Config {
  if (!current) {
    throw new Error('Runtime config was read before createApp() set it.');
  }
  return current;
}
