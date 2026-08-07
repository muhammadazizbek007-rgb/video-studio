import type { MediaKind } from '@video-studio/shared';
import type { Model, Types } from 'mongoose';
import mongoose, { Schema } from 'mongoose';

const KINDS: MediaKind[] = ['image', 'video'];

/**
 * One file the account uploaded.
 *
 * The bytes were always kept; what was missing was the record. Without it an upload could
 * only ever be used by the screen that produced it, which is why the media picker had
 * nothing to show under "Uploads".
 */
export interface UploadDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  url: string;
  storagePath: string;
  kind: MediaKind;
  contentType: string;
  bytes: number;
  /** The name the browser sent. Display only — the storage key never derives from it. */
  filename: string;
  saved: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const uploadSchema = new Schema<UploadDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    url: { type: String, required: true },
    storagePath: { type: String, required: true },
    kind: { type: String, enum: KINDS, required: true },
    contentType: { type: String, required: true },
    bytes: { type: Number, required: true, default: 0 },
    filename: { type: String, required: true, default: '' },
    saved: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

// The picker always asks for one account's newest files, optionally narrowed to a kind.
uploadSchema.index({ userId: 1, createdAt: -1 });

export const UploadModel: Model<UploadDoc> =
  (mongoose.models.Upload as Model<UploadDoc> | undefined) ??
  mongoose.model<UploadDoc>('Upload', uploadSchema);
