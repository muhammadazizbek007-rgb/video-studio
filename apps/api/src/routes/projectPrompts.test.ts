import type { ProjectPromptDto } from '@video-studio/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

type AppModule = typeof import('../app.js');
type PromptModule = typeof import('../db/models/projectPrompt.js');

let mongo: MongoMemoryServer;
let app: Awaited<ReturnType<AppModule['buildApp']>>;
let disconnect: () => Promise<void>;
let promptModule: PromptModule;

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

async function addPrompt(cookie: string, name: string, prompt: string) {
  return await app.inject({
    method: 'POST',
    url: '/api/project-prompts',
    headers: { cookie },
    payload: { name, prompt },
  });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('video_studio_project_prompts_test');

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
  promptModule = await import('../db/models/projectPrompt.js');
  await promptModule.ProjectPromptModel.init();

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
  await promptModule.ProjectPromptModel.deleteMany({});
});

describe('project prompts', () => {
  it('saves a block of project context and lists it back', async () => {
    const cookie = await signIn('pp-owner@example.com');

    const created = await addPrompt(
      cookie,
      'Бренд Dona',
      'газировка Dona, стеклянная бутылка, этикетка сине-белая',
    );
    expect(created.statusCode).toBe(201);
    expect(parse<ProjectPromptDto>(created.body).name).toBe('Бренд Dona');

    const listed = await app.inject({
      method: 'GET',
      url: '/api/project-prompts',
      headers: { cookie },
    });
    const items = parse<{ items: ProjectPromptDto[] }>(listed.body).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.prompt).toContain('этикетка сине-белая');
  });

  // Two entries with the same name are indistinguishable in the @ list, which is the one
  // place this data is ever read.
  it('refuses a second entry with the same name', async () => {
    const cookie = await signIn('pp-dupe@example.com');
    await addPrompt(cookie, 'Бренд', 'первый');

    const second = await addPrompt(cookie, 'Бренд', 'второй');

    expect(second.statusCode).toBe(400);
    expect(second.body).toContain('already exists');
  });

  it('lets two accounts use the same name without colliding', async () => {
    const alice = await signIn('pp-alice@example.com');
    const bob = await signIn('pp-bob@example.com');

    expect((await addPrompt(alice, 'Бренд', 'её текст')).statusCode).toBe(201);
    expect((await addPrompt(bob, 'Бренд', 'его текст')).statusCode).toBe(201);
  });

  it('shows an account only its own entries', async () => {
    const alice = await signIn('pp-alice-only@example.com');
    const bob = await signIn('pp-bob-only@example.com');
    await addPrompt(alice, 'Только Алисин', 'описание');

    const listed = await app.inject({
      method: 'GET',
      url: '/api/project-prompts',
      headers: { cookie: bob },
    });

    expect(parse<{ items: ProjectPromptDto[] }>(listed.body).items).toHaveLength(0);
  });

  it('will not let a stranger edit or delete an entry', async () => {
    const owner = await signIn('pp-owner2@example.com');
    const stranger = await signIn('pp-stranger@example.com');
    const created = parse<ProjectPromptDto>((await addPrompt(owner, 'Мой', 'описание')).body);

    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/project-prompts/${created.id}`,
      headers: { cookie: stranger },
      payload: { name: 'Чужой' },
    });
    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/project-prompts/${created.id}`,
      headers: { cookie: stranger },
    });

    expect(edit.statusCode).toBe(403);
    expect(remove.statusCode).toBe(403);
  });

  it('rewrites an entry in place', async () => {
    const cookie = await signIn('pp-editor@example.com');
    const created = parse<ProjectPromptDto>((await addPrompt(cookie, 'Бренд', 'старое')).body);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/project-prompts/${created.id}`,
      headers: { cookie },
      payload: { prompt: 'новое описание, баритон' },
    });

    expect(updated.statusCode).toBe(200);
    expect(parse<ProjectPromptDto>(updated.body).prompt).toBe('новое описание, баритон');
  });

  it('requires a signed-in account', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/project-prompts' });
    expect(response.statusCode).toBe(401);
  });
});
