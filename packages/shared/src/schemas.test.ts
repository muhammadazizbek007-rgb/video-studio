import { describe, expect, it } from 'vitest';
import { buildHandle, extractMentions } from './helpers.js';
import { requireVeoModel, resolveAspectRatio, resolveDuration } from './models.js';
import { createGenerationSchema, generationDtoSchema } from './schemas.js';

describe('resolveDuration', () => {
  it('keeps a duration the model already supports', () => {
    expect(resolveDuration(requireVeoModel('veo-3.1'), 6)).toBe(6);
  });

  it('snaps to the nearest supported duration instead of throwing', () => {
    const veo31 = requireVeoModel('veo-3.1');
    expect(resolveDuration(veo31, 5)).toBe(4);
    expect(resolveDuration(veo31, 7)).toBe(6);
    expect(resolveDuration(veo31, 99)).toBe(8);
    expect(resolveDuration(requireVeoModel('veo-2.0'), 4)).toBe(5);
  });

  it('falls back to the model default for non-finite input', () => {
    expect(resolveDuration(requireVeoModel('veo-2.0'), Number.NaN)).toBe(8);
  });
});

describe('resolveAspectRatio', () => {
  it('returns a supported ratio and defaults empty input to 16:9', () => {
    const spec = requireVeoModel('veo-3.1-fast');
    expect(resolveAspectRatio(spec, '9:16')).toBe('9:16');
    expect(resolveAspectRatio(spec, '  ')).toBe('16:9');
  });

  it('throws for a ratio the model does not support', () => {
    expect(() => resolveAspectRatio(requireVeoModel('veo-3.1'), '1:1')).toThrow(/1:1/);
  });
});

describe('requireVeoModel', () => {
  it('resolves the exact Vertex model id', () => {
    expect(requireVeoModel('veo-2.0').vertexModel).toBe('veo-2.0-generate-001');
  });

  it('throws for an unknown model', () => {
    expect(() => requireVeoModel('veo-9')).toThrow(/Unknown Veo model: veo-9/);
  });
});

describe('handles and mentions', () => {
  it('builds handles from cyrillic names, stripping punctuation and spaces', () => {
    expect(buildHandle('Луна Соколова')).toBe('@Луна_Соколова');
    expect(buildHandle('  Luna, the Cat! ')).toBe('@Luna_the_Cat');
    expect(buildHandle('Ёжик №1')).toBe('@Ёжик_1');
  });

  it('extracts unique mentions including cyrillic ones', () => {
    expect(extractMentions('@Луна встречает @Дом и снова @Луна, потом @Prop_1')).toEqual([
      '@Луна',
      '@Дом',
      '@Prop_1',
    ]);
  });

  it('returns an empty list when there are no mentions', () => {
    expect(extractMentions('просто текст без упоминаний')).toEqual([]);
  });
});

const validCreateInput = {
  prompt: 'Кот в неоновом городе',
  modelId: 'veo-3.1-fast',
  mode: 'text_to_video',
  aspectRatio: '9:16',
  duration: 8,
  stylePreset: 'Cinematic',
  cameraMotion: 'Dolly in',
  referenceImageUrls: ['https://cdn.test/a.png'],
};

describe('createGenerationSchema', () => {
  it('parses a valid payload', () => {
    const parsed = createGenerationSchema.parse(validCreateInput);
    expect(parsed.modelId).toBe('veo-3.1-fast');
    expect(parsed.duration).toBe(8);
    expect(parsed.referenceImageUrls).toEqual(['https://cdn.test/a.png']);
  });

  it('rejects a prompt longer than 8000 characters', () => {
    const result = createGenerationSchema.safeParse({
      ...validCreateInput,
      prompt: 'а'.repeat(8001),
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than three reference images', () => {
    const result = createGenerationSchema.safeParse({
      ...validCreateInput,
      referenceImageUrls: ['a', 'b', 'c', 'd'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unsupported duration', () => {
    const result = createGenerationSchema.safeParse({ ...validCreateInput, duration: 3 });
    expect(result.success).toBe(false);
  });
});

describe('generationDtoSchema', () => {
  const dto = {
    id: 'gen_1',
    userId: 'user_1',
    prompt: 'Кот в неоновом городе',
    enrichedPrompt: 'Кот в неоновом городе, кинематографично',
    modelId: 'veo-3.1-fast',
    mode: 'text_to_video',
    aspectRatio: '9:16',
    duration: 8,
    stylePreset: 'Cinematic',
    cameraMotion: 'Dolly in',
    status: 'completed',
    resultVideoUrl: 'https://cdn.test/v.mp4',
    saved: false,
    referenceImageUrls: [],
    elements: [
      {
        id: 'el_1',
        name: 'Луна',
        handle: '@Луна',
        category: 'character',
        role: 'visual',
        imageIndex: 1,
      },
    ],
    referenceCount: 0,
    createdAt: '2026-08-02T10:00:00.000Z',
    updatedAt: '2026-08-02T10:01:30.000Z',
  };

  it('round-trips a full DTO', () => {
    const parsed = generationDtoSchema.parse(dto);
    expect(parsed).toEqual(dto);
    expect(generationDtoSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(dto);
  });

  it('rejects a non-ISO timestamp', () => {
    const result = generationDtoSchema.safeParse({ ...dto, createdAt: '2026-08-02' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown status', () => {
    const result = generationDtoSchema.safeParse({ ...dto, status: 'queued' });
    expect(result.success).toBe(false);
  });
});
