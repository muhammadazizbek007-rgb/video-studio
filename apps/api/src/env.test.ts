import { afterEach, describe, expect, it } from 'vitest';
import { getEnv, resetEnvCache } from './env.js';

const MANAGED_KEYS = [
  'NODE_ENV',
  'PORT',
  'LOG_LEVEL',
  'MONGODB_URI',
  'WEB_APP_URL',
  'API_PUBLIC_URL',
  'CORS_ORIGINS',
  'AUTH_JWT_SECRET',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'ALLOWED_EMAILS',
  'AUTH_DEV_LOGIN',
  'GCP_PROJECT_ID',
  'VERTEX_LOCATION',
  'GOOGLE_SERVICE_ACCOUNT_JSON',
  'FAKE_VERTEX',
  'MEDIA_ROOT',
  'MEDIA_PUBLIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'MCP_ENABLED',
];

const snapshot = new Map(MANAGED_KEYS.map((key) => [key, process.env[key]]));

const SECRET = 'a-very-long-jwt-signing-secret-value';

// Written the way a real key arrives: the newlines are literal backslash-n inside the JSON.
const SERVICE_ACCOUNT_JSON = JSON.stringify({
  project_id: 'demo-project',
  client_email: 'robot@demo-project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\\nMIIabc\\n-----END PRIVATE KEY-----\\n',
});

function setEnv(vars: Record<string, string>): void {
  for (const key of MANAGED_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(vars)) process.env[key] = value;
  resetEnvCache();
}

function validEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    MONGODB_URI: 'mongodb://localhost:27017/video-studio',
    AUTH_JWT_SECRET: SECRET,
    GOOGLE_OAUTH_CLIENT_ID: 'client-id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
    GOOGLE_SERVICE_ACCOUNT_JSON: SERVICE_ACCOUNT_JSON,
    ...overrides,
  };
}

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    const original = snapshot.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  resetEnvCache();
});

describe('getEnv', () => {
  it('reads a fully valid environment and applies defaults', () => {
    setEnv(
      validEnv({
        NODE_ENV: 'production',
        PORT: '9090',
        ALLOWED_EMAILS: 'Owner@Example.com, second@example.com',
        CORS_ORIGINS: 'https://studio.example.com,https://admin.example.com',
        ANTHROPIC_API_KEY: 'sk-test',
      }),
    );

    const env = getEnv();

    expect(env.nodeEnv).toBe('production');
    expect(env.port).toBe(9090);
    expect(env.logLevel).toBe('info');
    expect(env.mongoUri).toBe('mongodb://localhost:27017/video-studio');
    expect(env.webAppUrl).toBe('http://localhost:5173');
    expect(env.apiPublicUrl).toBe('http://localhost:8080');
    expect(env.vertexLocation).toBe('us-central1');
    expect(env.mediaRoot).toBe('./var/media');
    expect(env.mediaPublicBaseUrl).toBe('/media');
    expect(env.gcpProjectId).toBe('demo-project');
    expect(env.allowedEmails).toEqual(['owner@example.com', 'second@example.com']);
    expect(env.corsOrigins).toEqual(['https://studio.example.com', 'https://admin.example.com']);
    expect(env.anthropicApiKey).toBe('sk-test');
    expect(env.authDevLogin).toBe(false);
    expect(env.fakeVertex).toBe(false);
    expect(env.mcpEnabled).toBe(true);
  });

  it('memoises until the cache is reset', () => {
    setEnv(validEnv());
    const first = getEnv();
    expect(getEnv()).toBe(first);
  });

  it('reports every problem in a single error', () => {
    setEnv({ AUTH_JWT_SECRET: 'too-short', GOOGLE_SERVICE_ACCOUNT_JSON: SERVICE_ACCOUNT_JSON });

    let message = '';
    try {
      getEnv();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('MONGODB_URI');
    expect(message).toContain('AUTH_JWT_SECRET');
    expect(message).toContain('GOOGLE_OAUTH_CLIENT_ID');
    expect(message).toContain('GOOGLE_OAUTH_CLIENT_SECRET');
  });

  it('restores escaped newlines inside the service account private key', () => {
    setEnv(validEnv());

    const account = getEnv().googleServiceAccount;

    expect(account?.client_email).toBe('robot@demo-project.iam.gserviceaccount.com');
    expect(account?.private_key).toBe(
      '-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----\n',
    );
    expect(account?.private_key).not.toContain('\\n');
  });

  it('rejects a service account that is missing required fields', () => {
    setEnv(validEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'demo' }) }));

    expect(() => getEnv()).toThrow(/GOOGLE_SERVICE_ACCOUNT_JSON/);
  });

  it('strips a leading BOM from values', () => {
    setEnv(
      validEnv({
        MONGODB_URI: '\uFEFFmongodb://localhost:27017/bom',
        AUTH_JWT_SECRET: `\uFEFF${SECRET}`,
        GOOGLE_SERVICE_ACCOUNT_JSON: `\uFEFF${SERVICE_ACCOUNT_JSON}`,
      }),
    );

    const env = getEnv();

    expect(env.mongoUri).toBe('mongodb://localhost:27017/bom');
    expect(env.authJwtSecret).toBe(SECRET);
    expect(env.googleServiceAccount?.project_id).toBe('demo-project');
  });

  it('drops the Google OAuth client requirement when AUTH_DEV_LOGIN is true', () => {
    setEnv({
      MONGODB_URI: 'mongodb://localhost:27017/video-studio',
      AUTH_JWT_SECRET: SECRET,
      AUTH_DEV_LOGIN: 'true',
      FAKE_VERTEX: 'true',
    });

    const env = getEnv();

    expect(env.authDevLogin).toBe(true);
    expect(env.fakeVertex).toBe(true);
    expect(env.googleClientId).toBe('');
    expect(env.googleClientSecret).toBe('');
    expect(env.googleServiceAccount).toBeNull();
  });

  it('still requires the Google OAuth client when AUTH_DEV_LOGIN is false', () => {
    setEnv({
      MONGODB_URI: 'mongodb://localhost:27017/video-studio',
      AUTH_JWT_SECRET: SECRET,
      FAKE_VERTEX: 'true',
    });

    expect(() => getEnv()).toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
  });
});
