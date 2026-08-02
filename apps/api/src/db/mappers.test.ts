import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { toElementDto, toGenerationDto, toUserDto } from './mappers.js';
import type { ElementDoc } from './models/element.js';
import type { GenerationDoc } from './models/generation.js';
import type { UserDoc } from './models/user.js';

const CREATED_AT = new Date('2026-01-02T03:04:05.000Z');
const UPDATED_AT = new Date('2026-01-02T04:05:06.000Z');

describe('toUserDto', () => {
  it('stringifies the id and emits an ISO createdAt', () => {
    const id = new Types.ObjectId();
    const doc: UserDoc = {
      _id: id,
      googleId: 'google-1',
      email: 'owner@example.com',
      name: 'Owner',
      picture: null,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    };

    expect(toUserDto(doc)).toEqual({
      id: id.toString(),
      email: 'owner@example.com',
      name: 'Owner',
      picture: null,
      createdAt: '2026-01-02T03:04:05.000Z',
    });
  });
});

describe('toGenerationDto', () => {
  function baseDoc(overrides: Partial<GenerationDoc> = {}): GenerationDoc {
    return {
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      prompt: 'a cat on a skateboard',
      modelId: 'veo-3.1-fast',
      mode: 'text_to_video',
      aspectRatio: '16:9',
      duration: 8,
      stylePreset: 'Cinematic',
      cameraMotion: 'Static',
      status: 'processing',
      saved: false,
      referenceImageUrls: [],
      elements: [],
      referenceCount: 0,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      ...overrides,
    };
  }

  it('maps ids to strings and timestamps to ISO strings', () => {
    const doc = baseDoc();

    const dto = toGenerationDto(doc);

    expect(dto.id).toBe(doc._id.toString());
    expect(dto.userId).toBe(doc.userId.toString());
    expect(dto.createdAt).toBe('2026-01-02T03:04:05.000Z');
    expect(dto.updatedAt).toBe('2026-01-02T04:05:06.000Z');
  });

  it('omits undefined optional fields instead of emitting null', () => {
    const dto = toGenerationDto(baseDoc());

    expect('enrichedPrompt' in dto).toBe(false);
    expect('resultVideoUrl' in dto).toBe(false);
    expect('errorMessage' in dto).toBe(false);
    expect('lastFrameImageUrl' in dto).toBe(false);
  });

  it('keeps optional fields that are present and copies element refs', () => {
    const dto = toGenerationDto(
      baseDoc({
        enrichedPrompt: 'a cinematic cat on a skateboard',
        status: 'completed',
        resultVideoUrl: '/media/videos/out.mp4',
        referenceImageUrls: ['/media/uploads/a.png'],
        referenceCount: 1,
        elements: [
          {
            id: 'el-1',
            name: 'Luna',
            handle: '@Luna',
            category: 'character',
            role: 'visual',
            imageIndex: 1,
          },
        ],
      }),
    );

    expect(dto.enrichedPrompt).toBe('a cinematic cat on a skateboard');
    expect(dto.resultVideoUrl).toBe('/media/videos/out.mp4');
    expect(dto.referenceImageUrls).toEqual(['/media/uploads/a.png']);
    expect(dto.elements[0]?.handle).toBe('@Luna');
    expect(dto.elements[0] && 'description' in dto.elements[0]).toBe(false);
  });

  it('does not leak internal Vertex bookkeeping into the DTO', () => {
    const dto = toGenerationDto(
      baseDoc({ vertexOperationName: 'operations/123', resultStoragePath: 'videos/out.mp4' }),
    );

    expect('vertexOperationName' in dto).toBe(false);
    expect('resultStoragePath' in dto).toBe(false);
  });
});

describe('toElementDto', () => {
  it('omits undefined optionals and keeps the ones that are set', () => {
    const doc: ElementDoc = {
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      name: 'Luna',
      handle: '@Luna',
      category: 'character',
      imageUrl: '/media/elements/luna.png',
      pinned: true,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    };

    const dto = toElementDto(doc);

    expect(dto.id).toBe(doc._id.toString());
    expect(dto.userId).toBe(doc.userId.toString());
    expect(dto.imageUrl).toBe('/media/elements/luna.png');
    expect(dto.pinned).toBe(true);
    expect(dto.createdAt).toBe('2026-01-02T03:04:05.000Z');
    expect(dto.updatedAt).toBe('2026-01-02T04:05:06.000Z');
    expect('description' in dto).toBe(false);
    expect('storagePath' in dto).toBe(false);
  });
});
