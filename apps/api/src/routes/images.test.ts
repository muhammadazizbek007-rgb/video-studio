import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ImageGenerationDto, UserDto } from '@video-studio/shared';
import { DEFAULT_IMAGE_MODEL_ID } from '@video-studio/shared';
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

const CREATE_PAYLOAD = {
  prompt: 'A ceramic mug on a walnut desk',
  modelId: DEFAULT_IMAGE_MODEL_ID,
  aspectRatio: '1:1',
  stylePreset: 'Product Demo',
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

async function createImage(
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<ImageGenerationDto> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/images',
    headers: { cookie },
    payload: { ...CREATE_PAYLOAD, ...overrides },
  });
  expect(response.statusCode).toBe(200);
  return parse<ImageGenerationDto>(response.body);
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('video_studio_images_test');

  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.MONGODB_URI = uri;
  process.env.AUTH_JWT_SECRET = 'test-only-secret-value-of-at-least-32-chars';
  process.env.AUTH_DEV_LOGIN = 'true';
  process.env.FAKE_VERTEX = 'true';
  process.env.MCP_ENABLED = 'false';
  process.env.ALLOWED_EMAILS = '';
  process.env.CORS_ORIGINS = '';
  process.env.MEDIA_ROOT = await mkdtemp(join(tmpdir(), 'video-studio-images-'));
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

describe('image routes', () => {
  it('folds the chosen style preset into the prompt it sends', async () => {
    const { cookie } = await signIn('stylist@example.com');
    const created = await createImage(cookie);

    expect(created.status).toBe('completed');
    expect(created.stylePreset).toBe('Product Demo');
    // The user's text survives, and the preset arrives as a description rather than a label.
    expect(created.prompt).toBe(CREATE_PAYLOAD.prompt);
    expect(created.finalPrompt.startsWith(CREATE_PAYLOAD.prompt)).toBe(true);
    expect(created.finalPrompt).toContain('Product photograph');
    expect(created.imageUrl).toBeTruthy();
  });

  it('sends a different prompt for a different preset', async () => {
    const { cookie } = await signIn('two-styles@example.com');
    const product = await createImage(cookie);
    const ugc = await createImage(cookie, { stylePreset: 'UGC' });

    expect(ugc.finalPrompt).not.toBe(product.finalPrompt);
    expect(ugc.finalPrompt).toContain('user-generated');
  });

  it('lists the newest image first', async () => {
    const { cookie } = await signIn('gallery@example.com');
    await createImage(cookie, { prompt: 'first' });
    const second = await createImage(cookie, { prompt: 'second' });

    const response = await app.inject({ method: 'GET', url: '/api/images', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const page = parse<{ items: ImageGenerationDto[] }>(response.body);
    expect(page.items[0]?.id).toBe(second.id);
    expect(page.items).toHaveLength(2);
  });

  it('rejects an unknown model with invalid-argument', async () => {
    const { cookie } = await signIn('bad-model@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/images',
      headers: { cookie },
      payload: { ...CREATE_PAYLOAD, modelId: 'veo-3.1-fast' },
    });

    expect(response.statusCode).toBe(400);
    expect(parse<{ error: { code: string } }>(response.body).error.code).toBe('invalid-argument');
  });

  it('rejects a signed-out caller', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/images' });
    expect(response.statusCode).toBe(401);
  });

  it('likes a still so the picker can collect it', async () => {
    const { cookie } = await signIn('liker@example.com');
    const created = await createImage(cookie);
    expect(created.saved).toBe(false);

    const liked = await app.inject({
      method: 'PATCH',
      url: `/api/images/${created.id}`,
      headers: { cookie },
      payload: { saved: true },
    });

    expect(liked.statusCode).toBe(200);
    expect(parse<ImageGenerationDto>(liked.body).saved).toBe(true);
  });

  it("does not delete another account's image", async () => {
    const owner = await signIn('owner@example.com');
    const intruder = await signIn('intruder@example.com');
    const created = await createImage(owner.cookie);

    const forbidden = await app.inject({
      method: 'DELETE',
      url: `/api/images/${created.id}`,
      headers: { cookie: intruder.cookie },
    });
    expect(forbidden.statusCode).toBe(403);

    const missing = await app.inject({
      method: 'DELETE',
      url: `/api/images/${new Types.ObjectId().toString()}`,
      headers: { cookie: intruder.cookie },
    });
    expect(missing.statusCode).toBe(404);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/images/${created.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(removed.statusCode).toBe(204);
  });
});
