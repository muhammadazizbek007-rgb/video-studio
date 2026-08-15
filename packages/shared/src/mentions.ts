import type { VeoModelSpec } from './models.js';
import type { ElementDto, ElementRef } from './schemas.js';
import type { VideoElementCategory, VideoGenerationMode } from './types.js';

/**
 * `@mention` resolution — the single place that decides what a mentioned element becomes.
 *
 * A saved element is a name, a category and (usually) a photo. Writing `@Мухаммад` in a
 * prompt has to end up as two different things at once: an asset reference image, so Veo
 * knows what the person looks like, and a word in the prompt, so Veo knows what that person
 * does. Handles mean nothing to the model, so nothing here ever reaches Vertex verbatim.
 *
 * This lives in the contract package because three callers must agree on it — the studio
 * form, the storyboard segment generator and the MCP tools. Resolving on the client only
 * would mean a prompt sent from anywhere else silently ships raw `@handle` text to Veo.
 */

/** Veo 3.1 accepts at most three asset reference images per request. */
export const MAX_ASSET_REFERENCES = 3;

/**
 * Which mention wins a scarce image slot. Characters first: a wrong face is the failure a
 * viewer notices, while a location or a prop survives being described in words.
 */
const CATEGORY_PRIORITY: Record<VideoElementCategory, number> = {
  character: 1,
  location: 2,
  prop: 3,
  general: 4,
};

/** How each category is introduced to the model when it travels as a reference image. */
const CATEGORY_NOUN: Record<VideoElementCategory, string> = {
  character: 'the character',
  location: 'the location',
  prop: 'the prop',
  general: '',
};

/** Letters, digits and underscore in any script — Cyrillic and Latin alike. */
const HANDLE_CHARACTER = /[\p{L}\p{N}_]/u;
const MENTION_PATTERN = /@[\p{L}\p{N}_]+/gu;

export function extractMentionTokens(prompt: string): string[] {
  return [...new Set(prompt.match(MENTION_PATTERN) ?? [])];
}

export function assetReferenceCapacity(model: VeoModelSpec): number {
  return model.supportsReferenceImages
    ? Math.min(model.maxAssetReferences, MAX_ASSET_REFERENCES)
    : 0;
}

/**
 * Who keeps the image slots when the user both uploaded a first frame and mentioned
 * elements.
 *
 * `elements-win` is what the studio wants: mentioning a character is a deliberate act, and
 * a hand-picked photo of that character beats an unrelated opening frame. A storyboard
 * segment is the opposite — its first frame is the previous segment's closing frame, and
 * dropping it would visibly break the cut, so it passes `frame-wins`.
 */
export type FramePolicy = 'elements-win' | 'frame-wins';

export interface ResolveMentionsInput {
  prompt: string;
  elements: readonly ElementDto[];
  model: VeoModelSpec;
  firstFrameImageUrl?: string | null;
  framePolicy?: FramePolicy;
}

export interface ResolvedMentions {
  /** Elements travelling as asset reference images, in slot order. */
  assetRefs: ElementRef[];
  /** Elements that had to collapse into prompt text — no photo, or no slot left. */
  textRefs: ElementRef[];
  /** Both of the above, which is what a generation record stores. */
  refs: ElementRef[];
  assetImageUrls: string[];
  /** The opening frame that survived the policy; null when it lost to the elements. */
  firstFrameImageUrl: string | null;
  /** True when an uploaded frame was set aside — the UI has to say so rather than lose it. */
  firstFrameDropped: boolean;
  /** `@somebody` that matches no element; shown to the user, left alone in the prompt. */
  unknownHandles: string[];
  /** The prompt with every handle resolved — this is what Veo is asked to render. */
  promptForModel: string;
  mode: VideoGenerationMode;
}

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim() === '';
}

/**
 * Finds mentioned elements in prompt order.
 *
 * Matching is case-insensitive because nobody retypes capitals to make a mention work, and
 * an element is returned once no matter how often it is mentioned.
 */
export function findMentionedElements(
  prompt: string,
  elements: readonly ElementDto[],
): ElementDto[] {
  const tokens = extractMentionTokens(prompt);
  if (tokens.length === 0) return [];

  const byHandle = new Map<string, ElementDto>();
  for (const element of elements) {
    const key = element.handle.toLowerCase();
    // First writer wins, so a second element with a colliding handle cannot hijack a
    // mention that already resolves to someone else.
    if (!byHandle.has(key)) byHandle.set(key, element);
  }

  const found: ElementDto[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const element = byHandle.get(token.toLowerCase());
    if (!element || seen.has(element.id)) continue;
    seen.add(element.id);
    found.push(element);
  }
  return found;
}

export function findUnknownHandles(prompt: string, elements: readonly ElementDto[]): string[] {
  const known = new Set(elements.map((element) => element.handle.toLowerCase()));
  return extractMentionTokens(prompt).filter((token) => !known.has(token.toLowerCase()));
}

/**
 * Two elements pointing at the same picture would burn two slots on one image, so the later
 * one keeps its words and loses its photo.
 */
function dedupe(elements: readonly ElementDto[]): ElementDto[] {
  const seenImages = new Set<string>();
  const unique: ElementDto[] = [];
  for (const element of elements) {
    if (element.imageUrl && !isBlank(element.imageUrl)) {
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
    imageUrl: role === 'visual' ? element.imageUrl : undefined,
    description: element.description,
    role,
    imageIndex,
  };
}

/**
 * Replaces every standalone occurrence of a handle.
 *
 * Scanning by hand rather than by regex because both ends need a guard a regex cannot give
 * portably: `\b` is ASCII-only, so it fires inside Cyrillic words, and without a right-hand
 * guard `@Ali` would eat the start of `@Alisher`. The replacement is produced by a callback
 * so a description containing `$&` is inserted literally.
 */
function replaceHandle(
  text: string,
  handle: string,
  replacement: (occurrence: number) => string,
): string {
  const haystack = text.toLowerCase();
  const needle = handle.toLowerCase();
  let result = '';
  let cursor = 0;
  let occurrence = 0;

  for (;;) {
    const at = haystack.indexOf(needle, cursor);
    if (at === -1) break;

    const before = text[at - 1];
    const after = text[at + needle.length];
    const standalone =
      (before === undefined || !HANDLE_CHARACTER.test(before)) &&
      (after === undefined || !HANDLE_CHARACTER.test(after));

    if (!standalone) {
      result += text.slice(cursor, at + needle.length);
      cursor = at + needle.length;
      continue;
    }

    result += text.slice(cursor, at) + replacement(occurrence);
    occurrence += 1;
    cursor = at + needle.length;
  }

  return result + text.slice(cursor);
}

/** `Reference image 2 shows the location Кафе Нур — a small neon-lit café.` */
function referenceHeader(ref: ElementRef): string {
  const noun = CATEGORY_NOUN[ref.category];
  const subject = noun === '' ? ref.name : `${noun} ${ref.name}`;
  const description = ref.description?.trim();
  return `Reference image ${ref.imageIndex} shows ${subject}${description ? ` — ${description}` : ''}.`;
}

/**
 * Builds the prompt Veo actually receives.
 *
 * An element with an image becomes its plain name in the body, tied to its slot by a header
 * sentence — the model is told "reference image 1 shows the character Мухаммад", then asked
 * to film Мухаммад. An element without a slot has to carry its own appearance, so its first
 * mention drags the description along and later ones stay short.
 */
function buildPrompt(prompt: string, assetRefs: ElementRef[], textRefs: ElementRef[]): string {
  // Longest handle first: @Alisher must be consumed before @Ali is looked for, otherwise the
  // shorter one leaves a mangled tail behind.
  const ordered = [...assetRefs, ...textRefs].sort((a, b) => b.handle.length - a.handle.length);

  let body = prompt;
  for (const ref of ordered) {
    const description = ref.description?.trim();
    body = replaceHandle(body, ref.handle, (occurrence) => {
      if (ref.role === 'visual') return ref.name;
      if (occurrence === 0 && description) return `${ref.name} (${description})`;
      return ref.name;
    });
  }

  const header = assetRefs.map(referenceHeader).join(' ');
  if (!header) return body.trim();
  const trimmed = body.trim();
  return trimmed === '' ? header : `${header} ${trimmed}`;
}

/**
 * Turns a raw prompt plus the account's element library into everything a generation needs:
 * which elements travel as images, which collapse into words, what the model is told about
 * each reference image, and which generation mode that adds up to.
 */
export function resolveMentions(input: ResolveMentionsInput): ResolvedMentions {
  const prompt = input.prompt.trim();
  const framePolicy: FramePolicy = input.framePolicy ?? 'elements-win';
  const uploadedFrame = isBlank(input.firstFrameImageUrl)
    ? null
    : (input.firstFrameImageUrl as string).trim();

  const mentioned = dedupe(findMentionedElements(prompt, input.elements));
  const prioritised = [...mentioned].sort(
    (a, b) => CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category],
  );

  const modelCapacity = assetReferenceCapacity(input.model);
  const wantsSlot = prioritised.filter((element) => !isBlank(element.imageUrl));

  /**
   * Veo takes an opening frame or asset references, never both — it answers a request
   * carrying the two with "Image and reference images cannot be both set" and the clip
   * fails. So exactly one of them has to give way, and the policy says which.
   *
   * The frame gives way in the studio: someone who wrote `@Мухаммад` is asking for that
   * face, and a hand-picked photo of him beats an unrelated opening still. In a storyboard
   * it is the other way round — the opening frame is the previous shot's last frame, and
   * dropping it breaks the cut on screen, which is the one thing a board exists to avoid.
   */
  const frameLosesToElements =
    framePolicy === 'elements-win' &&
    uploadedFrame !== null &&
    wantsSlot.length > 0 &&
    modelCapacity > 0;

  const firstFrameImageUrl = frameLosesToElements ? null : uploadedFrame;

  // The other half of the same rule, and the half that was missing: keeping the frame has
  // to take the slots away, or both inputs travel and Veo refuses the request outright.
  const capacity = firstFrameImageUrl === null ? modelCapacity : 0;

  const assetRefs: ElementRef[] = [];
  const textRefs: ElementRef[] = [];
  for (const element of prioritised) {
    if (assetRefs.length < capacity && !isBlank(element.imageUrl)) {
      assetRefs.push(toRef(element, 'visual', assetRefs.length + 1));
    } else {
      textRefs.push(toRef(element, 'text'));
    }
  }

  const assetImageUrls = assetRefs
    .map((ref) => ref.imageUrl)
    .filter((url): url is string => Boolean(url));

  const mode: VideoGenerationMode =
    assetImageUrls.length > 0
      ? 'reference_to_video'
      : firstFrameImageUrl
        ? 'image_to_video'
        : 'text_to_video';

  return {
    assetRefs,
    textRefs,
    refs: [...assetRefs, ...textRefs],
    assetImageUrls,
    firstFrameImageUrl,
    firstFrameDropped: frameLosesToElements,
    unknownHandles: findUnknownHandles(prompt, input.elements),
    promptForModel: buildPrompt(prompt, assetRefs, textRefs),
    mode,
  };
}
