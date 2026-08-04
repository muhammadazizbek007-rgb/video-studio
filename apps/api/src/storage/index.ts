import { getEnv } from '../env.js';
import { createLocalStorage } from './local.js';

export interface StoredObject {
  url: string;
  path: string;
  bytes: number;
  contentType: string;
}

export interface StorageDriver {
  save(a: { key: string; data: Buffer; contentType: string }): Promise<StoredObject>;
  remove(key: string): Promise<void>;
  resolveUrl(key: string): string;
  /**
   * Absolute path of an object, when the driver keeps bytes on this filesystem.
   *
   * Stitching an export shells out to ffmpeg, which reads files rather than URLs. A remote
   * driver returns null and the caller falls back to downloading — so this is an
   * optimisation the local driver can offer, never something a driver must implement.
   */
  localPath?(key: string): string | null;
}

let cached: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (!cached) {
    const env = getEnv();
    cached = createLocalStorage({ root: env.mediaRoot, publicBaseUrl: env.mediaPublicBaseUrl });
  }
  return cached;
}
