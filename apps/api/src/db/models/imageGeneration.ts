import type { ImageAspectRatio, VideoStylePreset } from '@video-studio/shared';
import { STYLE_PRESETS } from '@video-studio/shared';
import type { Model, Types } from 'mongoose';
import mongoose, { Schema } from 'mongoose';

const IMAGE_ASPECT_RATIOS: ImageAspectRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const STATUSES = ['completed', 'failed'] as const;

export type ImageGenerationStatus = (typeof STATUSES)[number];

/**
 * Imagen and Gemini Image answer within one request, so there is no pending state to poll:
 * a record is written once the call has already succeeded or failed.
 *
 * `finalPrompt` is the text Vertex actually received — the user's prompt with the style
 * preset expanded into it. Keeping it makes a disappointing result diagnosable.
 */
export interface ImageGenerationDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  prompt: string;
  finalPrompt: string;
  modelId: string;
  aspectRatio: ImageAspectRatio;
  stylePreset: VideoStylePreset;
  status: ImageGenerationStatus;
  imageUrl?: string;
  storagePath?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const imageGenerationSchema = new Schema<ImageGenerationDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    prompt: { type: String, required: true },
    finalPrompt: { type: String, required: true },
    modelId: { type: String, required: true },
    aspectRatio: {
      type: String,
      enum: IMAGE_ASPECT_RATIOS,
      required: true,
      default: '1:1',
    },
    stylePreset: { type: String, enum: [...STYLE_PRESETS], required: true, default: 'Cinematic' },
    status: { type: String, enum: [...STATUSES], required: true, default: 'completed' },
    imageUrl: { type: String },
    storagePath: { type: String },
    errorMessage: { type: String },
  },
  { timestamps: true },
);

// The gallery is always "this account's latest images", never a global scan.
imageGenerationSchema.index({ userId: 1, createdAt: -1 });

export const ImageGenerationModel: Model<ImageGenerationDoc> =
  (mongoose.models.ImageGeneration as Model<ImageGenerationDoc> | undefined) ??
  mongoose.model<ImageGenerationDoc>('ImageGeneration', imageGenerationSchema);
