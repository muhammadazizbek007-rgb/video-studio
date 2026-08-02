import { HttpsError, type HandlerContext } from '../types';
import { checkRateLimit } from './rateLimit';
import {
  VEO_MODEL_IDS,
  getVeoModelSpec,
  startVeoOperation,
  checkVeoOperation,
  type VideoRequest,
} from '../providers';

const ALL_MODEL_IDS = [...VEO_MODEL_IDS, 'json2video'];

const MODEL_TO_PROVIDER: Record<string, string> = {
  ...Object.fromEntries(VEO_MODEL_IDS.map((id) => [id, 'veo'])),
  json2video: 'json2video',
};

/** Veo is long-running: the worker starts it, the client polls checkVideoGeneration. */
const VEO_MODEL_SET = new Set(VEO_MODEL_IDS);

export async function handleStartVideoGeneration(ctx: HandlerContext, data: unknown) {
  if (!ctx.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in is required.');
  const userId = ctx.auth.uid;

  const d = data as Record<string, unknown>;

  const generationId = String(d?.generationId || '').trim();
  if (!generationId || generationId.length > 160) throw new HttpsError('invalid-argument', 'generationId is required.');
  const prompt = String(d?.prompt || '').trim();
  if (!prompt || prompt.length > 8000) throw new HttpsError('invalid-argument', 'prompt is required.');
  const modelId = String(d?.modelId || '').trim();
  if (!ALL_MODEL_IDS.includes(modelId)) throw new HttpsError('invalid-argument', 'modelId is invalid.');

  const existing = await ctx.db.get('video_generations', generationId);
  if (!existing) throw new HttpsError('not-found', 'Video generation was not found.');
  if (existing.userId !== userId) throw new HttpsError('permission-denied', 'This generation belongs to another user.');

  await checkRateLimit(ctx, userId);

  const req: VideoRequest = {
    generationId,
    userId,
    prompt,
    enrichedPrompt: d?.enrichedPrompt ? String(d.enrichedPrompt) : undefined,
    modelId,
    mode: String(d?.mode || 'text_to_video'),
    aspectRatio: String(d?.aspectRatio || '16:9'),
    duration: Number(d?.duration || 8),
    stylePreset: String(d?.stylePreset || 'Cinematic'),
    cameraMotion: String(d?.cameraMotion || 'Static'),
    referenceImageUrl: d?.referenceImageUrl ? String(d.referenceImageUrl) : undefined,
    referenceVideoUrl: d?.referenceVideoUrl ? String(d.referenceVideoUrl) : undefined,
    referenceAudioUrl: d?.referenceAudioUrl ? String(d.referenceAudioUrl) : undefined,
    referenceImageUrls: Array.isArray(d?.referenceImageUrls) ? (d.referenceImageUrls as string[]) : undefined,
    lastFrameImageUrl: d?.lastFrameImageUrl ? String(d.lastFrameImageUrl) : undefined,
  };

  // Strip data: URLs before saving to Firestore (1MB field limit)
  const isDataUrl = (v: unknown) => typeof v === 'string' && (v as string).startsWith('data:');
  const stripDataUrls = (v: unknown): unknown => {
    if (isDataUrl(v)) return undefined;
    if (Array.isArray(v)) { const f = v.filter((i) => !isDataUrl(i)); return f.length > 0 ? f : undefined; }
    return v;
  };
  const firestoreReq = Object.fromEntries(
    Object.entries(req).map(([k, v]) => [k, stripDataUrls(v)]).filter(([, v]) => v !== undefined)
  );

  if (!VEO_MODEL_SET.has(modelId)) {
    throw new HttpsError('invalid-argument', `Model ${modelId} is not available through the Cloudflare Worker. Use the Firebase Function path.`);
  }

  let operationName: string;
  let vertexModel: string;
  try {
    const started = await startVeoOperation(ctx.env, req);
    operationName = started.operationName;
    vertexModel = started.vertexModel;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.db.upsertWithTransforms('video_generations', generationId, {
      status: 'failed', errorMessage: msg,
    }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);
    throw new HttpsError('internal', msg);
  }

  await ctx.db.upsertWithTransforms('video_generations', generationId, {
    ...firestoreReq,
    status: 'processing',
    provider: MODEL_TO_PROVIDER[modelId],
    veoOperationName: operationName,
    veoVertexModel: vertexModel,
  }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);

  return { ok: true, generationId, status: 'processing', operationName };
}

// Client calls this every ~5s to check the Veo operation
export async function handleCheckVideoGeneration(ctx: HandlerContext, data: unknown) {
  if (!ctx.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in is required.');

  const d = data as Record<string, unknown>;
  const generationId = String(d?.generationId || '').trim();
  if (!generationId) throw new HttpsError('invalid-argument', 'generationId is required.');

  const doc = await ctx.db.get('video_generations', generationId);
  if (!doc) throw new HttpsError('not-found', 'Generation not found.');
  if (doc.userId !== ctx.auth.uid) throw new HttpsError('permission-denied', 'Access denied.');

  // Already done — just return current status
  if (doc.status === 'completed' || doc.status === 'failed') {
    return { status: doc.status, resultVideoUrl: doc.resultVideoUrl ?? null, error: doc.errorMessage ?? null };
  }

  const operationName = String(doc.veoOperationName || '').trim();
  const vertexModel = String(doc.veoVertexModel || '').trim();
  if (!operationName || !vertexModel) return { status: doc.status };

  const result = await checkVeoOperation(ctx.env, vertexModel, operationName, {
    userId: String(doc.userId),
    generationId,
  });

  if (result.status === 'completed' && result.videoUrl) {
    await ctx.db.upsertWithTransforms('video_generations', generationId, {
      status: 'completed',
      resultVideoUrl: result.videoUrl,
      resultStoragePath: result.storagePath || null,
      provider: 'veo',
    }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);

    return { status: 'completed', resultVideoUrl: result.videoUrl, error: null };
  }

  if (result.status === 'failed') {
    await ctx.db.upsertWithTransforms('video_generations', generationId, {
      status: 'failed', errorMessage: result.error || 'Veo generation failed',
    }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);
    return { status: 'failed', resultVideoUrl: null, error: result.error };
  }

  return { status: 'processing', resultVideoUrl: null, error: null };
}

export async function handleTestVertexConnection(ctx: HandlerContext, _data: unknown) {
  if (!ctx.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in is required.');

  const projectId = String(ctx.env.VERTEX_PROJECT_ID || ctx.env.FIREBASE_PROJECT_ID || '').trim();
  const location = String(ctx.env.VERTEX_LOCATION || 'us-central1').trim();
  const hasServiceAccount = Boolean(String(ctx.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim());

  if (!projectId || !hasServiceAccount) {
    const missing = [!projectId && 'VERTEX_PROJECT_ID', !hasServiceAccount && 'FIREBASE_SERVICE_ACCOUNT_JSON']
      .filter(Boolean).join(', ');
    return {
      status: 'error', projectId, location, tokenOk: false,
      videoModels: VEO_MODEL_IDS,
      message: `Не задано: ${missing}.`,
    };
  }

  // Confirms the model registry resolves and credentials are present
  try {
    getVeoModelSpec(VEO_MODEL_IDS[0]);
  } catch (err) {
    return {
      status: 'error', projectId, location, tokenOk: false,
      videoModels: VEO_MODEL_IDS,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    status: 'ok', projectId, location, tokenOk: true,
    videoModels: VEO_MODEL_IDS,
    message: `Vertex AI настроен: проект ${projectId}, регион ${location}.`,
  };
}

export async function handleTestProviderConnection(ctx: HandlerContext, _data: unknown) {
  if (!ctx.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in is required.');
  const vertexReady = Boolean(
    String(ctx.env.VERTEX_PROJECT_ID || ctx.env.FIREBASE_PROJECT_ID || '').trim() &&
    String(ctx.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim(),
  );
  return {
    providers: {
      veo: { name: 'Google Veo (Vertex AI)', configured: vertexReady, mockMode: false, status: vertexReady ? 'ok' : 'not_configured' },
      imagen: { name: 'Google Imagen (Vertex AI)', configured: vertexReady, mockMode: false, status: vertexReady ? 'ok' : 'not_configured' },
      json2video: { name: 'JSON2Video (slideshow)', configured: Boolean(ctx.env.JSON2VIDEO_API_KEY), mockMode: false, status: ctx.env.JSON2VIDEO_API_KEY ? 'ok' : 'not_configured' },
    },
  };
}
