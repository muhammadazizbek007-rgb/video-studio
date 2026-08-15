import { MongoMemoryServer } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The seam between "a voice was chosen" and "the model was told about it".
 *
 * buildVeoPrompt is unit-tested and startVeoOperation is skipped entirely by the fake Vertex
 * driver, so the two halves could each be right while nothing joined them — and nobody would
 * see it, because the assembled prompt is never stored or shown anywhere. This watches the
 * call itself.
 */

const started = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));

vi.mock('../vertex/veo.js', () => ({
  startVeoOperation: vi.fn(async (input: Record<string, unknown>) => {
    started.calls.push(input);
    return { operationName: 'operations/test', vertexModel: 'veo-3.1-fast-generate-001' };
  }),
  startVeoExtension: vi.fn(async () => ({
    operationName: 'operations/test',
    vertexModel: 'veo-3.1-fast-generate-001',
  })),
  checkVeoOperation: vi.fn(async () => ({ status: 'processing' as const })),
}));

type ServiceModule = typeof import('./generations.js');
type VoiceModule = typeof import('../db/models/voice.js');
type UserModule = typeof import('../db/models/user.js');

let mongo: MongoMemoryServer;
let disconnect: () => Promise<void>;
let services: ServiceModule;
let voiceModule: VoiceModule;
let userModule: UserModule;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('video_studio_voice_wiring_test');

  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.MONGODB_URI = uri;
  process.env.AUTH_JWT_SECRET = 'test-only-secret-value-of-at-least-32-chars';
  process.env.AUTH_DEV_LOGIN = 'true';
  process.env.FAKE_VERTEX = 'true';
  process.env.MCP_ENABLED = 'false';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '';
  process.env.ANTHROPIC_API_KEY = '';

  const { resetEnvCache } = await import('../env.js');
  resetEnvCache();

  const { connectDb, disconnectDb } = await import('../db/connect.js');
  await connectDb(uri);
  disconnect = disconnectDb;

  voiceModule = await import('../db/models/voice.js');
  userModule = await import('../db/models/user.js');
  services = await import('./generations.js');
}, 180_000);

afterAll(async () => {
  if (disconnect) await disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  started.calls = [];
  await voiceModule.VoiceModel.deleteMany({});
});

async function makeUser(email: string) {
  const doc = await userModule.UserModel.create({ email, name: email });
  return { id: doc._id.toString(), email, name: email };
}

const BASE = {
  prompt: 'девушка держит бутылку',
  modelId: 'veo-3.1-fast',
  aspectRatio: '16:9' as const,
  duration: 8 as const,
  stylePreset: 'UGC' as const,
  cameraMotion: 'Handheld' as const,
};

describe('a chosen voice reaches Vertex', () => {
  it('hands the narrator description to the generation call', async () => {
    const user = await makeUser('voice-wiring@example.com');
    const voice = await voiceModule.VoiceModel.create({
      userId: new Types.ObjectId(user.id),
      name: 'Диктор Дона',
      prompt: 'женщина около 30, тёплый низкий тембр, говорит по-узбекски',
    });

    await services.createGeneration(user, { ...BASE, voiceId: voice._id.toString() });

    expect(started.calls).toHaveLength(1);
    expect(started.calls[0]?.voicePrompt).toBe(
      'женщина около 30, тёплый низкий тембр, говорит по-узбекски',
    );
  });

  it('sends nothing when no voice was chosen', async () => {
    const user = await makeUser('no-voice@example.com');

    await services.createGeneration(user, BASE);

    expect(started.calls[0]?.voicePrompt).toBeUndefined();
  });

  // The description is what reaches the model, so accepting an id from the request would let
  // any account borrow another's narrator by guessing.
  it('refuses another account’s voice rather than using it', async () => {
    const owner = await makeUser('voice-owner-wiring@example.com');
    const stranger = await makeUser('voice-stranger-wiring@example.com');
    const voice = await voiceModule.VoiceModel.create({
      userId: new Types.ObjectId(owner.id),
      name: 'Чужой',
      prompt: 'секретный голос',
    });

    await services.createGeneration(stranger, { ...BASE, voiceId: voice._id.toString() });

    expect(started.calls[0]?.voicePrompt).toBeUndefined();
  });

  it('survives a voice that was deleted between choosing and generating', async () => {
    const user = await makeUser('voice-gone@example.com');
    const voice = await voiceModule.VoiceModel.create({
      userId: new Types.ObjectId(user.id),
      name: 'Удалённый',
      prompt: 'уже нет',
    });
    const voiceId = voice._id.toString();
    await voice.deleteOne();

    const generation = await services.createGeneration(user, { ...BASE, voiceId });

    expect(generation.status).not.toBe('failed');
    expect(started.calls[0]?.voicePrompt).toBeUndefined();
  });
});
