import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env.js';
import { ApiError } from '../errors.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from './tokens.js';

const { TEST_SECRET } = vi.hoisted(() => ({
  TEST_SECRET: 'test-jwt-secret-0123456789abcdef',
}));

vi.mock('../env.js', () => ({
  getEnv: () => ({ nodeEnv: 'test', authJwtSecret: TEST_SECRET }) as unknown as Env,
  resetEnvCache: () => undefined,
}));

const USER = { id: 'user-1', email: 'pilot@example.com', name: 'Pilot' };

async function signRaw(secret: string, expiresAt: number): Promise<string> {
  return await new SignJWT({ email: USER.email, name: USER.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(USER.id)
    .setIssuer('video-studio')
    .setAudience('video-studio-web')
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(secret));
}

describe('access tokens', () => {
  it('round-trips the user claims', async () => {
    const token = await signAccessToken(USER);
    const claims = await verifyAccessToken(token);

    expect(claims).toEqual({ sub: USER.id, email: USER.email, name: USER.name });
  });

  it('rejects a token signed with a different secret', async () => {
    const notOurSecret = 'a-completely-different-secret-value';
    const token = await signRaw(notOurSecret, Math.floor(Date.now() / 1000) + 900);

    await expect(verifyAccessToken(token)).rejects.toBeInstanceOf(ApiError);
    await expect(verifyAccessToken(token)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects an expired token', async () => {
    const token = await signRaw(TEST_SECRET, Math.floor(Date.now() / 1000) - 60);

    await expect(verifyAccessToken(token)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects a malformed token', async () => {
    await expect(verifyAccessToken('not-a-jwt')).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
});

describe('refresh tokens', () => {
  it('returns a hash that matches hashRefreshToken', () => {
    const { token, hash } = generateRefreshToken();

    expect(hash).toBe(hashRefreshToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never exposes the raw token as the stored hash', () => {
    const { token, hash } = generateRefreshToken();

    expect(token).not.toBe(hash);
    expect(hash).not.toContain(token);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('issues a distinct token every time', () => {
    const first = generateRefreshToken();
    const second = generateRefreshToken();

    expect(first.token).not.toBe(second.token);
    expect(first.hash).not.toBe(second.hash);
  });
});
