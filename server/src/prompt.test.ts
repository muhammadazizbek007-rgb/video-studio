import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CAMERA_MOTION_PROMPTS,
  STYLE_PRESET_PROMPTS,
  buildNegativePrompt,
  buildVeoPrompt,
} from './prompt.js';

const DEFAULT_AUDIO_LINE = 'Audio: natural ambient sound that matches the scene, no spoken narration';
const STATIC_NEGATIVE_FRAGMENT = 'camera shake, camera movement, panning';

test('every camera preset contributes its mapped phrase', () => {
  for (const [preset, phrase] of Object.entries(CAMERA_MOTION_PROMPTS)) {
    const result = buildVeoPrompt({ prompt: 'A cat on a windowsill', cameraMotion: preset });
    assert.equal(result, `A cat on a windowsill. ${phrase}`, `preset ${preset}`);
  }
});

test('an unknown camera preset falls back to a generic camera-movement phrase', () => {
  const result = buildVeoPrompt({ prompt: 'A cat', cameraMotion: 'Crane Up' });
  assert.equal(result, 'A cat. The camera performs a crane up movement');
});

test('a blank camera preset adds nothing', () => {
  assert.equal(buildVeoPrompt({ prompt: 'A cat', cameraMotion: '   ' }), 'A cat');
});

test('every style preset contributes its mapped phrase', () => {
  for (const [preset, phrase] of Object.entries(STYLE_PRESET_PROMPTS)) {
    const result = buildVeoPrompt({ prompt: 'A cat', stylePreset: preset });
    assert.equal(result, `A cat. ${phrase}`, `preset ${preset}`);
  }
});

test('an unknown style preset falls back to "<label> style"', () => {
  assert.equal(buildVeoPrompt({ prompt: 'A cat', stylePreset: 'Noir' }), 'A cat. Noir style');
});

test('style comes before camera', () => {
  const result = buildVeoPrompt({ prompt: 'A cat', stylePreset: 'UGC', cameraMotion: 'Pan' });
  assert.equal(
    result,
    `A cat. ${STYLE_PRESET_PROMPTS['UGC']}. ${CAMERA_MOTION_PROMPTS['Pan']}`,
  );
});

test('Static adds the static negative prompt', () => {
  const negative = buildNegativePrompt('Static');
  assert.ok(negative.includes(STATIC_NEGATIVE_FRAGMENT));
  assert.ok(negative.startsWith('subtitles, captions, burned-in text'));
});

test('non-static motions get only the base negative prompt', () => {
  const base = buildNegativePrompt();
  assert.ok(!base.includes(STATIC_NEGATIVE_FRAGMENT));
  for (const preset of Object.keys(CAMERA_MOTION_PROMPTS)) {
    if (preset === 'Static') continue;
    assert.equal(buildNegativePrompt(preset), base, `preset ${preset}`);
  }
});

test('a reference image prepends the first-frame opener', () => {
  const result = buildVeoPrompt({ prompt: 'A cat stretches', hasReferenceImage: true });
  assert.equal(result, 'Starting from the provided first frame: A cat stretches');
});

test('the first-frame opener is skipped when there is no scene text', () => {
  assert.equal(buildVeoPrompt({ prompt: '', hasReferenceImage: true }), '');
});

test('enrichedPrompt wins over prompt as the scene', () => {
  const result = buildVeoPrompt({ prompt: 'A cat', enrichedPrompt: 'A ginger cat in golden light' });
  assert.equal(result, 'A ginger cat in golden light');
});

test('the default audio line is added when the model has audio and the scene is silent about sound', () => {
  const result = buildVeoPrompt({ prompt: 'A cat on a windowsill', supportsAudio: true });
  assert.equal(result, `A cat on a windowsill. ${DEFAULT_AUDIO_LINE}`);
});

test('no audio line when the model has no audio track', () => {
  assert.equal(buildVeoPrompt({ prompt: 'A cat, music plays' }), 'A cat, music plays');
  assert.equal(buildVeoPrompt({ prompt: 'A cat' }), 'A cat');
});

test('the default audio line is skipped when the scene mentions sound in English', () => {
  const scenes = [
    'A cat on a windowsill, soft music plays',
    'Two friends speak quietly',
    'A voiceover explains the product',
    'Complete silence in the room',
    'She leans in to whisper',
    'The dialogue is tense',
  ];
  for (const prompt of scenes) {
    const result = buildVeoPrompt({ prompt, supportsAudio: true });
    assert.equal(result, prompt, `scene: ${prompt}`);
  }
});

// Pins a known gap ported verbatim from the worker: the English half of the
// keyword regex is \b-delimited, so inflected forms and the "narrat" stem never
// match and the scene wrongly gets "no spoken narration" appended.
test('KNOWN GAP: inflected English audio words are not detected', () => {
  for (const prompt of ['She whispers to the dog', 'A narrator introduces the app', 'He speaks softly']) {
    const result = buildVeoPrompt({ prompt, supportsAudio: true });
    assert.equal(result, `${prompt}. ${DEFAULT_AUDIO_LINE}`, `scene: ${prompt}`);
  }
});

test('the default audio line is skipped when the scene mentions sound in Russian', () => {
  const scenes = [
    'слышны разговоры',
    'играет музыка',
    'полная тишина',
    'девушка говорит в камеру',
    'звук дождя за окном',
    'на фоне поёт птица',
  ];
  for (const prompt of scenes) {
    const result = buildVeoPrompt({ prompt, supportsAudio: true });
    assert.equal(result, prompt, `scene: ${prompt}`);
  }
});

test('the audio check reads the enriched scene, not the raw prompt', () => {
  const result = buildVeoPrompt({
    prompt: 'A cat',
    enrichedPrompt: 'A cat on a windowsill while music plays',
    supportsAudio: true,
  });
  assert.equal(result, 'A cat on a windowsill while music plays');
});

test('an over-long prompt is truncated to the cap and ends with an ellipsis', () => {
  const result = buildVeoPrompt({ prompt: 'a'.repeat(2500) });
  assert.equal(result.length, 1800);
  assert.ok(result.endsWith('…'));
  assert.equal(result.slice(0, 1799), 'a'.repeat(1799));
});

test('a prompt at exactly the cap is left untouched', () => {
  const exact = 'a'.repeat(1800);
  assert.equal(buildVeoPrompt({ prompt: exact }), exact);
});

test('an empty prompt never produces leading separators', () => {
  assert.equal(buildVeoPrompt({ prompt: '' }), '');
  assert.equal(
    buildVeoPrompt({ prompt: '   ', stylePreset: 'Cinematic', cameraMotion: 'Pan', supportsAudio: true }),
    `${STYLE_PRESET_PROMPTS['Cinematic']}. ${CAMERA_MOTION_PROMPTS['Pan']}. ${DEFAULT_AUDIO_LINE}`,
  );
});
