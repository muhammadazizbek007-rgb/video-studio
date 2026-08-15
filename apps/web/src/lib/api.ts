import {
  apiErrorSchema,
  type CreateElementInput,
  type CreateGenerationInput,
  type CreateImageGenerationInput,
  type CreateStoryboardInput,
  type CreateVoiceInput,
  type EnrichPromptInput,
  type ExtendGenerationInput,
  elementDtoSchema,
  type GenerateSegmentInput,
  type GenerationDto,
  generationDtoSchema,
  imageGenerationDtoSchema,
  type MediaKind,
  mcpKeyIssuedDtoSchema,
  mcpKeyStatusDtoSchema,
  type StoryboardDto,
  storyboardDtoSchema,
  type UpdateElementInput,
  type UpdateGenerationInput,
  type UpdateImageGenerationInput,
  type UpdateStoryboardInput,
  type UpdateStoryboardSegmentInput,
  type UpdateUploadInput,
  type UpdateVoiceInput,
  uploadDtoSchema,
  userDtoSchema,
  videoAspectRatioSchema,
  videoDurationSchema,
  voiceDtoSchema,
} from '@video-studio/shared';
import { z } from 'zod';

export const API_BASE: string = import.meta.env.VITE_API_URL ?? '';

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }
}

const STATUS_CODES: Record<number, string> = {
  400: 'invalid-argument',
  401: 'unauthenticated',
  403: 'permission-denied',
  404: 'not-found',
  429: 'rate-limited',
  500: 'internal',
  503: 'unavailable',
};

const veoModelSpecSchema = z.object({
  id: z.string(),
  name: z.string(),
  vertexModel: z.string(),
  description: z.string(),
  supportedDurations: z.array(videoDurationSchema),
  defaultDuration: videoDurationSchema,
  aspectRatios: z.array(videoAspectRatioSchema),
  supportsImageToVideo: z.boolean(),
  supportsAudio: z.boolean(),
  supportsLastFrame: z.boolean(),
  supportsReferenceImages: z.boolean(),
  maxAssetReferences: z.number().int().min(0),
  supportsExtension: z.boolean(),
  maxResolution: z.string(),
});

const imageModelSpecSchema = z.object({
  id: z.string(),
  name: z.string(),
  vertexModel: z.string(),
  kind: z.enum(['imagen', 'gemini']),
  supportsEditing: z.boolean(),
  description: z.string(),
});

const modelsResponseSchema = z.object({
  video: z.array(veoModelSpecSchema),
  image: z.array(imageModelSpecSchema),
});

const generationPageSchema = z.object({
  items: z.array(generationDtoSchema),
  nextCursor: z.string().nullable(),
});

const imageGenerationListSchema = z.object({
  items: z.array(imageGenerationDtoSchema),
});

const uploadListSchema = z.object({
  items: z.array(uploadDtoSchema),
});

const voiceListSchema = z.object({ items: z.array(voiceDtoSchema) });

const enrichResponseSchema = z.object({
  enrichedPrompt: z.string(),
});

const storyboardPageSchema = z.object({
  items: z.array(storyboardDtoSchema),
  nextCursor: z.string().nullable(),
});

const storyboardCapabilitiesSchema = z.object({ serverStitching: z.boolean() });

export type ModelsResponse = z.infer<typeof modelsResponseSchema>;
export type GenerationPage = z.infer<typeof generationPageSchema>;
export type StoryboardPage = z.infer<typeof storyboardPageSchema>;
export type StoryboardCapabilities = z.infer<typeof storyboardCapabilitiesSchema>;
export type UploadResult = z.infer<typeof uploadDtoSchema>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  formData?: FormData;
  query?: Record<string, string | number | undefined>;
  /** auth.me is the one call whose 401 is a legitimate answer, not an expired session. */
  refreshOn401?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = `${API_BASE}/api${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Every 401 replay funnels through one promise so a screen that fires six queries at once
 * rotates the refresh token once instead of six times (each rotation invalidates the last).
 */
function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { accept: 'application/json' },
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function toApiClientError(response: Response): Promise<ApiClientError> {
  const fallbackCode = STATUS_CODES[response.status] ?? 'internal';
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return new ApiClientError(fallbackCode, response.statusText || fallbackCode, response.status);
  }
  const parsed = apiErrorSchema.safeParse(payload);
  if (parsed.success) {
    return new ApiClientError(parsed.data.error.code, parsed.data.error.message, response.status);
  }
  return new ApiClientError(fallbackCode, response.statusText || fallbackCode, response.status);
}

async function send(path: string, options: RequestOptions = {}): Promise<unknown> {
  const { method = 'GET', body, formData, query, refreshOn401 = true, signal } = options;

  // content-type is set only when a body is actually sent. Declaring application/json on a
  // bodyless DELETE makes Fastify wait for a JSON payload that never arrives, and the request
  // hangs rather than failing — which is far harder to diagnose than a 400.
  const headers: Record<string, string> = { accept: 'application/json' };
  if (!formData && body !== undefined) headers['content-type'] = 'application/json';

  const init: RequestInit = { method, credentials: 'include', headers };
  if (signal) init.signal = signal;
  if (formData) init.body = formData;
  else if (body !== undefined) init.body = JSON.stringify(body);

  const url = buildUrl(path, query);
  let response = await fetch(url, init);

  if (response.status === 401 && refreshOn401) {
    const refreshed = await refreshSession();
    if (refreshed) response = await fetch(url, init);
  }

  if (!response.ok) throw await toApiClientError(response);

  if (response.status === 204) return undefined;

  try {
    return await response.json();
  } catch {
    throw new ApiClientError('internal', 'Server returned a malformed response.', response.status);
  }
}

/**
 * Validating here turns backend contract drift into one loud error at the boundary instead of
 * an undefined that surfaces three components deep.
 */
async function requestJson<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const data = await send(path, options);
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiClientError(
      'invalid-response',
      `Response for ${path} did not match the expected shape.`,
      200,
    );
  }
  return parsed.data;
}

export interface GenerationListParams {
  limit?: number;
  cursor?: string;
}

export const api = {
  auth: {
    me: () => requestJson('/auth/me', userDtoSchema, { refreshOn401: false }),
    logout: async (): Promise<void> => {
      await send('/auth/logout', { method: 'POST' });
    },
    devLogin: (email?: string) =>
      requestJson('/auth/dev-login', userDtoSchema, {
        method: 'POST',
        body: email ? { email } : {},
        refreshOn401: false,
      }),
  },
  voices: {
    list: () => requestJson('/voices', voiceListSchema),
    create: (input: CreateVoiceInput) =>
      requestJson('/voices', voiceDtoSchema, { method: 'POST', body: input }),
    update: (id: string, input: UpdateVoiceInput) =>
      requestJson(`/voices/${id}`, voiceDtoSchema, { method: 'PATCH', body: input }),
    remove: async (id: string): Promise<void> => {
      await send(`/voices/${id}`, { method: 'DELETE' });
    },
  },
  models: {
    list: () => requestJson('/models', modelsResponseSchema),
  },
  generations: {
    list: (params: GenerationListParams = {}) =>
      requestJson('/generations', generationPageSchema, {
        query: { limit: params.limit, cursor: params.cursor },
      }),
    get: (id: string) => requestJson(`/generations/${id}`, generationDtoSchema),
    create: (input: CreateGenerationInput) =>
      requestJson('/generations', generationDtoSchema, { method: 'POST', body: input }),
    update: (id: string, input: UpdateGenerationInput) =>
      requestJson(`/generations/${id}`, generationDtoSchema, { method: 'PATCH', body: input }),
    remove: async (id: string): Promise<void> => {
      await send(`/generations/${id}`, { method: 'DELETE' });
    },
    refresh: (id: string) =>
      requestJson(`/generations/${id}/refresh`, generationDtoSchema, { method: 'POST' }),
    /** Continues a finished clip; the answer is the new generation, not the source. */
    extend: (id: string, input: ExtendGenerationInput = {}) =>
      requestJson(`/generations/${id}/extend`, generationDtoSchema, {
        method: 'POST',
        body: input,
      }),
    stream: (
      id: string,
      onUpdate: (generation: GenerationDto) => void,
      onError?: (event: Event) => void,
    ): (() => void) => {
      if (typeof EventSource === 'undefined') {
        onError?.(new Event('error'));
        return () => {};
      }
      const source = new EventSource(`${API_BASE}/api/generations/${id}/events`, {
        withCredentials: true,
      });
      const handleMessage = (event: MessageEvent<string>) => {
        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        const parsed = generationDtoSchema.safeParse(payload);
        if (parsed.success) onUpdate(parsed.data);
      };
      const handleError = (event: Event) => onError?.(event);
      source.addEventListener('generation', handleMessage as EventListener);
      source.addEventListener('error', handleError);
      return () => {
        source.removeEventListener('generation', handleMessage as EventListener);
        source.removeEventListener('error', handleError);
        source.close();
      };
    },
  },
  images: {
    list: (limit = 24) => requestJson('/images', imageGenerationListSchema, { query: { limit } }),
    /** Resolves only once the picture exists: Imagen answers in seconds, not minutes. */
    create: (input: CreateImageGenerationInput) =>
      requestJson('/images', imageGenerationDtoSchema, { method: 'POST', body: input }),
    update: (id: string, input: UpdateImageGenerationInput) =>
      requestJson(`/images/${id}`, imageGenerationDtoSchema, { method: 'PATCH', body: input }),
    remove: async (id: string): Promise<void> => {
      await send(`/images/${id}`, { method: 'DELETE' });
    },
  },
  storyboards: {
    list: (limit = 20) => requestJson('/storyboards', storyboardPageSchema, { query: { limit } }),
    get: (id: string) => requestJson(`/storyboards/${id}`, storyboardDtoSchema),
    create: (input: CreateStoryboardInput = {}) =>
      requestJson('/storyboards', storyboardDtoSchema, { method: 'POST', body: input }),
    update: (id: string, input: UpdateStoryboardInput) =>
      requestJson(`/storyboards/${id}`, storyboardDtoSchema, { method: 'PATCH', body: input }),
    remove: async (id: string): Promise<void> => {
      await send(`/storyboards/${id}`, { method: 'DELETE' });
    },
    updateSegment: (id: string, index: number, input: UpdateStoryboardSegmentInput) =>
      requestJson(`/storyboards/${id}/segments/${index}`, storyboardDtoSchema, {
        method: 'PATCH',
        body: input,
      }),
    generateSegment: (id: string, index: number, input: GenerateSegmentInput = {}) =>
      requestJson(`/storyboards/${id}/segments/${index}/generate`, storyboardDtoSchema, {
        method: 'POST',
        body: input,
      }),
    clearSegmentGeneration: (id: string, index: number) =>
      requestJson(`/storyboards/${id}/segments/${index}/generation`, storyboardDtoSchema, {
        method: 'DELETE',
      }),
    export: (id: string) =>
      requestJson(`/storyboards/${id}/export`, storyboardDtoSchema, { method: 'POST' }),
    capabilities: () => requestJson('/storyboards/capabilities', storyboardCapabilitiesSchema),
    /** One stream for the whole board: every segment's progress arrives on this connection. */
    stream: (
      id: string,
      onUpdate: (storyboard: StoryboardDto) => void,
      onError?: (event: Event) => void,
    ): (() => void) => {
      if (typeof EventSource === 'undefined') {
        onError?.(new Event('error'));
        return () => {};
      }
      const source = new EventSource(`${API_BASE}/api/storyboards/${id}/events`, {
        withCredentials: true,
      });
      const handleMessage = (event: MessageEvent<string>) => {
        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        const parsed = storyboardDtoSchema.safeParse(payload);
        if (parsed.success) onUpdate(parsed.data);
      };
      const handleError = (event: Event) => onError?.(event);
      source.addEventListener('storyboard', handleMessage as EventListener);
      source.addEventListener('error', handleError);
      return () => {
        source.removeEventListener('storyboard', handleMessage as EventListener);
        source.removeEventListener('error', handleError);
        source.close();
      };
    },
  },
  elements: {
    list: () => requestJson('/elements', z.array(elementDtoSchema)),
    create: (input: CreateElementInput) =>
      requestJson('/elements', elementDtoSchema, { method: 'POST', body: input }),
    update: (id: string, input: UpdateElementInput) =>
      requestJson(`/elements/${id}`, elementDtoSchema, { method: 'PATCH', body: input }),
    remove: async (id: string): Promise<void> => {
      await send(`/elements/${id}`, { method: 'DELETE' });
    },
  },
  media: {
    upload: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return requestJson('/media/upload', uploadDtoSchema, { method: 'POST', formData });
    },
    list: (params: { kind?: MediaKind; limit?: number } = {}) =>
      requestJson('/media/uploads', uploadListSchema, {
        query: { kind: params.kind, limit: params.limit },
      }),
    update: (id: string, input: UpdateUploadInput) =>
      requestJson(`/media/uploads/${id}`, uploadDtoSchema, { method: 'PATCH', body: input }),
    remove: async (id: string): Promise<void> => {
      await send(`/media/uploads/${id}`, { method: 'DELETE' });
    },
  },
  mcp: {
    key: () => requestJson('/mcp/key', mcpKeyStatusDtoSchema),
    /** The response is the one and only copy of the secret — it cannot be read back. */
    issueKey: () => requestJson('/mcp/key', mcpKeyIssuedDtoSchema, { method: 'POST' }),
    revokeKey: async (): Promise<void> => {
      await send('/mcp/key', { method: 'DELETE' });
    },
  },
  prompt: {
    enrich: (input: EnrichPromptInput) =>
      requestJson('/prompt/enrich', enrichResponseSchema, { method: 'POST', body: input }),
  },
} as const;

export function googleSignInUrl(): string {
  return `${API_BASE}/api/auth/google`;
}
