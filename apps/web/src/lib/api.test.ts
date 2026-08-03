import type { GenerationDto, UserDto } from '@video-studio/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, api } from './api';

const USER: UserDto = {
  id: 'u1',
  email: 'user@example.com',
  name: 'User',
  picture: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function generationFixture(id: string): GenerationDto {
  return {
    id,
    userId: 'u1',
    prompt: 'a cat on a skateboard',
    modelId: 'veo-3.1-fast',
    mode: 'text_to_video',
    aspectRatio: '16:9',
    duration: 8,
    stylePreset: 'Cinematic',
    cameraMotion: 'Static',
    status: 'processing',
    saved: false,
    referenceImageUrls: [],
    elements: [],
    referenceCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fail(status: number, code: string, message = 'boom'): Response {
  return json({ error: { code, message } }, status);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('sends credentials and unwraps a typed payload', async () => {
    fetchMock.mockResolvedValueOnce(json(USER));

    await expect(api.auth.me()).resolves.toEqual(USER);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/me');
    expect(init.credentials).toBe('include');
  });

  it('turns the error envelope into an ApiClientError', async () => {
    fetchMock.mockResolvedValueOnce(fail(404, 'not-found', 'Генерация не найдена'));

    const error = await api.generations.get('g1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: 'not-found',
      status: 404,
      message: 'Генерация не найдена',
    });
  });

  it('falls back to a status-derived code when the body is not an envelope', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>502</html>', { status: 503 }));

    const error = await api.elements.list().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe('unavailable');
  });

  it('refreshes once and replays the request after a 401', async () => {
    fetchMock
      .mockResolvedValueOnce(fail(401, 'unauthenticated'))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json(generationFixture('g1')));

    await expect(api.generations.get('g1')).resolves.toMatchObject({ id: 'g1' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(refreshUrl).toBe('/api/auth/refresh');
    expect(refreshInit.method).toBe('POST');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/generations/g1');
  });

  it('propagates a second 401 instead of looping', async () => {
    fetchMock
      .mockResolvedValueOnce(fail(401, 'unauthenticated'))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(fail(401, 'unauthenticated'));

    const error = await api.generations.get('g1').catch((e: unknown) => e);

    expect((error as ApiClientError).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never refreshes for auth.me', async () => {
    fetchMock.mockResolvedValueOnce(fail(401, 'unauthenticated'));

    await expect(api.auth.me()).rejects.toBeInstanceOf(ApiClientError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one refresh between two concurrent 401s', async () => {
    let refreshCalls = 0;
    const attempts = new Map<string, number>();

    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url === '/api/auth/refresh') {
        refreshCalls += 1;
        return Promise.resolve(json({ ok: true }));
      }
      const seen = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, seen);
      if (seen === 1) return Promise.resolve(fail(401, 'unauthenticated'));
      return Promise.resolve(json(generationFixture(url.split('/').pop() ?? '')));
    });

    const [first, second] = await Promise.all([api.generations.get('a'), api.generations.get('b')]);

    expect(refreshCalls).toBe(1);
    expect(first.id).toBe('a');
    expect(second.id).toBe('b');
  });

  it('rejects a response that does not match the schema', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'g1', status: 'weird' }));

    const error = await api.generations.get('g1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe('invalid-response');
  });

  it('resolves void for a 204 delete', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(api.elements.remove('e1')).resolves.toBeUndefined();
  });
});
