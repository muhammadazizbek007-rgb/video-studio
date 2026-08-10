import { getEnv } from '../env.js';

/**
 * Media URLs, seen from the two places that have to leave this host.
 *
 * `MEDIA_PUBLIC_BASE_URL` defaults to `/media`, which is correct for the browser — it shares
 * an origin with the API — and unusable everywhere else. Vertex *fetches* a reference image
 * rather than resolving it against us, and `fetch('/media/...')` in Node is not a relative
 * request but a parse error. Every caller that hands a stored URL to something off-host goes
 * through here instead of assuming the URL is absolute.
 */

/**
 * Turns a media URL back into the storage key it was built from.
 *
 * Only URLs this deployment served can be mapped, which is the point: a key is what unlocks
 * the filesystem shortcut, and anything we did not serve has to be fetched like any other
 * remote file.
 */
export function storageKeyFromUrl(url: string): string | null {
  const base = getEnv().mediaPublicBaseUrl.replace(/\/+$/, '');
  const withoutOrigin = url.replace(/^https?:\/\/[^/]+/, '');
  const prefix = `${base}/`;
  if (!withoutOrigin.startsWith(prefix)) return null;
  const key = withoutOrigin.slice(prefix.length).split('?')[0] ?? '';
  return key === '' ? null : decodeURIComponent(key);
}

/** Absolutises a stored media URL against `API_PUBLIC_URL`; leaves an absolute one alone. */
export function absoluteMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed === '') return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('data:')) return trimmed;

  const base = getEnv().apiPublicUrl.replace(/\/+$/, '');
  return trimmed.startsWith('/') ? `${base}${trimmed}` : `${base}/${trimmed}`;
}
