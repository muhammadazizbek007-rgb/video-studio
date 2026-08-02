'use strict';

/**
 * Veo prompt construction.
 *
 * Google's Veo guidance is that a prompt reads best as an ordered description:
 *   subject + action + scene → visual style → camera → lighting/audio
 * The UI pickers (style preset, camera motion) are labels, not prompt text, so
 * each one is expanded into film vocabulary before being appended in that order.
 *
 * Keep in sync with workers/src/prompt.ts
 */

/** Hard ceiling so an over-long enriched prompt can never be rejected by the API. */
const MAX_PROMPT_CHARS = 1800;

/**
 * Cinematographic phrasing for each camera preset.
 *
 * A bare "Dolly in camera movement" is ambiguous and often makes the *subject*
 * move instead of the camera, so every phrase names the camera explicitly.
 */
const CAMERA_MOTION_PROMPTS = Object.freeze({
  'Static': 'The camera is completely locked off on a tripod — no panning, tilting, zooming or drifting. Only the subject moves within the frame',
  'Zoom in': 'The camera slowly zooms in, gradually tightening the framing on the subject while staying in place',
  'Dolly in': 'The camera dollies forward on a smooth track, physically closing the distance to the subject',
  'Handheld': 'Handheld camera with subtle natural shake and small organic reframing, documentary feel',
  'Orbit': 'The camera orbits steadily around the subject in a smooth circular arc, keeping the subject centred in frame',
  'Pan': 'The camera pans horizontally across the scene at a slow, even speed',
});

/**
 * Visual treatment for each style preset.
 *
 * The raw labels ("AI Social Platform Ad", "School Viral Reel") carry no meaning
 * for the model — these describe the actual look each preset is meant to produce.
 */
const STYLE_PRESET_PROMPTS = Object.freeze({
  'Cinematic': 'Cinematic film look: shallow depth of field, wide anamorphic framing, rich contrast and filmic colour grading',
  'UGC': 'Authentic user-generated look: filmed on a modern smartphone, slightly imperfect handheld framing, ordinary available light, no professional polish',
  'App Promo': 'Clean app promotion look: bright even lighting, uncluttered modern setting, crisp sharp focus and confident product-centred framing',
  'AI Social Platform Ad': 'High-energy social media advertisement: bold saturated colours, punchy contrast, dynamic scroll-stopping framing',
  'School Viral Reel': 'Trendy short-form reel for a teenage audience: vivid colours, playful energetic framing, casual everyday setting',
  'Product Demo': 'Product demonstration: the product stays sharply in focus and clearly visible at all times, clean neutral background, even studio lighting',
  'Character Story': 'Character-driven narrative: closer framing on the character’s face and expression, warm cinematic lighting, emotional tone',
});

/**
 * Applied to every generation. Veo readily burns in subtitles when the scene has
 * speech, and watermarks / artifacts are never wanted.
 */
const BASE_NEGATIVE_PROMPT = 'subtitles, captions, burned-in text, watermark, logo overlay, distorted faces, extra limbs, blurry, low resolution';

/** Extra guardrail for a locked-off shot — the text instruction alone is not reliable. */
const STATIC_NEGATIVE_PROMPT = 'camera shake, camera movement, panning, tilting, zooming, dolly, handheld motion, unstable footage';

/**
 * Default audio direction for models that generate sound.
 *
 * Without any direction Veo 3 invents muffled background speech; this asks for
 * scene-appropriate ambience instead. Skipped when the user already described
 * the audio themselves, so an explicit request always wins.
 */
const DEFAULT_AUDIO_PROMPT = 'Audio: natural ambient sound that matches the scene, no spoken narration';

// The UI is Russian, so an English-only test would miss "слышны разговоры" and
// then contradict the user with a "no spoken narration" instruction.
const AUDIO_KEYWORDS = new RegExp(
  '\\b(audio|sound|music|song|voice|voice-?over|narrat|dialogue|dialog|speak|say|says|saying|whisper|shout|sings?|soundtrack|silent|silence)\\b'
  + '|(звук|аудио|музык|песн|голос|озвуч|диалог|говор|разговор|шепч|шёпот|шепот|крич|поёт|поет|поют|саундтрек|тишин|молч|реплик)',
  'i',
);

function describeCameraMotion(cameraMotion) {
  const motion = String(cameraMotion || '').trim();
  if (!motion) return null;
  // Unknown presets still get an explicit camera-is-moving phrasing
  return CAMERA_MOTION_PROMPTS[motion] || `The camera performs a ${motion.toLowerCase()} movement`;
}

function describeStylePreset(stylePreset) {
  const style = String(stylePreset || '').trim();
  if (!style) return null;
  return STYLE_PRESET_PROMPTS[style] || `${style} style`;
}

/**
 * Assembles the final Veo prompt in scene → style → camera → audio order.
 *
 * @param {object} input
 * @param {string} input.prompt
 * @param {string} [input.enrichedPrompt]
 * @param {string} [input.stylePreset]
 * @param {string} [input.cameraMotion]
 * @param {boolean} [input.hasReferenceImage]  a starting frame is supplied
 * @param {boolean} [input.supportsAudio]      the model produces an audio track
 */
function buildVeoPrompt(input) {
  const scene = String(input.enrichedPrompt || input.prompt || '').trim();

  // With a starting frame Veo should continue the image, not re-invent the scene
  const opening = input.hasReferenceImage && scene
    ? `Starting from the provided first frame: ${scene}`
    : scene;

  const parts = [opening];

  const style = describeStylePreset(input.stylePreset);
  if (style) parts.push(style);

  const camera = describeCameraMotion(input.cameraMotion);
  if (camera) parts.push(camera);

  if (input.supportsAudio && !AUDIO_KEYWORDS.test(scene)) {
    parts.push(DEFAULT_AUDIO_PROMPT);
  }

  const result = parts.filter(Boolean).join('. ');
  return result.length > MAX_PROMPT_CHARS ? `${result.slice(0, MAX_PROMPT_CHARS - 1).trimEnd()}…` : result;
}

/** Negative prompt for a generation; always non-empty. */
function buildNegativePrompt(cameraMotion) {
  return cameraMotion === 'Static'
    ? `${BASE_NEGATIVE_PROMPT}, ${STATIC_NEGATIVE_PROMPT}`
    : BASE_NEGATIVE_PROMPT;
}

module.exports = {
  CAMERA_MOTION_PROMPTS,
  STYLE_PRESET_PROMPTS,
  buildNegativePrompt,
  buildVeoPrompt,
  describeCameraMotion,
  describeStylePreset,
};
