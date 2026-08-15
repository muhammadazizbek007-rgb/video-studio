import type {
  CameraMotion,
  ElementRef,
  VideoAspectRatio,
  VideoDuration,
  VideoElementCategory,
  VideoGenerationMode,
  VideoGenerationStatus,
  VideoStylePreset,
} from '@video-studio/shared';
import {
  ASPECT_RATIOS,
  CAMERA_MOTIONS,
  STYLE_PRESETS,
  VIDEO_DURATIONS,
} from '@video-studio/shared';
import type { Model, Types } from 'mongoose';
import mongoose, { Schema } from 'mongoose';

const STATUSES: VideoGenerationStatus[] = ['pending', 'processing', 'completed', 'failed'];
const MODES: VideoGenerationMode[] = ['text_to_video', 'image_to_video', 'reference_to_video'];
const ELEMENT_CATEGORIES: VideoElementCategory[] = ['general', 'character', 'location', 'prop'];

export interface GenerationDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  prompt: string;
  enrichedPrompt?: string;
  modelId: string;
  mode: VideoGenerationMode;
  aspectRatio: VideoAspectRatio;
  duration: VideoDuration;
  stylePreset: VideoStylePreset;
  cameraMotion: CameraMotion;
  status: VideoGenerationStatus;
  resultVideoUrl?: string;
  resultStoragePath?: string;
  errorMessage?: string;
  saved: boolean;
  referenceImageUrls: string[];
  lastFrameImageUrl?: string;
  /** The dice roll handed to Veo; kept so the clip can be reproduced exactly. */
  seed?: number;
  /** The saved narrator this clip asked for, kept as a record of what was requested. */
  voiceId?: Types.ObjectId;
  elements: ElementRef[];
  referenceCount: number;
  vertexOperationName?: string;
  vertexModel?: string;
  /**
   * Waiting for a submission slot, not for Vertex.
   *
   * Vertex accepts one `predictLongRunning` per minute per base model, so a second clip
   * started in the same minute has to wait its turn. Without this flag such a row is
   * indistinguishable from one that was handed over and lost its operation name — and
   * `syncGeneration` fails those on sight, which would kill every queued clip 30 seconds
   * after it was asked for.
   */
  awaitingSubmission?: boolean;
  /** How many times the submission was refused by the quota and re-queued. */
  submissionAttempts?: number;
  /** The clip this one continues from, when it was made by extending rather than generating. */
  extendedFromId?: Types.ObjectId;
  /** Set when the generation was started from a storyboard segment rather than the studio. */
  storyboardId?: Types.ObjectId;
  segmentIndex?: number;
  createdAt: Date;
  updatedAt: Date;
}

const elementRefSubSchema = new Schema<ElementRef>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    handle: { type: String, required: true },
    category: { type: String, enum: ELEMENT_CATEGORIES, required: true },
    imageUrl: { type: String },
    description: { type: String },
    role: { type: String, enum: ['visual', 'text'], required: true },
    imageIndex: { type: Number },
  },
  { _id: false },
);

const generationSchema = new Schema<GenerationDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    prompt: { type: String, required: true },
    enrichedPrompt: { type: String },
    modelId: { type: String, required: true },
    mode: { type: String, enum: MODES, required: true, default: 'text_to_video' },
    aspectRatio: { type: String, enum: [...ASPECT_RATIOS], required: true, default: '16:9' },
    duration: { type: Number, enum: [...VIDEO_DURATIONS], required: true, default: 8 },
    stylePreset: { type: String, enum: [...STYLE_PRESETS], required: true, default: 'Cinematic' },
    cameraMotion: { type: String, enum: [...CAMERA_MOTIONS], required: true, default: 'Static' },
    status: { type: String, enum: STATUSES, required: true, default: 'pending', index: true },
    resultVideoUrl: { type: String },
    resultStoragePath: { type: String },
    errorMessage: { type: String },
    saved: { type: Boolean, required: true, default: false },
    referenceImageUrls: { type: [String], required: true, default: [] },
    lastFrameImageUrl: { type: String },
    seed: { type: Number },
    voiceId: { type: Schema.Types.ObjectId, ref: 'Voice' },
    elements: { type: [elementRefSubSchema], required: true, default: [] },
    referenceCount: { type: Number, required: true, default: 0 },
    vertexOperationName: { type: String },
    vertexModel: { type: String },
    awaitingSubmission: { type: Boolean },
    submissionAttempts: { type: Number },
    extendedFromId: { type: Schema.Types.ObjectId, ref: 'Generation' },
    storyboardId: { type: Schema.Types.ObjectId, ref: 'Storyboard' },
    segmentIndex: { type: Number },
  },
  { timestamps: true },
);

// Serves the cursor-paginated history list, which is always scoped to one user.
generationSchema.index({ userId: 1, createdAt: -1 });

// The background reconciler sweeps by status and staleness, never by user.
generationSchema.index({ status: 1, updatedAt: 1 });

export const GenerationModel: Model<GenerationDoc> =
  (mongoose.models.Generation as Model<GenerationDoc> | undefined) ??
  mongoose.model<GenerationDoc>('Generation', generationSchema);
