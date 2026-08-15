import Anthropic from '@anthropic-ai/sdk';
import type { ElementRef, EnrichPromptInput } from '@video-studio/shared';
import { getEnv } from './env.js';
import { logger } from './logger.js';

/**
 * Veo prompt construction.
 *
 * Google's Veo guidance is that a prompt reads best as an ordered description:
 *   subject + action + scene -> visual style -> camera -> lighting/audio
 * The UI pickers (style preset, camera motion) submit labels, not prompt text, so each
 * label is expanded into film vocabulary before being appended.
 *
 * Everything except `enrichPrompt` is pure: it takes plain data and returns strings, so
 * prompt behaviour can be tested without Vertex, Anthropic or config.
 */

/** Hard ceiling so an over-long enriched prompt can never be rejected by the API. */
const MAX_PROMPT_CHARS = 1800;

/** What joins the assembled sections, and what the length budget has to account for. */
const SEPARATOR = '. ';

/**
 * A bare "Dolly in camera movement" is ambiguous and often makes the *subject* move
 * instead of the camera, so every phrase names the camera explicitly.
 */
export const CAMERA_MOTION_PROMPTS: Readonly<Record<string, string>> = Object.freeze({
  Static:
    'The camera is completely locked off on a tripod — no panning, tilting, zooming or drifting. Only the subject moves within the frame',
  'Zoom in':
    'The camera slowly zooms in, gradually tightening the framing on the subject while staying in place',
  'Dolly in':
    'The camera dollies forward on a smooth track, physically closing the distance to the subject',
  Handheld:
    'Handheld camera with subtle natural shake and small organic reframing, documentary feel',
  Orbit:
    'The camera orbits steadily around the subject in a smooth circular arc, keeping the subject centred in frame',
  Pan: 'The camera pans horizontally across the scene at a slow, even speed',
});

/**
 * The raw labels carry no meaning for the model — these describe the look each preset is
 * meant to produce.
 */
export const STYLE_PRESET_PROMPTS: Readonly<Record<string, string>> = Object.freeze({
  Cinematic:
    'Cinematic film look: shallow depth of field, wide anamorphic framing, rich contrast and filmic colour grading',
  UGC: 'Authentic user-generated look: filmed on a modern smartphone, slightly imperfect handheld framing, ordinary available light, no professional polish',
  'App Promo':
    'Clean app promotion look: bright even lighting, uncluttered modern setting, crisp sharp focus and confident product-centred framing',
  'Product Demo':
    'Product demonstration: the product stays sharply in focus and clearly visible at all times, clean neutral background, even studio lighting',
  'Character Story':
    'Character-driven narrative: closer framing on the character’s face and expression, warm cinematic lighting, emotional tone',
  'Social Ad':
    'High-energy social media advertisement: bold saturated colours, punchy contrast, dynamic scroll-stopping framing',
});

/**
 * The same presets seen through a still-image lens. Reusing the Veo wording would ask
 * Imagen for things a photograph cannot have — "filmed", "single continuous shot" — and a
 * model asked for a video look returns a video frame, complete with motion blur.
 */
export const IMAGE_STYLE_PRESET_PROMPTS: Readonly<Record<string, string>> = Object.freeze({
  Cinematic:
    'Cinematic still frame: shallow depth of field, wide anamorphic framing, rich contrast and filmic colour grading',
  UGC: 'Authentic user-generated photo: taken on a modern smartphone, slightly imperfect handheld framing, ordinary available light, no professional retouching',
  'App Promo':
    'Clean app promotion image: bright even lighting, uncluttered modern setting, crisp sharp focus and confident product-centred composition',
  'Product Demo':
    'Product photograph: the product sharply in focus and fully visible, clean neutral background, even studio lighting, nothing competing with it for attention',
  'Character Story':
    'Character portrait: close framing on the face and expression, warm cinematic lighting, emotional tone',
  'Social Ad':
    'High-energy social media advertisement image: bold saturated colours, punchy contrast, dynamic scroll-stopping composition',
});

/**
 * Imagen 4 dropped the negativePrompt parameter, so the guardrails that ride alongside a
 * Veo request have to travel inside the prompt itself.
 */
const IMAGE_QUALITY_SUFFIX =
  'Sharp, high detail, no watermark, no logo overlay, no captions or burned-in text';

/**
 * Physical continuity, stated as what the world does rather than what it must not do.
 *
 * Veo's characteristic failure is not ugliness, it is incoherence: the phone leaves the
 * hand without being put down, the screen turns itself around, a label rewrites itself
 * between frames. Asking for that in the negative — "the phone does not disappear" — makes
 * it likelier, because the model has no dependable notion of negation and naming a thing is
 * mostly a way of putting it in frame. So the prohibitions live in the negative prompt,
 * which is the parameter built to carry them, and everything here is an assertion about how
 * objects behave.
 *
 * Deliberately generic: it never names a phone or any other prop, so it reads as a rule the
 * whole scene obeys instead of a hint about which object matters.
 */
export const PHYSICAL_CONSISTENCY_PROMPT =
  'Physical continuity: every object keeps one shape, size, colour and identity for the whole ' +
  'shot and stays where the action leaves it. Hands keep a settled, deliberate grip on what ' +
  'they hold. Screens, labels and printed text keep showing the same content unless the action ' +
  'itself changes it. Everything moves with real weight and gravity, in one unbroken take';

/**
 * Applied to every generation. Veo readily burns in subtitles when the scene has speech,
 * and watermarks or artifacts are never wanted.
 */
const BASE_NEGATIVE_PROMPT =
  'subtitles, captions, burned-in text, watermark, logo overlay, distorted faces, extra limbs, blurry, low resolution';

/**
 * The other half of the continuity guardrail: the failures themselves, where a negation is
 * read as a negation. These are the artefacts that make a clip unusable rather than merely
 * imperfect, so they ride on every request alongside the base list.
 */
const CONTINUITY_NEGATIVE_PROMPT =
  'morphing, warping, shape-shifting, objects appearing or vanishing mid-shot, items ' +
  'teleporting or swapping between hands, objects slipping out of the hand, floating or ' +
  'levitating props, extra or missing fingers, deformed hands, screens flipping or changing ' +
  'content on their own, text or logos mutating, jump cut, scene change, impossible physics';

/** Extra guardrail for a locked-off shot — the text instruction alone is not reliable. */
const STATIC_NEGATIVE_PROMPT =
  'camera shake, camera movement, panning, tilting, zooming, dolly, handheld motion, unstable footage';

/**
 * Without any direction Veo 3 invents muffled background speech; this asks for
 * scene-appropriate ambience instead. Skipped when the user already described the audio
 * themselves, so an explicit request always wins.
 */
const DEFAULT_AUDIO_PROMPT =
  'Audio: natural ambient sound that matches the scene, no spoken narration';

/**
 * The UI is Russian, so an English-only test would miss "слышны разговоры" and then
 * contradict the user with a "no spoken narration" instruction.
 *
 * Cyrillic stems are matched without \b because JavaScript word boundaries are ASCII-only
 * and would not fire between a Cyrillic letter and a space.
 */
const AUDIO_KEYWORDS = new RegExp(
  '\\b(audio|sound|music|song|voice|voice-?over|narrat|dialogue|dialog|speak|say|says|saying|whisper|shout|sings?|soundtrack|silent|silence)\\b' +
    '|(звук|аудио|музык|песн|голос|озвуч|диалог|говор|разговор|шепч|шёпот|шепот|крич|поёт|поет|поют|саундтрек|тишин|молч|реплик)' +
    // The interface speaks Uzbek too, and a scene written in it was invisible here — so
    // a prompt describing someone talking still got "no spoken narration" appended.
    '|(ovoz|tovush|musiqa|qo‘shiq|qoshiq|kuylay|gapir|suhbat|shivir|baqir|jimlik|sukunat|diktor)',
  'i',
);

export interface PromptInput {
  prompt: string;
  enrichedPrompt?: string;
  stylePreset?: string;
  cameraMotion?: string;
  /** Set when a starting frame is supplied — Veo then wants motion, not scene, described */
  hasReferenceImage?: boolean;
  /** Whether the selected model produces an audio track */
  supportsAudio?: boolean;
  /**
   * A saved narrator's description, when the caller chose one.
   *
   * Veo has no voice parameter, so this is the whole mechanism: the same words describing
   * the same person, asked for again on the next clip.
   */
  voicePrompt?: string;
}

function describeCameraMotion(cameraMotion: string | undefined): string | null {
  const motion = (cameraMotion ?? '').trim();
  if (!motion) return null;
  // Unknown presets still get an explicit camera-is-moving phrasing
  return CAMERA_MOTION_PROMPTS[motion] ?? `The camera performs a ${motion.toLowerCase()} movement`;
}

function describeStylePreset(stylePreset: string | undefined): string | null {
  const style = (stylePreset ?? '').trim();
  if (!style) return null;
  return STYLE_PRESET_PROMPTS[style] ?? `${style} style`;
}

/** An instruction appended after the scene, and how readily it is given up for room. */
interface TailPart {
  text: string;
  /** Lower goes first. Rank 1 is the studio's own; the higher ranks are the user's doing. */
  rank: number;
}

/**
 * Joins the scene to its instructions, dropping instructions until the whole thing fits.
 *
 * Dropping changes which parts are present, never their order — Veo's guidance is that a
 * prompt reads as an ordered description, so a surviving camera line stays where it was
 * rather than being resorted by rank.
 */
function assemble(opening: string, tail: TailPart[]): string {
  const kept = [...tail];
  const total = () =>
    [opening, ...kept.map((part) => part.text)].filter(Boolean).join(SEPARATOR).length;

  // Giving up an instruction only ever buys room for a scene that could fit whole. A scene
  // already past the ceiling on its own is cut either way, so dropping the guardrails too
  // would pay their full price and get nothing back.
  if (opening.length <= MAX_PROMPT_CHARS) {
    for (const part of [...tail].sort((a, b) => a.rank - b.rank)) {
      if (total() <= MAX_PROMPT_CHARS) break;
      kept.splice(kept.indexOf(part), 1);
    }
  }

  const suffix = kept.map((part) => part.text).join(SEPARATOR);
  const room = Math.max(0, MAX_PROMPT_CHARS - suffix.length - (suffix ? SEPARATOR.length : 0));
  const trimmed =
    opening.length > room ? `${opening.slice(0, Math.max(0, room - 1)).trimEnd()}…` : opening;

  return [trimmed, suffix].filter(Boolean).join(SEPARATOR);
}

/**
 * Assembles the final Veo prompt in scene -> style -> camera -> audio -> continuity order.
 *
 * Something has to give when the assembly runs past the ceiling, and for a long time the
 * answer was the scene's tail: spend the cap on the instructions, cut the scene to fit. That
 * held only while a scene was scenery, where losing the last sentence costs a detail. It is
 * false the moment someone writes the line their character has to say, because that line goes
 * at the end — and a shot was generated whose entire script had been cut off before it left
 * the building, which the model then wrote for itself.
 *
 * So the order of sacrifice is by authorship. The continuity clause is ours and goes first;
 * style and camera come from pickers the user set, so they go next; the audio line stays
 * longest because it governs the speech someone bothered to write out. Only a scene that
 * overruns the ceiling on its own is cut, and by then nothing else is left to give up.
 */
export function buildVeoPrompt(input: PromptInput): string {
  const scene = (input.enrichedPrompt ?? input.prompt ?? '').trim();

  // With a starting frame Veo should continue the image, not re-invent the scene
  const opening =
    input.hasReferenceImage && scene ? `Starting from the provided first frame: ${scene}` : scene;

  const tail: TailPart[] = [];

  const style = describeStylePreset(input.stylePreset);
  if (style) tail.push({ text: style, rank: 2 });

  const camera = describeCameraMotion(input.cameraMotion);
  if (camera) tail.push({ text: camera, rank: 3 });

  const voice = input.voicePrompt?.trim();
  if (input.supportsAudio && voice) {
    // The default audio line is skipped on purpose. It ends with "no spoken narration",
    // which would tell the model to stay silent in the same breath as describing who is
    // speaking — and a prompt that contradicts itself gets whichever half the model likes.
    tail.push({ text: `Narrated by: ${voice}`, rank: 4 });
  } else if (input.supportsAudio && !AUDIO_KEYWORDS.test(scene)) {
    tail.push({ text: DEFAULT_AUDIO_PROMPT, rank: 4 });
  }

  // An empty request stays empty: there is no shot to keep coherent, and a prompt that is
  // nothing but guardrails would describe a scene the user never asked for.
  if (opening === '' && tail.length === 0) return '';

  tail.push({ text: PHYSICAL_CONSISTENCY_PROMPT, rank: 1 });

  return assemble(opening, tail);
}

export interface ImagePromptInput {
  prompt: string;
  stylePreset?: string;
}

/**
 * Assembles the Imagen/Gemini prompt in scene -> style -> quality order.
 *
 * The style preset is the whole point of the picker: the label alone means nothing to the
 * model, so it is expanded here and appended to what the user typed.
 */
export function buildImagePrompt(input: ImagePromptInput): string {
  const scene = (input.prompt ?? '').trim();
  const style = (input.stylePreset ?? '').trim();

  const parts = [scene];
  if (style) parts.push(IMAGE_STYLE_PRESET_PROMPTS[style] ?? `${style} style`);
  parts.push(IMAGE_QUALITY_SUFFIX);

  const result = parts.filter(Boolean).join('. ');
  return result.length > MAX_PROMPT_CHARS
    ? `${result.slice(0, MAX_PROMPT_CHARS - 1).trimEnd()}…`
    : result;
}

/**
 * Negative prompt for a generation; always non-empty.
 *
 * The continuity terms are unconditional. Every shot has objects in it, and a clip where one
 * of them morphs or leaves the hand on its own is unusable whatever the camera was doing.
 */
export function buildNegativePrompt(cameraMotion?: string): string {
  const parts = [BASE_NEGATIVE_PROMPT, CONTINUITY_NEGATIVE_PROMPT];
  if (cameraMotion === 'Static') parts.push(STATIC_NEGATIVE_PROMPT);
  return parts.join(', ');
}

const ENRICHMENT_MODEL = 'claude-sonnet-5';
const ENRICHMENT_MAX_TOKENS = 1024;

/** Leaves room for the style, camera and audio lines buildVeoPrompt appends afterwards. */
const MAX_ENRICHED_CHARS = 1200;

const ENRICHMENT_SYSTEM_PROMPT = [
  'You rewrite short user ideas into vivid single-shot prompts for the Google Veo video model.',
  'Describe one continuous shot: subject, action, setting, lighting and mood, in that order.',
  'Write in English even when the idea is in another language. Use plain prose, no lists,',
  'no headings, no markdown, no quotes around the result.',
  'Never invent dialogue and never describe on-screen text, captions or logos.',
  'Do not mention camera movement or visual style — those are added separately.',
  'The idea may contain @handle tokens naming the user’s saved characters, locations and',
  'props. Keep every @handle exactly as written, in the same role it had — never translate,',
  'rename, expand or drop one, and never invent a handle that was not in the idea.',
  `Answer with the rewritten prompt only, under ${MAX_ENRICHED_CHARS} characters.`,
].join(' ');

/**
 * Tells the rewriter who each handle is, without spending the handle itself.
 *
 * The enriched text goes straight back into the user's prompt field, so it has to come back
 * still saying `@Мухаммад`: that token is the link to the saved photo, and resolving it here
 * would leave the user holding a prompt whose references silently detached.
 */
function describeElements(elements: ElementRef[] | undefined): string {
  if (!elements || elements.length === 0) return '';

  const lines = elements.map((ref) => {
    const description = ref.description?.trim();
    return `${ref.handle} — ${ref.name}${description ? `, ${description}` : ''} (${ref.category})`;
  });
  return `Saved elements mentioned in the idea (keep these handles verbatim):\n${lines.join('\n')}`;
}

function buildEnrichmentRequest(input: EnrichPromptInput): string {
  return [
    `Idea: ${input.prompt}`,
    describeElements(input.elements),
    `Generation mode: ${input.mode}`,
    `Visual style preset: ${input.stylePreset}`,
    `Camera motion preset: ${input.cameraMotion}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

let cachedClient: { apiKey: string; anthropic: Anthropic } | null = null;

function getAnthropic(apiKey: string): Anthropic {
  if (!cachedClient || cachedClient.apiKey !== apiKey) {
    cachedClient = { apiKey, anthropic: new Anthropic({ apiKey }) };
  }
  return cachedClient.anthropic;
}

/**
 * A rewrite that lost a handle lost a reference image with it, which is worse than not
 * rewriting at all — so the original prompt is kept instead.
 */
function keepsEveryHandle(enriched: string, elements: ElementRef[] | undefined): boolean {
  if (!elements || elements.length === 0) return true;
  const lower = enriched.toLowerCase();
  return elements.every((ref) => lower.includes(ref.handle.toLowerCase()));
}

/**
 * Enrichment is a convenience, never a gate: any failure returns the prompt as typed, so a
 * generation is still started with something usable.
 */
export async function enrichPrompt(input: EnrichPromptInput): Promise<string> {
  const { anthropicApiKey } = getEnv();
  if (!anthropicApiKey) return input.prompt;

  try {
    const message = await getAnthropic(anthropicApiKey).messages.create({
      model: ENRICHMENT_MODEL,
      max_tokens: ENRICHMENT_MAX_TOKENS,
      system: ENRICHMENT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildEnrichmentRequest(input) }],
    });

    // Widened because older SDK releases do not list 'refusal' in the stop-reason union.
    const stopReason: string | null = message.stop_reason;
    if (stopReason === 'refusal') return input.prompt;

    const parts: string[] = [];
    for (const block of message.content) {
      if (block.type === 'text') parts.push(block.text);
    }

    const enriched = parts.join('\n').trim().slice(0, MAX_ENRICHED_CHARS);
    if (enriched === '') return input.prompt;
    if (!keepsEveryHandle(enriched, input.elements)) {
      logger.warn('Prompt enrichment dropped an element handle; keeping the original prompt.');
      return input.prompt;
    }
    return enriched;
  } catch (err) {
    logger.warn({ err }, 'Prompt enrichment failed; using the unenriched prompt.');
    return input.prompt;
  }
}
