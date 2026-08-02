import type {
  ElementDto,
  ElementRef,
  VeoModelSpec,
  VideoElementCategory,
  VideoGenerationMode,
} from '@video-studio/shared';
import { extractMentions } from '@video-studio/shared';

const CATEGORY_PRIORITY: Record<VideoElementCategory, number> = {
  character: 1,
  location: 2,
  prop: 3,
  general: 4,
};

/** createGenerationSchema accepts at most three reference images per request. */
const MAX_REFERENCE_IMAGES = 3;

export interface ResolveReferencesInput {
  prompt: string;
  elements: readonly ElementDto[];
  model: VeoModelSpec;
  /** First-frame image the user uploaded by hand; it occupies the first reference slot. */
  uploadedImageUrl?: string | null;
}

export interface ResolvedReferences {
  visualRefs: ElementRef[];
  textRefs: ElementRef[];
  referenceImageUrls: string[];
  enrichedPromptHint: string;
  mode: VideoGenerationMode;
}

export function referenceCapacity(model: VeoModelSpec): number {
  return model.supportsImageToVideo ? MAX_REFERENCE_IMAGES : 0;
}

export function findMentionedElements(
  prompt: string,
  elements: readonly ElementDto[],
): ElementDto[] {
  const mentions = extractMentions(prompt);
  if (mentions.length === 0) return [];

  const byHandle = new Map<string, ElementDto>();
  for (const element of elements) {
    byHandle.set(element.handle.toLowerCase(), element);
  }

  const found: ElementDto[] = [];
  for (const mention of mentions) {
    const element = byHandle.get(mention.toLowerCase());
    if (element) found.push(element);
  }
  return found;
}

function dedupe(elements: readonly ElementDto[]): ElementDto[] {
  const seenIds = new Set<string>();
  const seenImages = new Set<string>();
  const unique: ElementDto[] = [];
  for (const element of elements) {
    if (seenIds.has(element.id)) continue;
    seenIds.add(element.id);
    // Two elements pointing at the same picture would burn two reference slots
    // on one image, so the later one degrades to a text reference instead.
    if (element.imageUrl) {
      if (seenImages.has(element.imageUrl)) {
        unique.push({ ...element, imageUrl: undefined });
        continue;
      }
      seenImages.add(element.imageUrl);
    }
    unique.push(element);
  }
  return unique;
}

function toRef(element: ElementDto, role: 'visual' | 'text', imageIndex?: number): ElementRef {
  return {
    id: element.id,
    name: element.name,
    handle: element.handle,
    category: element.category,
    imageUrl: element.imageUrl,
    description: element.description,
    role,
    imageIndex,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceHandle(text: string, handle: string, replacement: string): string {
  return text.replace(new RegExp(escapeRegex(handle), 'gi'), replacement);
}

function buildMultiReferencePrompt(
  prompt: string,
  visualRefs: readonly ElementRef[],
  textRefs: readonly ElementRef[],
): string {
  const header = visualRefs
    .map((ref) => {
      const description = ref.description?.trim();
      return `@Image${ref.imageIndex} is ${ref.name}${description ? ` — ${description}` : ''}.`;
    })
    .join(' ');

  let body = prompt;
  for (const ref of visualRefs) {
    body = replaceHandle(body, ref.handle, `@Image${ref.imageIndex}`);
  }
  for (const ref of textRefs) {
    body = replaceHandle(body, ref.handle, ref.description?.trim() || ref.name);
  }

  if (!header) return body;
  return body ? `${header} ${body}` : header;
}

function buildFlatPrompt(prompt: string, refs: readonly ElementRef[]): string {
  let result = prompt;
  for (const ref of refs) {
    result = replaceHandle(result, ref.handle, ref.description?.trim() || ref.name);
  }
  return result;
}

/**
 * Turns the raw prompt plus the user's element library into the reference payload
 * a generation request needs: which elements travel as images, which collapse into
 * prompt text, and what the model should be told about each `@ImageN`.
 */
export function resolveReferences(input: ResolveReferencesInput): ResolvedReferences {
  const uploadedImageUrl = input.uploadedImageUrl?.trim() ? input.uploadedImageUrl : null;
  const mentioned = dedupe(findMentionedElements(input.prompt, input.elements));
  const prioritised = [...mentioned].sort(
    (a, b) => CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category],
  );

  const uploadedSlots = uploadedImageUrl ? 1 : 0;
  let remaining = referenceCapacity(input.model) - uploadedSlots;

  const visualRefs: ElementRef[] = [];
  const textRefs: ElementRef[] = [];
  for (const element of prioritised) {
    if (remaining > 0 && element.imageUrl) {
      visualRefs.push(toRef(element, 'visual', uploadedSlots + visualRefs.length + 1));
      remaining -= 1;
    } else {
      textRefs.push(toRef(element, 'text'));
    }
  }

  const elementImageUrls = visualRefs
    .map((ref) => ref.imageUrl)
    .filter((url): url is string => Boolean(url));
  const referenceImageUrls = uploadedImageUrl
    ? [uploadedImageUrl, ...elementImageUrls]
    : elementImageUrls;

  const mode: VideoGenerationMode =
    referenceImageUrls.length > 1
      ? 'reference_to_video'
      : referenceImageUrls.length === 1
        ? 'image_to_video'
        : 'text_to_video';

  const prompt = input.prompt.trim();
  const enrichedPromptHint =
    mode === 'reference_to_video'
      ? buildMultiReferencePrompt(prompt, visualRefs, textRefs)
      : buildFlatPrompt(prompt, [...visualRefs, ...textRefs]);

  return { visualRefs, textRefs, referenceImageUrls, enrichedPromptHint, mode };
}
