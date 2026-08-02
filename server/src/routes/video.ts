import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpError, isHttpError } from '../errors.js';
import { db } from '../firebase.js';
import { log } from '../logger.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAllowedEmail, requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { checkRateLimit } from '../middleware/rateLimit.js';
import { VEO_MODEL_IDS } from '../vertex/models.js';
import { checkVeoOperation, startVeoOperation, type VideoRequest } from '../vertex/veo.js';

const COLLECTION = 'video_generations';

const MAX_GENERATION_ID_LENGTH = 160;
const MAX_PROMPT_LENGTH = 8000;

const DEFAULT_ASPECT_RATIO = '16:9';
const DEFAULT_DURATION = 8;
const DEFAULT_STYLE_PRESET = 'Cinematic';
const DEFAULT_CAMERA_MOTION = 'Static';

function payloadOf(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null) return {};
  const data = (body as { data?: unknown }).data;
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
}

function requiredString(data: Record<string, unknown>, field: string, maxLength: number): string {
  const value = typeof data[field] === 'string' ? (data[field] as string).trim() : '';
  if (value === '') {
    throw new HttpError('invalid-argument', `${field} is required.`);
  }
  // Distinct message: "is required" for something the user clearly supplied
  // sends them looking for the wrong fix.
  if (value.length > maxLength) {
    throw new HttpError('invalid-argument', `${field} is too long (max ${maxLength} characters).`);
  }
  return value;
}

/**
 * Transport-level faults are worth another attempt, so they must not be
 * recorded as a terminal generation failure.
 */
function isRetryable(err: unknown): boolean {
  return isHttpError(err) && (err.code === 'internal' || err.code === 'resource-exhausted');
}

function optionalString(data: Record<string, unknown>, field: string): string | undefined {
  const value = data[field];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function stringOr(data: Record<string, unknown>, field: string, fallback: string): string {
  return optionalString(data, field)?.trim() ?? fallback;
}

function numberOr(data: Record<string, unknown>, field: string, fallback: number): number {
  const value = Number(data[field]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Reference images arrive inline as data: URLs. Firestore caps a field at ~1MB
 * and rejects the whole write above it, so the request is echoed into the doc
 * without them — the provider call already received the full value.
 */
function withoutDataUrls(req: VideoRequest): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(req).filter(
      ([, value]) => value !== undefined && !(typeof value === 'string' && value.startsWith('data:')),
    ),
  );
}

function authOf(req: AuthedRequest): { uid: string; email?: string } {
  if (!req.auth) throw new HttpError('unauthenticated', 'Sign in is required.');
  return req.auth;
}

async function loadOwnedGeneration(
  generationId: string,
  userId: string,
): Promise<Record<string, unknown>> {
  const snap = await db().collection(COLLECTION).doc(generationId).get();
  if (!snap.exists) throw new HttpError('not-found', 'Video generation was not found.');

  const doc = (snap.data() ?? {}) as Record<string, unknown>;
  if (doc['userId'] !== userId) {
    throw new HttpError('permission-denied', 'This generation belongs to another user.');
  }
  return doc;
}

async function patchGeneration(generationId: string, fields: Record<string, unknown>): Promise<void> {
  await db()
    .collection(COLLECTION)
    .doc(generationId)
    .set({ ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export const videoRouter: Router = Router();

// Guards are attached per route rather than with router.use(): this router is
// mounted at the app root, so router-level middleware would also run for paths
// this router does not handle.
videoRouter.post(
  '/startVideoGeneration',
  requireAuth(),
  requireAllowedEmail(),
  asyncHandler(async (req, res) => {
    const { uid } = authOf(req as AuthedRequest);
    const data = payloadOf(req.body);

    const generationId = requiredString(data, 'generationId', MAX_GENERATION_ID_LENGTH);
    const prompt = requiredString(data, 'prompt', MAX_PROMPT_LENGTH);
    const modelId = stringOr(data, 'modelId', '');
    if (!VEO_MODEL_IDS.includes(modelId)) {
      throw new HttpError('invalid-argument', 'modelId is invalid.');
    }

    await loadOwnedGeneration(generationId, uid);
    await checkRateLimit(uid);

    const videoRequest: VideoRequest = {
      generationId,
      userId: uid,
      prompt,
      enrichedPrompt: optionalString(data, 'enrichedPrompt'),
      modelId,
      aspectRatio: stringOr(data, 'aspectRatio', DEFAULT_ASPECT_RATIO),
      duration: numberOr(data, 'duration', DEFAULT_DURATION),
      stylePreset: stringOr(data, 'stylePreset', DEFAULT_STYLE_PRESET),
      cameraMotion: stringOr(data, 'cameraMotion', DEFAULT_CAMERA_MOTION),
      referenceImageUrl: optionalString(data, 'referenceImageUrl'),
      lastFrameImageUrl: optionalString(data, 'lastFrameImageUrl'),
    };

    let started: { operationName: string; vertexModel: string };
    try {
      started = await startVeoOperation(videoRequest);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The client polls the doc, so a start failure has to be visible there
      // and not only in this response.
      await patchGeneration(generationId, { status: 'failed', errorMessage: message });
      throw isHttpError(err) ? err : new HttpError('internal', message);
    }

    await patchGeneration(generationId, {
      ...withoutDataUrls(videoRequest),
      status: 'processing',
      provider: 'veo',
      veoOperationName: started.operationName,
      veoVertexModel: started.vertexModel,
    });

    log('info', 'video generation started', { generationId, userId: uid, modelId });

    // Veo runs for minutes; the client polls checkVideoGeneration from here.
    res.json({
      result: {
        ok: true,
        generationId,
        status: 'processing',
        operationName: started.operationName,
      },
    });
  }),
);

videoRouter.post(
  '/checkVideoGeneration',
  requireAuth(),
  requireAllowedEmail(),
  asyncHandler(async (req, res) => {
    const { uid } = authOf(req as AuthedRequest);
    const data = payloadOf(req.body);
    const generationId = requiredString(data, 'generationId', MAX_GENERATION_ID_LENGTH);

    const doc = await loadOwnedGeneration(generationId, uid);
    const status = typeof doc['status'] === 'string' ? doc['status'] : 'processing';

    if (status === 'completed' || status === 'failed') {
      res.json({
        result: {
          status,
          resultVideoUrl: doc['resultVideoUrl'] ?? null,
          error: doc['errorMessage'] ?? null,
        },
      });
      return;
    }

    const operationName = typeof doc['veoOperationName'] === 'string' ? doc['veoOperationName'] : '';
    const vertexModel = typeof doc['veoVertexModel'] === 'string' ? doc['veoVertexModel'] : '';
    if (operationName === '' || vertexModel === '') {
      // startVideoGeneration has not written the operation yet.
      res.json({ result: { status, resultVideoUrl: null, error: null } });
      return;
    }

    // A throw here must not leave the doc on 'processing': the browser poller
    // discards the rejection and only stops when the doc turns terminal, so an
    // unhandled failure would spin forever. Transport faults stay retryable
    // (doc untouched, 5xx to the client); everything else is terminal.
    let result: Awaited<ReturnType<typeof checkVeoOperation>>;
    try {
      result = await checkVeoOperation({ vertexModel, operationName, userId: uid, generationId });
    } catch (err) {
      if (isRetryable(err)) throw err;
      const message = err instanceof Error ? err.message : String(err);
      await patchGeneration(generationId, { status: 'failed', errorMessage: message });
      res.json({ result: { status: 'failed', resultVideoUrl: null, error: message } });
      return;
    }

    if (result.status === 'completed') {
      await patchGeneration(generationId, {
        status: 'completed',
        resultVideoUrl: result.videoUrl,
        resultStoragePath: result.storagePath,
        provider: 'veo',
      });
      res.json({ result: { status: 'completed', resultVideoUrl: result.videoUrl, error: null } });
      return;
    }

    if (result.status === 'failed') {
      await patchGeneration(generationId, { status: 'failed', errorMessage: result.error });
      res.json({ result: { status: 'failed', resultVideoUrl: null, error: result.error } });
      return;
    }

    res.json({ result: { status: 'processing', resultVideoUrl: null, error: null } });
  }),
);
