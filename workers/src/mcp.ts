import { Firestore } from './firestore';
import { HttpsError } from './types';
import type { Env } from './types';
import {
  startVeoOperation, checkVeoOperation, generateGoogleImage,
  VEO_MODEL_IDS, IMAGE_MODEL_IDS, DEFAULT_IMAGE_MODEL,
} from './providers';
import { checkRateLimit } from './handlers/rateLimit';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_VIDEO_MODEL = 'veo-3.1-fast';

const MODEL_CATALOG = [
  // ── Video: Google Veo via Vertex AI ────────────────────────────────────────
  { id: 'veo-3.1', name: 'Google Veo 3.1', type: 'video', status: 'ready', description: 'Highest quality, native audio, 1080p, 4/6/8s' },
  { id: 'veo-3.1-fast', name: 'Google Veo 3.1 Fast', type: 'video', status: 'ready', description: 'Faster Veo 3.1, native audio — default' },
  { id: 'veo-3.0', name: 'Google Veo 3', type: 'video', status: 'ready', description: 'Veo 3 with native audio, 1080p' },
  { id: 'veo-3.0-fast', name: 'Google Veo 3 Fast', type: 'video', status: 'ready', description: 'Fast Veo 3, native audio' },
  { id: 'veo-2.0', name: 'Google Veo 2', type: 'video', status: 'ready', description: 'Veo 2, 720p, no audio track' },
  { id: 'json2video', name: 'JSON2Video (slideshow)', type: 'video', status: 'needs_key', description: 'Template slideshow from photo + text — not AI generation' },
  // ── Image: Google Imagen / Gemini Image via Vertex AI ──────────────────────
  { id: 'imagen-4', name: 'Google Imagen 4', type: 'image', status: 'ready', description: 'Photorealistic text-to-image, accurate text rendering — default' },
  { id: 'imagen-4-fast', name: 'Google Imagen 4 Fast', type: 'image', status: 'ready', description: 'Faster Imagen 4' },
  { id: 'imagen-4-ultra', name: 'Google Imagen 4 Ultra', type: 'image', status: 'ready', description: 'Highest quality Imagen 4' },
  { id: 'imagen-3', name: 'Google Imagen 3', type: 'image', status: 'ready', description: 'Previous generation Imagen' },
  { id: 'gemini-image', name: 'Google Gemini Image', type: 'image', status: 'ready', description: 'Conversational image editing — background swap, object removal, restyling' },
];

const STYLE_PRESETS = [
  { id: 'Cinematic', description: 'Film-like quality with dramatic lighting' },
  { id: 'UGC', description: 'User-generated content, authentic and relatable' },
  { id: 'App Promo', description: 'Clean, professional app promotional style' },
  { id: 'AI Social Platform Ad', description: 'Eye-catching social media ad style' },
  { id: 'School Viral Reel', description: 'Trendy youth viral content' },
  { id: 'Product Demo', description: 'Product showcase with features highlighted' },
  { id: 'Character Story', description: 'Character-driven narrative storytelling' },
];

const CAMERA_MOTIONS = [
  { id: 'Static', description: 'No camera movement' },
  { id: 'Zoom in', description: 'Camera slowly zooms towards subject' },
  { id: 'Dolly in', description: 'Camera physically moves forward' },
  { id: 'Handheld', description: 'Slight shake, documentary feel' },
  { id: 'Orbit', description: 'Camera orbits around subject' },
  { id: 'Pan', description: 'Camera pans horizontally' },
];

const MODEL_TO_PROVIDER: Record<string, string> = {
  ...Object.fromEntries(VEO_MODEL_IDS.map((id) => [id, 'veo'])),
  json2video: 'json2video',
};

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'generate_video',
    description: 'Generate a video from a text prompt or reference image using Google Veo.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Text description of the video' },
        model: { type: 'string', description: 'Model: veo-3.1-fast (default), veo-3.1 (best quality), veo-3.0, veo-3.0-fast, veo-2.0', default: DEFAULT_VIDEO_MODEL },
        aspect_ratio: { type: 'string', description: '16:9 or 9:16 (Veo does not support square video)', default: '9:16' },
        duration: { type: 'number', description: 'Duration in seconds: 4, 6, or 8', default: 8 },
        style: { type: 'string', description: 'Style: Cinematic, UGC, App Promo, AI Social Platform Ad, School Viral Reel, Product Demo, Character Story', default: 'Cinematic' },
        camera_motion: { type: 'string', description: 'Camera: Static, Zoom in, Dolly in, Handheld, Orbit, Pan', default: 'Static' },
        reference_image_url: { type: 'string', description: 'Reference image URL for image-to-video' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'get_video_status',
    description: 'Check the status and result of a video generation job.',
    inputSchema: {
      type: 'object',
      properties: {
        generation_id: { type: 'string', description: 'Generation ID returned by generate_video' },
      },
      required: ['generation_id'],
    },
  },
  {
    name: 'show_generations',
    description: 'List recent video generations.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 10 },
        status: { type: 'string', description: 'Filter: completed, failed, processing, pending' },
      },
    },
  },
  {
    name: 'motion_control',
    description: 'Generate a video with precise camera and motion control.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Video description' },
        camera_motion: { type: 'string', description: 'Camera: Static, Zoom in, Dolly in, Handheld, Orbit, Pan' },
        model: { type: 'string', default: DEFAULT_VIDEO_MODEL },
        aspect_ratio: { type: 'string', default: '16:9' },
        duration: { type: 'number', default: 8 },
        reference_image_url: { type: 'string' },
      },
      required: ['prompt', 'camera_motion'],
    },
  },
  {
    name: 'reframe',
    description: 'Generate a video in a specific aspect ratio.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        target_aspect_ratio: { type: 'string', description: '16:9 or 9:16' },
        model: { type: 'string', default: DEFAULT_VIDEO_MODEL },
        style: { type: 'string', default: 'Cinematic' },
      },
      required: ['prompt', 'target_aspect_ratio'],
    },
  },
  {
    name: 'generate_image',
    description: 'Generate an image from a text prompt using Google Imagen.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Description of the image' },
        aspect_ratio: { type: 'string', description: '1:1, 16:9, 9:16, 4:3, 3:4', default: '1:1' },
        model: { type: 'string', description: 'imagen-4 (default), imagen-4-fast, imagen-4-ultra, imagen-3', default: DEFAULT_IMAGE_MODEL },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'edit_image',
    description: 'Edit an existing image with a natural-language instruction using Google Gemini Image — swap backgrounds, remove or add objects, restyle.',
    inputSchema: {
      type: 'object',
      properties: {
        image_url: { type: 'string', description: 'URL of the image to edit' },
        prompt: { type: 'string', description: 'What to change, e.g. "remove the person in the background"' },
      },
      required: ['image_url', 'prompt'],
    },
  },
  {
    name: 'get_image_status',
    description: 'Check status of an image generation, upscale, or background removal job.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job ID returned by generate_image, upscale_image, upscale_video, remove_background, or outpaint_image' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'upscale_image',
    description: 'Upscale an image 4x using Real-ESRGAN AI.',
    inputSchema: {
      type: 'object',
      properties: {
        image_url: { type: 'string', description: 'URL of the image to upscale' },
      },
      required: ['image_url'],
    },
  },
  {
    name: 'upscale_video',
    description: 'Upscale a video to higher resolution using AI.',
    inputSchema: {
      type: 'object',
      properties: {
        video_url: { type: 'string', description: 'URL of the video to upscale' },
      },
      required: ['video_url'],
    },
  },
  {
    name: 'remove_background',
    description: 'Remove the background from an image using Google Gemini Image.',
    inputSchema: {
      type: 'object',
      properties: {
        image_url: { type: 'string', description: 'URL of the image' },
      },
      required: ['image_url'],
    },
  },
  {
    name: 'outpaint_image',
    description: 'Extend an image beyond its borders using Google Gemini Image (outpainting).',
    inputSchema: {
      type: 'object',
      properties: {
        image_url: { type: 'string', description: 'URL of the image to extend' },
        prompt: { type: 'string', description: 'What to generate in the extended area' },
        direction: { type: 'string', description: 'all, left, right, up, down', default: 'all' },
      },
      required: ['image_url', 'prompt'],
    },
  },
  {
    name: 'media_import_url',
    description: 'Import a media file from a public URL for use as reference in generation.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Public URL of the media file' },
        type: { type: 'string', description: 'image or video', default: 'image' },
      },
      required: ['url'],
    },
  },
  {
    name: 'show_medias',
    description: 'List imported media files.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 10 },
        type: { type: 'string', description: 'image or video' },
      },
    },
  },
  {
    name: 'models_explore',
    description: 'Explore all available Google AI models and their capabilities.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Filter by type: video, image' },
      },
    },
  },
  {
    name: 'presets_show',
    description: 'Show available style presets and camera motions.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'show_reference_elements',
    description: 'Show all reference elements, styles, aspect ratios and models.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'show_characters',
    description: 'Show AI character tips and how to maintain character consistency.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'virality_predictor',
    description: 'Predict viral potential of a video concept. Returns score, hook strength, engagement prediction and optimization tips.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Video concept or script to analyze' },
        platform: { type: 'string', description: 'tiktok, instagram, youtube, twitter', default: 'tiktok' },
        niche: { type: 'string', description: 'Content niche (fitness, cooking, tech, comedy, etc.)' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'video_analysis_create',
    description: 'Analyze a video for quality, content and engagement insights.',
    inputSchema: {
      type: 'object',
      properties: {
        video_url: { type: 'string', description: 'Public URL of the video' },
        analysis_type: { type: 'string', description: 'quality, content, engagement, or all', default: 'all' },
      },
      required: ['video_url'],
    },
  },
  {
    name: 'video_analysis_status',
    description: 'Check status of a video analysis job.',
    inputSchema: {
      type: 'object',
      properties: {
        analysis_id: { type: 'string', description: 'ID returned by video_analysis_create' },
      },
      required: ['analysis_id'],
    },
  },
  {
    name: 'generate_video_with_references',
    description: 'Generate a PingTop-style video by first creating a reference image with Google Imagen (hand holding phone in a location, app UI on screen), then animating it with Google Veo.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Main video description (what happens in the video)' },
        location_description: { type: 'string', description: 'Location/background — e.g. "busy café interior, warm light, people in background". Defaults to urban street.' },
        duration: { type: 'integer', description: 'Video duration in seconds (4, 6 or 8)', default: 8 },
        model: { type: 'string', description: 'Veo model to animate with', default: DEFAULT_VIDEO_MODEL },
      },
      required: ['prompt'],
    },
  },
];

// ─── Replicate upscaling helpers ──────────────────────────────────────────────
// Upscaling is post-processing, not generation — Google has no equivalent API here,
// so Replicate is kept for this single purpose.

async function replicateCreate(token: string, model: string, input: Record<string, unknown>): Promise<string> {
  const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Prefer': 'respond-async' },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) throw new Error(`Replicate error ${res.status}: ${await res.text()}`);
  const data = await res.json() as Record<string, unknown>;
  return String(data.id || '');
}

async function replicatePoll(token: string, predId: string, maxAttempts = 60): Promise<{ status: string; output: unknown; error: string | null }> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`https://api.replicate.com/v1/predictions/${predId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) continue;
    const data = await res.json() as Record<string, unknown>;
    const status = String(data.status || '');
    if (status === 'succeeded') return { status: 'completed', output: data.output, error: null };
    if (status === 'failed' || status === 'canceled') return { status: 'failed', output: null, error: String(data.error || 'Failed') };
  }
  return { status: 'timeout', output: null, error: 'Timed out after 3 minutes' };
}

async function runUpscaleJob(
  db: Firestore, env: Env, jobId: string,
  model: string, input: Record<string, unknown>,
): Promise<void> {
  const token = env.REPLICATE_API_TOKEN || '';
  try {
    const predId = await replicateCreate(token, model, input);
    await db.upsertWithTransforms('image_jobs', jobId, { replicateId: predId, status: 'processing' }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);

    const result = await replicatePoll(token, predId);
    const outputUrl = Array.isArray(result.output) ? String(result.output[0] || '') : String(result.output || '');

    await db.upsertWithTransforms('image_jobs', jobId, {
      status: result.status, resultUrl: outputUrl || null, errorMessage: result.error || null,
    }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.upsertWithTransforms('image_jobs', jobId, { status: 'failed', errorMessage: msg }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);
  }
}

// ─── Google image job helper ──────────────────────────────────────────────────

/** Runs a Google image job — Imagen generation or Gemini editing. */
async function runImageJob(
  db: Firestore, env: Env, jobId: string, userId: string,
  req: { prompt: string; model?: string; aspectRatio?: string; sourceImageUrl?: string },
): Promise<void> {
  try {
    const result = await generateGoogleImage(env, {
      prompt: req.prompt,
      model: req.model,
      aspectRatio: req.aspectRatio,
      sourceImageUrl: req.sourceImageUrl,
      userId,
      jobId,
    });

    await db.upsertWithTransforms('image_jobs', jobId, {
      status: 'completed', resultUrl: result.imageUrl, model: result.model, errorMessage: null,
    }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.upsertWithTransforms('image_jobs', jobId, { status: 'failed', errorMessage: msg }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);
  }
}

// ─── Claude AI helpers ────────────────────────────────────────────────────────

async function analyzeVirality(prompt: string, platform: string, niche: string, apiKey: string): Promise<Record<string, unknown>> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 600,
      system: 'You are an expert viral content strategist. Always respond with valid JSON only, no markdown.',
      messages: [{
        role: 'user',
        content: `Analyze this video concept for viral potential on ${platform}${niche ? ` in the ${niche} niche` : ''}:\n\n"${prompt}"\n\nReturn JSON only:\n{"virality_score":<0-100>,"hook_strength":"<Weak|Moderate|Strong|Viral>","engagement_prediction":"<Low|Medium|High|Very High>","retention_risk":"<High|Medium|Low>","best_posting_time":"<time>","recommended_hashtags":["tag1","tag2","tag3"],"tips":["tip1","tip2","tip3"],"estimated_reach":"<reach>"}`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  const data = await res.json() as { content: Array<{ text: string }> };
  const text = data.content[0]?.text || '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
}

async function runVideoAnalysisBasic(
  db: Firestore, analysisId: string, userId: string,
  videoUrl: string, analysisType: string,
): Promise<void> {
  try {
    const urlLower = videoUrl.toLowerCase();
    const isShort = urlLower.includes('tiktok') || urlLower.includes('reels') || urlLower.includes('shorts');
    const isLong = urlLower.includes('youtube.com/watch') || urlLower.includes('youtu.be');
    const isProfessional = urlLower.includes('vimeo') || urlLower.includes('wistia');

    const result = {
      quality_score: isProfessional ? 85 : isShort ? 72 : 75,
      content_type: isShort ? 'short-form social' : isLong ? 'long-form' : 'standard video',
      engagement_factors: [
        'Consider adding captions (85% watch without sound)',
        'Strong thumbnail increases CTR by up to 30%',
        isShort ? 'Short format maximizes completion rate' : 'Chapter markers help retention',
      ],
      improvement_suggestions: [
        'Add captions for better accessibility and silent viewing',
        'Use a strong hook in the first 3 seconds',
        'Include a clear call-to-action at the end',
      ],
      best_platforms: isShort ? ['TikTok', 'Instagram Reels', 'YouTube Shorts'] : ['YouTube', 'Vimeo', 'LinkedIn'],
      overall_rating: isProfessional ? 'Good' : 'Average',
      summary: 'Basic analysis complete. Add ANTHROPIC_API_KEY for AI-powered deep analysis.',
      note: 'For AI-powered analysis, set ANTHROPIC_API_KEY in Worker secrets.',
    };

    await db.upsertWithTransforms('videoAnalysis', analysisId, { status: 'completed', result }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.upsertWithTransforms('videoAnalysis', analysisId, { status: 'failed', errorMessage: msg }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);
  }
}

async function runVideoAnalysis(
  db: Firestore, analysisId: string, userId: string,
  videoUrl: string, analysisType: string, apiKey: string,
): Promise<void> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 800,
        system: 'You are a video content analyst. Always respond with valid JSON only, no markdown.',
        messages: [{
          role: 'user',
          content: `Analyze this video URL for ${analysisType} insights: ${videoUrl}\n\nReturn JSON only:\n{"quality_score":<0-100>,"content_type":"<type>","engagement_factors":["f1","f2"],"improvement_suggestions":["s1","s2","s3"],"best_platforms":["p1","p2"],"overall_rating":"<Excellent|Good|Average|Poor>","summary":"<1-2 sentences>"}`,
        }],
      }),
    });
    if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
    const data = await res.json() as { content: Array<{ text: string }> };
    const text = data.content[0]?.text || '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    await db.upsertWithTransforms('videoAnalysis', analysisId, { status: 'completed', result }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.upsertWithTransforms('videoAnalysis', analysisId, { status: 'failed', errorMessage: msg }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);
  }
}

// ─── Token auth ───────────────────────────────────────────────────────────────

async function getUserIdFromToken(token: string, db: Firestore): Promise<string | null> {
  const doc = await db.get('mcpTokens', token);
  if (!doc) return null;
  return String(doc.userId || '');
}

// ─── Tool call dispatcher ─────────────────────────────────────────────────────

async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
  db: Firestore,
  env: Env,
  executionCtx: ExecutionContext,
): Promise<unknown> {
  const fakeCtx = { auth: { uid: userId }, db, env, ctx: executionCtx };

  // ── generate_video / motion_control / reframe ─────────────────────────────
  if (toolName === 'generate_video' || toolName === 'motion_control' || toolName === 'reframe') {
    const prompt = String(args.prompt || '').trim();
    if (!prompt) return { error: 'prompt is required' };

    const model = String(args.model || DEFAULT_VIDEO_MODEL);
    if (!VEO_MODEL_IDS.includes(model)) {
      return { error: `Unknown model "${model}". Available: ${VEO_MODEL_IDS.join(', ')}.` };
    }
    const aspectRatio = String(args.aspect_ratio || args.target_aspect_ratio || '9:16');
    const duration = Number(args.duration || 8);
    const style = String(args.style || 'Cinematic');

    // Unvalidated values reach the prompt verbatim, so a typo would silently
    // become a nonsense camera instruction rather than an error.
    const cameraMotion = String(args.camera_motion || 'Static');
    const allowedMotions = CAMERA_MOTIONS.map((m) => m.id);
    if (!allowedMotions.includes(cameraMotion)) {
      return { error: `Unknown camera_motion "${cameraMotion}". Available: ${allowedMotions.join(', ')}.` };
    }

    const referenceImageUrl = args.reference_image_url ? String(args.reference_image_url) : undefined;

    try {
      await checkRateLimit(fakeCtx, userId);
    } catch (e) {
      if (e instanceof Error && e.message.includes('Превышен лимит')) return { error: e.message };
      return { error: `rate_limit_failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    const generationId = crypto.randomUUID().replace(/-/g, '');
    const req = {
      generationId, userId, prompt, modelId: model,
      mode: referenceImageUrl ? 'image_to_video' : 'text_to_video',
      aspectRatio, duration, stylePreset: style, cameraMotion, referenceImageUrl,
    };

    // Veo is long-running: start the operation now, poll it from get_video_status.
    let operationName: string;
    let vertexModel: string;
    try {
      const started = await startVeoOperation(env, req);
      operationName = started.operationName;
      vertexModel = started.vertexModel;
    } catch (e) {
      return { error: `veo_create_failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    try {
      await db.upsertWithTransforms('video_generations', generationId, {
        ...req, status: 'processing', source: 'mcp',
        provider: MODEL_TO_PROVIDER[model] || 'veo',
        veoOperationName: operationName, veoVertexModel: vertexModel,
      }, [{ field: 'createdAt', type: 'serverTimestamp' }, { field: 'updatedAt', type: 'serverTimestamp' }]);
    } catch (e) {
      return { error: `firestore_write_failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    return {
      generation_id: generationId, status: 'processing', model,
      message: `Video generation started! Use get_video_status("${generationId}") to check progress. Usually 1-3 minutes.`,
    };
  }

  // ── get_video_status ──────────────────────────────────────────────────────
  if (toolName === 'get_video_status') {
    const gid = String(args.generation_id || '');
    if (!gid) return { error: 'generation_id is required' };
    const doc = await db.get('video_generations', gid);
    if (!doc || doc.userId !== userId) return { error: 'Generation not found' };

    // If still processing, poll the Veo operation right now
    if (doc.status === 'processing' && doc.veoOperationName && doc.veoVertexModel) {
      try {
        const result = await checkVeoOperation(
          env,
          String(doc.veoVertexModel),
          String(doc.veoOperationName),
          { userId, generationId: gid },
        );

        if (result.status !== 'processing') {
          await db.upsertWithTransforms('video_generations', gid, {
            status: result.status,
            resultVideoUrl: result.videoUrl || null,
            resultStoragePath: result.storagePath || null,
            errorMessage: result.error || null,
          }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);

          return {
            generation_id: gid, status: result.status, model: doc.modelId,
            prompt: String(doc.prompt || '').slice(0, 200),
            video_url: result.videoUrl || null,
            error_message: result.error || null,
          };
        }
      } catch { /* fall through — return cached processing status */ }
    }

    return {
      generation_id: gid, status: doc.status, model: doc.modelId,
      prompt: String(doc.prompt || '').slice(0, 200),
      video_url: doc.resultVideoUrl || null,
      error_message: doc.errorMessage || null,
    };
  }

  // ── show_generations ──────────────────────────────────────────────────────
  if (toolName === 'show_generations') {
    const limit = Math.min(Number(args.limit || 10), 20);
    const docs = await db.query('video_generations', [{ field: 'userId', op: 'EQUAL', value: userId }]);
    const filtered = args.status ? docs.filter((d) => d.data.status === args.status) : docs;
    return {
      generations: filtered.slice(0, limit).map((d) => ({
        generation_id: d.id, status: d.data.status, model: d.data.modelId,
        prompt: String(d.data.prompt || '').slice(0, 100),
        video_url: d.data.resultVideoUrl || null,
      })),
      total: filtered.length,
    };
  }

  // ── generate_image ────────────────────────────────────────────────────────
  if (toolName === 'generate_image') {
    const prompt = String(args.prompt || '').trim();
    if (!prompt) return { error: 'prompt is required' };

    const model = String(args.model || DEFAULT_IMAGE_MODEL);
    if (!IMAGE_MODEL_IDS.includes(model)) {
      return { error: `Unknown image model "${model}". Available: ${IMAGE_MODEL_IDS.join(', ')}.` };
    }

    const aspectRatio = String(args.aspect_ratio || '1:1');
    const jobId = crypto.randomUUID().replace(/-/g, '');

    await db.upsertWithTransforms('image_jobs', jobId, {
      userId, type: 'generate_image', prompt, model, aspectRatio, status: 'processing',
    }, [{ field: 'createdAt', type: 'serverTimestamp' }, { field: 'updatedAt', type: 'serverTimestamp' }]);

    executionCtx.waitUntil(
      runImageJob(db, env, jobId, userId, { prompt, model, aspectRatio }),
    );

    return {
      job_id: jobId, status: 'processing', model,
      message: `Image generation started! Use get_image_status("${jobId}") to check. Usually 10-30 seconds.`,
    };
  }

  // ── edit_image ────────────────────────────────────────────────────────────
  if (toolName === 'edit_image') {
    const imageUrl = String(args.image_url || '');
    const prompt = String(args.prompt || '').trim();
    if (!imageUrl || !prompt) return { error: 'image_url and prompt are required' };

    const jobId = crypto.randomUUID().replace(/-/g, '');
    await db.upsertWithTransforms('image_jobs', jobId, {
      userId, type: 'edit_image', sourceUrl: imageUrl, prompt, model: 'gemini-image', status: 'processing',
    }, [{ field: 'createdAt', type: 'serverTimestamp' }, { field: 'updatedAt', type: 'serverTimestamp' }]);

    executionCtx.waitUntil(
      runImageJob(db, env, jobId, userId, { prompt, sourceImageUrl: imageUrl }),
    );

    return {
      job_id: jobId, status: 'processing', model: 'gemini-image',
      message: `Image editing started! Use get_image_status("${jobId}") to check.`,
    };
  }

  // ── get_image_status ──────────────────────────────────────────────────────
  if (toolName === 'get_image_status') {
    const jobId = String(args.job_id || '');
    if (!jobId) return { error: 'job_id is required' };
    const doc = await db.get('image_jobs', jobId);
    if (!doc || doc.userId !== userId) return { error: 'Job not found' };
    return {
      job_id: jobId, type: doc.type, status: doc.status,
      result_url: doc.resultUrl || null, error_message: doc.errorMessage || null,
    };
  }

  // ── upscale_image ─────────────────────────────────────────────────────────
  if (toolName === 'upscale_image') {
    const imageUrl = String(args.image_url || '');
    if (!imageUrl) return { error: 'image_url is required' };
    if (!env.REPLICATE_API_TOKEN) return { error: 'Upscale requires REPLICATE_API_TOKEN.' };

    const jobId = crypto.randomUUID().replace(/-/g, '');
    await db.upsertWithTransforms('image_jobs', jobId, {
      userId, type: 'upscale_image', sourceUrl: imageUrl, status: 'processing',
    }, [{ field: 'createdAt', type: 'serverTimestamp' }, { field: 'updatedAt', type: 'serverTimestamp' }]);

    executionCtx.waitUntil(
      runUpscaleJob(db, env, jobId, 'nightmareai/real-esrgan', { image: imageUrl, scale: 4, face_enhance: false }),
    );

    return {
      job_id: jobId, status: 'processing',
      message: `Upscaling started! Use get_image_status("${jobId}") to check. Usually 30-60 seconds.`,
    };
  }

  // ── upscale_video ─────────────────────────────────────────────────────────
  if (toolName === 'upscale_video') {
    const videoUrl = String(args.video_url || '');
    if (!videoUrl) return { error: 'video_url is required' };
    if (!env.REPLICATE_API_TOKEN) return { error: 'Upscale video requires REPLICATE_API_TOKEN.' };

    const jobId = crypto.randomUUID().replace(/-/g, '');
    await db.upsertWithTransforms('image_jobs', jobId, {
      userId, type: 'upscale_video', sourceUrl: videoUrl, status: 'processing',
    }, [{ field: 'createdAt', type: 'serverTimestamp' }, { field: 'updatedAt', type: 'serverTimestamp' }]);

    executionCtx.waitUntil(
      runUpscaleJob(db, env, jobId, 'lucataco/real-esrgan-video', { video_path: videoUrl, scale: 2 }),
    );

    return {
      job_id: jobId, status: 'processing',
      message: `Video upscaling started! Use get_image_status("${jobId}") to check. Usually 2-5 minutes.`,
    };
  }

  // ── remove_background ─────────────────────────────────────────────────────
  if (toolName === 'remove_background') {
    const imageUrl = String(args.image_url || '');
    if (!imageUrl) return { error: 'image_url is required' };

    const jobId = crypto.randomUUID().replace(/-/g, '');
    await db.upsertWithTransforms('image_jobs', jobId, {
      userId, type: 'remove_background', sourceUrl: imageUrl, model: 'gemini-image', status: 'processing',
    }, [{ field: 'createdAt', type: 'serverTimestamp' }, { field: 'updatedAt', type: 'serverTimestamp' }]);

    executionCtx.waitUntil(
      runImageJob(db, env, jobId, userId, {
        prompt: 'Remove the background completely, keeping only the main subject with clean edges on a transparent background. Do not alter the subject itself.',
        sourceImageUrl: imageUrl,
      }),
    );

    return {
      job_id: jobId, status: 'processing',
      message: `Background removal started! Use get_image_status("${jobId}") to check. Usually 10-20 seconds.`,
    };
  }

  // ── outpaint_image ────────────────────────────────────────────────────────
  if (toolName === 'outpaint_image') {
    const imageUrl = String(args.image_url || '');
    const prompt = String(args.prompt || '').trim();
    if (!imageUrl || !prompt) return { error: 'image_url and prompt are required' };

    const direction = String(args.direction || 'all');
    const jobId = crypto.randomUUID().replace(/-/g, '');
    await db.upsertWithTransforms('image_jobs', jobId, {
      userId, type: 'outpaint_image', sourceUrl: imageUrl, prompt, direction, model: 'gemini-image', status: 'processing',
    }, [{ field: 'createdAt', type: 'serverTimestamp' }, { field: 'updatedAt', type: 'serverTimestamp' }]);

    executionCtx.waitUntil(
      runImageJob(db, env, jobId, userId, {
        prompt: `Extend this image outward${direction === 'all' ? ' on all sides' : ` towards the ${direction}`}, seamlessly continuing the existing scene. In the newly generated area: ${prompt}. Keep the original content unchanged and match lighting, perspective and style.`,
        sourceImageUrl: imageUrl,
      }),
    );

    return {
      job_id: jobId, status: 'processing',
      message: `Outpainting started! Use get_image_status("${jobId}") to check.`,
    };
  }

  // ── media_import_url ──────────────────────────────────────────────────────
  if (toolName === 'media_import_url') {
    const url = String(args.url || '');
    if (!url) return { error: 'url is required' };
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (!res.ok) return { error: `Cannot access URL (${res.status}). Make sure it is publicly accessible.` };
      const ct = res.headers.get('content-type') || '';
      const mediaType = ct.startsWith('video/') ? 'video' : 'image';
      const mediaId = crypto.randomUUID().replace(/-/g, '');
      await db.upsertWithTransforms('userMedia', `${userId}_${mediaId}`, {
        userId, url, type: mediaType, status: 'imported',
      }, [{ field: 'importedAt', type: 'serverTimestamp' }]);
      return {
        media_id: mediaId, url, type: mediaType, status: 'imported',
        message: `Imported. Use this URL as reference_image_url in generate_video: "${url}"`,
      };
    } catch {
      return { error: 'Failed to access URL. Make sure it is publicly accessible.' };
    }
  }

  // ── show_medias ───────────────────────────────────────────────────────────
  if (toolName === 'show_medias') {
    const limit = Math.min(Number(args.limit || 10), 20);
    const docs = await db.query('userMedia', [{ field: 'userId', op: 'EQUAL', value: userId }]);
    const filtered = args.type ? docs.filter((d) => d.data.type === args.type) : docs;
    return {
      medias: filtered.slice(0, limit).map((d) => ({ id: d.id, url: d.data.url, type: d.data.type })),
      total: filtered.length,
    };
  }

  // ── models_explore ────────────────────────────────────────────────────────
  if (toolName === 'models_explore') {
    const typeFilter = args.type ? String(args.type) : null;
    const models = typeFilter ? MODEL_CATALOG.filter((m) => m.type === typeFilter) : MODEL_CATALOG;
    return { models, total: models.length };
  }

  // ── presets_show ──────────────────────────────────────────────────────────
  if (toolName === 'presets_show') {
    return { style_presets: STYLE_PRESETS, camera_motions: CAMERA_MOTIONS };
  }

  // ── show_reference_elements ───────────────────────────────────────────────
  if (toolName === 'show_reference_elements') {
    return {
      style_presets: STYLE_PRESETS, camera_motions: CAMERA_MOTIONS,
      aspect_ratios: ['16:9', '9:16'],
      durations_seconds: [4, 6, 8],
      modes: ['text_to_video', 'image_to_video'],
      video_models: MODEL_CATALOG.filter((m) => m.type === 'video'),
      image_models: MODEL_CATALOG.filter((m) => m.type === 'image'),
    };
  }

  // ── show_characters ───────────────────────────────────────────────────────
  if (toolName === 'show_characters') {
    return {
      tip: 'Use a consistent reference image to maintain character identity across videos.',
      how_to_use: [
        '1. Generate a character portrait with generate_image (Google Imagen)',
        '2. Reuse the returned URL as reference_image_url in generate_video',
        '3. Use edit_image (Gemini Image) to restyle the same character without losing identity',
        '4. Use similar prompts each time for consistency',
      ],
      example: {
        prompt: 'A young woman with red hair walking through a forest',
        reference_image_url: 'https://your-character-portrait.jpg',
        model: DEFAULT_VIDEO_MODEL,
        camera_motion: 'Dolly in',
      },
    };
  }

  // ── virality_predictor ────────────────────────────────────────────────────
  if (toolName === 'virality_predictor') {
    const prompt = String(args.prompt || '').trim();
    if (!prompt) return { error: 'prompt is required' };
    const platform = String(args.platform || 'tiktok');
    const niche = String(args.niche || '');

    if (env.ANTHROPIC_API_KEY) {
      try {
        const analysis = await analyzeVirality(prompt, platform, niche, env.ANTHROPIC_API_KEY);
        return { platform, niche: niche || 'general', ...analysis };
      } catch { /* fall through */ }
    }

    // Rule-based fallback when no API key
    const hasHook = /^(how|why|what|watch|stop|wait|this|the secret|i tried)/i.test(prompt);
    const hasEmotion = /(amazing|shocking|insane|crazy|unbelievable|satisfying|beautiful)/i.test(prompt);
    const score = Math.min(50 + (hasHook ? 20 : 0) + (hasEmotion ? 15 : 0) + (niche ? 10 : 0), 95);
    return {
      platform, niche: niche || 'general',
      virality_score: score,
      hook_strength: hasHook ? 'Strong' : 'Moderate',
      engagement_prediction: score > 70 ? 'High' : 'Medium',
      retention_risk: hasHook ? 'Low' : 'Medium',
      tips: [
        'Start with a strong hook in the first 3 seconds',
        'Add captions (85% watch without sound)',
        `Optimal length for ${platform}: ${platform === 'tiktok' ? '15-30s' : platform === 'youtube' ? '60-90s' : '30-60s'}`,
        'End with a clear call-to-action',
      ],
      note: env.ANTHROPIC_API_KEY ? undefined : 'Set ANTHROPIC_API_KEY for AI-powered analysis',
    };
  }

  // ── video_analysis_create ─────────────────────────────────────────────────
  if (toolName === 'video_analysis_create') {
    const videoUrl = String(args.video_url || '');
    if (!videoUrl) return { error: 'video_url is required' };

    const analysisId = crypto.randomUUID().replace(/-/g, '');
    const analysisType = String(args.analysis_type || 'all');

    await db.upsertWithTransforms('videoAnalysis', analysisId, {
      userId, videoUrl, analysisType, status: 'processing',
    }, [{ field: 'createdAt', type: 'serverTimestamp' }, { field: 'updatedAt', type: 'serverTimestamp' }]);

    // Use Anthropic if available, otherwise do URL-based analysis
    const analysisFn = env.ANTHROPIC_API_KEY
      ? runVideoAnalysis(db, analysisId, userId, videoUrl, analysisType, env.ANTHROPIC_API_KEY)
      : runVideoAnalysisBasic(db, analysisId, userId, videoUrl, analysisType);

    executionCtx.waitUntil(analysisFn);

    return {
      analysis_id: analysisId, status: 'processing',
      message: `Analysis started! Use video_analysis_status("${analysisId}") to check. Usually 10-20 seconds.`,
    };
  }

  // ── video_analysis_status ─────────────────────────────────────────────────
  if (toolName === 'video_analysis_status') {
    const analysisId = String(args.analysis_id || '');
    if (!analysisId) return { error: 'analysis_id is required' };
    const doc = await db.get('videoAnalysis', analysisId);
    if (!doc || doc.userId !== userId) return { error: 'Analysis not found' };
    return { analysis_id: analysisId, status: doc.status, video_url: doc.videoUrl, result: doc.result || null };
  }

  // ── generate_video_with_references ───────────────────────────────────────
  if (toolName === 'generate_video_with_references') {
    const prompt = String(args.prompt || '').trim();
    if (!prompt) return { error: 'prompt is required' };

    const videoModel = String(args.model || DEFAULT_VIDEO_MODEL);
    if (!VEO_MODEL_IDS.includes(videoModel)) {
      return { error: `Unknown model "${videoModel}". Available: ${VEO_MODEL_IDS.join(', ')}.` };
    }

    const locationDescription = String(args.location_description || 'busy urban street, warm sunlight, people walking in background, modern city');
    const duration = Number(args.duration || 8);

    try {
      await checkRateLimit(fakeCtx, userId);
    } catch (e) {
      if (e instanceof Error && e.message.includes('Превышен лимит')) return { error: e.message };
      return { error: `rate_limit_failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    // STEP 1 — Build one composed reference frame with Google Imagen.
    // Veo takes a single starting image, so the hand, location and app UI are
    // described together in one Imagen prompt instead of three separate images.
    const referenceJobId = crypto.randomUUID().replace(/-/g, '');
    const referencePrompt = [
      'Photorealistic vertical shot: a close-up of a human hand holding a modern smartphone with a relaxed natural grip.',
      `Background: ${locationDescription}.`,
      'On the phone screen: a mobile social video feed UI — grid of short video thumbnails, circular profile pictures, a live streaming badge, amber and white colour scheme, clean modern design (PingTop social video platform).',
      'Warm soft lighting, shallow depth of field, no text overlays.',
    ].join(' ');

    let referenceImageUrl: string;
    try {
      const image = await generateGoogleImage(env, {
        prompt: referencePrompt,
        model: DEFAULT_IMAGE_MODEL,
        aspectRatio: '9:16',
        userId,
        jobId: referenceJobId,
      });
      referenceImageUrl = image.imageUrl;
    } catch (e) {
      return { error: `imagen_reference_failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    // STEP 2 — Animate the reference frame with Veo
    const generationId = crypto.randomUUID().replace(/-/g, '');
    const enrichedPrompt = `${prompt}. The hand holds the phone steadily, the app interface stays visible on screen, the background stays consistent.`;

    const veoReq = {
      generationId, userId, prompt, enrichedPrompt,
      modelId: videoModel, mode: 'image_to_video',
      aspectRatio: '9:16', duration,
      stylePreset: 'Cinematic', cameraMotion: 'Static',
      referenceImageUrl,
    };

    let operationName: string;
    let vertexModel: string;
    try {
      const started = await startVeoOperation(env, veoReq);
      operationName = started.operationName;
      vertexModel = started.vertexModel;
    } catch (e) {
      return { error: `veo_create_failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    // STEP 3 — Persist and return generation_id (status polled via get_video_status)
    try {
      await db.upsertWithTransforms('video_generations', generationId, {
        ...veoReq, status: 'processing', source: 'mcp',
        provider: 'veo',
        veoOperationName: operationName, veoVertexModel: vertexModel,
        referenceImages: [referenceImageUrl],
      }, [{ field: 'createdAt', type: 'serverTimestamp' }, { field: 'updatedAt', type: 'serverTimestamp' }]);
    } catch (e) {
      return { error: `firestore_write_failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    return {
      generation_id: generationId,
      status: 'processing',
      model: videoModel,
      reference_images: [referenceImageUrl],
      message: `Video generation started from a Google Imagen reference frame! Use get_video_status("${generationId}") to check progress. Usually 1-3 minutes.`,
    };
  }

  return { error: `Unknown tool: ${toolName}` };
}

// ─── SSE / HTTP transport ─────────────────────────────────────────────────────

export async function handleMcp(request: Request, db: Firestore, env: Env, executionCtx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  if (!token) return new Response('Missing token', { status: 401 });

  const userId = await getUserIdFromToken(token, db);
  if (!userId) return new Response('Invalid or expired token', { status: 401 });

  const subpath = url.pathname.replace(/.*\/mcp\/?/, '');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  // GET /mcp or GET /mcp/sse → SSE stream
  if (request.method === 'GET' && (!subpath || subpath === 'sse')) {
    const messageUrl = `${url.origin}/mcp/message?token=${token}`;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`event: endpoint\ndata: ${messageUrl}\n\n`));
        const timer = setInterval(() => {
          try { controller.enqueue(new TextEncoder().encode(': ping\n\n')); } catch { clearInterval(timer); }
        }, 20000);
        setTimeout(() => { clearInterval(timer); try { controller.close(); } catch { /* */ } }, 300000);
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
        'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // POST /mcp or POST /mcp/message → JSON-RPC (supports both SSE and Streamable HTTP transport)
  if (request.method === 'POST' && (!subpath || subpath === 'message')) {
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return new Response('Invalid JSON', { status: 400 }); }

    const id = body.id;
    const method = String(body.method || '');
    const params = (body.params || {}) as Record<string, unknown>;

    const ok = (result: unknown) => Response.json({ jsonrpc: '2.0', id, result }, { headers: { 'Access-Control-Allow-Origin': '*' } });
    const err = (code: number, message: string) => Response.json({ jsonrpc: '2.0', id, error: { code, message } }, { headers: { 'Access-Control-Allow-Origin': '*' } });

    if (method === 'initialize') {
      return ok({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'video-studio-mcp', version: '3.0.0' } });
    }
    if (method === 'notifications/initialized' || method === 'ping') return ok({});
    if (method === 'tools/list') return ok({ tools: TOOLS });

    if (method === 'tools/call') {
      const toolName = String((params as Record<string, string>).name || '');
      const toolArgs = ((params as Record<string, Record<string, unknown>>).arguments || {}) as Record<string, unknown>;
      try {
        const result = await handleToolCall(toolName, toolArgs, userId, db, env, executionCtx);
        return ok({ content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return ok({ content: [{ type: 'text', text: `Tool error: ${msg}` }], isError: true });
      }
    }

    return err(-32601, `Method not found: ${method}`);
  }

  return new Response('Not found', { status: 404 });
}
