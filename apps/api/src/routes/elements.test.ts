import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElementDto, UserDto } from '@video-studio/shared';
import type { FastifyInstance } from 'fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let mongo: MongoMemoryServer;
let app: FastifyInstance;
let disconnect: () => Promise<void>;

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

async function createElement(cookie: string, name: string): Promise<InjectedResponse> {
  return await app.inject({
    method: 'POST',
    url: '/api/elements',
    headers: { cookie },
    payload: { name, category: 'character', description: `${name} description` },
  });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('video_studio_elements_test');

  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.MONGODB_URI = uri;
  process.env.AUTH_JWT_SECRET = 'test-only-secret-value-of-at-least-32-chars';
  process.env.AUTH_DEV_LOGIN = 'true';
  process.env.FAKE_VERTEX = 'true';
  process.env.MCP_ENABLED = 'false';
  process.env.ALLOWED_EMAILS = '';
  process.env.CORS_ORIGINS = '';
  process.env.MEDIA_ROOT = await mkdtemp(join(tmpdir(), 'video-studio-elements-'));
  process.env.ANTHROPIC_API_KEY = '';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '';

  const { resetEnvCache } = await import('../env.js');
  resetEnvCache();

  const { connectDb, disconnectDb } = await import('../db/connect.js');
  await connectDb(uri);
  disconnect = disconnectDb;

  // The duplicate-handle case depends on the { userId, handle } unique index existing.
  const { ElementModel } = await import('../db/models/element.js');
  await ElementModel.init();

  const { buildApp } = await import('../app.js');
  app = await buildApp();
  await app.ready();
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (disconnect) await disconnect();
  if (mongo) await mongo.stop();
});

describe('element routes', () => {
  it('creates an element with a derived handle and lists it', async () => {
    const { cookie, user } = await signIn('elements-create@example.com');

    const created = await createElement(cookie, 'Luna');
    expect(created.statusCode).toBe(200);

    const element = parse<ElementDto>(created.body);
    expect(element.handle).toBe('@Luna');
    expect(element.category).toBe('character');
    expect(element.pinned).toBe(false);
    expect(element.userId).toBe(user.id);

    const listed = await app.inject({ method: 'GET', url: '/api/elements', headers: { cookie } });
    expect(listed.statusCode).toBe(200);
    expect(parse<ElementDto[]>(listed.body).map((item) => item.id)).toEqual([element.id]);
  });

  it('rejects a signed-out caller', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/elements' });
    expect(response.statusCode).toBe(401);
  });

  it('rebuilds the handle on rename and honours pinning', async () => {
    const { cookie } = await signIn('elements-update@example.com');
    const created = parse<ElementDto>((await createElement(cookie, 'Old Name')).body);
    expect(created.handle).toBe('@Old_Name');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/elements/${created.id}`,
      headers: { cookie },
      payload: { name: 'Новое Имя', pinned: true },
    });

    expect(response.statusCode).toBe(200);
    const updated = parse<ElementDto>(response.body);
    expect(updated.name).toBe('Новое Имя');
    expect(updated.handle).toBe('@Новое_Имя');
    expect(updated.pinned).toBe(true);
  });

  it('reports a duplicate handle as invalid-argument', async () => {
    const { cookie } = await signIn('elements-duplicate@example.com');

    expect((await createElement(cookie, 'Twin')).statusCode).toBe(200);

    const duplicate = await createElement(cookie, 'Twin');
    expect(duplicate.statusCode).toBe(400);

    const body = parse<{ error: { code: string; message: string } }>(duplicate.body);
    expect(body.error.code).toBe('invalid-argument');
    expect(body.error.message).toContain('@Twin');
  });

  it('lets a second account reuse the same handle', async () => {
    const first = await signIn('elements-tenant-a@example.com');
    const second = await signIn('elements-tenant-b@example.com');

    expect((await createElement(first.cookie, 'Shared')).statusCode).toBe(200);
    expect((await createElement(second.cookie, 'Shared')).statusCode).toBe(200);
  });

  it('deletes an element', async () => {
    const { cookie } = await signIn('elements-delete@example.com');
    const created = parse<ElementDto>((await createElement(cookie, 'Disposable')).body);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/elements/${created.id}`,
      headers: { cookie },
    });
    expect(deleted.statusCode).toBe(204);

    const listed = await app.inject({ method: 'GET', url: '/api/elements', headers: { cookie } });
    expect(parse<ElementDto[]>(listed.body)).toEqual([]);
  });
});
