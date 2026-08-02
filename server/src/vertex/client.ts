import { GoogleAuth } from 'google-auth-library';
import { HttpError } from '../errors.js';
import { getRuntimeConfig } from '../runtimeConfig.js';

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

// Refresh slightly early so a token cannot expire mid-flight on a slow Vertex call.
const EXPIRY_MARGIN_MS = 60_000;

// Constructed on first use rather than at import time: building it eagerly would
// make merely importing this module depend on the config already being set.
let auth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  const { projectId, serviceAccount } = getRuntimeConfig();
  auth ??= new GoogleAuth({
    projectId,
    credentials: {
      client_email: serviceAccount.client_email,
      private_key: serviceAccount.private_key,
    },
    scopes: [SCOPE],
  });
  return auth;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

// Polling clients hit this concurrently; sharing the in-flight refresh keeps a
// burst of pollers from triggering a burst of token requests.
let pendingToken: Promise<string> | null = null;

async function fetchAccessToken(): Promise<string> {
  const client = await getAuth().getClient();
  const { token } = await client.getAccessToken();
  if (!token) {
    throw new HttpError('internal', 'Google returned an empty access token for the service account.');
  }

  const expiryDate = client.credentials.expiry_date;
  const expiresAt = typeof expiryDate === 'number' ? expiryDate - EXPIRY_MARGIN_MS : 0;
  cachedToken = { token, expiresAt };
  return token;
}

export function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return Promise.resolve(cachedToken.token);
  }

  pendingToken ??= fetchAccessToken().finally(() => {
    pendingToken = null;
  });
  return pendingToken;
}

export function modelUrl(model: string): string {
  const { projectId, location } = getRuntimeConfig();
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}`;
}

function describeFailure(status: number, rawBody: string): string {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    const message = (parsed as { error?: { message?: unknown } }).error?.message;
    if (typeof message === 'string' && message !== '') return `${status} ${message}`;
  } catch {
    // Vertex answers with an HTML error page for some gateway failures.
  }
  return `${status} ${rawBody.slice(0, 500)}`;
}

/**
 * `method` is the URL suffix Vertex uses for its custom verbs, e.g. ':predict'
 * or ':predictLongRunning'.
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
    throw new HttpError('internal', `Vertex ${model}${method} failed: ${describeFailure(response.status, rawBody)}`);
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new HttpError('internal', `Vertex ${model}${method} returned a non-JSON body: ${rawBody.slice(0, 500)}`);
  }
}
