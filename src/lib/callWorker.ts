import { getAuth } from 'firebase/auth';
import { app } from '../firebaseApp';

const WORKER_URL = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.['VITE_WORKER_URL'] || '';

export async function callWorker<T = unknown>(name: string, data: unknown = {}): Promise<T> {
  if (!WORKER_URL) throw new Error('VITE_WORKER_URL is not configured');

  const auth = getAuth(app);
  const user = auth.currentUser;
  const idToken = user ? await user.getIdToken() : null;

  const res = await fetch(`${WORKER_URL}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ data }),
  });

  const json = await res.json() as { result?: T; error?: { status: string; message: string } };

  if (json.error) {
    const err = new Error(json.error.message) as Error & { code: string };
    err.code = json.error.status;
    throw err;
  }

  return json.result as T;
}
