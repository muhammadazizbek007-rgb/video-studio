import type { Timestamp } from 'firebase/firestore';
import type { VideoElement, VideoElementCategory } from './videoElement';

export type VideoModelStatus = 'active' | 'coming_soon';
export type VideoGenerationMode = 'text_to_video' | 'image_to_video' | 'reference_to_video';
export type VideoAspectRatio = '9:16' | '16:9' | '1:1';
export type VideoDuration = 5 | 10 | 15;
export type VideoGenerationStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type VideoStylePreset =
  | 'Cinematic'
  | 'UGC'
  | 'App Promo'
  | 'AI Social Platform Ad'
  | 'School Viral Reel'
  | 'Product Demo'
  | 'Character Story';

export type CameraMotion =
  | 'Static'
  | 'Zoom in'
  | 'Dolly in'
  | 'Handheld'
  | 'Orbit'
  | 'Pan';

// ─── Reference Mode ───────────────────────────────────────────────────────────

/** How the provider accepts reference images */
export type ReferenceMode =
  | 'none'              // model takes no images
  | 'single_image'      // image_url: string
  | 'image_urls'        // image_urls: string[]  (Seedance 2.0 multi)
  | 'reference_images'  // reference_images: string[]
  | 'content_array';    // content: [{type:"image_url", image_url:"..."}]

// ─── Model Capabilities ───────────────────────────────────────────────────────

export interface ModelCapabilities {
  maxReferenceImages: number;
  supportsMultiReference: boolean;
  referenceMode: ReferenceMode;
  supportsCharacterReference: boolean;
  supportsLocationReference: boolean;
  supportsPropReference: boolean;
}

// ─── Generation Element Reference ─────────────────────────────────────────────

/** One element resolved for a generation request */
export interface GenerationElementRef {
  id: string;
  name: string;
  handle: string;          // "@Luna"
  type: VideoElementCategory;
  imageUrl?: string;
  description?: string;
  role: 'visual' | 'text'; // visual = sent as image, text = in enriched prompt only
  imageIndex?: number;     // 1,2,3 → @Image1, @Image2, @Image3 in prompt
}

// ─── Resolved References ─────────────────────────────────────────────────────

export type ResolvedReferenceMode = 'multi_reference' | 'single_reference' | 'text_only';

export interface ResolvedReferences {
  /** Elements sent as actual images to the model — sorted by priority, deduplicated */
  visualRefs: GenerationElementRef[];
  /** Elements used only in enriched prompt text */
  textRefs: GenerationElementRef[];
  /** Final enriched prompt sent to AI */
  enrichedPrompt: string;
  /** Ordered list of image URLs (index 0 = @Image1) */
  referenceImageUrls: string[];
  /** What mode was resolved */
  mode: ResolvedReferenceMode;
}

// ─── Video Model ──────────────────────────────────────────────────────────────

export interface VideoModel {
  id: string;
  name: string;
  provider: string;
  status: VideoModelStatus;
  supportsTextToVideo: boolean;
  supportsImageToVideo: boolean;
  supportsReferenceVideo: boolean;
  supportsAudio: boolean;
  maxDuration: VideoDuration;
  aspectRatios: VideoAspectRatio[];
  capabilities: ModelCapabilities;
  estimatedCostLabel?: string;
  description?: string;
}

// ─── Firestore Document ───────────────────────────────────────────────────────

export interface VideoGenerationRequest {
  id: string;
  userId: string;

  // Prompts
  prompt: string;
  enrichedPrompt?: string;

  // Model
  modelId: string;
  provider?: string;

  // Generation params
  mode: VideoGenerationMode;
  aspectRatio: VideoAspectRatio;
  duration: VideoDuration;
  stylePreset: VideoStylePreset;
  cameraMotion: CameraMotion;

  // References — legacy single
  referenceImageUrl?: string;
  referenceVideoUrl?: string;
  referenceAudioUrl?: string;

  // References — multi
  referenceImageUrls?: string[];
  elements?: GenerationElementRef[];
  referenceMode?: ReferenceMode;

  // Status
  status: VideoGenerationStatus;
  resultVideoUrl?: string;
  resultStoragePath?: string;
  errorMessage?: string;
  saved?: boolean;

  // Analytics
  referenceCount?: number;
  fallbackUsed?: boolean;
  fallbackReason?: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Frontend Input ───────────────────────────────────────────────────────────

export interface CreateVideoGenerationInput {
  prompt: string;
  enrichedPrompt?: string;
  modelId: string;
  mode: VideoGenerationMode;
  aspectRatio: VideoAspectRatio;
  duration: VideoDuration;
  stylePreset: VideoStylePreset;
  cameraMotion: CameraMotion;
  // Files
  referenceImageFile?: File | null;
  referenceVideoFile?: File | null;
  referenceAudioFile?: File | null;
  // URLs (from element resolver)
  referenceImageUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrl?: string;
  referenceAudioUrl?: string;
  // Element metadata
  elements?: GenerationElementRef[];
  referenceMode?: ReferenceMode;
  referenceCount?: number;
}

export interface VideoGenerationResult {
  resultVideoUrl: string;
}

export interface VideoProvider {
  generate(request: VideoGenerationRequest): Promise<VideoGenerationResult>;
}
