import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { ApiError } from '../errors.js';
import type { StorageDriver, StoredObject } from './index.js';

export interface LocalStorageOptions {
  root: string;
  publicBaseUrl: string;
}

function normaliseKey(key: string): string {
  const trimmed = key.trim().replace(/^\/+/, '');
  if (trimmed === '') {
    throw new ApiError('invalid-argument', 'Storage key must not be empty.');
  }
  if (isAbsolute(trimmed)) {
    throw new ApiError('invalid-argument', `Storage key must be relative: ${key}`);
  }
  return trimmed;
}

export function createLocalStorage(options: LocalStorageOptions): StorageDriver {
  const root = resolve(options.root);
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  const publicBase = options.publicBaseUrl.replace(/\/+$/, '');

  // A key is attacker-influenced (upload filenames, ids from request bodies); anything
  // resolving outside the media root would let a caller read or clobber arbitrary files.
  function safeKey(key: string): { key: string; absolute: string } {
    const normalised = normaliseKey(key);
    const absolute = resolve(root, normalised);
    if (absolute !== root && !absolute.startsWith(rootPrefix)) {
      throw new ApiError('invalid-argument', `Storage key escapes the media root: ${key}`);
    }
    return { key: normalised, absolute };
  }

  function resolveUrl(key: string): string {
    return `${publicBase}/${safeKey(key).key}`;
  }

  return {
    resolveUrl,

    async save({ key, data, contentType }): Promise<StoredObject> {
      const { key: normalised, absolute } = safeKey(key);
      await mkdir(dirname(absolute), { recursive: true });

      // Write-then-rename so a reader never observes a half-written video.
      const temp = `${absolute}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, data);
        await rename(temp, absolute);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }

      return {
        url: resolveUrl(normalised),
        path: normalised,
        bytes: data.byteLength,
        contentType,
      };
    },

    async remove(key): Promise<void> {
      const { absolute } = safeKey(key);
      try {
        await unlink(absolute);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    },
  };
}
