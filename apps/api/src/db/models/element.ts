import type { VideoElementCategory } from '@video-studio/shared';
import type { Model, Types } from 'mongoose';
import mongoose, { Schema } from 'mongoose';

const ELEMENT_CATEGORIES: VideoElementCategory[] = ['general', 'character', 'location', 'prop'];

export interface ElementDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  handle: string;
  category: VideoElementCategory;
  description?: string;
  imageUrl?: string;
  storagePath?: string;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const elementSchema = new Schema<ElementDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    handle: { type: String, required: true, trim: true },
    category: { type: String, enum: ELEMENT_CATEGORIES, required: true, default: 'general' },
    description: { type: String },
    imageUrl: { type: String },
    storagePath: { type: String },
    pinned: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

elementSchema.index({ userId: 1, handle: 1 }, { unique: true });

export const ElementModel: Model<ElementDoc> =
  (mongoose.models.Element as Model<ElementDoc> | undefined) ??
  mongoose.model<ElementDoc>('Element', elementSchema);
