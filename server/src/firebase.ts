import { randomUUID } from 'node:crypto';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { Config } from './config.js';
import { HttpError } from './errors.js';

// @google-cloud/storage is only an optional dependency of firebase-admin, so it
// is not something this package declares or should import from directly.
type Bucket = ReturnType<ReturnType<typeof getStorage>['bucket']>;

let app: App | null = null;
let bucketName = '';

export function initFirebase(config: Config): void {
  // The dev watcher and the test runner both re-import this module in the same
  // process; initializeApp throws on a duplicate app name.
  if (app !== null) return;

  const existing = getApps()[0];
  app =
    existing ??
    initializeApp({
      credential: cert({
        projectId: config.serviceAccount.project_id,
        clientEmail: config.serviceAccount.client_email,
        privateKey: config.serviceAccount.private_key,
      }),
      projectId: config.projectId,
      storageBucket: config.storageBucket,
    });

  // The Storage API addresses buckets by bare name; operators habitually paste
  // the gs:// form they see in the Firebase console.
  bucketName = config.storageBucket.replace(/^gs:\/\//, '');
}

function requireApp(): App {
  if (app === null) {
    throw new HttpError('internal', 'Firebase has not been initialised; call initFirebase at startup');
  }
  return app;
}

/**
 * Firebase reports infrastructure problems (cert fetch, DNS, upstream 5xx) as
 * `auth/internal-error`, distinct from the codes that mean "bad token".
 */
function isTransientAuthFailure(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return typeof code === 'string' && code.includes('internal-error');
}

export async function verifyIdToken(
  idToken: string,
): Promise<{ uid: string; email?: string; admin?: boolean }> {
  const decoded = await getAuth(requireApp())
    .verifyIdToken(idToken)
    .catch((err: unknown) => {
      // Not every failure is the caller's fault: verifyIdToken fetches Google's
      // signing certificates when its cache is cold, so a DNS/TLS blip arrives
      // here too. Reporting that as 401 makes the client mark a perfectly valid
      // generation as permanently failed and tell a signed-in user to sign in.
      if (isTransientAuthFailure(err)) {
        throw new HttpError('internal', 'Could not verify the authentication token; try again.');
      }
      throw new HttpError('unauthenticated', 'Invalid or expired authentication token');
    });

  return {
    uid: decoded.uid,
    email: decoded.email,
    admin: decoded.admin === true,
  };
}

export function db(): Firestore {
  return getFirestore(requireApp());
}

export function bucket(): Bucket {
  return getStorage(requireApp()).bucket(bucketName);
}

export async function uploadBuffer(args: {
  path: string;
  data: Buffer;
  contentType: string;
}): Promise<{ downloadUrl: string; storagePath: string }> {
  const downloadToken = randomUUID();

  await bucket()
    .file(args.path)
    .save(args.data, {
      // Generated media is a single in-memory buffer, so a resumable session
      // would cost an extra round trip and buy nothing.
      resumable: false,
      contentType: args.contentType,
      metadata: {
        cacheControl: 'private, max-age=3600',
        // This token is what makes the firebasestorage.googleapis.com URL below
        // readable without a signed request or an authenticated SDK client.
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    });

  const encodedPath = encodeURIComponent(args.path);
  return {
    downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${downloadToken}`,
    storagePath: args.path,
  };
}
