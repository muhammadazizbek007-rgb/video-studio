import { API_ORIGIN, expect, test, WEB_ORIGIN } from '../fixtures.js';

test.describe('API surface', () => {
  test('the liveness and readiness probes both answer 200', async ({ request }) => {
    const live = await request.get(`${API_ORIGIN}/api/health/live`);
    expect(live.status()).toBe(200);
    expect(await live.json()).toMatchObject({ status: 'ok' });

    const ready = await request.get(`${API_ORIGIN}/api/health/ready`);
    expect(ready.status()).toBe(200);
    // /ready is the one probe that proves the database is actually reachable.
    expect(await ready.json()).toMatchObject({ status: 'ok', mongo: true });
  });

  test('an unauthenticated read is refused with the error envelope', async ({ request }) => {
    const response = await request.get(`${API_ORIGIN}/api/generations`);

    expect(response.status()).toBe(401);
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('unauthenticated');
    expect(body.error?.message).toBeTruthy();
  });

  test('a credentialed preflight from the web origin is allowed', async ({ request }) => {
    const response = await request.fetch(`${API_ORIGIN}/api/generations`, {
      method: 'OPTIONS',
      headers: {
        origin: WEB_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    // @fastify/cors answers a preflight with 204; 200 is the same outcome from an older one.
    expect([200, 204]).toContain(response.status());
    const headers = response.headers();
    expect(headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    // Without this the browser would drop the vs_access cookie on every cross-origin call.
    expect(headers['access-control-allow-credentials']).toBe('true');
  });

  test('an unknown route answers 404 in the same envelope', async ({ request }) => {
    const response = await request.get(`${API_ORIGIN}/api/does-not-exist`);

    expect(response.status()).toBe(404);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('not-found');
  });
});
