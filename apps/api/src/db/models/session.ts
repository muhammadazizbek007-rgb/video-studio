import type { Model, Types } from 'mongoose';
import mongoose, { Schema } from 'mongoose';

export interface SessionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  refreshTokenHash: string;
  userAgent?: string;
  ip?: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<SessionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    refreshTokenHash: { type: String, required: true, unique: true },
    userAgent: { type: String },
    ip: { type: String },
    // `expires: 0` turns this into a TTL index, so Mongo reaps dead sessions itself.
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true },
);

export const SessionModel: Model<SessionDoc> =
  (mongoose.models.Session as Model<SessionDoc> | undefined) ??
  mongoose.model<SessionDoc>('Session', sessionSchema);
