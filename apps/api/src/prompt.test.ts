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
  buildImagePrompt,
  buildNegativePrompt,
  buildVeoPrompt,
  CAMERA_MOTION_PROMPTS,
  enrichPrompt,
  IMAGE_STYLE_PRESET_PROMPTS,
  PHYSICAL_CONSISTENCY_PROMPT,
  STYLE_PRESET_PROMPTS,
} from './prompt.js';

const DEFAULT_AUDIO_LINE =
  'Audio: natural ambient sound that matches the scene, no spoken narration';
const STATIC_NEGATIVE_FRAGMENT = 'camera shake, camera movement, panning';

/**
 * Every assembled prompt ends with the continuity clause, so the cases below state the parts
 * they are actually about and let this add the constant.
 */
function assembled(...parts: string[]): string {
  return [...parts, PHYSICAL_CONSISTENCY_PROMPT].join('. ');
}

describe('buildVeoPrompt', () => {
  it('gives every camera preset its mapped phrase', () => {
    for (const [preset, phrase] of Object.entries(CAMERA_MOTION_PROMPTS)) {
      expect(buildVeoPrompt({ prompt: 'A cat on a windowsill', cameraMotion: preset })).toBe(
        assembled('A cat on a windowsill', phrase),
      );
    }
  });

  it('falls back to a generic camera-movement phrase for an unknown preset', () => {
    expect(buildVeoPrompt({ prompt: 'A cat', cameraMotion: 'Crane Up' })).toBe(
      assembled('A cat', 'The camera performs a crane up movement'),
    );
  });

  it('adds nothing for a blank camera preset', () => {
    expect(buildVeoPrompt({ prompt: 'A cat', cameraMotion: '   ' })).toBe(assembled('A cat'));
  });

  it('gives every style preset its mapped phrase', () => {
    for (const [preset, phrase] of Object.entries(STYLE_PRESET_PROMPTS)) {
      expect(buildVeoPrompt({ prompt: 'A cat', stylePreset: preset })).toBe(
        assembled('A cat', phrase),
      );
    }
  });

  it('falls back to "<label> style" for an unknown style preset', () => {
    expect(buildVeoPrompt({ prompt: 'A cat', stylePreset: 'Noir' })).toBe(
      assembled('A cat', 'Noir style'),
    );
  });

  it('puts style before camera', () => {
    expect(buildVeoPrompt({ prompt: 'A cat', stylePreset: 'UGC', cameraMotion: 'Pan' })).toBe(
      assembled('A cat', STYLE_PRESET_PROMPTS.UGC ?? '', CAMERA_MOTION_PROMPTS.Pan ?? ''),
    );
  });

  it('prepends the first-frame opener when a reference image is supplied', () => {
    expect(buildVeoPrompt({ prompt: 'A cat stretches', hasReferenceImage: true })).toBe(
      assembled('Starting from the provided first frame: A cat stretches'),
    );
  });

  it('skips the first-frame opener when there is no scene text', () => {
    expect(buildVeoPrompt({ prompt: '', hasReferenceImage: true })).toBe('');
  });

  it('prefers enrichedPrompt over prompt as the scene', () => {
    expect(
      buildVeoPrompt({ prompt: 'A cat', enrichedPrompt: 'A ginger cat in golden light' }),
    ).toBe(assembled('A ginger cat in golden light'));
  });

  it('adds the default audio line when the model has audio and the scene is silent about sound', () => {
    expect(buildVeoPrompt({ prompt: 'A cat on a windowsill', supportsAudio: true })).toBe(
      assembled('A cat on a windowsill', DEFAULT_AUDIO_LINE),
    );
  });

  it('adds no audio line when the model has no audio track', () => {
    expect(buildVeoPrompt({ prompt: 'A cat, music plays' })).toBe(assembled('A cat, music plays'));
    expect(buildVeoPrompt({ prompt: 'A cat' })).toBe(assembled('A cat'));
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
      expect(buildVeoPrompt({ prompt, supportsAudio: true })).toBe(assembled(prompt));
    }
  });

  it('skips the default audio line when the scene mentions sound in Uzbek', () => {
    const scenes = [
      'qiz kameraga gapiradi',
      'orqa fonda musiqa yangraydi',
      'yigitning ovozi eshitiladi',
      'to‘liq jimlik',
      'diktor mahsulotni tanishtiradi',
    ];
    for (const prompt of scenes) {
      expect(buildVeoPrompt({ prompt, supportsAudio: true })).toBe(assembled(prompt));
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
      expect(buildVeoPrompt({ prompt, supportsAudio: true })).toBe(assembled(prompt));
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
        assembled(prompt, DEFAULT_AUDIO_LINE),
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
    ).toBe(assembled('A cat on a windowsill while music plays'));
  });

  it('stays within the cap when the scene is over-long, and marks the cut', () => {
    const result = buildVeoPrompt({ prompt: 'a'.repeat(2500) });
    expect(result.length).toBeLessThanOrEqual(1800);
    expect(result).toContain('…');
  });

  // The guardrails sit at the end of the assembly, which is exactly where a naive truncation
  // eats them — so the budget is spent on the scene and the instructions always survive.
  it('spends the cap on the scene rather than dropping the instructions', () => {
    const result = buildVeoPrompt({
      prompt: 'a'.repeat(2500),
      stylePreset: 'UGC',
      cameraMotion: 'Pan',
      supportsAudio: true,
    });

    expect(result.length).toBeLessThanOrEqual(1800);
    expect(result.endsWith(PHYSICAL_CONSISTENCY_PROMPT)).toBe(true);
    expect(result).toContain(STYLE_PRESET_PROMPTS.UGC ?? '');
    expect(result).toContain(CAMERA_MOTION_PROMPTS.Pan ?? '');
    expect(result).toContain(DEFAULT_AUDIO_LINE);
  });

  // The counter-example to the rule above. A scene is not always scenery: it can end on the
  // one line a character has to say, and cutting its tail then throws away the whole script.
  // A real shot was generated that way — the model got a character study, no dialogue, and
  // supplied its own words.
  it('gives up its own guardrails before cutting a scene that would otherwise fit', () => {
    const line = 'Он произносит ровно одну реплику: «Красотка, стоп».';
    const scene = `${'Девушка смотрит телевизор, экран мигает. '.repeat(36)}${line}`;
    expect(scene.length).toBeLessThanOrEqual(1800);

    const result = buildVeoPrompt({
      prompt: scene,
      stylePreset: 'UGC',
      cameraMotion: 'Pan',
      supportsAudio: true,
      voicePrompt: 'мужчина 30 лет, низкий голос',
    });

    expect(result.length).toBeLessThanOrEqual(1800);
    expect(result).toContain(line);
    expect(result).not.toContain('…');
    // The two ends of the order: ours is spent first, the voice governing the speech is last.
    expect(result).not.toContain(PHYSICAL_CONSISTENCY_PROMPT);
    expect(result).toContain('Narrated by: мужчина 30 лет, низкий голос');
  });

  it('names the narrator when a saved voice is attached', () => {
    const built = buildVeoPrompt({
      prompt: 'девушка держит бутылку',
      supportsAudio: true,
      voicePrompt: 'женщина около 30, тёплый низкий тембр, говорит по-узбекски',
    });

    expect(built).toContain('Narrated by: женщина около 30, тёплый низкий тембр');
  });

  // The default audio line ends with "no spoken narration". Appending both would ask the
  // model to describe a speaker and stay silent in the same breath, and a prompt that
  // contradicts itself gets whichever half the model prefers.
  it('drops the silence instruction when a voice is asked for', () => {
    const built = buildVeoPrompt({
      prompt: 'девушка держит бутылку',
      supportsAudio: true,
      voicePrompt: 'мужчина, спокойный баритон',
    });

    expect(built).not.toContain(DEFAULT_AUDIO_LINE);
    expect(built).not.toContain('no spoken narration');
  });

  it('leaves a silent model silent, voice or not', () => {
    const built = buildVeoPrompt({ prompt: 'кот', voicePrompt: 'мужчина, баритон' });

    expect(built).not.toContain('Narrated by');
  });

  it('ignores a blank voice rather than announcing an empty narrator', () => {
    const built = buildVeoPrompt({ prompt: 'кот', supportsAudio: true, voicePrompt: '   ' });

    expect(built).not.toContain('Narrated by');
    expect(built).toContain(DEFAULT_AUDIO_LINE);
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
      assembled(
        STYLE_PRESET_PROMPTS.Cinematic ?? '',
        CAMERA_MOTION_PROMPTS.Pan ?? '',
        DEFAULT_AUDIO_LINE,
      ),
    );
  });

  // The whole point of moving this into the project rather than the skill: the MCP server,
  // the studio form and the storyboard generator all reach Veo through this one function.
  it('asks for physical continuity on every shot, whatever the caller supplied', () => {
    const callers = [
      { prompt: 'A cat' },
      { prompt: 'A cat', stylePreset: 'UGC' },
      { prompt: 'A cat', cameraMotion: 'Static' },
      { prompt: 'A cat', hasReferenceImage: true },
      { prompt: 'A cat', enrichedPrompt: 'A ginger cat', supportsAudio: true },
    ];

    for (const caller of callers) {
      expect(buildVeoPrompt(caller)).toContain(PHYSICAL_CONSISTENCY_PROMPT);
    }
  });

  // Negation is what the negative prompt is for; here it would mostly summon the phone it
  // is trying to keep in frame.
  it('states continuity positively, never as a prohibition', () => {
    for (const word of [' no ', ' not ', 'never', "n't", 'without']) {
      expect(PHYSICAL_CONSISTENCY_PROMPT.toLowerCase()).not.toContain(word);
    }
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

  // These are the artefacts that make a clip unusable rather than merely imperfect, and
  // every shot has objects in it — so no camera preset gets to opt out of them.
  it('refuses the continuity artefacts whatever the camera is doing', () => {
    const wanted = [
      'morphing',
      'objects appearing or vanishing mid-shot',
      'objects slipping out of the hand',
      'screens flipping or changing content on their own',
      'deformed hands',
      'impossible physics',
    ];

    for (const preset of [...Object.keys(CAMERA_MOTION_PROMPTS), undefined]) {
      const negative = buildNegativePrompt(preset);
      for (const term of wanted) expect(negative).toContain(term);
    }
  });
});

describe('buildImagePrompt', () => {
  it('expands every style preset into its own description', () => {
    for (const [preset, phrase] of Object.entries(IMAGE_STYLE_PRESET_PROMPTS)) {
      const built = buildImagePrompt({ prompt: 'A ceramic mug on a desk', stylePreset: preset });
      expect(built.startsWith(`A ceramic mug on a desk. ${phrase}.`)).toBe(true);
    }
  });

  it('gives two different presets two different prompts', () => {
    const cinematic = buildImagePrompt({ prompt: 'A mug', stylePreset: 'Cinematic' });
    const ugc = buildImagePrompt({ prompt: 'A mug', stylePreset: 'UGC' });
    expect(cinematic).not.toBe(ugc);
  });

  it('describes an unknown preset rather than dropping it', () => {
    expect(buildImagePrompt({ prompt: 'A mug', stylePreset: 'Noir' })).toContain('Noir style');
  });

  it('still guards against text and watermarks with no preset chosen', () => {
    const built = buildImagePrompt({ prompt: 'A mug' });
    expect(built).toBe(
      'A mug. Sharp, high detail, no watermark, no logo overlay, no captions or burned-in text',
    );
  });

  it('caps an over-long prompt', () => {
    const built = buildImagePrompt({ prompt: 'x'.repeat(5000), stylePreset: 'Cinematic' });
    expect(built).toHaveLength(1800);
    expect(built.endsWith('…')).toBe(true);
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

  it('sends the handles verbatim and describes who each one is', async () => {
    state.anthropicApiKey = 'test-key';
    state.create.mockResolvedValue(textReply('@Luna walks into @School at dusk'));

    await enrichPrompt(
      enrichInput({ prompt: '@Luna walks into @School', elements: [LUNA, SCHOOL] }),
    );

    const request = state.create.mock.calls[0]?.[0] as { messages: [{ content: string }] };
    const sent = request.messages[0].content;
    // The handle is the link back to the saved photo, so it travels intact and the
    // description rides alongside it rather than replacing it.
    expect(sent).toContain('Idea: @Luna walks into @School');
    expect(sent).toContain('@Luna — Luna, young curly-haired girl in an orange hoodie');
    expect(sent).toContain('@School — School, modern red brick building');
    expect(sent).toContain('Camera motion preset: Pan');
  });

  it('keeps a rewrite that preserved every handle', async () => {
    state.anthropicApiKey = 'test-key';
    state.create.mockResolvedValue(textReply('@Luna waves from the doorway of @School'));

    await expect(
      enrichPrompt(enrichInput({ prompt: '@Luna waves at @School', elements: [LUNA, SCHOOL] })),
    ).resolves.toBe('@Luna waves from the doorway of @School');
  });

  // A dropped handle is a dropped reference image, which is worse than no rewrite at all.
  it('discards a rewrite that lost a handle', async () => {
    state.anthropicApiKey = 'test-key';
    state.create.mockResolvedValue(textReply('A curly-haired girl waves outside a red building'));

    await expect(
      enrichPrompt(enrichInput({ prompt: '@Luna waves', elements: [LUNA] })),
    ).resolves.toBe('@Luna waves');
  });

  it('falls back to the prompt as typed when the SDK throws', async () => {
    state.anthropicApiKey = 'test-key';
    state.create.mockRejectedValue(new Error('rate limited'));

    await expect(
      enrichPrompt(enrichInput({ prompt: '@Luna waves', elements: [LUNA] })),
    ).resolves.toBe('@Luna waves');
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
