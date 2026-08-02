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
 * Applied to every generation. Veo readily burns in subtitles when the scene has speech,
 * and watermarks or artifacts are never wanted.
 */
const BASE_NEGATIVE_PROMPT =
  'subtitles, captions, burned-in text, watermark, logo overlay, distorted faces, extra limbs, blurry, low resolution';

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
    '|(звук|аудио|музык|песн|голос|озвуч|диалог|говор|разговор|шепч|шёпот|шепот|крич|поёт|поет|поют|саундтрек|тишин|молч|реплик)',
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

/** Assembles the final Veo prompt in scene -> style -> camera -> audio order. */
export function buildVeoPrompt(input: PromptInput): string {
  const scene = (input.enrichedPrompt ?? input.prompt ?? '').trim();

  // With a starting frame Veo should continue the image, not re-invent the scene
  const opening =
    input.hasReferenceImage && scene ? `Starting from the provided first frame: ${scene}` : scene;

  const parts = [opening];

  const style = describeStylePreset(input.stylePreset);
  if (style) parts.push(style);

  const camera = describeCameraMotion(input.cameraMotion);
  if (camera) parts.push(camera);

  if (input.supportsAudio && !AUDIO_KEYWORDS.test(scene)) {
    parts.push(DEFAULT_AUDIO_PROMPT);
  }

  const result = parts.filter(Boolean).join('. ');
  return result.length > MAX_PROMPT_CHARS
    ? `${result.slice(0, MAX_PROMPT_CHARS - 1).trimEnd()}…`
    : result;
}

/** Negative prompt for a generation; always non-empty. */
export function buildNegativePrompt(cameraMotion?: string): string {
  return cameraMotion === 'Static'
    ? `${BASE_NEGATIVE_PROMPT}, ${STATIC_NEGATIVE_PROMPT}`
    : BASE_NEGATIVE_PROMPT;
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
  'Preserve every @ImageN token exactly as written; they name the supplied reference images.',
  `Answer with the rewritten prompt only, under ${MAX_ENRICHED_CHARS} characters.`,
].join(' ');

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Elements are referenced in the prompt by handle ("@Luna"). Handles mean nothing to Veo,
 * so each one is replaced: an element carrying a reference image becomes the @ImageN slot
 * it occupies, and every other element becomes its description.
 *
 * Replacements are supplied as functions because a description containing "$&" would
 * otherwise be treated as a replacement pattern.
 */
function foldElements(prompt: string, elements: ElementRef[] | undefined): string {
  if (!elements || elements.length === 0) return prompt;

  const visual: ElementRef[] = [];
  const textual: ElementRef[] = [];
  for (const element of elements) {
    if (element.role === 'visual' && element.imageIndex !== undefined) visual.push(element);
    else textual.push(element);
  }

  let body = prompt;
  for (const ref of visual) {
    const slot = `@Image${ref.imageIndex}`;
    body = body.replace(new RegExp(escapeRegex(ref.handle), 'gi'), () => slot);
  }
  for (const ref of textual) {
    const replacement = ref.description?.trim() || ref.name;
    body = body.replace(new RegExp(escapeRegex(ref.handle), 'gi'), () => replacement);
  }

  const header = visual
    .map((ref) => {
      const description = ref.description?.trim();
      return `@Image${ref.imageIndex} is ${ref.name}${description ? ` — ${description}` : ''}.`;
    })
    .join(' ');

  return header ? `${header} ${body}` : body;
}

function buildEnrichmentRequest(input: EnrichPromptInput, folded: string): string {
  return [
    `Idea: ${folded}`,
    `Generation mode: ${input.mode}`,
    `Visual style preset: ${input.stylePreset}`,
    `Camera motion preset: ${input.cameraMotion}`,
  ].join('\n');
}

let cachedClient: { apiKey: string; anthropic: Anthropic } | null = null;

function getAnthropic(apiKey: string): Anthropic {
  if (!cachedClient || cachedClient.apiKey !== apiKey) {
    cachedClient = { apiKey, anthropic: new Anthropic({ apiKey }) };
  }
  return cachedClient.anthropic;
}

/**
 * Enrichment is a convenience, never a gate: any failure returns the locally folded prompt
 * so a generation is still started with something usable.
 */
export async function enrichPrompt(input: EnrichPromptInput): Promise<string> {
  const { anthropicApiKey } = getEnv();
  if (!anthropicApiKey) return input.prompt;

  const folded = foldElements(input.prompt, input.elements);

  try {
    const message = await getAnthropic(anthropicApiKey).messages.create({
      model: ENRICHMENT_MODEL,
      max_tokens: ENRICHMENT_MAX_TOKENS,
      system: ENRICHMENT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildEnrichmentRequest(input, folded) }],
    });

    // Widened because older SDK releases do not list 'refusal' in the stop-reason union.
    const stopReason: string | null = message.stop_reason;
    if (stopReason === 'refusal') return folded;

    const parts: string[] = [];
    for (const block of message.content) {
      if (block.type === 'text') parts.push(block.text);
    }

    const enriched = parts.join('\n').trim();
    return enriched === '' ? folded : enriched.slice(0, MAX_ENRICHED_CHARS);
  } catch (err) {
    logger.warn({ err }, 'Prompt enrichment failed; using the unenriched prompt.');
    return folded;
  }
}
