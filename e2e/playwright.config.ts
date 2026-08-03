import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import {
  API_ORIGIN,
  API_ORIGIN_ENV_VAR,
  mediaRoot,
  mongoUri,
  WEB_ORIGIN,
  WEB_ORIGIN_ENV_VAR,
} from './constants.js';
import { STATE_FILE_ENV_VAR, stateFile } from './global-setup.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const e2eRoot = fileURLToPath(new URL('.', import.meta.url));
const isCI = Boolean(process.env.CI);

const SERVER_TIMEOUT_MS = 180_000;
const TEST_TIMEOUT_MS = 90_000;
const EXPECT_TIMEOUT_MS = 15_000;

// Set during config evaluation, which happens before any worker is forked, so the specs
// inherit them. The literal fallbacks in fixtures.ts keep a stray `playwright test` honest.
process.env[API_ORIGIN_ENV_VAR] = API_ORIGIN;
process.env[WEB_ORIGIN_ENV_VAR] = WEB_ORIGIN;
process.env[STATE_FILE_ENV_VAR] = stateFile;

/**
 * Spelled out in full rather than inherited: a variable missing from apps/api/src/env.ts's
 * schema stops the API from booting at all, and an inherited one (ALLOWED_EMAILS, a real
 * GOOGLE_SERVICE_ACCOUNT_JSON) would silently change what the suite is testing.
 */
const apiEnv: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '8080',
  LOG_LEVEL: 'warn',
  MONGODB_URI: mongoUri,
  WEB_APP_URL: WEB_ORIGIN,
  API_PUBLIC_URL: API_ORIGIN,
  CORS_ORIGINS: WEB_ORIGIN,
  // Throwaway literal, 32+ characters, valid only against the ephemeral database above.
  AUTH_JWT_SECRET: 'video-studio-e2e-throwaway-signing-key-0123456789',
  AUTH_DEV_LOGIN: 'true',
  FAKE_VERTEX: 'true',
  MCP_ENABLED: 'false',
  ALLOWED_EMAILS: '',
  MEDIA_ROOT: mediaRoot,
  MEDIA_PUBLIC_BASE_URL: '/media',
  VERTEX_LOCATION: 'us-central1',
};

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  timeout: TEST_TIMEOUT_MS,
  expect: { timeout: EXPECT_TIMEOUT_MS },
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  reporter: isCI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: WEB_ORIGIN,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Pinned so the app's language and theme detection start from a known place.
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // Owns the ephemeral Mongo as well as the server; see start-api.ts.
      command: 'pnpm exec tsx ./start-api.ts',
      cwd: e2eRoot,
      url: `${API_ORIGIN}/api/health/ready`,
      reuseExistingServer: !isCI,
      timeout: SERVER_TIMEOUT_MS,
      stdout: 'pipe',
      stderr: 'pipe',
      env: apiEnv,
    },
    {
      command: 'pnpm --filter @video-studio/web dev',
      cwd: repoRoot,
      url: WEB_ORIGIN,
      reuseExistingServer: !isCI,
      timeout: SERVER_TIMEOUT_MS,
      stderr: 'pipe',
      // Vite bakes VITE_* variables into import.meta.env, so this is what api.ts talks to.
      env: { VITE_API_URL: API_ORIGIN },
    },
  ],
});
