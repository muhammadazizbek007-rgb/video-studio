import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { after, mock } from 'node:test';
import type { Config } from '../config.js';

/**
 * End-to-end over real HTTP with only the two credential-bearing boundaries
 * replaced: firebase-admin (auth, Firestore, Storage) and google-auth-library.
 * Everything between them — routing, validation, prompt building, the Vertex
 * request/response shapes, the rate limiter — is the production code.
 */

const OPERATION_NAME = 'projects/test-project/locations/us-central1/operations/op-test';
const DOWNLOAD_URL_PREFIX = 'https://firebasestorage.googleapis.com/v0/b/test-bucket/o/';

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

type DocData = Record<string, unknown>;

const documents = new Map<string, DocData>();

function writeDoc(key: string, fields: DocData, merge: boolean): void {
  documents.set(key, merge ? { ...(documents.get(key) ?? {}), ...fields } : { ...fields });
}

function snapshotOf(key: string): {
  exists: boolean;
  data: () => DocData | undefined;
  get: (field: string) => unknown;
} {
  const data = documents.get(key);
  return { exists: data !== undefined, data: () => data, get: (field) => data?.[field] };
}

interface FakeDocRef {
  key: string;
  get: () => Promise<ReturnType<typeof snapshotOf>>;
  set: (fields: DocData, options?: { merge?: boolean }) => Promise<void>;
}

function docRef(key: string): FakeDocRef {
  return {
    key,
    get: () => Promise.resolve(snapshotOf(key)),
    set: (fields, options) => {
      writeDoc(key, fields, options?.merge === true);
      return Promise.resolve();
    },
  };
}

const fakeFirestore = {
  collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
  // Single-threaded fakes cannot interleave, so running the body directly is
  // an accurate stand-in for Firestore's optimistic transaction.
  runTransaction: <T>(body: (tx: FakeTransaction) => Promise<T>): Promise<T> =>
    body({
      get: (ref) => Promise.resolve(snapshotOf(ref.key)),
      set: (ref, fields, options) => {
        writeDoc(ref.key, fields, options?.merge === true);
      },
    }),
};

interface FakeTransaction {
  get: (ref: FakeDocRef) => Promise<ReturnType<typeof snapshotOf>>;
  set: (ref: FakeDocRef, fields: DocData, options?: { merge?: boolean }) => void;
}

// ---------------------------------------------------------------------------
// Boundary stubs
// ---------------------------------------------------------------------------

const uploads: Array<{ path: string; size: number; contentType: string }> = [];

mock.module('../firebase.js', {
  namedExports: {
    initFirebase: (): void => {},
    // Tests present the bare uid as the bearer token; a real token is opaque
    // to this server anyway, only the decoded claims matter downstream.
    verifyIdToken: (idToken: string): Promise<{ uid: string; email?: string; admin?: boolean }> =>
      idToken === 'bad-token'
        ? Promise.reject(new Error('token rejected'))
        : Promise.resolve({ uid: idToken, email: `${idToken}@example.com`, admin: false }),
    db: () => fakeFirestore,
    bucket: () => {
      throw new Error('bucket() is not expected in these tests');
    },
    uploadBuffer: (args: { path: string; data: Buffer; contentType: string }) => {
      uploads.push({ path: args.path, size: args.data.byteLength, contentType: args.contentType });
      return Promise.resolve({
        downloadUrl: `${DOWNLOAD_URL_PREFIX}${encodeURIComponent(args.path)}?alt=media&token=test`,
        storagePath: args.path,
      });
    },
  },
});

// Minting a real token would sign a JWT with a real key and call Google.
mock.module('google-auth-library', {
  namedExports: {
    GoogleAuth: class {
      getClient(): Promise<{
        getAccessToken: () => Promise<{ token: string }>;
        credentials: { expiry_date: number };
      }> {
        return Promise.resolve({
          getAccessToken: () => Promise.resolve({ token: 'fake-access-token' }),
          credentials: { expiry_date: Date.now() + 3_600_000 },
        });
      }
    },
  },
});

// ---------------------------------------------------------------------------
// Fake Vertex over globalThis.fetch
// ---------------------------------------------------------------------------

/** Flipped by the tests that need a finished Veo operation. */
let operationIsDone = false;

const FINISHED_OPERATION = {
  done: true,
  response: {
    videos: [
      {
        bytesBase64Encoded: Buffer.from('fake-mp4-bytes').toString('base64'),
        mimeType: 'video/mp4',
      },
    ],
  },
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const realFetch = globalThis.fetch;

const fakeFetch: typeof globalThis.fetch = (input, init) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  // The tests themselves call the server under test through this same global.
  if (!url.includes('aiplatform.googleapis.com')) return realFetch(input, init);

  if (url.endsWith(':predictLongRunning')) {
    return Promise.resolve(jsonResponse({ name: OPERATION_NAME }));
  }
  if (url.endsWith(':fetchPredictOperation')) {
    return Promise.resolve(jsonResponse(operationIsDone ? FINISHED_OPERATION : { done: false }));
  }
  return Promise.reject(new Error(`unexpected Vertex call: ${url}`));
};

globalThis.fetch = fakeFetch;

// ---------------------------------------------------------------------------
// Server under test
// ---------------------------------------------------------------------------

const config: Config = {
  port: 0,
  projectId: 'test-project',
  location: 'us-central1',
  storageBucket: 'test-bucket',
  serviceAccount: {
    project_id: 'test-project',
    client_email: 'test@test-project.iam.gserviceaccount.com',
    private_key: 'unused-because-google-auth-library-is-stubbed',
  },
  allowedEmails: [],
  corsOrigins: [],
};

// Imported after the mocks are registered so the app graph binds to the stubs.
const { createApp } = await import('../app.js');

const server = createApp(config).listen(0);
await once(server, 'listening');

const address = server.address();
assert.ok(address !== null && typeof address === 'object', 'server did not bind a TCP port');
const baseUrl = `http://127.0.0.1:${address.port}`;

after(async () => {
  globalThis.fetch = realFetch;
  server.close();
  await once(server, 'close');
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown, label: string): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null, `${label} is not an object: ${String(value)}`);
  return value as Record<string, unknown>;
}

async function call(
  name: string,
  data: DocData,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await realFetch(`${baseUrl}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ data }),
  });
  return { status: response.status, body: asRecord(await response.json(), 'response body') };
}

function resultOf(body: Record<string, unknown>): Record<string, unknown> {
  return asRecord(body['result'], 'result');
}

function errorOf(body: Record<string, unknown>): Record<string, unknown> {
  return asRecord(body['error'], 'error');
}

function seedGeneration(generationId: string, userId: string, extra: DocData = {}): void {
  documents.set(`video_generations/${generationId}`, { userId, status: 'pending', ...extra });
}

const VALID_START = {
  prompt: 'a cat walking through neon rain',
  modelId: 'veo-3.1-fast',
  aspectRatio: '16:9',
  duration: 8,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('GET /health reports liveness without authentication', async () => {
  const response = await realFetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);

  const body = asRecord(await response.json(), 'health body');
  assert.equal(body['ok'], true);
  assert.equal(typeof body['uptime'], 'number');
});

test('a request without Authorization is rejected with the error envelope', async () => {
  const { status, body } = await call('startVideoGeneration', { generationId: 'g', ...VALID_START });

  assert.equal(status, 401);
  assert.equal(body['result'], undefined);
  assert.deepEqual(errorOf(body), {
    status: 'unauthenticated',
    message: 'Sign in is required.',
  });
});

test('startVideoGeneration rejects an unknown modelId', async () => {
  seedGeneration('gen-unknown-model', 'user-a');

  const { status, body } = await call(
    'startVideoGeneration',
    { ...VALID_START, generationId: 'gen-unknown-model', modelId: 'veo-9000' },
    'user-a',
  );

  assert.equal(status, 400);
  assert.equal(errorOf(body)['status'], 'invalid-argument');
});

test('startVideoGeneration starts an operation and reports processing', async () => {
  seedGeneration('gen-happy', 'user-happy');

  const { status, body } = await call(
    'startVideoGeneration',
    { ...VALID_START, generationId: 'gen-happy' },
    'user-happy',
  );

  assert.equal(status, 200);
  assert.deepEqual(resultOf(body), {
    ok: true,
    generationId: 'gen-happy',
    status: 'processing',
    operationName: OPERATION_NAME,
  });

  // The client polls the Firestore doc, so the operation has to be persisted.
  const stored = documents.get('video_generations/gen-happy') ?? {};
  assert.equal(stored['status'], 'processing');
  assert.equal(stored['veoOperationName'], OPERATION_NAME);
  assert.equal(stored['veoVertexModel'], 'veo-3.1-fast-generate-preview');
});

test('checkVideoGeneration reports processing while the operation is unfinished', async () => {
  operationIsDone = false;
  seedGeneration('gen-poll', 'user-poll', {
    status: 'processing',
    veoOperationName: OPERATION_NAME,
    veoVertexModel: 'veo-3.1-fast-generate-preview',
  });

  const { status, body } = await call(
    'checkVideoGeneration',
    { generationId: 'gen-poll' },
    'user-poll',
  );

  assert.equal(status, 200);
  assert.deepEqual(resultOf(body), { status: 'processing', resultVideoUrl: null, error: null });
});

test('checkVideoGeneration returns the stored video once the operation is done', async () => {
  operationIsDone = true;
  uploads.length = 0;
  seedGeneration('gen-done', 'user-done', {
    status: 'processing',
    veoOperationName: OPERATION_NAME,
    veoVertexModel: 'veo-3.1-fast-generate-preview',
  });

  const { status, body } = await call(
    'checkVideoGeneration',
    { generationId: 'gen-done' },
    'user-done',
  );

  assert.equal(status, 200);

  const result = resultOf(body);
  assert.equal(result['status'], 'completed');
  assert.equal(result['error'], null);
  assert.equal(
    result['resultVideoUrl'],
    `${DOWNLOAD_URL_PREFIX}${encodeURIComponent('video-generations/user-done/gen-done/result.mp4')}?alt=media&token=test`,
  );

  assert.deepEqual(uploads, [
    {
      path: 'video-generations/user-done/gen-done/result.mp4',
      size: Buffer.from('fake-mp4-bytes').byteLength,
      contentType: 'video/mp4',
    },
  ]);

  assert.equal((documents.get('video_generations/gen-done') ?? {})['status'], 'completed');
});

test('the rate limiter rejects the eleventh generation in the window', async () => {
  seedGeneration('gen-limited', 'user-limited');

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const { status } = await call(
      'startVideoGeneration',
      { ...VALID_START, generationId: 'gen-limited' },
      'user-limited',
    );
    assert.equal(status, 200, `attempt ${attempt} should have been admitted`);
  }

  const { status, body } = await call(
    'startVideoGeneration',
    { ...VALID_START, generationId: 'gen-limited' },
    'user-limited',
  );

  assert.equal(status, 429);
  assert.equal(errorOf(body)['status'], 'resource-exhausted');
  assert.match(String(errorOf(body)['message']), /10 генераций в час/);
});
