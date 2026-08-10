import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors.js';
import { callVertex } from './client.js';

/**
 * The Vertex transport, checked on its own.
 *
 * `checkVeoOperation` short-circuits to the fake driver under FAKE_VERTEX, so the status
 * mapping the live path depends on is exercised here, one layer down. Kept apart from
 * veo.test.ts because that file mocks this module away.
 */

const state = vi.hoisted(() => ({ fakeVertex: true }));

vi.mock('../env.js', () => ({
  getEnv: () => ({
    fakeVertex: state.fakeVertex,
    gcpProjectId: 'test-project',
    vertexLocation: 'us-central1',
    googleServiceAccount: null,
  }),
  resetEnvCache: () => undefined,
}));

function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (err: unknown) => err,
  );
}

beforeEach(() => {
  state.fakeVertex = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Vertex transport errors', () => {
  it('reports a 503 as a retryable "unavailable" error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":{"message":"backend overloaded"}}', { status: 503 }),
    );

    const err = await captureError(
      callVertex('veo-3.1-generate-001', ':fetchPredictOperation', { operationName: 'op' }),
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('unavailable');
    expect((err as ApiError).message).toContain('backend overloaded');
  });

  it('reports a 429 as retryable too', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('slow down', { status: 429 }));

    const err = await captureError(callVertex('veo-3.1-generate-001', ':predict', {}));
    expect((err as ApiError).code).toBe('unavailable');
  });

  it('reports a 400 as a non-retryable internal error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>bad request</html>', { status: 400 }),
    );

    const err = await captureError(callVertex('veo-3.1-generate-001', ':predict', {}));
    expect((err as ApiError).code).toBe('internal');
    expect((err as ApiError).message).toContain('bad request');
  });
});
