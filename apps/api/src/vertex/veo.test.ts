import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors.js';
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
  /** Storage key -> absolute path, mirroring what the local driver can shortcut. */
  localFiles: new Map<string, string>(),
  callVertex: vi.fn(async () => ({ name: 'projects/p/operations/op-1' })),
}));

vi.mock('../env.js', () => ({
  getEnv: () => ({
    fakeVertex: state.fakeVertex,
    gcpProjectId: 'test-project',
    vertexLocation: 'us-central1',
    googleServiceAccount: null,
    anthropicApiKey: null,
    // The deployment default: relative to the browser, unusable to anything off-host.
    mediaPublicBaseUrl: '/media',
    apiPublicUrl: 'https://studio.example.test',
  }),
  resetEnvCache: () => undefined,
}));

/**
 * The transport is replaced wholesale so the live path can be exercised without a service
 * account: what matters here is the JSON Veo would receive, not how it is delivered.
 * client.test.ts covers the delivery.
 */
vi.mock('./client.js', () => ({
  callVertex: state.callVertex,
  getAccessToken: async () => 'test-access-token',
  modelUrl: (model: string) => `https://vertex.test/${model}`,
  resetVertexClientCache: () => undefined,
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
    localPath: (key: string) => state.localFiles.get(key) ?? null,
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
  state.localFiles.clear();
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

/**
 * The live request path, which the fake driver short-circuits past.
 *
 * This is where a mentioned element turns into something Veo can see, so it is checked
 * against the actual JSON that would go over the wire.
 */
describe('the Vertex request payload', () => {
  async function storeImage(key: string, bytes: Buffer, name: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'veo-test-'));
    const file = join(directory, name);
    await writeFile(file, bytes);
    state.localFiles.set(key, file);
    return `/media/${key}`;
  }

  function sentInstance(): Record<string, unknown> {
    const body = state.callVertex.mock.calls[0]?.[2] as
      | { instances: Record<string, unknown>[] }
      | undefined;
    return body?.instances[0] ?? {};
  }

  beforeEach(() => {
    state.fakeVertex = false;
    state.callVertex.mockClear();
  });

  it('reads an element photo off local disk and sends it as an asset reference', async () => {
    const bytes = Buffer.from([0x0a, 0x0b, 0x0c, 0x0d]);
    const url = await storeImage('uploads/user-1/muhammad.jpg', bytes, 'muhammad.jpg');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await startVeoOperation(startInput({ assetReferenceUrls: [url] }));

    const references = sentInstance().referenceImages as {
      image: { bytesBase64Encoded: string; mimeType: string };
      referenceType: string;
    }[];

    expect(references).toHaveLength(1);
    expect(references[0]?.referenceType).toBe('asset');
    expect(references[0]?.image.bytesBase64Encoded).toBe(bytes.toString('base64'));
    expect(references[0]?.image.mimeType).toBe('image/jpeg');
    // The whole point of the local shortcut: a relative `/media/...` URL cannot be fetched
    // from Node, and the old code tried to anyway.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never sends more asset references than the model accepts', async () => {
    const urls = await Promise.all(
      ['a', 'b', 'c', 'd'].map((name) =>
        storeImage(`uploads/user-1/${name}.png`, Buffer.from([1]), `${name}.png`),
      ),
    );

    await startVeoOperation(startInput({ assetReferenceUrls: urls }));

    expect(sentInstance().referenceImages).toHaveLength(3);
  });

  it('keeps the opening frame and the asset references in separate fields', async () => {
    const frame = await storeImage('uploads/user-1/frame.png', Buffer.from([2]), 'frame.png');
    const photo = await storeImage('uploads/user-1/ali.png', Buffer.from([3]), 'ali.png');

    await startVeoOperation(startInput({ firstFrameImageUrl: frame, assetReferenceUrls: [photo] }));

    const instance = sentInstance();
    expect(instance.image).toMatchObject({ mimeType: 'image/png' });
    expect(instance.referenceImages).toHaveLength(1);
    // Only a supplied opening frame makes the model continue an image.
    expect(String(instance.prompt)).toContain('Starting from the provided first frame');
  });

  it('sends no reference block at all when nothing was mentioned', async () => {
    await startVeoOperation(startInput());

    const instance = sentInstance();
    expect(instance.referenceImages).toBeUndefined();
    expect(instance.image).toBeUndefined();
  });

  it('downloads a reference that is not ours, absolutised against the API host', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(Buffer.from([9, 9]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );

    await startVeoOperation(
      startInput({ assetReferenceUrls: ['/media/uploads/user-1/missing.png'] }),
    );

    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      'https://studio.example.test/media/uploads/user-1/missing.png',
    );
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

// The Vertex transport itself — status mapping, error bodies — lives in client.test.ts,
// which does not mock the module away.
