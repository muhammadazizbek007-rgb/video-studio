import type { Model, Types } from 'mongoose';
import mongoose, { Schema } from 'mongoose';

/**
 * A block of project context the account can reuse.
 *
 * The facts every clip in a campaign shares — what the product is, how the packaging looks,
 * the tone, what must never appear. Retyping them is how they drift apart; kept here they
 * stay identical from the first clip to the hundredth.
 */
export interface ProjectPromptDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  prompt: string;
  createdAt: Date;
  updatedAt: Date;
}

const projectPromptSchema = new Schema<ProjectPromptDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    prompt: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

// Two entries with the same name are indistinguishable in the @ list, which is the one
// place these are ever read.
projectPromptSchema.index({ userId: 1, name: 1 }, { unique: true });

export const ProjectPromptModel: Model<ProjectPromptDoc> =
  (mongoose.models.ProjectPrompt as Model<ProjectPromptDoc> | undefined) ??
  mongoose.model<ProjectPromptDoc>('ProjectPrompt', projectPromptSchema);
