import { describe, expect, it } from 'vitest';
import { generationFirstFrameImageUrl, retryGenerationInput } from './generations.js';
import type { ElementRef, GenerationDto } from './schemas.js';

type GenerationSeed = Partial<GenerationDto>;

function generation(seed: GenerationSeed = {}): GenerationDto {
  return {
    id: 'gen-1',
    userId: 'user-1',
    prompt: 'Мухаммад @Мухаммад идёт по улице',
    modelId: 'veo-3.1',
    mode: 'text_to_video',
    aspectRatio: '16:9',
    duration: 8,
    stylePreset: 'Cinematic',
    cameraMotion: 'Dolly in',
    status: 'failed',
    errorMessage: 'Downloading the reference image failed.',
    saved: false,
    referenceImageUrls: [],
    elements: [],
    referenceCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...seed,
  };
}

/** An element travels as a picture when it has one and as words when it does not. */
function ref(imageUrl?: string): ElementRef {
  return {
    id: 'element-1',
    name: 'Мухаммад',
    handle: '@Мухаммад',
    category: 'character',
    role: imageUrl ? 'visual' : 'text',
    imageUrl,
  };
}

describe('generationFirstFrameImageUrl', () => {
  it('finds nothing when the record has no images at all', () => {
    expect(generationFirstFrameImageUrl(generation())).toBeUndefined();
  });

  it('reads the only reference as the frame when no element contributed one', () => {
    const source = generation({ referenceImageUrls: ['/media/frame.png'], elements: [] });
    expect(generationFirstFrameImageUrl(source)).toBe('/media/frame.png');
  });

  it('claims nothing when every reference came from an element', () => {
    const source = generation({
      referenceImageUrls: ['/media/element-a.png', '/media/element-b.png'],
      elements: [ref('/media/element-a.png'), ref('/media/element-b.png')],
    });
    expect(generationFirstFrameImageUrl(source)).toBeUndefined();
  });

  it('takes the leading entry when a frame and elements share the list', () => {
    const source = generation({
      referenceImageUrls: ['/media/frame.png', '/media/element-a.png'],
      elements: [ref('/media/element-a.png')],
    });
    expect(generationFirstFrameImageUrl(source)).toBe('/media/frame.png');
  });

  // An element without a photo is on the record but contributes nothing to the URL list,
  // so counting elements rather than their images would hide a real opening frame.
  it('ignores elements that carried no image', () => {
    const source = generation({
      referenceImageUrls: ['/media/frame.png'],
      elements: [ref(), ref()],
    });
    expect(generationFirstFrameImageUrl(source)).toBe('/media/frame.png');
  });
});

describe('retryGenerationInput', () => {
  it('sends the settings back unchanged', () => {
    const source = generation({
      prompt: 'Ночная улица',
      modelId: 'veo-3.1-fast',
      aspectRatio: '9:16',
      duration: 6,
      stylePreset: 'UGC',
      cameraMotion: 'Pan',
    });

    expect(retryGenerationInput(source)).toEqual({
      prompt: 'Ночная улица',
      modelId: 'veo-3.1-fast',
      aspectRatio: '9:16',
      duration: 6,
      stylePreset: 'UGC',
      cameraMotion: 'Pan',
    });
  });

  // The elements are re-resolved from the prompt on the server, so pinning their images as
  // an opening frame would attach them twice and burn a reference slot.
  it('carries the opening frame but never an element image', () => {
    const source = generation({
      referenceImageUrls: ['/media/frame.png', '/media/element-a.png'],
      elements: [ref('/media/element-a.png')],
    });

    const input = retryGenerationInput(source);

    expect(input.firstFrameImageUrl).toBe('/media/frame.png');
    expect(input.referenceImageUrls).toBeUndefined();
  });

  it('carries the closing frame when the record kept one', () => {
    const source = generation({ lastFrameImageUrl: '/media/last.png' });
    expect(retryGenerationInput(source).lastFrameImageUrl).toBe('/media/last.png');
  });

  // Deliberate: a retry is a fresh roll. Carrying the seed would reproduce the same clip,
  // which is the opposite of what someone clicking "try again" on a failure is asking for.
  // Reproducing a clip exactly is a different act and needs its own way in.
  it('does not carry the seed, so a retry is a new attempt', () => {
    const source = generation({ seed: 12345 });
    expect(retryGenerationInput(source).seed).toBeUndefined();
  });

  // `mode` is the server's conclusion, not the user's choice: a record that failed as
  // reference_to_video must be free to come back as image_to_video if the element is gone.
  it('leaves the mode for the server to derive again', () => {
    const source = generation({ mode: 'reference_to_video' });
    expect(retryGenerationInput(source).mode).toBeUndefined();
  });
});
