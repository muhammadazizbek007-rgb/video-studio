import type { ElementDto, ElementRef, GenerationDto, UserDto } from '@video-studio/shared';
import type { ElementDoc } from './models/element.js';
import type { GenerationDoc } from './models/generation.js';
import type { UserDoc } from './models/user.js';

function iso(value: Date | undefined): string {
  return (value ?? new Date(0)).toISOString();
}

/** Optional DTO fields are omitted entirely rather than serialised as null. */
function assignOptional<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | null | undefined,
): void {
  if (value !== null && value !== undefined) target[key] = value;
}

function toElementRef(ref: ElementRef): ElementRef {
  const out: ElementRef = {
    id: ref.id,
    name: ref.name,
    handle: ref.handle,
    category: ref.category,
    role: ref.role,
  };
  assignOptional(out, 'imageUrl', ref.imageUrl);
  assignOptional(out, 'description', ref.description);
  assignOptional(out, 'imageIndex', ref.imageIndex);
  return out;
}

export function toUserDto(doc: UserDoc): UserDto {
  return {
    id: doc._id.toString(),
    email: doc.email,
    name: doc.name,
    picture: doc.picture ?? null,
    createdAt: iso(doc.createdAt),
  };
}

export function toGenerationDto(doc: GenerationDoc): GenerationDto {
  const dto: GenerationDto = {
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    prompt: doc.prompt,
    modelId: doc.modelId,
    mode: doc.mode,
    aspectRatio: doc.aspectRatio,
    duration: doc.duration,
    stylePreset: doc.stylePreset,
    cameraMotion: doc.cameraMotion,
    status: doc.status,
    saved: doc.saved,
    referenceImageUrls: [...(doc.referenceImageUrls ?? [])],
    elements: (doc.elements ?? []).map(toElementRef),
    referenceCount: doc.referenceCount ?? 0,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
  assignOptional(dto, 'enrichedPrompt', doc.enrichedPrompt);
  assignOptional(dto, 'resultVideoUrl', doc.resultVideoUrl);
  assignOptional(dto, 'errorMessage', doc.errorMessage);
  assignOptional(dto, 'lastFrameImageUrl', doc.lastFrameImageUrl);
  return dto;
}

export function toElementDto(doc: ElementDoc): ElementDto {
  const dto: ElementDto = {
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    name: doc.name,
    handle: doc.handle,
    category: doc.category,
    pinned: doc.pinned,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
  assignOptional(dto, 'description', doc.description);
  assignOptional(dto, 'imageUrl', doc.imageUrl);
  assignOptional(dto, 'storagePath', doc.storagePath);
  return dto;
}
