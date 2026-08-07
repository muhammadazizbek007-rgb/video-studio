import type { CreateImageGenerationInput } from '@video-studio/shared';
import { getImageModel } from '@video-studio/shared';
import type { HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';
import type { AuthUser } from '../auth/plugin.js';
import { type ImageGenerationDoc, ImageGenerationModel } from '../db/models/imageGeneration.js';
import { ApiError } from '../errors.js';
import { logger } from '../logger.js';
import { buildImagePrompt } from '../prompt.js';
import { getStorage } from '../storage/index.js';
import { generateImage } from '../vertex/imagen.js';

export type ImageGenerationDocument = HydratedDocument<ImageGenerationDoc>;

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return 'Image generation failed.';
}

function toObjectId(value: string, what: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw new ApiError('not-found', `${what} not found.`);
  }
  return new Types.ObjectId(value);
}

/**
 * Runs the generation, then records it — success or failure.
 *
 * The style preset is expanded into the prompt here rather than in the route or the Vertex
 * client, so every caller (REST, MCP) gets the same look from the same label, and the text
 * that produced the picture is stored alongside it.
 */
export async function createImageGeneration(
  user: AuthUser,
  input: CreateImageGenerationInput,
): Promise<ImageGenerationDocument> {
  const spec = getImageModel(input.modelId);
  if (!spec) {
    throw new ApiError('invalid-argument', `Unknown image model: ${input.modelId}.`);
  }

  const finalPrompt = buildImagePrompt({
    prompt: input.prompt,
    stylePreset: input.stylePreset,
  });

  const base = {
    userId: toObjectId(user.id, 'Account'),
    prompt: input.prompt,
    finalPrompt,
    modelId: spec.id,
    aspectRatio: input.aspectRatio,
    stylePreset: input.stylePreset,
  };

  try {
    const image = await generateImage({
      userId: user.id,
      prompt: finalPrompt,
      modelId: spec.id,
      aspectRatio: input.aspectRatio,
    });

    return await ImageGenerationModel.create({
      ...base,
      status: 'completed',
      imageUrl: image.imageUrl,
      storagePath: image.storagePath,
    });
  } catch (error) {
    // The failed attempt is still worth a row: it is how a rejected prompt or a quota wall
    // stays visible after the toast that reported it has gone.
    await ImageGenerationModel.create({
      ...base,
      status: 'failed',
      errorMessage: messageOf(error),
    }).catch((saveError: unknown) => {
      logger.error({ err: saveError }, 'could not record the failed image generation');
    });
    throw error;
  }
}

export async function listImageGenerations(
  userId: string,
  options: { limit: number },
): Promise<ImageGenerationDocument[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit), 1), 100);
  return await ImageGenerationModel.find({ userId: toObjectId(userId, 'Account') })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .exec();
}

export async function requireOwnedImage(
  id: string,
  userId: string,
): Promise<ImageGenerationDocument> {
  const doc = await ImageGenerationModel.findById(toObjectId(id, 'Image')).exec();
  if (!doc) {
    throw new ApiError('not-found', 'Image not found.');
  }
  if (doc.userId.toString() !== userId) {
    throw new ApiError('permission-denied', 'This image belongs to another account.');
  }
  return doc;
}

export async function deleteImageGeneration(doc: ImageGenerationDocument): Promise<void> {
  const storagePath = doc.storagePath;
  if (storagePath) {
    await getStorage()
      .remove(storagePath)
      .catch((error: unknown) => {
        logger.warn(
          { err: error, imageId: doc._id.toString() },
          'could not remove the stored image, deleting the record anyway',
        );
      });
  }
  await doc.deleteOne();
}
