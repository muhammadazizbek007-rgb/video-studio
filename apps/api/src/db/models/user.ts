import type { Model, Types } from 'mongoose';
import mongoose, { Schema } from 'mongoose';

export interface UserDoc {
  _id: Types.ObjectId;
  googleId?: string;
  email: string;
  name: string;
  picture: string | null;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    googleId: { type: String, unique: true, sparse: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, default: '' },
    picture: { type: String, default: null },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

export const UserModel: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc> | undefined) ??
  mongoose.model<UserDoc>('User', userSchema);
