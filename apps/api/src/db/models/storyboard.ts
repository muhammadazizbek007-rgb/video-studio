import type {
  CameraMotion,
  StoryboardExportStatus,
  VideoAspectRatio,
  VideoDuration,
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

const EXPORT_STATUSES: StoryboardExportStatus[] = ['idle', 'processing', 'completed', 'failed'];

/**
 * A segment stores both the public URL and the storage key of everything it owns. The URL
 * is what the browser needs; the key is what lets us delete the object when the slot is
 * replaced, cleared or the storyboard goes away. Keeping only the URL is how media roots
 * fill up with files nothing references any more.
 */
export interface StoryboardSegmentDoc {
  firstFrameUrl?: string;
  firstFrameStoragePath?: string;
  lastFrameUrl?: string;
  lastFrameStoragePath?: string;
  /** The generation that produced this segment, when it came from Veo rather than an upload. */
  generationId?: Types.ObjectId;
  videoUrl?: string;
  /** Set only for a manually uploaded clip — a generated one is owned by its generation. */
  videoStoragePath?: string;
  durationSeconds?: number;
}

export interface StoryboardDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  prompt: string;
  modelId: string;
  aspectRatio: VideoAspectRatio;
  duration: VideoDuration;
  stylePreset: VideoStylePreset;
  cameraMotion: CameraMotion;
  segments: StoryboardSegmentDoc[];
  exportStatus: StoryboardExportStatus;
  exportUrl?: string;
  exportStoragePath?: string;
  exportError?: string;
  /** Lets a crashed export be re-offered instead of pinning the storyboard on 'processing'. */
  exportStartedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const segmentSubSchema = new Schema<StoryboardSegmentDoc>(
  {
    firstFrameUrl: { type: String },
    firstFrameStoragePath: { type: String },
    lastFrameUrl: { type: String },
    lastFrameStoragePath: { type: String },
    generationId: { type: Schema.Types.ObjectId, ref: 'Generation' },
    videoUrl: { type: String },
    videoStoragePath: { type: String },
    durationSeconds: { type: Number },
  },
  { _id: false },
);

const storyboardSchema = new Schema<StoryboardDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Not `required`: mongoose treats an empty string as a missing value, and a board with
    // no title or no prompt yet is the normal state right after it is created.
    title: { type: String, default: '' },
    prompt: { type: String, default: '' },
    modelId: { type: String, required: true },
    aspectRatio: { type: String, enum: [...ASPECT_RATIOS], required: true, default: '16:9' },
    duration: { type: Number, enum: [...VIDEO_DURATIONS], required: true, default: 8 },
    stylePreset: { type: String, enum: [...STYLE_PRESETS], required: true, default: 'Cinematic' },
    cameraMotion: { type: String, enum: [...CAMERA_MOTIONS], required: true, default: 'Static' },
    // Order is the segment order, so the array index *is* the segment index.
    segments: { type: [segmentSubSchema], required: true, default: [] },
    exportStatus: { type: String, enum: EXPORT_STATUSES, required: true, default: 'idle' },
    exportUrl: { type: String },
    exportStoragePath: { type: String },
    exportError: { type: String },
    exportStartedAt: { type: Date },
  },
  { timestamps: true },
);

storyboardSchema.index({ userId: 1, updatedAt: -1 });

export const StoryboardModel: Model<StoryboardDoc> =
  (mongoose.models.Storyboard as Model<StoryboardDoc> | undefined) ??
  mongoose.model<StoryboardDoc>('Storyboard', storyboardSchema);
