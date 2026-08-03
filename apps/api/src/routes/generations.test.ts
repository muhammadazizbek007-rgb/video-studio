import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GenerationDto, UserDto } from '@video-studio/shared';
import { DEFAULT_VIDEO_MODEL_ID } from '@video-studio/shared';
import type { FastifyInstance } from 'fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type GenerationModule = typeof import('../db/models/generation.js');

let mongo: MongoMemoryServer;
let app: FastifyInstance;
let generationModule: GenerationModule;
let disconnect: () => Promise<void>;

interface InjectedResponse {
  statusCode: number;
  body: string;
  headers: Record<string, number | string | string[] | undefined>;
}

const CREATE_PAYLOAD = {
  prompt: 'A neon cat surfing a data wave',
  modelId: DEFAULT_VIDEO_MODEL_ID,
  mode: 'text_to_video',
  aspectRatio: '16:9',
  duration: 8,
  stylePreset: 'Cinematic',
  cameraMotion: 'Static',
};

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

async function createGeneration(cookie: string): Promise<GenerationDto> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/generations',
    headers: { cookie },
    payload: CREATE_PAYLOAD,
  });
  expect(response.statusCode).toBe(200);
  return parse<GenerationDto>(response.body);
}

/**
 * Seeded straight through the model: the pagination fixtures need controlled
 * createdAt values, and going through the route would eat the per-user create budget.
 */
async function seedGenerations(userId: string, count: number): Promise<string[]> {
  const base = Date.UTC(2026, 0, 1);
  const ids: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const doc = await generationModule.GenerationModel.create({
      userId: new Types.ObjectId(userId),
      prompt: `seed ${index}`,
      modelId: DEFAULT_VIDEO_MODEL_ID,
      mode: 'text_to_video',
      aspectRatio: '16:9',
      duration: 8,
      stylePreset: 'Cinematic',
      cameraMotion: 'Static',
      status: 'completed',
      saved: false,
      referenceImageUrls: [],
      elements: [],
      referenceCount: 0,
    });
    await generationModule.GenerationModel.updateOne(
      { _id: doc._id },
      { $set: { createdAt: new Date(base + index * 60_000) } },
      { timestamps: false },
    );
    ids.push(doc._id.toString());
  }

  return ids;
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('video_studio_generations_test');

  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.MONGODB_URI = uri;
  process.env.AUTH_JWT_SECRET = 'test-only-secret-value-of-at-least-32-chars';
  process.env.AUTH_DEV_LOGIN = 'true';
  process.env.FAKE_VERTEX = 'true';
  process.env.MCP_ENABLED = 'false';
  process.env.ALLOWED_EMAILS = '';
  process.env.CORS_ORIGINS = '';
  process.env.MEDIA_ROOT = await mkdtemp(join(tmpdir(), 'video-studio-generations-'));
  process.env.ANTHROPIC_API_KEY = '';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '';

  // Imported only once the environment is in place: logger.ts reads it at module load.
  const { resetEnvCache } = await import('../env.js');
  resetEnvCache();

  const { connectDb, disconnectDb } = await import('../db/connect.js');
  await connectDb(uri);
  disconnect = disconnectDb;

  generationModule = await import('../db/models/generation.js');

  const { buildApp } = await import('../app.js');
  app = await buildApp();
  await app.ready();
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (disconnect) await disconnect();
  if (mongo) await mongo.stop();
});

describe('generation routes', () => {
  it('creates a generation that is already processing', async () => {
    const { cookie } = await signIn('creator@example.com');
    const created = await createGeneration(cookie);

    expect(created.status).toBe('processing');
    expect(created.modelId).toBe(DEFAULT_VIDEO_MODEL_ID);
    expect(created.saved).toBe(false);
    expect(created.prompt).toBe(CREATE_PAYLOAD.prompt);
    expect(typeof created.createdAt).toBe('string');
  });

  it('rejects a signed-out caller', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/generations' });

    expect(response.statusCode).toBe(401);
    expect(parse<{ error: { code: string } }>(response.body).error.code).toBe('unauthenticated');
  });

  it('rejects an invalid payload with invalid-argument', async () => {
    const { cookie } = await signIn('invalid@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/generations',
      headers: { cookie },
      payload: { ...CREATE_PAYLOAD, prompt: '' },
    });

    expect(response.statusCode).toBe(400);
    expect(parse<{ error: { code: string } }>(response.body).error.code).toBe('invalid-argument');
  });

  it("does not expose another account's generation", async () => {
    const owner = await signIn('owner@example.com');
    const intruder = await signIn('intruder@example.com');
    const created = await createGeneration(owner.cookie);

    const forbidden = await app.inject({
      method: 'GET',
      url: `/api/generations/${created.id}`,
      headers: { cookie: intruder.cookie },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(parse<{ error: { code: string } }>(forbidden.body).error.code).toBe('permission-denied');

    const missing = await app.inject({
      method: 'GET',
      url: `/api/generations/${new Types.ObjectId().toString()}`,
      headers: { cookie: intruder.cookie },
    });
    expect(missing.statusCode).toBe(404);

    const malformed = await app.inject({
      method: 'GET',
      url: '/api/generations/not-an-object-id',
      headers: { cookie: intruder.cookie },
    });
    expect(malformed.statusCode).toBe(404);
  });

  it('paginates newest-first across a page boundary', async () => {
    const { cookie, user } = await signIn('pager@example.com');
    const seeded = await seedGenerations(user.id, 5);
    const newestFirst = [...seeded].reverse();

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const url: string = cursor
        ? `/api/generations?limit=2&cursor=${encodeURIComponent(cursor)}`
        : '/api/generations?limit=2';
      const response = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(response.statusCode).toBe(200);

      const page = parse<{ items: GenerationDto[]; nextCursor: string | null }>(response.body);
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 10);

    expect(pages).toBe(3);
    expect(cursor).toBeNull();
    expect(seen).toEqual(newestFirst);
    expect(new Set(seen).size).toBe(seeded.length);
  });

  it('toggles the saved flag', async () => {
    const { cookie } = await signIn('saver@example.com');
    const created = await createGeneration(cookie);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/generations/${created.id}`,
      headers: { cookie },
      payload: { saved: true },
    });

    expect(response.statusCode).toBe(200);
    expect(parse<GenerationDto>(response.body).saved).toBe(true);
  });

  it('deletes a generation', async () => {
    const { cookie } = await signIn('deleter@example.com');
    const created = await createGeneration(cookie);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/generations/${created.id}`,
      headers: { cookie },
    });
    expect(deleted.statusCode).toBe(204);

    const missing = await app.inject({
      method: 'GET',
      url: `/api/generations/${created.id}`,
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('drives a fake generation to completed on refresh', async () => {
    const { cookie } = await signIn('refresher@example.com');
    const created = await createGeneration(cookie);

    const response = await app.inject({
      method: 'POST',
      url: `/api/generations/${created.id}/refresh`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const refreshed = parse<GenerationDto>(response.body);
    expect(refreshed.status).toBe('completed');
    expect(refreshed.resultVideoUrl).toBeTruthy();
  });
});
