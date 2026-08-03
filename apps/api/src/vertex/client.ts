import { GoogleAuth } from 'google-auth-library';
import { getEnv } from '../env.js';
import type { ApiErrorCode } from '../errors.js';
import { ApiError } from '../errors.js';

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** Refresh slightly early so a token cannot expire mid-flight on a slow Vertex call. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * The fake driver has no service account to sign with. Nothing on that path reaches
 * Vertex, so a constant keeps `callVertex` usable against a local stub without
 * making credentials a prerequisite for running the app in fake mode.
 */
const FAKE_ACCESS_TOKEN = 'fake-vertex-access-token';

const MAX_ERROR_BODY_CHARS = 500;

// Constructed on first use rather than at import time: building it eagerly would make
// merely importing this module depend on the environment already being validated.
let auth: GoogleAuth | null = null;

let cachedToken: { token: string; expiresAt: number } | null = null;

// Polling clients hit this concurrently; sharing the in-flight refresh keeps a burst of
// pollers from triggering a burst of token requests.
let pendingToken: Promise<string> | null = null;

function getAuth(): GoogleAuth {
  if (auth) return auth;

  const { gcpProjectId, googleServiceAccount } = getEnv();
  if (!googleServiceAccount) {
    throw new ApiError(
      'internal',
      'Vertex AI is not configured: no Google service account is available.',
    );
  }

  auth = new GoogleAuth({
    projectId: gcpProjectId,
    credentials: {
      client_email: googleServiceAccount.client_email,
      private_key: googleServiceAccount.private_key,
    },
    scopes: [SCOPE],
  });
  return auth;
}

async function fetchAccessToken(): Promise<string> {
  const client = await getAuth().getClient();
  const { token } = await client.getAccessToken();
  if (!token) {
    throw new ApiError(
      'internal',
      'Google returned an empty access token for the service account.',
    );
  }

  const expiryDate = client.credentials.expiry_date;
  const expiresAt = typeof expiryDate === 'number' ? expiryDate - EXPIRY_MARGIN_MS : 0;
  cachedToken = { token, expiresAt };
  return token;
}

export function getAccessToken(): Promise<string> {
  if (getEnv().fakeVertex) return Promise.resolve(FAKE_ACCESS_TOKEN);

  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return Promise.resolve(cachedToken.token);
  }

  pendingToken ??= fetchAccessToken().finally(() => {
    pendingToken = null;
  });
  return pendingToken;
}

/** Drops the memoised auth client and token; used by tests that swap the environment. */
export function resetVertexClientCache(): void {
  auth = null;
  cachedToken = null;
  pendingToken = null;
}

export function modelUrl(model: string): string {
  const { gcpProjectId, vertexLocation } = getEnv();
  return `https://${vertexLocation}-aiplatform.googleapis.com/v1/projects/${gcpProjectId}/locations/${vertexLocation}/publishers/google/models/${model}`;
}

/**
 * Throttling and gateway failures are transient, so the caller can retry them instead of
 * marking a generation permanently failed.
 */
function codeForStatus(status: number): ApiErrorCode {
  return status === 429 || status >= 500 ? 'unavailable' : 'internal';
}

function describeFailure(status: number, rawBody: string): string {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    const message = (parsed as { error?: { message?: unknown } }).error?.message;
    if (typeof message === 'string' && message !== '') return `${status} ${message}`;
  } catch {
    // Vertex answers with an HTML error page for some gateway failures.
  }
  return `${status} ${rawBody.slice(0, MAX_ERROR_BODY_CHARS)}`;
}

/**
 * `method` is the URL suffix Vertex uses for its custom verbs, e.g. ':predict' or
 * ':predictLongRunning'.
 */
export async function callVertex<T>(model: string, method: string, body: unknown): Promise<T> {
  const token = await getAccessToken();

  const response = await fetch(`${modelUrl(model)}${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });

  const rawBody = await response.text();

  if (!response.ok) {
    throw new ApiError(
      codeForStatus(response.status),
      `Vertex ${model}${method} failed: ${describeFailure(response.status, rawBody)}`,
    );
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new ApiError(
      'internal',
      `Vertex ${model}${method} returned a non-JSON body: ${rawBody.slice(0, MAX_ERROR_BODY_CHARS)}`,
    );
  }
}
