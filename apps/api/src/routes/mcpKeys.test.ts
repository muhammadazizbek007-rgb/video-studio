import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpKeyIssuedDto, McpKeyStatusDto, UserDto } from '@video-studio/shared';
import type { FastifyInstance } from 'fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let mongo: MongoMemoryServer;
let app: FastifyInstance;
let disconnect: () => Promise<void>;

const API_PUBLIC_URL = 'https://studio-api.example.test';

interface InjectedResponse {
  statusCode: number;
  body: string;
  headers: Record<string, number | string | string[] | undefined>;
}

function parse<T>(body: string): T {
  return JSON.parse(body) as T;
}

function cookieHeader(response: InjectedResponse): string {
  const raw = response.headers['set-cookie'];
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return values
    .map((entry) => entry.split(';')[0] ?? '')
    .filter((entry) => entry !== '')
    .join('; ');
}

async function signIn(email: string): Promise<{ cookie: string; user: UserDto }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/dev-login',
    payload: { email, name: email },
  });
  if (response.statusCode !== 200) {
    throw new Error(`dev-login failed: ${response.statusCode} ${response.body}`);
  }
  return { cookie: cookieHeader(response), user: parse<UserDto>(response.body) };
}

async function issueKey(cookie: string): Promise<McpKeyIssuedDto> {
  const response = await app.inject({ method: 'POST', url: '/api/mcp/key', headers: { cookie } });
  if (response.statusCode !== 201) {
    throw new Error(`issue failed: ${response.statusCode} ${response.body}`);
  }
  return parse<McpKeyIssuedDto>(response.body);
}

/** The secret is only ever in the URL, so that is where a test has to read it from. */
function tokenOf(issued: McpKeyIssuedDto): string {
  return issued.url.split('/mcp/k/')[1] ?? '';
}

/** A minimal MCP handshake — enough to prove the key authenticated. */
function initializePayload() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    },
  };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('video_studio_mcp_keys_test');

  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.MONGODB_URI = uri;
  process.env.AUTH_JWT_SECRET = 'test-only-secret-value-of-at-least-32-chars';
  process.env.AUTH_DEV_LOGIN = 'true';
  process.env.FAKE_VERTEX = 'true';
  process.env.MCP_ENABLED = 'true';
  process.env.API_PUBLIC_URL = API_PUBLIC_URL;
  process.env.ALLOWED_EMAILS = '';
  process.env.CORS_ORIGINS = '';
  process.env.MEDIA_ROOT = await mkdtemp(join(tmpdir(), 'video-studio-mcp-'));
  process.env.ANTHROPIC_API_KEY = '';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '';

  const { resetEnvCache } = await import('../env.js');
  resetEnvCache();

  const { connectDb, disconnectDb } = await import('../db/connect.js');
  await connectDb(uri);
  disconnect = disconnectDb;

  const { buildApp } = await import('../app.js');
  app = await buildApp();
  await app.ready();
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (disconnect) await disconnect();
  if (mongo) await mongo.stop();
});

describe('mcp key routes', () => {
  it('reports no key before one is issued', async () => {
    const { cookie } = await signIn('mcp-fresh@example.com');
    const response = await app.inject({ method: 'GET', url: '/api/mcp/key', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    const status = parse<McpKeyStatusDto>(response.body);
    expect(status.hasKey).toBe(false);
    expect(status.enabled).toBe(true);
    expect(status.hint).toBeUndefined();
  });

  it('rejects a signed-out caller', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/mcp/key' });

    expect(response.statusCode).toBe(401);
    expect(parse<{ error: { code: string } }>(response.body).error.code).toBe('unauthenticated');
  });

  it('issues a connector URL built from the public API address', async () => {
    const { cookie } = await signIn('mcp-issue@example.com');
    const issued = await issueKey(cookie);

    expect(issued.url.startsWith(`${API_PUBLIC_URL}/mcp/k/vsmcp_`)).toBe(true);
    expect(issued.hint).toHaveLength(6);
    expect(tokenOf(issued).endsWith(issued.hint)).toBe(true);
  });

  it('never returns the secret again after issuing it', async () => {
    const { cookie } = await signIn('mcp-secret@example.com');
    const issued = await issueKey(cookie);

    const response = await app.inject({ method: 'GET', url: '/api/mcp/key', headers: { cookie } });
    const status = parse<McpKeyStatusDto>(response.body);

    expect(status.hasKey).toBe(true);
    expect(status.hint).toBe(issued.hint);
    // The whole point of hashing it: no field anywhere can rebuild the key.
    expect(response.body).not.toContain(tokenOf(issued));
  });

  it('authenticates an MCP call made with the key in the URL', async () => {
    const { cookie } = await signIn('mcp-connect@example.com');
    const issued = await issueKey(cookie);

    const response = await app.inject({
      method: 'POST',
      url: `/mcp/k/${tokenOf(issued)}`,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: initializePayload(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('serverInfo');
  });

  it('refuses an MCP call with a key that was never issued', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/mcp/k/vsmcp_not-a-real-key',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: initializePayload(),
    });

    expect(response.statusCode).toBe(401);
    expect(parse<{ error: { code: string } }>(response.body).error.code).toBe('unauthenticated');
  });

  it('records when the key was last used', async () => {
    const { cookie } = await signIn('mcp-used@example.com');
    const issued = await issueKey(cookie);

    const before = await app.inject({ method: 'GET', url: '/api/mcp/key', headers: { cookie } });
    expect(parse<McpKeyStatusDto>(before.body).lastUsedAt).toBeUndefined();

    await app.inject({
      method: 'POST',
      url: `/mcp/k/${tokenOf(issued)}`,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: initializePayload(),
    });

    // The stamp is written without blocking the response, so give it a moment to land.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const after = await app.inject({ method: 'GET', url: '/api/mcp/key', headers: { cookie } });
    expect(parse<McpKeyStatusDto>(after.body).lastUsedAt).toBeTruthy();
  });

  it('retires the previous key when a new one is issued', async () => {
    const { cookie } = await signIn('mcp-rotate@example.com');
    const first = await issueKey(cookie);
    const second = await issueKey(cookie);

    expect(tokenOf(second)).not.toBe(tokenOf(first));

    const stale = await app.inject({
      method: 'POST',
      url: `/mcp/k/${tokenOf(first)}`,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: initializePayload(),
    });
    expect(stale.statusCode).toBe(401);

    const fresh = await app.inject({
      method: 'POST',
      url: `/mcp/k/${tokenOf(second)}`,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: initializePayload(),
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('revokes the key so it stops authenticating', async () => {
    const { cookie } = await signIn('mcp-revoke@example.com');
    const issued = await issueKey(cookie);

    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/mcp/key',
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(204);

    const status = await app.inject({ method: 'GET', url: '/api/mcp/key', headers: { cookie } });
    expect(parse<McpKeyStatusDto>(status.body).hasKey).toBe(false);

    const rejected = await app.inject({
      method: 'POST',
      url: `/mcp/k/${tokenOf(issued)}`,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: initializePayload(),
    });
    expect(rejected.statusCode).toBe(401);
  });

  it("does not let one account's key act as another", async () => {
    const owner = await signIn('mcp-owner@example.com');
    const other = await signIn('mcp-other@example.com');

    const ownerKey = await issueKey(owner.cookie);
    await issueKey(other.cookie);

    // Revoking the other account must leave the owner's key untouched.
    await app.inject({ method: 'DELETE', url: '/api/mcp/key', headers: { cookie: other.cookie } });

    const stillWorks = await app.inject({
      method: 'POST',
      url: `/mcp/k/${tokenOf(ownerKey)}`,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: initializePayload(),
    });
    expect(stillWorks.statusCode).toBe(200);
  });

  it('hands Claude absolute media URLs, not host-relative paths', async () => {
    const { cookie } = await signIn('mcp-urls@example.com');
    const issued = await issueKey(cookie);

    const response = await app.inject({
      method: 'POST',
      url: `/mcp/k/${tokenOf(issued)}`,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'generate_image', arguments: { prompt: 'a lighthouse keeper' } },
      },
    });

    expect(response.statusCode).toBe(200);
    const frame = response.body.split('data: ')[1] ?? '';
    const envelope = parse<{ result: { content: { text: string }[]; isError?: boolean } }>(frame);
    expect(envelope.result.isError).not.toBe(true);

    const payload = parse<{ image_url: string }>(envelope.result.content[0]?.text ?? '{}');
    // A relative `/media/...` cannot be opened by Claude, and Veo fetches rather than
    // resolves a reference frame — so a relative URL breaks the image-to-video workflow.
    expect(payload.image_url.startsWith(`${API_PUBLIC_URL}/media/`)).toBe(true);
  });

  it('refuses the server-initiated stream on the key route', async () => {
    const { cookie } = await signIn('mcp-get@example.com');
    const issued = await issueKey(cookie);

    const response = await app.inject({ method: 'GET', url: `/mcp/k/${tokenOf(issued)}` });

    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe('POST');
  });
});
