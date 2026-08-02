import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAuthUser } from '../auth/plugin.js';
import { ApiError } from '../errors.js';
import { getStorage } from '../storage/index.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * The extension is derived from the validated mime type, never from the supplied
 * filename — a client-controlled name is how a path or a double extension gets in.
 */
const EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
};

export const mediaRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.post('/upload', { preHandler: fastify.authenticate }, async (request) => {
    const user = requireAuthUser(request);

    const part = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
    if (!part) {
      throw new ApiError('invalid-argument', 'A multipart file part named "file" is required.');
    }
    if (part.fieldname !== 'file') {
      throw new ApiError(
        'invalid-argument',
        `Expected the upload field to be named "file", got "${part.fieldname}".`,
      );
    }

    const mimeType = part.mimetype.split(';')[0]?.trim().toLowerCase() ?? '';
    const extension = EXTENSION_BY_MIME_TYPE[mimeType];
    if (!extension) {
      throw new ApiError(
        'invalid-argument',
        `Unsupported upload type "${part.mimetype}". Allowed: PNG, JPEG, WebP and MP4.`,
      );
    }

    const data = await part.toBuffer();
    if (part.file.truncated || data.byteLength > MAX_UPLOAD_BYTES) {
      throw new ApiError('invalid-argument', 'The upload exceeds the 10 MB limit.');
    }

    const stored = await getStorage().save({
      key: `uploads/${user.id}/${randomUUID()}.${extension}`,
      data,
      contentType: mimeType,
    });

    return { url: stored.url, path: stored.path };
  });
};
