import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DEFAULT_VIDEO_MODEL_ID } from '@video-studio/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AuthUser } from '../auth/plugin.js';

type AppModule = typeof import('../app.js');
type AuthModule = typeof import('./auth.js');
type ServerModule = typeof import('./server.js');
type GenerationModule = typeof import('../db/models/generation.js');
type UserModule = typeof import('../db/models/user.js');

const PORTED_TOOLS = [
  'generate_image',
  'generate_video',
  'generate_video_with_references',
  'get_image_status',
  'get_video_status',
  'models_explore',
  'presets_show',
  'show_characters',
  'show_generations',
  'show_reference_elements',
];

const toolResultSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).min(1),
  isError: z.boolean().optional(),
});

let mongo: MongoMemoryServer;
let app: Awaited<ReturnType<AppModule['buildApp']>>;
let disconnect: () => Promise<void>;
let authModule: AuthModule;
let serverModule: ServerModule;
let generationModule: GenerationModule;
let userModule: UserModule;

let alice: AuthUser;
let bob: AuthUser;
let aliceClient: Client;
let bobClient: Client;

function payloadOf(result: unknown): Record<string, unknown> {
  const parsed = toolResultSchema.parse(result);
  const first = parsed.content[0];
  if (!first?.text) {
    throw new Error('the tool returned no text content');
  }
  if (parsed.isError === true) {
    throw new Error(`the tool reported an error: ${first.text}`);
  }
  return JSON.parse(first.text) as Record<string, unknown>;
}

async function createUser(email: string): Promise<AuthUser> {
  const doc = await userModule.UserModel.create({ email, name: email, picture: null });
  return { id: doc._id.toString(), email: doc.email, name: doc.name };
}

async function connectClient(user: AuthUser): Promise<Client> {
  const server = serverModule.createMcpServer(user);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'video-studio-mcp-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function generateVideo(client: Client, prompt: string): Promise<Record<string, unknown>> {
  return payloadOf(
    await client.callTool({
      name: 'generate_video',
      arguments: { prompt, model: DEFAULT_VIDEO_MODEL_ID, aspect_ratio: '16:9', duration: 8 },
    }),
  );
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('video_studio_mcp_test');

  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.MONGODB_URI = uri;
  process.env.AUTH_JWT_SECRET = 'test-only-secret-value-of-at-least-32-chars';
  process.env.AUTH_DEV_LOGIN = 'true';
  process.env.FAKE_VERTEX = 'true';
  process.env.MCP_ENABLED = 'true';
  process.env.ALLOWED_EMAILS = '';
  process.env.CORS_ORIGINS = '';
  process.env.MEDIA_ROOT = await mkdtemp(join(tmpdir(), 'video-studio-mcp-'));
  process.env.ANTHROPIC_API_KEY = '';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '';

  // Imported only once the environment is in place: logger.ts reads it at module load.
  const { resetEnvCache } = await import('../env.js');
  resetEnvCache();

  const { connectDb, disconnectDb } = await import('../db/connect.js');
  await connectDb(uri);
  disconnect = disconnectDb;

  authModule = await import('./auth.js');
  serverModule = await import('./server.js');
  generationModule = await import('../db/models/generation.js');
  userModule = await import('../db/models/user.js');

  const { buildApp } = await import('../app.js');
  app = await buildApp();
  await app.ready();

  alice = await createUser('alice@example.com');
  bob = await createUser('bob@example.com');
  aliceClient = await connectClient(alice);
  bobClient = await connectClient(bob);
}, 180_000);

afterAll(async () => {
  if (aliceClient) await aliceClient.close();
  if (bobClient) await bobClient.close();
  if (app) await app.close();
  if (disconnect) await disconnect();
  if (mongo) await mongo.stop();
});

describe('mcp tool registry', () => {
  it('exposes exactly the ported tools', async () => {
    const listed = await aliceClient.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();

    expect(names).toEqual([...PORTED_TOOLS].sort());
  });

  it('describes every model the studio can actually run', async () => {
    const payload = payloadOf(
      await aliceClient.callTool({ name: 'models_explore', arguments: {} }),
    );

    expect(payload.default_video_model).toBe(DEFAULT_VIDEO_MODEL_ID);
    expect(Array.isArray(payload.models)).toBe(true);
  });
});

describe('mcp video tools', () => {
  it('creates a generation owned by the calling account', async () => {
    const payload = await generateVideo(aliceClient, 'A neon cat surfing a data wave');
    const generationId = String(payload.generation_id);

    expect(payload.status).toBe('processing');
    expect(payload.model).toBe(DEFAULT_VIDEO_MODEL_ID);

    const doc = await generationModule.GenerationModel.findById(generationId).exec();
    expect(doc).not.toBeNull();
    expect(doc?.userId.toString()).toBe(alice.id);
  });

  it('rejects an unknown video model without writing a row', async () => {
    const result = toolResultSchema.parse(
      await aliceClient.callTool({
        name: 'generate_video',
        arguments: { prompt: 'anything', model: 'veo-nonexistent' },
      }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text ?? '').toContain('invalid-argument');
  });

  it('lists only the calling account rows', async () => {
    const mine = await generateVideo(aliceClient, 'Alice rides a comet');
    const theirs = await generateVideo(bobClient, 'Bob builds a submarine');

    const payload = payloadOf(
      await aliceClient.callTool({ name: 'show_generations', arguments: { limit: 50 } }),
    );
    const rows = z
      .array(z.object({ generation_id: z.string() }))
      .parse(payload.generations)
      .map((row) => row.generation_id);

    expect(rows).toContain(String(mine.generation_id));
    expect(rows).not.toContain(String(theirs.generation_id));
  });

  it('refreshes a generation the caller owns and hides one it does not', async () => {
    const mine = await generateVideo(aliceClient, 'Alice paints a nebula');

    const status = payloadOf(
      await aliceClient.callTool({
        name: 'get_video_status',
        arguments: { generation_id: String(mine.generation_id) },
      }),
    );
    expect(status.status).toBe('completed');
    expect(typeof status.video_url).toBe('string');

    const denied = toolResultSchema.parse(
      await bobClient.callTool({
        name: 'get_video_status',
        arguments: { generation_id: String(mine.generation_id) },
      }),
    );
    expect(denied.isError).toBe(true);
    expect(denied.content[0]?.text ?? '').toContain('permission-denied');
  });
});

describe('mcp bearer tokens', () => {
  it('rejects a request with no Authorization header', async () => {
    await expect(authModule.resolveMcpUser({ headers: {} })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('rejects an unknown token', async () => {
    await expect(
      authModule.resolveMcpUser({ headers: { authorization: 'Bearer vsmcp_not-a-real-token' } }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('resolves a freshly issued token to its owner and forgets a revoked one', async () => {
    const token = await authModule.issueMcpToken(alice.id);
    const resolved = await authModule.resolveMcpUser({
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resolved.id).toBe(alice.id);
    expect(resolved.email).toBe(alice.email);

    await authModule.revokeMcpToken(alice.id);
    await expect(
      authModule.resolveMcpUser({ headers: { authorization: `Bearer ${token}` } }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

describe('mcp http surface', () => {
  it('answers 401 in the shared error envelope when the bearer token is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: 'unauthenticated' } });
  });

  it('answers 405 with a JSON-RPC body on GET', async () => {
    const response = await app.inject({ method: 'GET', url: '/mcp' });

    expect(response.statusCode).toBe(405);
    expect(JSON.parse(response.body)).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32000 },
      id: null,
    });
  });
});
