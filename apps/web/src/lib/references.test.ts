import type { ElementDto, VeoModelSpec } from '@video-studio/shared';
import { requireVeoModel, VIDEO_MODEL_LIST } from '@video-studio/shared';
import { describe, expect, it } from 'vitest';
import { findMentionedElements, referenceCapacity, resolveReferences } from './references';

const MODEL: VeoModelSpec = requireVeoModel('veo-3.1');

/** Every model in the registry accepts images, so the zero-slot branch needs a synthetic spec. */
const TEXT_ONLY_MODEL: VeoModelSpec = { ...MODEL, supportsImageToVideo: false };

type ElementSeed = Pick<ElementDto, 'id' | 'name' | 'handle' | 'category'> &
  Partial<Pick<ElementDto, 'description' | 'imageUrl'>>;

function element(seed: ElementSeed): ElementDto {
  return {
    id: seed.id,
    userId: 'user-1',
    name: seed.name,
    handle: seed.handle,
    category: seed.category,
    description: seed.description,
    imageUrl: seed.imageUrl,
    pinned: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const ava = element({
  id: 'el-ava',
  name: 'Ава',
  handle: '@Ava',
  category: 'character',
  description: 'рыжая героиня',
  imageUrl: 'https://cdn.test/ava.png',
});

const boris = element({
  id: 'el-boris',
  name: 'Борис',
  handle: '@Boris',
  category: 'character',
  imageUrl: 'https://cdn.test/boris.png',
});

const cleo = element({
  id: 'el-cleo',
  name: 'Клео',
  handle: '@Cleo',
  category: 'character',
  imageUrl: 'https://cdn.test/cleo.png',
});

const dora = element({
  id: 'el-dora',
  name: 'Дора',
  handle: '@Dora',
  category: 'prop',
  imageUrl: 'https://cdn.test/dora.png',
});

const bar = element({
  id: 'el-bar',
  name: 'Бар',
  handle: '@Bar',
  category: 'location',
  description: 'неоновый бар',
});

describe('referenceCapacity', () => {
  it('offers three image slots on every model that accepts images', () => {
    for (const model of VIDEO_MODEL_LIST) {
      expect(referenceCapacity(model)).toBe(3);
    }
  });

  it('offers no slots when the model cannot take images at all', () => {
    expect(referenceCapacity(TEXT_ONLY_MODEL)).toBe(0);
  });
});

describe('findMentionedElements', () => {
  it('returns nothing when the prompt carries no mention', () => {
    expect(findMentionedElements('пустая сцена без упоминаний', [ava, bar])).toEqual([]);
  });

  it('matches handles case-insensitively and keeps the prompt order', () => {
    const found = findMentionedElements('@bar встречает @AVA', [ava, bar]);
    expect(found.map((item) => item.id)).toEqual(['el-bar', 'el-ava']);
  });

  it('ignores mentions that match no element', () => {
    expect(findMentionedElements('@Ava и @Ghost', [ava]).map((item) => item.id)).toEqual([
      'el-ava',
    ]);
  });

  it('collapses a handle mentioned more than once', () => {
    expect(findMentionedElements('@Ava смотрит на @Ava', [ava])).toHaveLength(1);
  });
});

describe('resolveReferences', () => {
  it('leaves a prompt without mentions untouched', () => {
    const result = resolveReferences({
      prompt: '  закат над морем  ',
      elements: [ava],
      model: MODEL,
    });

    expect(result.visualRefs).toEqual([]);
    expect(result.textRefs).toEqual([]);
    expect(result.referenceImageUrls).toEqual([]);
    expect(result.mode).toBe('text_to_video');
    expect(result.enrichedPromptHint).toBe('закат над морем');
  });

  it('fills the model reference limit and demotes the overflow to text', () => {
    const result = resolveReferences({
      prompt: '@Ava @Boris @Cleo @Dora на сцене',
      elements: [ava, boris, cleo, dora],
      model: MODEL,
    });

    expect(result.visualRefs.map((ref) => ref.handle)).toEqual(['@Ava', '@Boris', '@Cleo']);
    expect(result.visualRefs.map((ref) => ref.imageIndex)).toEqual([1, 2, 3]);
    expect(result.visualRefs.every((ref) => ref.role === 'visual')).toBe(true);
    expect(result.textRefs.map((ref) => ref.handle)).toEqual(['@Dora']);
    expect(result.textRefs[0]?.role).toBe('text');
    expect(result.textRefs[0]?.imageIndex).toBeUndefined();
    expect(result.referenceImageUrls).toHaveLength(3);
    expect(result.mode).toBe('reference_to_video');
  });

  it('numbers @ImageN by category priority rather than by prompt order', () => {
    const result = resolveReferences({
      prompt: '@Dora танцует с @Ava в @Bar',
      elements: [ava, dora, bar],
      model: MODEL,
    });

    expect(result.visualRefs.map((ref) => [ref.handle, ref.imageIndex])).toEqual([
      ['@Ava', 1],
      ['@Dora', 2],
    ]);
    expect(result.enrichedPromptHint).toBe(
      '@Image1 is Ава — рыжая героиня. @Image2 is Дора. @Image2 танцует с @Image1 в неоновый бар',
    );
  });

  it('gives the uploaded first frame slot one and shifts the elements after it', () => {
    const result = resolveReferences({
      prompt: '@Ava и @Dora',
      elements: [ava, dora],
      model: MODEL,
      uploadedImageUrl: 'https://cdn.test/frame.png',
    });

    expect(result.visualRefs.map((ref) => ref.imageIndex)).toEqual([2, 3]);
    expect(result.referenceImageUrls).toEqual([
      'https://cdn.test/frame.png',
      'https://cdn.test/ava.png',
      'https://cdn.test/dora.png',
    ]);
    expect(result.mode).toBe('reference_to_video');
  });

  it('treats a blank uploaded url as no upload', () => {
    const result = resolveReferences({
      prompt: '@Ava одна в кадре',
      elements: [ava],
      model: MODEL,
      uploadedImageUrl: '   ',
    });

    expect(result.visualRefs.map((ref) => ref.imageIndex)).toEqual([1]);
    expect(result.referenceImageUrls).toEqual(['https://cdn.test/ava.png']);
    expect(result.mode).toBe('image_to_video');
  });

  it('keeps one reference per element id even when two handles point at it', () => {
    const alias = element({
      id: 'el-ava',
      name: 'Ава (дубль)',
      handle: '@Twin',
      category: 'character',
      imageUrl: 'https://cdn.test/ava.png',
    });

    const result = resolveReferences({
      prompt: '@Ava и @Twin',
      elements: [ava, alias],
      model: MODEL,
    });

    expect(result.visualRefs.map((ref) => ref.id)).toEqual(['el-ava']);
    expect(result.textRefs).toEqual([]);
    expect(result.referenceImageUrls).toEqual(['https://cdn.test/ava.png']);
    expect(result.mode).toBe('image_to_video');
    // The alias never became a reference, so its handle survives in the prompt verbatim.
    expect(result.enrichedPromptHint).toBe('рыжая героиня и @Twin');
  });

  it('demotes a second element that reuses an already attached image', () => {
    const twinImage = element({
      id: 'el-twin',
      name: 'Двойник',
      handle: '@Twin',
      category: 'character',
      description: 'та же фотография',
      imageUrl: 'https://cdn.test/ava.png',
    });

    const result = resolveReferences({
      prompt: '@Ava и @Twin',
      elements: [ava, twinImage],
      model: MODEL,
    });

    expect(result.visualRefs.map((ref) => ref.id)).toEqual(['el-ava']);
    expect(result.textRefs.map((ref) => ref.id)).toEqual(['el-twin']);
    expect(result.textRefs[0]?.imageUrl).toBeUndefined();
    expect(result.referenceImageUrls).toEqual(['https://cdn.test/ava.png']);
  });

  it('sends an element without an image as a text reference', () => {
    const result = resolveReferences({
      prompt: '@Ava в @Bar',
      elements: [ava, bar],
      model: MODEL,
    });

    expect(result.visualRefs.map((ref) => ref.handle)).toEqual(['@Ava']);
    expect(result.textRefs.map((ref) => ref.handle)).toEqual(['@Bar']);
    expect(result.mode).toBe('image_to_video');
    // A single image never gets an @ImageN header, so both handles collapse to prose.
    expect(result.enrichedPromptHint).toBe('рыжая героиня в неоновый бар');
  });

  it('falls back to the element name when it carries no description', () => {
    const result = resolveReferences({
      prompt: 'крупный план @Boris',
      elements: [boris],
      model: TEXT_ONLY_MODEL,
    });

    expect(result.enrichedPromptHint).toBe('крупный план Борис');
  });

  it('inlines every mention as text when the model takes no references', () => {
    const result = resolveReferences({
      prompt: '@Ava и @Dora в @Bar',
      elements: [ava, dora, bar],
      model: TEXT_ONLY_MODEL,
    });

    expect(result.visualRefs).toEqual([]);
    expect(result.textRefs.map((ref) => ref.handle)).toEqual(['@Ava', '@Bar', '@Dora']);
    expect(result.textRefs.every((ref) => ref.role === 'text')).toBe(true);
    expect(result.referenceImageUrls).toEqual([]);
    expect(result.mode).toBe('text_to_video');
    expect(result.enrichedPromptHint).toBe('рыжая героиня и Дора в неоновый бар');
  });

  it('still forwards a hand-uploaded frame on a model that takes no references', () => {
    const result = resolveReferences({
      prompt: '@Ava крупным планом',
      elements: [ava],
      model: TEXT_ONLY_MODEL,
      uploadedImageUrl: 'https://cdn.test/frame.png',
    });

    expect(result.visualRefs).toEqual([]);
    expect(result.referenceImageUrls).toEqual(['https://cdn.test/frame.png']);
    expect(result.mode).toBe('image_to_video');
  });

  it('never exceeds the three slots the create-generation contract allows', () => {
    const result = resolveReferences({
      prompt: '@Ava @Boris @Cleo @Dora',
      elements: [ava, boris, cleo, dora],
      model: MODEL,
      uploadedImageUrl: 'https://cdn.test/frame.png',
    });

    expect(result.referenceImageUrls).toHaveLength(3);
    expect(result.textRefs).toHaveLength(2);
  });
});
