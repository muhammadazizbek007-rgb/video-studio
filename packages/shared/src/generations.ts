import type { CreateGenerationInput, GenerationDto } from './schemas.js';

/**
 * The opening frame the user uploaded, read back off a stored generation.
 *
 * A record keeps `referenceImageUrls` as the opening frame followed by the images its
 * mentioned elements contributed, with nothing marking where one ends and the other begins.
 * The elements are on the record too, so the number of them that carried an image is exactly
 * how many of those entries are theirs — anything left over at the front is the frame.
 */
export function generationFirstFrameImageUrl(generation: GenerationDto): string | undefined {
  const fromElements = generation.elements.filter((ref) => ref.imageUrl).length;
  return generation.referenceImageUrls.length > fromElements
    ? generation.referenceImageUrls[0]
    : undefined;
}

/**
 * What to send to run a failed generation again.
 *
 * Only the choices the user made travel. The mentions are still sitting in the prompt, so the
 * server resolves them against the library as it stands at the moment of the retry — an
 * element renamed, re-photographed or deleted since the failure is picked up rather than
 * frozen at what it was. `mode` is left out for the same reason: the server derives it from
 * what the prompt resolves to, and a stale mode would only fight that.
 */
export function retryGenerationInput(generation: GenerationDto): CreateGenerationInput {
  const input: CreateGenerationInput = {
    prompt: generation.prompt,
    modelId: generation.modelId,
    aspectRatio: generation.aspectRatio,
    duration: generation.duration,
    stylePreset: generation.stylePreset,
    cameraMotion: generation.cameraMotion,
  };

  const firstFrameImageUrl = generationFirstFrameImageUrl(generation);
  if (firstFrameImageUrl) input.firstFrameImageUrl = firstFrameImageUrl;
  if (generation.lastFrameImageUrl) input.lastFrameImageUrl = generation.lastFrameImageUrl;

  return input;
}
