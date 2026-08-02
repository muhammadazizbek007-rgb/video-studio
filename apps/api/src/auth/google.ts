import { decodeIdToken, Google, generateCodeVerifier, generateState } from 'arctic';
import { getEnv } from '../env.js';
import { ApiError } from '../errors.js';
import { logger } from '../logger.js';

const SCOPES = ['openid', 'profile', 'email'];

export interface AuthorizationRequest {
  url: string;
  state: string;
  codeVerifier: string;
}

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  picture: string | null;
}

// Constructed per call rather than at module load: getEnv() must not run while
// the module graph is still being imported (tests reset the env cache freely).
function googleClient(): Google {
  const env = getEnv();
  return new Google(
    env.googleClientId,
    env.googleClientSecret,
    `${env.apiPublicUrl}/api/auth/google/callback`,
  );
}

export function createAuthorizationUrl(): AuthorizationRequest {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = googleClient().createAuthorizationURL(state, codeVerifier, SCOPES);
  return { url: url.toString(), state, codeVerifier };
}

function readString(claims: Record<string, unknown>, key: string): string | undefined {
  const value = claims[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isEmailVerified(claims: Record<string, unknown>): boolean {
  const value = claims.email_verified;
  if (typeof value === 'boolean') return value;
  // Some Google responses stringify the claim.
  if (typeof value === 'string') return value === 'true';
  return false;
}

export async function exchangeCode(code: string, codeVerifier: string): Promise<GoogleProfile> {
  let idToken: string;
  try {
    const tokens = await googleClient().validateAuthorizationCode(code, codeVerifier);
    idToken = tokens.idToken();
  } catch (error) {
    logger.warn({ err: error }, 'google oauth code exchange failed');
    throw new ApiError('permission-denied', 'Google sign-in could not be completed.');
  }

  let claims: Record<string, unknown>;
  try {
    claims = decodeIdToken(idToken) as Record<string, unknown>;
  } catch (error) {
    logger.warn({ err: error }, 'google id_token could not be decoded');
    throw new ApiError('permission-denied', 'Google sign-in could not be completed.');
  }

  const googleId = readString(claims, 'sub');
  const email = readString(claims, 'email');
  if (!googleId || !email) {
    throw new ApiError('permission-denied', 'Google did not return an account email.');
  }
  if (!isEmailVerified(claims)) {
    throw new ApiError('permission-denied', 'This Google account has an unverified email address.');
  }

  const name =
    readString(claims, 'name') ?? readString(claims, 'given_name') ?? email.split('@')[0] ?? email;

  return {
    googleId,
    email: email.toLowerCase(),
    name,
    picture: readString(claims, 'picture') ?? null,
  };
}
