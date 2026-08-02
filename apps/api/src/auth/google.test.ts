import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env.js';
import { createAuthorizationUrl, googleRedirectUri } from './google.js';

const { FAKE_ENV } = vi.hoisted(() => ({
  FAKE_ENV: {
    nodeEnv: 'test',
    logLevel: 'silent',
    googleClientId: 'client-id.apps.googleusercontent.com',
    googleClientSecret: 'client-secret',
    apiPublicUrl: 'https://studio.example.com',
  },
}));

vi.mock('../env.js', () => ({
  getEnv: () => FAKE_ENV as unknown as Env,
  resetEnvCache: () => undefined,
}));

describe('google oauth', () => {
  it('derives the redirect uri from the public API url', () => {
    expect(googleRedirectUri()).toBe('https://studio.example.com/api/auth/google/callback');
  });

  it('builds an authorization url carrying the client, scopes and redirect', () => {
    const url = new URL(createAuthorizationUrl().url);

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(FAKE_ENV.googleClientId);
    expect(url.searchParams.get('redirect_uri')).toBe(googleRedirectUri());
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(
      expect.arrayContaining(['openid', 'profile', 'email']),
    );
  });

  it('sends a PKCE challenge that is the S256 hash of the returned verifier', () => {
    const { url, codeVerifier } = createAuthorizationUrl();
    const params = new URL(url).searchParams;

    const expected = createHash('sha256').update(codeVerifier).digest('base64url');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toBe(expected);
    // The verifier itself must never travel in the authorization request.
    expect(url).not.toContain(codeVerifier);
  });

  it('puts the returned state on the url so the callback can match it', () => {
    const { url, state } = createAuthorizationUrl();
    expect(new URL(url).searchParams.get('state')).toBe(state);
  });

  it('never repeats a state or verifier across requests', () => {
    const first = createAuthorizationUrl();
    const second = createAuthorizationUrl();
    expect(first.state).not.toBe(second.state);
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
    expect(first.state.length).toBeGreaterThanOrEqual(32);
    expect(first.codeVerifier.length).toBeGreaterThanOrEqual(32);
  });

  it('asks for an account chooser and no refresh token', () => {
    const params = new URL(createAuthorizationUrl().url).searchParams;
    expect(params.get('prompt')).toBe('select_account');
    expect(params.get('access_type')).toBe('online');
  });
});
