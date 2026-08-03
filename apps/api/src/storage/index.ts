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
}

let cached: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (!cached) {
    const env = getEnv();
    cached = createLocalStorage({ root: env.mediaRoot, publicBaseUrl: env.mediaPublicBaseUrl });
  }
  return cached;
}
