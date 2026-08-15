import type { Model, Types } from 'mongoose';
import mongoose, { Schema } from 'mongoose';

/**
 * A narrator the account can reuse.
 *
 * Veo casts a new speaker for every clip and its API has no voice parameter, so the only
 * way to ask for the same person twice is to describe them the same way twice. This is that
 * description, written once and kept.
 */
export interface VoiceDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  prompt: string;
  createdAt: Date;
  updatedAt: Date;
}

const voiceSchema = new Schema<VoiceDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    prompt: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

// Two narrators called "Диктор" in one account are indistinguishable in a picker.
voiceSchema.index({ userId: 1, name: 1 }, { unique: true });

export const VoiceModel: Model<VoiceDoc> =
  (mongoose.models.Voice as Model<VoiceDoc> | undefined) ??
  mongoose.model<VoiceDoc>('Voice', voiceSchema);
