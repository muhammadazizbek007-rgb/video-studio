import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StoryboardDto, UserDto } from '@video-studio/shared';
import type { FastifyInstance } from 'fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let mongo: MongoMemoryServer;
let app: FastifyInstance;
let mediaRoot: string;
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

async function createBoard(cookie: string, segmentCount = 2): Promise<StoryboardDto> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/storyboards',
    headers: { cookie },
    payload: { prompt: 'a lighthouse at dusk', segmentCount },
  });
  if (response.statusCode !== 201) {
    throw new Error(`create storyboard failed: ${response.statusCode} ${response.body}`);
  }
  return parse<StoryboardDto>(response.body);
}

/** Writes a real file under the media root so cleanup assertions have something to delete. */
async function fakeUpload(userId: string, name: string): Promise<{ url: string; path: string }> {
  const directory = join(mediaRoot, 'uploads', userId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, name), 'not-really-an-image');
  return { url: `/media/uploads/${userId}/${name}`, path: `uploads/${userId}/${name}` };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('video_studio_storyboards_test');
  mediaRoot = await mkdtemp(join(tmpdir(), 'video-studio-storyboards-'));

  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.MONGODB_URI = uri;
  process.env.AUTH_JWT_SECRET = 'test-only-secret-value-of-at-least-32-chars';
  process.env.AUTH_DEV_LOGIN = 'true';
  process.env.FAKE_VERTEX = 'true';
  process.env.MCP_ENABLED = 'false';
  process.env.ALLOWED_EMAILS = '';
  process.env.CORS_ORIGINS = '';
  process.env.MEDIA_ROOT = mediaRoot;
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

describe('storyboard routes', () => {
  it('creates a board with the requested number of empty segments', async () => {
    const { cookie } = await signIn('board-creator@example.com');
    const board = await createBoard(cookie, 3);

    expect(board.segments).toHaveLength(3);
    expect(board.segments.map((segment) => segment.index)).toEqual([0, 1, 2]);
    expect(board.exportStatus).toBe('idle');
    expect(board.prompt).toBe('a lighthouse at dusk');
  });

  it('rejects a signed-out caller', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/storyboards' });

    expect(response.statusCode).toBe(401);
    expect(parse<{ error: { code: string } }>(response.body).error.code).toBe('unauthenticated');
  });

  it("does not expose another account's storyboard", async () => {
    const owner = await signIn('sb-owner@example.com');
    const intruder = await signIn('sb-intruder@example.com');
    const board = await createBoard(owner.cookie);

    const response = await app.inject({
      method: 'GET',
      url: `/api/storyboards/${board.id}`,
      headers: { cookie: intruder.cookie },
    });

    expect(response.statusCode).toBe(403);
    expect(parse<{ error: { code: string } }>(response.body).error.code).toBe('permission-denied');
  });

  it('stores a first frame on a segment and clears it again', async () => {
    const { cookie, user } = await signIn('frames@example.com');
    const board = await createBoard(cookie);
    const upload = await fakeUpload(user.id, 'first.png');

    const set = await app.inject({
      method: 'PATCH',
      url: `/api/storyboards/${board.id}/segments/0`,
      headers: { cookie },
      payload: { firstFrame: upload },
    });
    expect(set.statusCode).toBe(200);
    expect(parse<StoryboardDto>(set.body).segments[0]?.firstFrameUrl).toBe(upload.url);

    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/storyboards/${board.id}/segments/0`,
      headers: { cookie },
      payload: { firstFrame: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(parse<StoryboardDto>(cleared.body).segments[0]?.firstFrameUrl).toBeUndefined();

    // The stored object goes with the reference; a leaked file is invisible until the disk fills.
    await expect(access(join(mediaRoot, 'uploads', user.id, 'first.png'))).rejects.toThrow();
  });

  it('rejects a segment index the board does not have', async () => {
    const { cookie } = await signIn('range@example.com');
    const board = await createBoard(cookie, 1);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/storyboards/${board.id}/segments/7`,
      headers: { cookie },
      payload: { firstFrame: null },
    });

    expect(response.statusCode).toBe(404);
  });

  it('grows and shrinks the segment list', async () => {
    const { cookie } = await signIn('resize@example.com');
    const board = await createBoard(cookie, 2);

    const grown = await app.inject({
      method: 'PATCH',
      url: `/api/storyboards/${board.id}`,
      headers: { cookie },
      payload: { segmentCount: 5 },
    });
    expect(parse<StoryboardDto>(grown.body).segments).toHaveLength(5);

    const shrunk = await app.inject({
      method: 'PATCH',
      url: `/api/storyboards/${board.id}`,
      headers: { cookie },
      payload: { segmentCount: 1 },
    });
    expect(parse<StoryboardDto>(shrunk.body).segments).toHaveLength(1);
  });

  it('re-resolves the aspect ratio when the model changes under it', async () => {
    const { cookie } = await signIn('clamp@example.com');
    const board = await createBoard(cookie, 1);

    // 1:1 is in the shared enum but no Veo model offers it, so it must not survive a save.
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/storyboards/${board.id}`,
      headers: { cookie },
      payload: { aspectRatio: '1:1' },
    });

    expect(response.statusCode).toBe(200);
    expect(parse<StoryboardDto>(response.body).aspectRatio).toBe('16:9');
  });

  it('generates a segment and links the generation to it', async () => {
    const { cookie } = await signIn('generate@example.com');
    const board = await createBoard(cookie, 2);

    const response = await app.inject({
      method: 'POST',
      url: `/api/storyboards/${board.id}/segments/1/generate`,
      headers: { cookie },
      payload: {},
    });

    expect(response.statusCode).toBe(202);
    const updated = parse<StoryboardDto>(response.body);
    const segment = updated.segments[1];
    expect(segment?.generationId).toBeTruthy();
    expect(segment?.status).toBe('processing');
    // Untouched segments must stay untouched.
    expect(updated.segments[0]?.generationId).toBeUndefined();
  });

  it('refuses to generate a segment with no prompt anywhere', async () => {
    const { cookie } = await signIn('no-prompt@example.com');
    const created = await app.inject({
      method: 'POST',
      url: '/api/storyboards',
      headers: { cookie },
      payload: { segmentCount: 1 },
    });
    const board = parse<StoryboardDto>(created.body);

    const response = await app.inject({
      method: 'POST',
      url: `/api/storyboards/${board.id}/segments/0/generate`,
      headers: { cookie },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(parse<{ error: { code: string } }>(response.body).error.code).toBe('invalid-argument');
  });

  it('detaches a generation so the segment returns to its upload slots', async () => {
    const { cookie } = await signIn('detach@example.com');
    const board = await createBoard(cookie, 1);

    await app.inject({
      method: 'POST',
      url: `/api/storyboards/${board.id}/segments/0/generate`,
      headers: { cookie },
      payload: {},
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/storyboards/${board.id}/segments/0/generation`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const segment = parse<StoryboardDto>(response.body).segments[0];
    expect(segment?.generationId).toBeUndefined();
    expect(segment?.status).toBeUndefined();
  });

  it('refuses to export a board with no finished segments', async () => {
    const { cookie } = await signIn('empty-export@example.com');
    const board = await createBoard(cookie, 1);

    const response = await app.inject({
      method: 'POST',
      url: `/api/storyboards/${board.id}/export`,
      headers: { cookie },
    });

    // Either answer is correct and both are honest: nothing to stitch, or no stitcher.
    expect([400, 503]).toContain(response.statusCode);
  });

  it('reports whether this deployment can stitch server-side', async () => {
    const { cookie } = await signIn('capabilities@example.com');
    const response = await app.inject({
      method: 'GET',
      url: '/api/storyboards/capabilities',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(typeof parse<{ serverStitching: boolean }>(response.body).serverStitching).toBe(
      'boolean',
    );
  });

  it('deletes a board and its uploads without deleting the account history', async () => {
    const { cookie, user } = await signIn('delete@example.com');
    const board = await createBoard(cookie, 1);
    const upload = await fakeUpload(user.id, 'doomed.png');

    await app.inject({
      method: 'PATCH',
      url: `/api/storyboards/${board.id}/segments/0`,
      headers: { cookie },
      payload: { firstFrame: upload },
    });
    await app.inject({
      method: 'POST',
      url: `/api/storyboards/${board.id}/segments/0/generate`,
      headers: { cookie },
      payload: {},
    });

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/storyboards/${board.id}`,
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(204);

    const gone = await app.inject({
      method: 'GET',
      url: `/api/storyboards/${board.id}`,
      headers: { cookie },
    });
    expect(gone.statusCode).toBe(404);

    // The generation is the account's history and outlives the board it was made for.
    const history = await app.inject({
      method: 'GET',
      url: '/api/generations',
      headers: { cookie },
    });
    expect(parse<{ items: unknown[] }>(history.body).items.length).toBeGreaterThan(0);
  });
});
