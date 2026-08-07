import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UploadDto, UserDto } from '@video-studio/shared';
import type { FastifyInstance } from 'fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let mongo: MongoMemoryServer;
let app: FastifyInstance;
let disconnect: () => Promise<void>;

interface InjectedResponse {
  statusCode: number;
  body: string;
  headers: Record<string, number | string | string[] | undefined>;
}

/** A 1x1 PNG — the smallest thing the upload route will accept as an image. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

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

/** Hand-rolled multipart: `inject` has no form helper and the route reads the raw stream. */
function multipart(filename: string, contentType: string, data: Buffer) {
  const boundary = '----videostudiotest';
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    payload: Buffer.concat([head, data, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function upload(cookie: string, filename = 'desk.png'): Promise<UploadDto> {
  const form = multipart(filename, 'image/png', PNG);
  const response = await app.inject({
    method: 'POST',
    url: '/api/media/upload',
    headers: { ...form.headers, cookie },
    payload: form.payload,
  });
  expect(response.statusCode).toBe(200);
  return parse<UploadDto>(response.body);
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('video_studio_media_test');

  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.MONGODB_URI = uri;
  process.env.AUTH_JWT_SECRET = 'test-only-secret-value-of-at-least-32-chars';
  process.env.AUTH_DEV_LOGIN = 'true';
  process.env.FAKE_VERTEX = 'true';
  process.env.MCP_ENABLED = 'false';
  process.env.ALLOWED_EMAILS = '';
  process.env.CORS_ORIGINS = '';
  process.env.MEDIA_ROOT = await mkdtemp(join(tmpdir(), 'video-studio-media-'));
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

describe('media routes', () => {
  it('records an upload instead of only returning its URL', async () => {
    const { cookie } = await signIn('uploader@example.com');
    const created = await upload(cookie);

    expect(created.url).toContain('/media/');
    expect(created.path).toContain('uploads/');
    expect(created.kind).toBe('image');
    expect(created.filename).toBe('desk.png');
    expect(created.saved).toBe(false);
    expect(created.bytes).toBeGreaterThan(0);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/media/uploads',
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    const page = parse<{ items: UploadDto[] }>(listed.body);
    expect(page.items.map((item) => item.id)).toContain(created.id);
  });

  it('narrows the list to the kind the caller can use', async () => {
    const { cookie } = await signIn('kinds@example.com');
    await upload(cookie);

    const images = await app.inject({
      method: 'GET',
      url: '/api/media/uploads?kind=image',
      headers: { cookie },
    });
    const videos = await app.inject({
      method: 'GET',
      url: '/api/media/uploads?kind=video',
      headers: { cookie },
    });

    expect(parse<{ items: UploadDto[] }>(images.body).items).toHaveLength(1);
    expect(parse<{ items: UploadDto[] }>(videos.body).items).toHaveLength(0);
  });

  it('likes and unlikes an upload', async () => {
    const { cookie } = await signIn('liker@example.com');
    const created = await upload(cookie);

    const liked = await app.inject({
      method: 'PATCH',
      url: `/api/media/uploads/${created.id}`,
      headers: { cookie },
      payload: { saved: true },
    });
    expect(liked.statusCode).toBe(200);
    expect(parse<UploadDto>(liked.body).saved).toBe(true);

    const unliked = await app.inject({
      method: 'PATCH',
      url: `/api/media/uploads/${created.id}`,
      headers: { cookie },
      payload: { saved: false },
    });
    expect(parse<UploadDto>(unliked.body).saved).toBe(false);
  });

  it('keeps one account out of another account uploads', async () => {
    const owner = await signIn('owner@example.com');
    const intruder = await signIn('intruder@example.com');
    const created = await upload(owner.cookie);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/media/uploads',
      headers: { cookie: intruder.cookie },
    });
    expect(parse<{ items: UploadDto[] }>(listed.body).items).toHaveLength(0);

    const forbidden = await app.inject({
      method: 'DELETE',
      url: `/api/media/uploads/${created.id}`,
      headers: { cookie: intruder.cookie },
    });
    expect(forbidden.statusCode).toBe(403);

    const missing = await app.inject({
      method: 'DELETE',
      url: `/api/media/uploads/${new Types.ObjectId().toString()}`,
      headers: { cookie: owner.cookie },
    });
    expect(missing.statusCode).toBe(404);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/media/uploads/${created.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(removed.statusCode).toBe(204);
  });

  it('refuses a type it cannot serve back', async () => {
    const { cookie } = await signIn('badtype@example.com');
    const form = multipart('notes.txt', 'text/plain', Buffer.from('hello', 'utf8'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/media/upload',
      headers: { ...form.headers, cookie },
      payload: form.payload,
    });

    expect(response.statusCode).toBe(400);
    expect(parse<{ error: { code: string } }>(response.body).error.code).toBe('invalid-argument');
  });

  it('rejects a signed-out caller', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/media/uploads' });
    expect(response.statusCode).toBe(401);
  });
});
