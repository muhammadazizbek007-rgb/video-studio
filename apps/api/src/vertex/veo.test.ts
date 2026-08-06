import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors.js';
import { callVertex } from './client.js';
import { readFakeVeoOperation, resetFakeVertex } from './fake.js';
import type { VeoStartInput } from './veo.js';
import { checkVeoOperation, startVeoOperation } from './veo.js';

interface SavedObject {
  contentType: string;
  bytes: number;
  brand: string;
}

const state = vi.hoisted(() => ({
  fakeVertex: true,
  saved: new Map<string, { contentType: string; bytes: number; brand: string }>(),
}));

vi.mock('../env.js', () => ({
  getEnv: () => ({
    fakeVertex: state.fakeVertex,
    gcpProjectId: 'test-project',
    vertexLocation: 'us-central1',
    googleServiceAccount: null,
    anthropicApiKey: null,
  }),
  resetEnvCache: () => undefined,
}));

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../storage/index.js', () => ({
  getStorage: () => ({
    save: async (asset: { key: string; data: Buffer; contentType: string }) => {
      state.saved.set(asset.key, {
        contentType: asset.contentType,
        bytes: asset.data.byteLength,
        // Bytes 4..8 of an MP4 are the 'ftyp' box type, so this pins that the fake driver
        // really wrote a container rather than a placeholder blob.
        brand: asset.data.subarray(4, 8).toString('latin1'),
      });
      return {
        url: `/media/${asset.key}`,
        path: asset.key,
        bytes: asset.data.byteLength,
        contentType: asset.contentType,
      };
    },
    remove: async () => undefined,
    resolveUrl: (key: string) => `/media/${key}`,
  }),
}));

function startInput(overrides: Partial<VeoStartInput> = {}): VeoStartInput {
  return {
    generationId: 'gen-1',
    userId: 'user-1',
    prompt: 'a cat on a windowsill',
    modelId: 'veo-3.1',
    aspectRatio: '16:9',
    duration: 8,
    stylePreset: 'Cinematic',
    cameraMotion: 'Pan',
    ...overrides,
  };
}

function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (err: unknown) => err,
  );
}

beforeEach(() => {
  state.fakeVertex = true;
  state.saved.clear();
  resetFakeVertex();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('startVeoOperation', () => {
  it('snaps an unsupported duration to the nearest one the model offers', async () => {
    const started = await startVeoOperation(startInput({ modelId: 'veo-3.1', duration: 5 }));
    expect(readFakeVeoOperation(started.operationName)?.duration).toBe(4);

    const up = await startVeoOperation(
      startInput({ modelId: 'veo-3.1', duration: 7, generationId: 'gen-2' }),
    );
    expect(readFakeVeoOperation(up.operationName)?.duration).toBe(6);
  });

  it('keeps a duration the model already supports', async () => {
    const started = await startVeoOperation(startInput({ modelId: 'veo-3.1', duration: 6 }));
    expect(readFakeVeoOperation(started.operationName)?.duration).toBe(6);
  });

  it('rejects an aspect ratio the model does not support', async () => {
    const err = await captureError(startVeoOperation(startInput({ aspectRatio: '1:1' })));
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('invalid-argument');
    expect((err as ApiError).message).toContain('1:1');
  });

  it('rejects an unknown model', async () => {
    const err = await captureError(startVeoOperation(startInput({ modelId: 'veo-9.9' })));
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('invalid-argument');
  });

  it('resolves the vertex model id from the registry', async () => {
    const started = await startVeoOperation(startInput({ modelId: 'veo-3.1-fast' }));
    expect(started.vertexModel).toBe('veo-3.1-fast-generate-001');
    expect(started.operationName).toContain('veo-3.1-fast-generate-001');
  });
});

describe('the fake Vertex driver', () => {
  it('runs start -> check to completion and stores a playable MP4', async () => {
    const started = await startVeoOperation(startInput());

    const polled = await checkVeoOperation({
      vertexModel: started.vertexModel,
      operationName: started.operationName,
      userId: 'user-1',
      generationId: 'gen-1',
    });

    expect(polled.status).toBe('completed');
    if (polled.status !== 'completed') return;

    const key = 'generations/user-1/gen-1/video.mp4';
    expect(polled.storagePath).toBe(key);
    expect(polled.videoUrl).toBe(`/media/${key}`);

    const stored: SavedObject | undefined = state.saved.get(key);
    expect(stored?.contentType).toBe('video/mp4');
    expect(stored?.brand).toBe('ftyp');
    expect(stored?.bytes ?? 0).toBeGreaterThan(500);
  });

  it('produces the same operation name for the same generation', async () => {
    const first = await startVeoOperation(startInput());
    const second = await startVeoOperation(startInput());
    expect(second.operationName).toBe(first.operationName);
  });

  it('makes no network calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const started = await startVeoOperation(startInput());
    await checkVeoOperation({
      vertexModel: started.vertexModel,
      operationName: started.operationName,
      userId: 'user-1',
      generationId: 'gen-1',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// checkVeoOperation short-circuits to the fake driver under FAKE_VERTEX, so the Vertex
// status mapping is exercised one layer down, at the transport the live path shares.
describe('Vertex transport errors', () => {
  it('reports a 503 as a retryable "unavailable" error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":{"message":"backend overloaded"}}', { status: 503 }),
    );

    const err = await captureError(
      callVertex('veo-3.1-generate-preview', ':fetchPredictOperation', { operationName: 'op' }),
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('unavailable');
    expect((err as ApiError).message).toContain('backend overloaded');
  });

  it('reports a 429 as retryable too', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('slow down', { status: 429 }));

    const err = await captureError(callVertex('veo-3.1-generate-preview', ':predict', {}));
    expect((err as ApiError).code).toBe('unavailable');
  });

  it('reports a 400 as a non-retryable internal error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>bad request</html>', { status: 400 }),
    );

    const err = await captureError(callVertex('veo-3.1-generate-preview', ':predict', {}));
    expect((err as ApiError).code).toBe('internal');
    expect((err as ApiError).message).toContain('bad request');
  });
});
