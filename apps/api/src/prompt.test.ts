import type { ElementRef, EnrichPromptInput } from '@video-studio/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  anthropicApiKey: null as string | null,
  create: vi.fn(),
}));

vi.mock('./env.js', () => ({
  getEnv: () => ({ anthropicApiKey: state.anthropicApiKey }),
  resetEnvCache: () => undefined,
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({ messages: { create: state.create } })),
}));

import {
  buildNegativePrompt,
  buildVeoPrompt,
  CAMERA_MOTION_PROMPTS,
  enrichPrompt,
  STYLE_PRESET_PROMPTS,
} from './prompt.js';

const DEFAULT_AUDIO_LINE =
  'Audio: natural ambient sound that matches the scene, no spoken narration';
const STATIC_NEGATIVE_FRAGMENT = 'camera shake, camera movement, panning';

describe('buildVeoPrompt', () => {
  it('gives every camera preset its mapped phrase', () => {
    for (const [preset, phrase] of Object.entries(CAMERA_MOTION_PROMPTS)) {
      expect(buildVeoPrompt({ prompt: 'A cat on a windowsill', cameraMotion: preset })).toBe(
        `A cat on a windowsill. ${phrase}`,
      );
    }
  });

  it('falls back to a generic camera-movement phrase for an unknown preset', () => {
    expect(buildVeoPrompt({ prompt: 'A cat', cameraMotion: 'Crane Up' })).toBe(
      'A cat. The camera performs a crane up movement',
    );
  });

  it('adds nothing for a blank camera preset', () => {
    expect(buildVeoPrompt({ prompt: 'A cat', cameraMotion: '   ' })).toBe('A cat');
  });

  it('gives every style preset its mapped phrase', () => {
    for (const [preset, phrase] of Object.entries(STYLE_PRESET_PROMPTS)) {
      expect(buildVeoPrompt({ prompt: 'A cat', stylePreset: preset })).toBe(`A cat. ${phrase}`);
    }
  });

  it('falls back to "<label> style" for an unknown style preset', () => {
    expect(buildVeoPrompt({ prompt: 'A cat', stylePreset: 'Noir' })).toBe('A cat. Noir style');
  });

  it('puts style before camera', () => {
    expect(buildVeoPrompt({ prompt: 'A cat', stylePreset: 'UGC', cameraMotion: 'Pan' })).toBe(
      `A cat. ${STYLE_PRESET_PROMPTS.UGC}. ${CAMERA_MOTION_PROMPTS.Pan}`,
    );
  });

  it('prepends the first-frame opener when a reference image is supplied', () => {
    expect(buildVeoPrompt({ prompt: 'A cat stretches', hasReferenceImage: true })).toBe(
      'Starting from the provided first frame: A cat stretches',
    );
  });

  it('skips the first-frame opener when there is no scene text', () => {
    expect(buildVeoPrompt({ prompt: '', hasReferenceImage: true })).toBe('');
  });

  it('prefers enrichedPrompt over prompt as the scene', () => {
    expect(
      buildVeoPrompt({ prompt: 'A cat', enrichedPrompt: 'A ginger cat in golden light' }),
    ).toBe('A ginger cat in golden light');
  });

  it('adds the default audio line when the model has audio and the scene is silent about sound', () => {
    expect(buildVeoPrompt({ prompt: 'A cat on a windowsill', supportsAudio: true })).toBe(
      `A cat on a windowsill. ${DEFAULT_AUDIO_LINE}`,
    );
  });

  it('adds no audio line when the model has no audio track', () => {
    expect(buildVeoPrompt({ prompt: 'A cat, music plays' })).toBe('A cat, music plays');
    expect(buildVeoPrompt({ prompt: 'A cat' })).toBe('A cat');
  });

  it('skips the default audio line when the scene mentions sound in English', () => {
    const scenes = [
      'A cat on a windowsill, soft music plays',
      'Two friends speak quietly',
      'A voiceover explains the product',
      'Complete silence in the room',
      'She leans in to whisper',
      'The dialogue is tense',
    ];
    for (const prompt of scenes) {
      expect(buildVeoPrompt({ prompt, supportsAudio: true })).toBe(prompt);
    }
  });

  it('skips the default audio line when the scene mentions sound in Russian', () => {
    const scenes = [
      'слышны разговоры',
      'играет музыка',
      'полная тишина',
      'девушка говорит в камеру',
      'звук дождя за окном',
      'на фоне поёт птица',
    ];
    for (const prompt of scenes) {
      expect(buildVeoPrompt({ prompt, supportsAudio: true })).toBe(prompt);
    }
  });

  // Pins a known gap: the English half of the keyword regex is \b-delimited, so inflected
  // forms and the "narrat" stem never match and the scene wrongly gets the audio line.
  it('KNOWN GAP: does not detect inflected English audio words', () => {
    for (const prompt of [
      'She whispers to the dog',
      'A narrator introduces the app',
      'He speaks softly',
    ]) {
      expect(buildVeoPrompt({ prompt, supportsAudio: true })).toBe(
        `${prompt}. ${DEFAULT_AUDIO_LINE}`,
      );
    }
  });

  it('reads the audio check from the enriched scene, not the raw prompt', () => {
    expect(
      buildVeoPrompt({
        prompt: 'A cat',
        enrichedPrompt: 'A cat on a windowsill while music plays',
        supportsAudio: true,
      }),
    ).toBe('A cat on a windowsill while music plays');
  });

  it('truncates an over-long prompt to the cap and ends it with an ellipsis', () => {
    const result = buildVeoPrompt({ prompt: 'a'.repeat(2500) });
    expect(result).toHaveLength(1800);
    expect(result.endsWith('…')).toBe(true);
    expect(result.slice(0, 1799)).toBe('a'.repeat(1799));
  });

  it('leaves a prompt at exactly the cap untouched', () => {
    const exact = 'a'.repeat(1800);
    expect(buildVeoPrompt({ prompt: exact })).toBe(exact);
  });

  it('never produces leading separators for an empty prompt', () => {
    expect(buildVeoPrompt({ prompt: '' })).toBe('');
    expect(
      buildVeoPrompt({
        prompt: '   ',
        stylePreset: 'Cinematic',
        cameraMotion: 'Pan',
        supportsAudio: true,
      }),
    ).toBe(
      `${STYLE_PRESET_PROMPTS.Cinematic}. ${CAMERA_MOTION_PROMPTS.Pan}. ${DEFAULT_AUDIO_LINE}`,
    );
  });
});

describe('buildNegativePrompt', () => {
  it('adds the static negative prompt for a locked-off shot', () => {
    const negative = buildNegativePrompt('Static');
    expect(negative).toContain(STATIC_NEGATIVE_FRAGMENT);
    expect(negative.startsWith('subtitles, captions, burned-in text')).toBe(true);
  });

  it('gives non-static motions only the base negative prompt', () => {
    const base = buildNegativePrompt();
    expect(base).not.toContain(STATIC_NEGATIVE_FRAGMENT);
    for (const preset of Object.keys(CAMERA_MOTION_PROMPTS)) {
      if (preset === 'Static') continue;
      expect(buildNegativePrompt(preset)).toBe(base);
    }
  });
});

const LUNA: ElementRef = {
  id: 'el-1',
  name: 'Luna',
  handle: '@Luna',
  category: 'character',
  description: 'young curly-haired girl in an orange hoodie',
  role: 'visual',
  imageIndex: 1,
  imageUrl: 'https://example.test/luna.png',
};

const SCHOOL: ElementRef = {
  id: 'el-2',
  name: 'School',
  handle: '@School',
  category: 'location',
  description: 'modern red brick building',
  role: 'text',
};

function enrichInput(overrides: Partial<EnrichPromptInput> = {}): EnrichPromptInput {
  return {
    prompt: 'a cat on a windowsill',
    stylePreset: 'Cinematic',
    cameraMotion: 'Pan',
    mode: 'text_to_video',
    ...overrides,
  };
}

function textReply(text: string) {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn' };
}

describe('enrichPrompt', () => {
  beforeEach(() => {
    state.anthropicApiKey = null;
    state.create.mockReset();
  });

  it('returns the prompt unchanged when no Anthropic key is configured', async () => {
    const input = enrichInput({ prompt: '@Luna walks into @School', elements: [LUNA, SCHOOL] });
    await expect(enrichPrompt(input)).resolves.toBe('@Luna walks into @School');
    expect(state.create).not.toHaveBeenCalled();
  });

  it('returns the enriched text from Claude', async () => {
    state.anthropicApiKey = 'test-key';
    state.create.mockResolvedValue(textReply('  A ginger cat dozes on a sunlit windowsill.  '));

    await expect(enrichPrompt(enrichInput())).resolves.toBe(
      'A ginger cat dozes on a sunlit windowsill.',
    );
  });

  it('folds element handles into the text sent to Claude', async () => {
    state.anthropicApiKey = 'test-key';
    state.create.mockResolvedValue(textReply('enriched'));

    await enrichPrompt(
      enrichInput({ prompt: '@Luna walks into @School', elements: [LUNA, SCHOOL] }),
    );

    const request = state.create.mock.calls[0]?.[0] as { messages: [{ content: string }] };
    const sent = request.messages[0].content;
    expect(sent).toContain('@Image1 is Luna — young curly-haired girl in an orange hoodie.');
    expect(sent).toContain('@Image1 walks into modern red brick building');
    expect(sent).toContain('Camera motion preset: Pan');
  });

  it('falls back to the folded prompt when the SDK throws', async () => {
    state.anthropicApiKey = 'test-key';
    state.create.mockRejectedValue(new Error('rate limited'));

    await expect(
      enrichPrompt(enrichInput({ prompt: '@Luna waves', elements: [LUNA] })),
    ).resolves.toBe('@Image1 is Luna — young curly-haired girl in an orange hoodie. @Image1 waves');
  });

  it('falls back when Claude answers with no usable text', async () => {
    state.anthropicApiKey = 'test-key';
    state.create.mockResolvedValue(textReply('   '));

    await expect(enrichPrompt(enrichInput())).resolves.toBe('a cat on a windowsill');
  });

  it('falls back when Claude refuses', async () => {
    state.anthropicApiKey = 'test-key';
    state.create.mockResolvedValue({ content: [], stop_reason: 'refusal' });

    await expect(enrichPrompt(enrichInput())).resolves.toBe('a cat on a windowsill');
  });

  it('caps the enriched prompt so the style and camera lines still fit', async () => {
    state.anthropicApiKey = 'test-key';
    state.create.mockResolvedValue(textReply('x'.repeat(5000)));

    await expect(enrichPrompt(enrichInput())).resolves.toHaveLength(1200);
  });
});
