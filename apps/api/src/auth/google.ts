import { createHash, randomBytes } from 'node:crypto';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
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

export function googleRedirectUri(): string {
  return `${getEnv().apiPublicUrl}/api/auth/google/callback`;
}

// Constructed per call rather than at module load: getEnv() must not run while the
// module graph is still being imported (tests reset the env cache freely).
function client(): OAuth2Client {
  const env = getEnv();
  return new OAuth2Client({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri: googleRedirectUri(),
  });
}

function base64url(input: Buffer): string {
  return input.toString('base64url');
}

export function createAuthorizationUrl(): AuthorizationRequest {
  const state = base64url(randomBytes(32));
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());

  const url = client().generateAuthUrl({
    scope: SCOPES,
    state,
    code_challenge_method: CodeChallengeMethod.S256,
    code_challenge: codeChallenge,
    // We never call a Google API as the user, so a refresh token would be a stored
    // credential with no purpose. `select_account` keeps a shared machine from
    // silently signing the previous person back in.
    access_type: 'online',
    prompt: 'select_account',
  });

  return { url, state, codeVerifier };
}

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export async function exchangeCode(code: string, codeVerifier: string): Promise<GoogleProfile> {
  const oauth = client();

  let idToken: string | undefined;
  try {
    const { tokens } = await oauth.getToken({
      code,
      codeVerifier,
      redirect_uri: googleRedirectUri(),
    });
    idToken = tokens.id_token ?? undefined;
  } catch (error) {
    logger.warn({ err: error }, 'google oauth code exchange failed');
    throw new ApiError('permission-denied', 'Google sign-in could not be completed.');
  }

  if (!idToken) {
    throw new ApiError('permission-denied', 'Google did not return an identity token.');
  }

  // Verified, not merely decoded: this checks Google's signature, the issuer and that
  // the token was minted for *our* client id. Skipping it would let any Google-issued
  // token for any application be replayed here as a sign-in.
  let payload: Record<string, unknown>;
  try {
    const ticket = await oauth.verifyIdToken({ idToken, audience: getEnv().googleClientId });
    payload = (ticket.getPayload() ?? {}) as Record<string, unknown>;
  } catch (error) {
    logger.warn({ err: error }, 'google id_token failed verification');
    throw new ApiError('permission-denied', 'Google sign-in could not be verified.');
  }

  const googleId = readString(payload, 'sub');
  const email = readString(payload, 'email');
  if (!googleId || !email) {
    throw new ApiError('permission-denied', 'Google did not return an account email.');
  }

  // An unverified address is one the account holder never proved they own, so it must
  // not be matched against the allow-list.
  if (payload.email_verified !== true && payload.email_verified !== 'true') {
    throw new ApiError('permission-denied', 'This Google account has an unverified email address.');
  }

  const name =
    readString(payload, 'name') ??
    readString(payload, 'given_name') ??
    email.split('@')[0] ??
    email;

  return {
    googleId,
    email: email.toLowerCase(),
    name,
    picture: readString(payload, 'picture') ?? null,
  };
}
