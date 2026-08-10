import type { ElementDto, ResolvedMentions, VeoModelSpec } from '@video-studio/shared';
import {
  assetReferenceCapacity,
  findMentionedElements,
  resolveMentions,
} from '@video-studio/shared';

/**
 * The studio's preview of what the prompt currently resolves to.
 *
 * The server resolves mentions again, from the same shared function, and its answer is the
 * one that reaches Veo — this exists so the form can show which elements are attached, which
 * slots are taken and whether the uploaded frame survived, before anything is sent.
 */

export interface PreviewReferencesInput {
  prompt: string;
  elements: readonly ElementDto[];
  model: VeoModelSpec;
  firstFrameImageUrl?: string | null;
}

export function previewReferences(input: PreviewReferencesInput): ResolvedMentions {
  return resolveMentions({
    prompt: input.prompt,
    elements: input.elements,
    model: input.model,
    firstFrameImageUrl: input.firstFrameImageUrl,
  });
}

export { assetReferenceCapacity, findMentionedElements };
