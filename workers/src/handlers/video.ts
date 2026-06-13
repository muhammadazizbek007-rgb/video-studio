import { HttpsError, type HandlerContext } from '../types';
import { ensureUserCredits, deductCredits, checkRateLimit } from './credits';

const ALL_MODEL_IDS = [
  'wavespeed-wan', 'wavespeed-wan-i2v', 'seedance-2', 'seedance-2-fast',
  'replicate-wan-t2v', 'replicate-wan-i2v', 'replicate-kling', 'replicate-luma',
  'huggingface-cogvideox', 'huggingface-opensora', 'cogvideox-free',
  'ltx-fast', 'svd', 'leonardo-motion', 'json2video',
];

const MODEL_TO_PROVIDER: Record<string, string> = {
  'wavespeed-wan': 'wavespeed', 'wavespeed-wan-i2v': 'wavespeed',
  'seedance-2': 'seedance', 'seedance-2-fast': 'seedance',
  'replicate-wan-t2v': 'replicate', 'replicate-wan-i2v': 'replicate',
  'replicate-kling': 'replicate', 'replicate-luma': 'replicate',
  'huggingface-cogvideox': 'huggingface', 'huggingface-opensora': 'huggingface',
  'cogvideox-free': 'huggingface', 'ltx-fast': 'huggingface', 'svd': 'huggingface',
  'leonardo-motion': 'leonardo', 'json2video': 'json2video',
};

interface VideoRequest {
  generationId: string; prompt: string; enrichedPrompt?: string;
  modelId: string; mode: string; aspectRatio: string; duration: number;
  stylePreset: string; cameraMotion: string;
  referenceImageUrl?: string; referenceVideoUrl?: string; referenceAudioUrl?: string;
  referenceImageUrls?: string[]; referenceMode?: string;
  elements?: unknown[]; referenceCount?: number;
}

async function runVideoGeneration(ctx: HandlerContext, userId: string, req: VideoRequest): Promise<void> {
  const genRef = `video_generations/${req.generationId}`;

  try {
    const { generateVideo } = await import('../providers');
    const result = await generateVideo(ctx.env, req);

    await ctx.db.upsertWithTransforms('video_generations', req.generationId, {
      status: 'completed',
      resultVideoUrl: result.resultVideoUrl,
      resultStoragePath: result.storagePath || null,
      provider: MODEL_TO_PROVIDER[req.modelId] || 'unknown',
      providerMockMode: false,
    }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);

    await deductCredits(ctx, userId, req.modelId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Video generation failed:', { generationId: req.generationId, userId, modelId: req.modelId, message });
    await ctx.db.upsertWithTransforms('video_generations', req.generationId, {
      status: 'failed',
      errorMessage: message,
    }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);
  }
  void genRef;
}

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
  const credits = await ensureUserCredits(ctx, userId, modelId);
  if (!credits.ok) {
    await ctx.db.upsertWithTransforms('video_generations', generationId, {
      status: 'failed', errorMessage: credits.reason || 'Not enough credits.',
    }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);
    throw new HttpsError('resource-exhausted', credits.reason || 'Not enough video credits.');
  }

  const req: VideoRequest = {
    generationId,
    prompt,
    enrichedPrompt: d?.enrichedPrompt ? String(d.enrichedPrompt) : undefined,
    modelId,
    mode: String(d?.mode || 'text_to_video'),
    aspectRatio: String(d?.aspectRatio || '16:9'),
    duration: Number(d?.duration || 5),
    stylePreset: String(d?.stylePreset || 'Cinematic'),
    cameraMotion: String(d?.cameraMotion || 'Static'),
    referenceImageUrl: d?.referenceImageUrl ? String(d.referenceImageUrl) : undefined,
    referenceVideoUrl: d?.referenceVideoUrl ? String(d.referenceVideoUrl) : undefined,
    referenceAudioUrl: d?.referenceAudioUrl ? String(d.referenceAudioUrl) : undefined,
    referenceImageUrls: Array.isArray(d?.referenceImageUrls) ? (d.referenceImageUrls as string[]) : undefined,
    referenceMode: d?.referenceMode ? String(d.referenceMode) : undefined,
    referenceCount: d?.referenceCount ? Number(d.referenceCount) : 0,
  };

  await ctx.db.upsertWithTransforms('video_generations', generationId, {
    ...req, status: 'processing',
    provider: MODEL_TO_PROVIDER[modelId] || 'unknown',
  }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);

  // Run generation in background so we can respond immediately
  ctx.ctx.waitUntil(runVideoGeneration(ctx, userId, req));

  return { ok: true, generationId, status: 'processing' };
}

export async function handleTestSeedanceConnection(ctx: HandlerContext, _data: unknown) {
  if (!ctx.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in is required.');
  const baseUrl = String(ctx.env.SEEDANCE_API_BASE_URL || '').trim();
  const hasApiKey = Boolean(String(ctx.env.SEEDANCE_API_KEY || '').trim());
  return { mockMode: false, liveTestMode: false, baseUrl, hasApiKey, status: 'ok', message: 'Seedance API configured.' };
}

export async function handleTestProviderConnection(ctx: HandlerContext, _data: unknown) {
  if (!ctx.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in is required.');
  return {
    wavespeed: { configured: Boolean(ctx.env.WAVESPEED_API_KEY), mockMode: false },
    seedance: { configured: Boolean(ctx.env.SEEDANCE_API_KEY), mockMode: false },
    replicate: { configured: Boolean(ctx.env.REPLICATE_API_TOKEN), mockMode: false },
    huggingface: { configured: Boolean(ctx.env.HUGGINGFACE_API_TOKEN), mockMode: false },
    leonardo: { configured: Boolean(ctx.env.LEONARDO_API_KEY), mockMode: false },
    json2video: { configured: Boolean(ctx.env.JSON2VIDEO_API_KEY), mockMode: false },
  };
}
