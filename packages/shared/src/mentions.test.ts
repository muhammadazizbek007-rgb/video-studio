import { describe, expect, it } from 'vitest';
import { buildHandle } from './helpers.js';
import {
  assetReferenceCapacity,
  findMentionedElements,
  findUnknownHandles,
  resolveMentions,
} from './mentions.js';
import type { VeoModelSpec } from './models.js';
import { requireVeoModel, VIDEO_MODEL_LIST } from './models.js';
import type { ElementDto } from './schemas.js';

const MODEL: VeoModelSpec = requireVeoModel('veo-3.1');

/** Every model in the registry takes references, so the zero-slot branch needs a stand-in. */
const TEXT_ONLY_MODEL: VeoModelSpec = {
  ...MODEL,
  supportsReferenceImages: false,
  maxAssetReferences: 0,
};

type ElementSeed = Pick<ElementDto, 'id' | 'name' | 'handle' | 'category'> &
  Partial<Pick<ElementDto, 'description' | 'imageUrl' | 'createdAt'>>;

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
    createdAt: seed.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const muhammad = element({
  id: 'el-muhammad',
  name: 'Мухаммад',
  handle: '@Мухаммад',
  category: 'character',
  description: 'молодой мужчина в серой худи',
  imageUrl: '/media/uploads/user-1/muhammad.jpg',
});

const ali = element({
  id: 'el-ali',
  name: 'Али',
  handle: '@Ali',
  category: 'character',
  imageUrl: '/media/uploads/user-1/ali.jpg',
});

const alisher = element({
  id: 'el-alisher',
  name: 'Алишер',
  handle: '@Alisher',
  category: 'character',
  imageUrl: '/media/uploads/user-1/alisher.jpg',
});

const cafe = element({
  id: 'el-cafe',
  name: 'Кафе Нур',
  handle: '@Кафе',
  category: 'location',
  description: 'маленькое кафе с неоновой вывеской',
  imageUrl: '/media/uploads/user-1/cafe.jpg',
});

const cup = element({
  id: 'el-cup',
  name: 'Пиала',
  handle: '@Пиала',
  category: 'prop',
  imageUrl: '/media/uploads/user-1/cup.jpg',
});

const bazaar = element({
  id: 'el-bazaar',
  name: 'Базар',
  handle: '@Базар',
  category: 'location',
  description: 'шумный утренний базар',
});

describe('buildHandle', () => {
  it('keeps letters of any script', () => {
    expect(buildHandle('Мухаммад')).toBe('@Мухаммад');
    expect(buildHandle('Muhammad Ali')).toBe('@Muhammad_Ali');
    // Latin-script Uzbek used to be stripped down to nonsense by the ASCII-only rule.
    expect(buildHandle('Gʻafur')).toBe('@Gʻafur');
  });

  it('drops punctuation, turns spaces into underscores and keeps digits', () => {
    expect(buildHandle('Кафе «Нур» 24')).toBe('@Кафе_Нур_24');
  });
});

describe('findMentionedElements', () => {
  it('finds nothing in a prompt without mentions', () => {
    expect(findMentionedElements('закат над городом', [muhammad])).toEqual([]);
  });

  it('matches case-insensitively and keeps prompt order', () => {
    const found = findMentionedElements('@кафе, потом @МУХАММАД', [muhammad, cafe]);
    expect(found.map((item) => item.id)).toEqual(['el-cafe', 'el-muhammad']);
  });

  it('returns an element mentioned twice only once', () => {
    expect(findMentionedElements('@Мухаммад смотрит на @Мухаммад', [muhammad])).toHaveLength(1);
  });
});

describe('findUnknownHandles', () => {
  it('reports handles that match no element', () => {
    expect(findUnknownHandles('@Мухаммад и @Незнакомец', [muhammad])).toEqual(['@Незнакомец']);
  });
});

describe('assetReferenceCapacity', () => {
  it('offers three slots on every shipped model', () => {
    for (const model of VIDEO_MODEL_LIST) expect(assetReferenceCapacity(model)).toBe(3);
  });

  it('offers none when the model takes no reference images', () => {
    expect(assetReferenceCapacity(TEXT_ONLY_MODEL)).toBe(0);
  });
});

describe('resolveMentions', () => {
  it('leaves a prompt without mentions alone', () => {
    const result = resolveMentions({
      prompt: '  закат над морем  ',
      elements: [muhammad],
      model: MODEL,
    });

    expect(result.refs).toEqual([]);
    expect(result.assetImageUrls).toEqual([]);
    expect(result.promptForModel).toBe('закат над морем');
    expect(result.mode).toBe('text_to_video');
  });

  it('attaches a mentioned character as an asset reference and names it in the prompt', () => {
    const result = resolveMentions({
      prompt: '@Мухаммад пьёт чай',
      elements: [muhammad],
      model: MODEL,
    });

    expect(result.assetImageUrls).toEqual(['/media/uploads/user-1/muhammad.jpg']);
    expect(result.assetRefs[0]?.imageIndex).toBe(1);
    expect(result.mode).toBe('reference_to_video');
    expect(result.promptForModel).toBe(
      'Reference image 1 shows the character Мухаммад — молодой мужчина в серой худи. Мухаммад пьёт чай',
    );
  });

  it('numbers slots by category priority, characters before locations', () => {
    const result = resolveMentions({
      prompt: 'в @Кафе сидит @Мухаммад',
      elements: [cafe, muhammad],
      model: MODEL,
    });

    expect(result.assetRefs.map((ref) => [ref.handle, ref.imageIndex])).toEqual([
      ['@Мухаммад', 1],
      ['@Кафе', 2],
    ]);
    expect(result.promptForModel).toContain('Reference image 2 shows the location Кафе Нур');
    expect(result.promptForModel).toContain('в Кафе Нур сидит Мухаммад');
  });

  it('fills the three slots and demotes the overflow to text', () => {
    const result = resolveMentions({
      prompt: '@Мухаммад, @Ali и @Alisher в @Кафе с @Пиала',
      elements: [muhammad, ali, alisher, cafe, cup],
      model: MODEL,
    });

    expect(result.assetRefs.map((ref) => ref.handle)).toEqual(['@Мухаммад', '@Ali', '@Alisher']);
    expect(result.textRefs.map((ref) => ref.handle)).toEqual(['@Кафе', '@Пиала']);
    expect(result.assetImageUrls).toHaveLength(3);
    // A demoted element has to carry its own appearance, so its first mention takes the
    // description with it.
    expect(result.promptForModel).toContain('Кафе Нур (маленькое кафе с неоновой вывеской)');
  });

  it('does not let a shorter handle eat a longer one', () => {
    const result = resolveMentions({
      prompt: '@Ali зовёт @Alisher',
      elements: [ali, alisher],
      model: MODEL,
    });

    expect(result.promptForModel).toContain('Али зовёт Алишер');
    expect(result.promptForModel).not.toContain('Алиsher');
  });

  it('leaves an unknown handle in the prompt and reports it', () => {
    const result = resolveMentions({
      prompt: '@Мухаммад и @Незнакомец',
      elements: [muhammad],
      model: MODEL,
    });

    expect(result.unknownHandles).toEqual(['@Незнакомец']);
    expect(result.promptForModel).toContain('@Незнакомец');
  });

  it('sends an element without a photo as text', () => {
    const result = resolveMentions({
      prompt: '@Мухаммад на @Базар',
      elements: [muhammad, bazaar],
      model: MODEL,
    });

    expect(result.assetRefs.map((ref) => ref.handle)).toEqual(['@Мухаммад']);
    expect(result.textRefs.map((ref) => ref.handle)).toEqual(['@Базар']);
    expect(result.promptForModel).toContain('Базар (шумный утренний базар)');
  });

  it('demotes a second element that reuses an attached photo', () => {
    const twin = element({
      id: 'el-twin',
      name: 'Двойник',
      handle: '@Двойник',
      category: 'character',
      imageUrl: muhammad.imageUrl,
    });

    const result = resolveMentions({
      prompt: '@Мухаммад и @Двойник',
      elements: [muhammad, twin],
      model: MODEL,
    });

    expect(result.assetRefs.map((ref) => ref.id)).toEqual(['el-muhammad']);
    expect(result.textRefs.map((ref) => ref.id)).toEqual(['el-twin']);
    expect(result.assetImageUrls).toEqual([muhammad.imageUrl]);
  });

  it('inlines every mention when the model takes no reference images', () => {
    const result = resolveMentions({
      prompt: '@Мухаммад в @Кафе',
      elements: [muhammad, cafe],
      model: TEXT_ONLY_MODEL,
    });

    expect(result.assetRefs).toEqual([]);
    expect(result.textRefs).toHaveLength(2);
    expect(result.mode).toBe('text_to_video');
    expect(result.promptForModel).not.toContain('Reference image');
  });

  describe('the uploaded first frame', () => {
    const frame = '/media/uploads/user-1/frame.png';

    it('loses its place to mentioned elements by default', () => {
      const result = resolveMentions({
        prompt: '@Мухаммад пьёт чай',
        elements: [muhammad],
        model: MODEL,
        firstFrameImageUrl: frame,
      });

      expect(result.firstFrameImageUrl).toBeNull();
      expect(result.firstFrameDropped).toBe(true);
      expect(result.assetImageUrls).toEqual([muhammad.imageUrl]);
    });

    /**
     * Veo answers a request carrying both an opening frame and asset references with
     * "Image and reference images cannot be both set", and the clip fails outright. This
     * used to assert that frame-wins kept the frame *and* the element photos, which is
     * exactly the request Veo refuses — the storyboard sent it every time somebody attached
     * an opening frame to a prompt that mentioned anybody.
     */
    it('keeps its place under frame-wins, and sends the elements as words', () => {
      const result = resolveMentions({
        prompt: '@Мухаммад пьёт чай',
        elements: [muhammad],
        model: MODEL,
        firstFrameImageUrl: frame,
        framePolicy: 'frame-wins',
      });

      expect(result.firstFrameImageUrl).toBe(frame);
      expect(result.firstFrameDropped).toBe(false);
      expect(result.assetImageUrls).toEqual([]);
      // Not lost — carried as a name in the prompt instead of a photo in a slot.
      expect(result.textRefs.map((ref) => ref.handle)).toEqual(['@Мухаммад']);
      expect(result.promptForModel).toContain('Мухаммад');
      expect(result.mode).toBe('image_to_video');
    });

    // The rule Veo enforces, stated once as a rule rather than case by case.
    it('never sends an opening frame and asset references together', () => {
      const combinations = [
        { framePolicy: 'frame-wins' as const, prompt: '@Мухаммад и @Кафе' },
        { framePolicy: 'elements-win' as const, prompt: '@Мухаммад и @Кафе' },
        { framePolicy: 'frame-wins' as const, prompt: 'никого не упомянули' },
        { framePolicy: 'elements-win' as const, prompt: 'никого не упомянули' },
      ];

      for (const { framePolicy, prompt } of combinations) {
        const result = resolveMentions({
          prompt,
          elements: [muhammad, cafe],
          model: MODEL,
          firstFrameImageUrl: frame,
          framePolicy,
        });

        expect(result.firstFrameImageUrl !== null && result.assetImageUrls.length > 0).toBe(false);
      }
    });

    it('survives when nothing was mentioned', () => {
      const result = resolveMentions({
        prompt: 'закат над морем',
        elements: [muhammad],
        model: MODEL,
        firstFrameImageUrl: frame,
      });

      expect(result.firstFrameImageUrl).toBe(frame);
      expect(result.firstFrameDropped).toBe(false);
      expect(result.mode).toBe('image_to_video');
    });

    it('survives a mention that could never take a slot anyway', () => {
      const result = resolveMentions({
        prompt: 'на @Базар',
        elements: [bazaar],
        model: MODEL,
        firstFrameImageUrl: frame,
      });

      expect(result.firstFrameImageUrl).toBe(frame);
      expect(result.firstFrameDropped).toBe(false);
    });

    it('treats a blank url as no upload', () => {
      const result = resolveMentions({
        prompt: 'закат',
        elements: [],
        model: MODEL,
        firstFrameImageUrl: '   ',
      });

      expect(result.firstFrameImageUrl).toBeNull();
      expect(result.mode).toBe('text_to_video');
    });
  });
});
