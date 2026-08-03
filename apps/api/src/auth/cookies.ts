import type { FastifyReply } from 'fastify';
import { getEnv } from '../env.js';

export const ACCESS_COOKIE = 'vs_access';
export const REFRESH_COOKIE = 'vs_refresh';
export const OAUTH_STATE_COOKIE = 'vs_oauth_state';
export const OAUTH_VERIFIER_COOKIE = 'vs_oauth_verifier';

export const ACCESS_TTL_SECONDS = 900;
export const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
export const OAUTH_TTL_SECONDS = 600;

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
}

export function cookieOptions(maxAgeSeconds: number): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: getEnv().nodeEnv === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export function setSessionCookies(
  reply: FastifyReply,
  tokens: { accessToken: string; refreshToken: string },
): void {
  reply.setCookie(ACCESS_COOKIE, tokens.accessToken, cookieOptions(ACCESS_TTL_SECONDS));
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, cookieOptions(REFRESH_TTL_SECONDS));
}

export function clearSessionCookies(reply: FastifyReply): void {
  // The browser only drops a cookie when the clearing attributes match the ones
  // it was set with, so reuse cookieOptions rather than clearing on path alone.
  const options = cookieOptions(0);
  reply.clearCookie(ACCESS_COOKIE, options);
  reply.clearCookie(REFRESH_COOKIE, options);
}

export function clearOauthCookies(reply: FastifyReply): void {
  const options = cookieOptions(0);
  reply.clearCookie(OAUTH_STATE_COOKIE, options);
  reply.clearCookie(OAUTH_VERIFIER_COOKIE, options);
}
