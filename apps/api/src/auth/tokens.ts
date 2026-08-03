import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { getEnv } from '../env.js';
import { ApiError } from '../errors.js';
import { ACCESS_TTL_SECONDS } from './cookies.js';

const ISSUER = 'video-studio';
const AUDIENCE = 'video-studio-web';
const ALGORITHM = 'HS256';

export interface AccessTokenClaims {
  sub: string;
  email: string;
  name: string;
}

function signingKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().authJwtSecret);
}

export async function signAccessToken(user: {
  id: string;
  email: string;
  name: string;
}): Promise<string> {
  return await new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(signingKey());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(token, signingKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALGORITHM],
    });
    payload = verified.payload;
  } catch {
    throw new ApiError('unauthenticated', 'Session expired or invalid. Please sign in again.');
  }

  const { sub, email, name } = payload;
  if (typeof sub !== 'string' || sub.length === 0 || typeof email !== 'string') {
    throw new ApiError('unauthenticated', 'Session expired or invalid. Please sign in again.');
  }

  return { sub, email, name: typeof name === 'string' ? name : '' };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}
