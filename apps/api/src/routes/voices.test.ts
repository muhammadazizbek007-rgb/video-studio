import type { VoiceDto } from '@video-studio/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

type AppModule = typeof import('../app.js');
type VoiceModule = typeof import('../db/models/voice.js');

let mongo: MongoMemoryServer;
let app: Awaited<ReturnType<AppModule['buildApp']>>;
let disconnect: () => Promise<void>;
let voiceModule: VoiceModule;

function parse<T>(body: string): T {
  return JSON.parse(body) as T;
}

function cookieHeader(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return values
    .map((entry) => entry.split(';')[0] ?? '')
    .filter((entry) => entry !== '')
    .join('; ');
}

async function signIn(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/dev-login',
    payload: { email, name: email },
  });
  return cookieHeader(response);
}

async function addVoice(cookie: string, name: string, prompt: string) {
  return await app.inject({
    method: 'POST',
    url: '/api/voices',
    headers: { cookie },
    payload: { name, prompt },
  });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('video_studio_voices_test');

  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.MONGODB_URI = uri;
  process.env.AUTH_JWT_SECRET = 'test-only-secret-value-of-at-least-32-chars';
  process.env.AUTH_DEV_LOGIN = 'true';
  process.env.FAKE_VERTEX = 'true';
  process.env.MCP_ENABLED = 'false';
  process.env.ALLOWED_EMAILS = '';
  process.env.CORS_ORIGINS = '';
  process.env.ANTHROPIC_API_KEY = '';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '';

  const { resetEnvCache } = await import('../env.js');
  resetEnvCache();

  const { connectDb, disconnectDb } = await import('../db/connect.js');
  await connectDb(uri);
  disconnect = disconnectDb;

  // The duplicate-name case depends on the { userId, name } unique index existing.
  voiceModule = await import('../db/models/voice.js');
  await voiceModule.VoiceModel.init();

  const appModule: AppModule = await import('../app.js');
  app = await appModule.buildApp();
  await app.ready();
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (disconnect) await disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  await voiceModule.VoiceModel.deleteMany({});
});

describe('voices', () => {
  it('saves a narrator and lists it back', async () => {
    const cookie = await signIn('voice-owner@example.com');

    const created = await addVoice(cookie, 'Диктор Дона', 'женщина около 30, тёплый низкий тембр');
    expect(created.statusCode).toBe(201);
    expect(parse<VoiceDto>(created.body).name).toBe('Диктор Дона');

    const listed = await app.inject({ method: 'GET', url: '/api/voices', headers: { cookie } });
    const items = parse<{ items: VoiceDto[] }>(listed.body).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.prompt).toContain('тёплый низкий тембр');
  });

  // Two narrators called "Диктор" are indistinguishable in a picker, which is the one place
  // this data is ever read.
  it('refuses a second voice with the same name', async () => {
    const cookie = await signIn('dupe@example.com');
    await addVoice(cookie, 'Диктор', 'первый');

    const second = await addVoice(cookie, 'Диктор', 'второй');

    expect(second.statusCode).toBe(400);
    expect(second.body).toContain('already exists');
  });

  it('lets two accounts use the same name without colliding', async () => {
    const alice = await signIn('alice-voice@example.com');
    const bob = await signIn('bob-voice@example.com');

    expect((await addVoice(alice, 'Диктор', 'её голос')).statusCode).toBe(201);
    expect((await addVoice(bob, 'Диктор', 'его голос')).statusCode).toBe(201);
  });

  it('shows an account only its own voices', async () => {
    const alice = await signIn('alice-only@example.com');
    const bob = await signIn('bob-only@example.com');
    await addVoice(alice, 'Только Алисин', 'описание');

    const listed = await app.inject({
      method: 'GET',
      url: '/api/voices',
      headers: { cookie: bob },
    });

    expect(parse<{ items: VoiceDto[] }>(listed.body).items).toHaveLength(0);
  });

  it('will not let a stranger edit or delete a voice', async () => {
    const owner = await signIn('owner-voice@example.com');
    const stranger = await signIn('stranger-voice@example.com');
    const created = parse<VoiceDto>((await addVoice(owner, 'Мой', 'описание')).body);

    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/voices/${created.id}`,
      headers: { cookie: stranger },
      payload: { name: 'Чужой' },
    });
    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/voices/${created.id}`,
      headers: { cookie: stranger },
    });

    expect(edit.statusCode).toBe(403);
    expect(remove.statusCode).toBe(403);
  });

  it('rewrites a voice in place', async () => {
    const cookie = await signIn('editor-voice@example.com');
    const created = parse<VoiceDto>((await addVoice(cookie, 'Диктор', 'старое')).body);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/voices/${created.id}`,
      headers: { cookie },
      payload: { prompt: 'новое описание, баритон' },
    });

    expect(updated.statusCode).toBe(200);
    expect(parse<VoiceDto>(updated.body).prompt).toBe('новое описание, баритон');
  });

  it('requires a signed-in account', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/voices' });
    expect(response.statusCode).toBe(401);
  });
});
