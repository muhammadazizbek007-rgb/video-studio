import type { VideoElement, VideoElementCategory } from '../types/videoElement';
import type {
  GenerationElementRef,
  ModelCapabilities,
  ResolvedReferenceMode,
  ResolvedReferences,
} from '../types/video';
import { videoModels } from '../models/videoModels';

// ─── Priority ─────────────────────────────────────────────────────────────────
// character(1) > location(2) > prop(3) > general(4)

const CATEGORY_PRIORITY: Record<VideoElementCategory, number> = {
  character: 1,
  location: 2,
  prop: 3,
  general: 4,
};

// ─── Deduplication ────────────────────────────────────────────────────────────

function deduplicateElements(elements: VideoElement[]): VideoElement[] {
  const seenIds = new Set<string>();
  const seenImageUrls = new Set<string>();
  return elements.filter((el) => {
    if (seenIds.has(el.id)) return false;
    seenIds.add(el.id);
    if (el.imageUrl) {
      if (seenImageUrls.has(el.imageUrl)) return false;
      seenImageUrls.add(el.imageUrl);
    }
    return true;
  });
}

// ─── Sort by priority ─────────────────────────────────────────────────────────

function sortByPriority(elements: VideoElement[]): VideoElement[] {
  return [...elements].sort(
    (a, b) => (CATEGORY_PRIORITY[a.category] ?? 99) - (CATEGORY_PRIORITY[b.category] ?? 99),
  );
}

// ─── Capability checker ───────────────────────────────────────────────────────

function getModelCapabilities(modelId: string): ModelCapabilities {
  const model = videoModels.find((m) => m.id === modelId);
  return model?.capabilities ?? {
    maxReferenceImages: 0,
    supportsMultiReference: false,
    referenceMode: 'none',
    supportsCharacterReference: false,
    supportsLocationReference: false,
    supportsPropReference: false,
  };
}

function canBeVisualRef(el: VideoElement, caps: ModelCapabilities): boolean {
  if (!el.imageUrl) return false;
  if (caps.maxReferenceImages === 0) return false;
  if (el.category === 'character') return caps.supportsCharacterReference;
  if (el.category === 'location') return caps.supportsLocationReference;
  if (el.category === 'prop') return caps.supportsPropReference;
  // general — use a slot if any remain
  return true;
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

/**
 * Build prompt for multi-reference mode.
 *
 * Produces:
 *   "@Image1 is Luna — young curly-haired girl in orange hoodie.
 *    @Image2 is School — modern red brick building.
 *    @Image3 is PinkBag — bright pink backpack.
 *    @Image1 walks into @Image2 carrying @Image3."
 */
function buildMultiReferencePrompt(
  rawPrompt: string,
  visualRefs: GenerationElementRef[],
  textRefs: GenerationElementRef[],
): string {
  // Header: define each @ImageN
  const headerParts = visualRefs.map((ref) => {
    const desc = ref.description?.trim();
    return `@Image${ref.imageIndex} is ${ref.name}${desc ? ` — ${desc}` : ''}.`;
  });
  const header = headerParts.join(' ');

  // Replace @handles in prompt body
  let body = rawPrompt;

  // Visual refs → @Image1, @Image2...
  for (const ref of visualRefs) {
    const re = new RegExp(escapeRegex(ref.handle), 'gi');
    body = body.replace(re, `@Image${ref.imageIndex}`);
  }

  // Text refs → description or name
  for (const ref of textRefs) {
    const re = new RegExp(escapeRegex(ref.handle), 'gi');
    body = body.replace(re, ref.description?.trim() || ref.name);
  }

  return header ? `${header} ${body}` : body;
}

/**
 * Build prompt for single-reference or text-only mode.
 * All @handles → descriptions or names.
 */
function buildSingleReferencePrompt(
  rawPrompt: string,
  allRefs: GenerationElementRef[],
): string {
  let result = rawPrompt;
  for (const ref of allRefs) {
    const re = new RegExp(escapeRegex(ref.handle), 'gi');
    result = result.replace(re, ref.description?.trim() || ref.name);
  }
  return result;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Main resolver ────────────────────────────────────────────────────────────

/**
 * Resolve which elements are visual references and which are text context.
 * Enforces: deduplication → priority sort → maxReferenceImages → stable indexing.
 */
export function resolveReferences(
  modelId: string,
  mentionedElements: VideoElement[],
  userUploadedImageUrl?: string,
): ResolvedReferences {
  const caps = getModelCapabilities(modelId);

  // 1. Deduplicate
  const unique = deduplicateElements(mentionedElements);

  // 2. Sort by priority: character > location > prop > general
  const sorted = sortByPriority(unique);

  // 3. Account for user-uploaded image taking one slot
  let remainingSlots = caps.maxReferenceImages - (userUploadedImageUrl ? 1 : 0);

  const visualRefs: GenerationElementRef[] = [];
  const textRefs: GenerationElementRef[] = [];

  for (const el of sorted) {
    if (remainingSlots > 0 && canBeVisualRef(el, caps)) {
      const imageIndex = visualRefs.length + 1; // stable: 1,2,3...
      visualRefs.push({
        id: el.id,
        name: el.name,
        handle: el.handle,
        type: el.category,
        imageUrl: el.imageUrl,
        description: el.description,
        role: 'visual',
        imageIndex,
      });
      remainingSlots -= 1;
    } else {
      textRefs.push({
        id: el.id,
        name: el.name,
        handle: el.handle,
        type: el.category,
        imageUrl: el.imageUrl,
        description: el.description,
        role: 'text',
      });
    }
  }

  // 4. Build image URL list (stable: index 0 = @Image1)
  const elementImageUrls = visualRefs
    .map((r) => r.imageUrl)
    .filter((u): u is string => Boolean(u));

  const referenceImageUrls = userUploadedImageUrl
    ? [userUploadedImageUrl, ...elementImageUrls]
    : elementImageUrls;

  // 5. Determine mode
  let mode: ResolvedReferenceMode;
  if (referenceImageUrls.length > 1 && caps.supportsMultiReference) {
    mode = 'multi_reference';
  } else if (referenceImageUrls.length >= 1) {
    mode = 'single_reference';
  } else {
    mode = 'text_only';
  }

  // 6. Build enriched prompt
  const allRefs = [...visualRefs, ...textRefs];
  const enrichedPrompt =
    mode === 'multi_reference'
      ? buildMultiReferencePrompt('__BODY__', visualRefs, textRefs).replace(
          '__BODY__',
          '',
        ) // will be built below with real prompt
      : buildSingleReferencePrompt('', allRefs); // placeholder, real call in buildGenerationContext

  // Return without enrichedPrompt — filled by buildGenerationContext
  return {
    visualRefs,
    textRefs,
    enrichedPrompt: '',
    referenceImageUrls,
    mode,
  };
}

// ─── Full pipeline ─────────────────────────────────────────────────────────────

export function buildGenerationContext(
  modelId: string,
  rawPrompt: string,
  mentionedElements: VideoElement[],
  userUploadedImageUrl?: string,
): ResolvedReferences {
  const resolved = resolveReferences(modelId, mentionedElements, userUploadedImageUrl);
  const allRefs = [...resolved.visualRefs, ...resolved.textRefs];

  const enrichedPrompt =
    resolved.mode === 'multi_reference'
      ? buildMultiReferencePrompt(rawPrompt, resolved.visualRefs, resolved.textRefs)
      : buildSingleReferencePrompt(rawPrompt, allRefs);

  return { ...resolved, enrichedPrompt };
}

// ─── Export helpers ───────────────────────────────────────────────────────────

export { getModelCapabilities };
