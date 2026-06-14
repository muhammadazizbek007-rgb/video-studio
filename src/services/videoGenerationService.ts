import { callWorker } from '../lib/callWorker';
import type { CreateVideoGenerationInput, GenerationElementRef, ReferenceMode } from '../types/video';
import {
  createVideoGenerationDocument,
  getVideoGeneration,
  saveVideoGeneration,
  updateVideoGeneration,
  uploadReferenceFile,
} from './firebaseVideoService';

interface StartVideoGenerationPayload {
  generationId: string;
  prompt: string;
  enrichedPrompt?: string;
  modelId: string;
  mode: string;
  aspectRatio: string;
  duration: number;
  stylePreset: string;
  cameraMotion: string;
  // Legacy single
  referenceImageUrl?: string;
  referenceVideoUrl?: string;
  referenceAudioUrl?: string;
  lastFrameImageUrl?: string;
  // Multi reference
  referenceImageUrls?: string[];
  referenceMode?: ReferenceMode;
  // Element metadata (for future models)
  elements?: GenerationElementRef[];
  referenceCount?: number;
}

export async function generateVideo(userId: string, input: CreateVideoGenerationInput) {
  const { request } = createVideoGenerationDocument(userId, input);
  await saveVideoGeneration(request);

  try {
    // Upload user-provided files
    const [uploadedImageUrl, referenceVideoUrl, referenceAudioUrl, lastFrameImageUrl] = await Promise.all([
      input.referenceImageFile
        ? uploadReferenceFile(userId, request.id, input.referenceImageFile, 'image')
        : Promise.resolve(input.referenceImageUrl),
      input.referenceVideoFile
        ? uploadReferenceFile(userId, request.id, input.referenceVideoFile, 'video')
        : Promise.resolve(input.referenceVideoUrl),
      input.referenceAudioFile
        ? uploadReferenceFile(userId, request.id, input.referenceAudioFile, 'audio')
        : Promise.resolve(input.referenceAudioUrl),
      input.lastFrameImageFile
        ? uploadReferenceFile(userId, request.id, input.lastFrameImageFile, 'image')
        : Promise.resolve(input.lastFrameImageUrl),
    ]);

    // Build final reference image list:
    // user upload (if any) + element visual refs (from resolver)
    const elementImageUrls = input.referenceImageUrls ?? [];
    const referenceImageUrls: string[] = [
      ...(uploadedImageUrl ? [uploadedImageUrl] : []),
      ...elementImageUrls.filter((u) => u !== uploadedImageUrl),
    ].filter((u): u is string => Boolean(u));

    // Primary single URL for legacy providers
    const referenceImageUrl = referenceImageUrls[0];

    // data: URLs are too large for Firestore (1MB limit) — store placeholder instead
    const isDataUrl = (u?: string) => u?.startsWith('data:') ?? false;
    const firestoreImageUrl = isDataUrl(referenceImageUrl) ? undefined : referenceImageUrl;
    const firestoreLastFrameUrl = isDataUrl(lastFrameImageUrl ?? '') ? undefined : (lastFrameImageUrl ?? undefined);

    const enrichedRequest = {
      ...request,
      enrichedPrompt: input.enrichedPrompt,
      referenceImageUrl: firestoreImageUrl,
      referenceImageUrls: referenceImageUrls.filter((u) => !isDataUrl(u)).length > 0
        ? referenceImageUrls.filter((u) => !isDataUrl(u))
        : undefined,
      referenceVideoUrl,
      referenceAudioUrl,
      lastFrameImageUrl: firestoreLastFrameUrl,
      elements: input.elements,
      referenceMode: input.referenceMode,
      referenceCount: referenceImageUrls.length,
      status: 'processing' as const,
    };

    await updateVideoGeneration(request.id, enrichedRequest);

    // Filter data: URLs from arrays before sending to worker (Firestore 1MB limit)
    const workerImageUrls = referenceImageUrls.filter((u) => !isDataUrl(u));

    await callWorker<{ ok: boolean }>('startVideoGeneration', {
      generationId: request.id,
      prompt: enrichedRequest.prompt,
      enrichedPrompt: enrichedRequest.enrichedPrompt,
      modelId: enrichedRequest.modelId,
      mode: enrichedRequest.mode,
      aspectRatio: enrichedRequest.aspectRatio,
      duration: enrichedRequest.duration,
      stylePreset: enrichedRequest.stylePreset,
      cameraMotion: enrichedRequest.cameraMotion,
      referenceImageUrl,
      referenceImageUrls: workerImageUrls.length > 0 ? workerImageUrls : undefined,
      referenceVideoUrl,
      referenceAudioUrl,
      lastFrameImageUrl: lastFrameImageUrl || undefined,
      elements: input.elements,
      referenceMode: input.referenceMode,
      referenceCount: referenceImageUrls.length,
    });

    const completedGeneration = await getVideoGeneration(request.id);
    return completedGeneration || enrichedRequest;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Video generation failed.';
    await updateVideoGeneration(request.id, { status: 'failed', errorMessage: message });
    throw error;
  }
}
