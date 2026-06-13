import { Firestore } from './firestore';
import { HttpsError } from './types';
import type { Env } from './types';
import { generateVideo, createReplicatePrediction, checkReplicatePrediction } from './providers';
import { ensureUserCredits, deductCredits, checkRateLimit } from './handlers/credits';

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL_CATALOG = [
  { id: 'seedance-2', name: 'Seedance 2.0 (ByteDance)', type: 'video', credits: 25, status: 'ready', description: 'Best quality, up to 15s, built-in audio, 720p — default' },
  { id: 'seedance-2-i2v', name: 'Seedance 2.0 I2V', type: 'video', credits: 25, status: 'ready', description: 'Image-to-video with audio, 720p' },
  { id: 'replicate-wan-t2v', name: 'MiniMax Video-01', type: 'video', credits: 10, status: 'ready', description: 'Fast text-to-video, 6s' },
  { id: 'replicate-wan-i2v', name: 'MiniMax Video-01 I2V', type: 'video', credits: 10, status: 'ready', description: 'Fast image-to-video, 6s' },
  { id: 'replicate-kling', name: 'HunyuanVideo', type: 'video', credits: 20, status: 'ready', description: 'High quality video by Tencent' },
  { id: 'replicate-luma', name: 'MiniMax Video-01 Live', type: 'video', credits: 15, status: 'ready', description: 'Animated/Live2D video' },
  { id: 'wavespeed-wan', name: 'WaveSpeed WAN 2.1 T2V', type: 'video', credits: 10, status: 'needs_key', description: 'Ultra-fast — needs WAVESPEED_API_KEY' },
  { id: 'wavespeed-wan-i2v', name: 'WaveSpeed WAN 2.1 I2V', type: 'video', credits: 10, status: 'needs_key', description: 'Ultra-fast image-to-video — needs WAVESPEED_API_KEY' },
  { id: 'seedance-2', name: 'Seedance 2.0', type: 'video', credits: 25, status: 'needs_key', description: 'Best quality, up to 15s — needs SEEDANCE_API_KEY' },
  { id: 'seedance-2-fast', name: 'Seedance 2.0 Fast', type: 'video', credits: 15, status: 'needs_key', description: 'Fast Seedance — needs SEEDANCE_API_KEY' },
  { id: 'ltx-fast', name: 'LTX Video', type: 'video', credits: 5, status: 'needs_key', description: 'Lightweight — needs HUGGINGFACE_API_TOKEN' },
  { id: 'flux-schnell', name: 'FLUX Schnell', type: 'image', credits: 2, status: 'ready', description: 'Fast image generation via Pollinations — works now' },
  { id: 'flux-dev', name: 'FLUX Dev', type: 'image', credits: 5, status: 'ready', description: 'High quality image via Replicate — works now' },
];

const IMAGE_CREDITS: Record<string, number> = {
  generate_image: 2,
  upscale_image: 5,
  upscale_video: 15,
  remove_background: 3,
  outpaint_image: 5,
  video_analysis: 5,
};

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
  'wavespeed-wan': 'wavespeed', 'wavespeed-wan-i2v': 'wavespeed',
  'seedance-2': 'replicate', 'seedance-2-i2v': 'replicate', 'seedance-2-fast': 'seedance',
  'replicate-wan-t2v': 'replicate', 'replicate-wan-i2v': 'replicate',
  'replicate-kling': 'replicate', 'replicate-luma': 'replicate',
  'huggingface-cogvideox': 'huggingface', 'ltx-fast': 'huggingface', 'svd': 'huggingface',
};

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'generate_video',
    description: 'Generate a video from text prompt or reference image using AI models.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Text description of the video' },
        model: { type: 'string', description: 'Model: seedance-2 (default, best quality + audio), seedance-2-i2v (image-to-video), replicate-wan-t2v (fast), replicate-kling (cinematic)', default: 'seedance-2' },
        aspect_ratio: { type: 'string', description: '9:16, 16:9, 1:1, 3:4, 4:3, 21:9, adaptive', default: '9:16' },
        duration: { type: 'number', description: 'Duration in seconds: 5, 10, or 15', default: 5 },
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
        model: { type: 'string', default: 'seedance-2' },
        aspect_ratio: { type: 'string', default: '16:9' },
        duration: { type: 'number', default: 5 },
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
        target_aspect_ratio: { type: 'string', description: '16:9, 9:16, 1:1' },
        model: { type: 'string', default: 'wavespeed-wan' },
        style: { type: 'string', default: 'Cinematic' },
      },
      required: ['prompt', 'target_aspect_ratio'],
    },
  },
  {
    name: 'generate_image',
    description: 'Generate an image from a text prompt using FLUX AI.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Description of the image' },
        aspect_ratio: { type: 'string', description: '1:1, 16:9, 9:16, 4:3', default: '1:1' },
        quality: { type: 'string', description: 'fast (FLUX Schnell, 2 credits) or high (FLUX Dev, 5 credits)', default: 'fast' },
      },
      required: ['prompt'],
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
    description: 'Remove background from an image using AI.',
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
    description: 'Extend image beyond its borders using AI (outpainting).',
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
    name: 'balance',
    description: 'Check current credit balance.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'show_plans_and_credits',
    description: 'Show available plans, credit costs per operation, and current balance.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'transactions',
    description: 'Show recent credit transactions.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', default: 10 } },
    },
  },
  {
    name: 'models_explore',
    description: 'Explore all available AI models with capabilities and credit costs.',
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
    name: 'recharge_credits',
    description: 'Add credits to your own account (owner-only, protected by MCP token). Use this when your balance is low.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'integer', description: 'Credits to add (1–10000)', default: 1000 },
      },
    },
  },
  {
    name: 'generate_video_with_references',
    description: 'Generate a PingTop-style video by first creating 3 reference images via Flux Schnell (hand holding phone, location, app UI), then sending them to Seedance 2.0 for consistent realistic video. Credits: 31 total (6 images + 25 video).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Main video description (what happens in the video)' },
        location_description: { type: 'string', description: 'Location/background for Image2 — e.g. "busy café interior, warm light, people in background". Defaults to urban street.' },
        duration: { type: 'integer', description: 'Video duration in seconds (1-15)', default: 5 },
      },
      required: ['prompt'],
    },
  },
];

// ─── Replicate helpers ────────────────────────────────────────────────────────

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

async function runImageJob(
  db: Firestore, env: Env, jobId: string, userId: string,
  model: string, input: Record<string, unknown>, creditType: string,
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

    if (result.status === 'completed') {
      const cost = IMAGE_CREDITS[creditType] || 2;
      await db.runTransaction(async (tx) => {
        const snap = await tx.get('users', userId);
        const balanceBefore = Number(snap?.credits || 0);
        const balanceAfter = Math.max(0, balanceBefore - cost);
        tx.setWithTransforms('users', userId, { credits: balanceAfter }, [{ field: 'creditsUpdatedAt', type: 'serverTimestamp' }]);
        tx.setWithTransforms('creditLogs', crypto.randomUUID().replace(/-/g, ''), {
          userId, type: 'deduction', amount: -cost, description: `Image job: ${creditType}`,
          balanceBefore, balanceAfter,
        }, [{ field: 'createdAt', type: 'serverTimestamp' }]);
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.upsertWithTransforms('image_jobs', jobId, { status: 'failed', errorMessage: msg }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);
  }
}

// ─── Video generation helper ──────────────────────────────────────────────────

async function runVideoJob(
  db: Firestore, env: Env,
  generationId: string, userId: string,
  req: {
    generationId: string; prompt: string; enrichedPrompt?: string;
    modelId: string; mode: string; aspectRatio: string; duration: number;
    stylePreset?: string; cameraMotion?: string; referenceImageUrl?: string;
  },
): Promise<void> {
  const fakeCtx = { auth: { uid: userId }, db, env, ctx: null as unknown as ExecutionContext };
  try {
    const result = await generateVideo(env, req);
    await db.upsertWithTransforms('video_generations', generationId, {
      status: 'completed', resultVideoUrl: result.resultVideoUrl,
      provider: MODEL_TO_PROVIDER[req.modelId] || 'unknown',
    }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);
    await deductCredits(fakeCtx, userId, req.modelId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.upsertWithTransforms('video_generations', generationId, {
      status: 'failed', errorMessage: msg,
    }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);
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

    const cost = IMAGE_CREDITS['video_analysis'] || 5;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get('users', userId);
      const balanceBefore = Number(snap?.credits || 0);
      const balanceAfter = Math.max(0, balanceBefore - cost);
      tx.setWithTransforms('users', userId, { credits: balanceAfter }, [{ field: 'creditsUpdatedAt', type: 'serverTimestamp' }]);
      tx.setWithTransforms('creditLogs', crypto.randomUUID().replace(/-/g, ''), {
        userId, type: 'deduction', amount: -cost, description: 'Video analysis (basic)',
        balanceBefore, balanceAfter,
      }, [{ field: 'createdAt', type: 'serverTimestamp' }]);
    });
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

    const cost = IMAGE_CREDITS['video_analysis'] || 5;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get('users', userId);
      const balanceBefore = Number(snap?.credits || 0);
      const balanceAfter = Math.max(0, balanceBefore - cost);
      tx.setWithTransforms('users', userId, { credits: balanceAfter }, [{ field: 'creditsUpdatedAt', type: 'serverTimestamp' }]);
      tx.setWithTransforms('creditLogs', crypto.randomUUID().replace(/-/g, ''), {
        userId, type: 'deduction', amount: -cost, description: 'Video analysis',
        balanceBefore, balanceAfter,
      }, [{ field: 'createdAt', type: 'serverTimestamp' }]);
    });
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

    const model = String(args.model || (toolName === 'motion_control' ? 'seedance-2' : 'seedance-2'));
    const aspectRatio = String(args.aspect_ratio || args.target_aspect_ratio || '9:16');
    const duration = Number(args.duration || 5);
    const style = String(args.style || 'Cinematic');
    const cameraMotion = String(args.camera_motion || 'Static');
    const referenceImageUrl = args.reference_image_url ? String(args.reference_image_url) : undefined;

    let credits: { ok: boolean; remaining: number; cost: number; reason?: string };
    try {
      credits = await ensureUserCredits(fakeCtx, userId, model);
    } catch (e) {
      return { error: `credits_check_failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!credits.ok) return { error: credits.reason };

    try {
      await checkRateLimit(fakeCtx, userId);
    } catch (e) {
      if (e instanceof Error && e.message.includes('Превышен лимит')) return { error: e.message };
      return { error: `rate_limit_failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    const generationId = crypto.randomUUID().replace(/-/g, '');
    const req = {
      generationId, prompt, modelId: model,
      mode: referenceImageUrl ? 'image_to_video' : 'text_to_video',
      aspectRatio, duration, stylePreset: style, cameraMotion, referenceImageUrl,
    };
    const provider = MODEL_TO_PROVIDER[model] || 'unknown';

    // For Replicate models: create prediction immediately and store predictionId.
    // Status is checked on-demand via get_video_status — no long-running background Worker needed.
    if (provider === 'replicate' && env.REPLICATE_API_TOKEN) {
      let predictionId: string;
      try {
        predictionId = await createReplicatePrediction(String(env.REPLICATE_API_TOKEN), model, req);
      } catch (e) {
        return { error: `replicate_create_failed: ${e instanceof Error ? e.message : String(e)}` };
      }

      try {
        await db.upsertWithTransforms('video_generations', generationId, {
          ...req, userId, status: 'processing', source: 'mcp',
          provider, predictionId,
        }, [{ field: 'createdAt', type: 'serverTimestamp' }, { field: 'updatedAt', type: 'serverTimestamp' }]);
      } catch (e) {
        return { error: `firestore_write_failed: ${e instanceof Error ? e.message : String(e)}` };
      }

      return {
        generation_id: generationId, status: 'processing', model, cost_credits: credits.cost,
        message: `Video generation started! Use get_video_status("${generationId}") to check progress. Usually 1-3 minutes.`,
      };
    }

    // For other providers: use background worker
    try {
      await db.upsertWithTransforms('video_generations', generationId, {
        ...req, userId, status: 'processing', source: 'mcp', provider,
      }, [{ field: 'createdAt', type: 'serverTimestamp' }, { field: 'updatedAt', type: 'serverTimestamp' }]);
    } catch (e) {
      return { error: `firestore_write_failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    executionCtx.waitUntil(runVideoJob(db, env, generationId, userId, req));

    return {
      generation_id: generationId, status: 'processing', model, cost_credits: credits.cost,
      message: `Video generation started! Use get_video_status("${generationId}") to check. Usually 30-120 seconds.`,
    };
  }

  // ── get_video_status ──────────────────────────────────────────────────────
  if (toolName === 'get_video_status') {
    const gid = String(args.generation_id || '');
    if (!gid) return { error: 'generation_id is required' };
    const doc = await db.get('video_generations', gid);
    if (!doc || doc.userId !== userId) return { error: 'Generation not found' };

    // If still processing and has Replicate predictionId, check Replicate right now
    if (doc.status === 'processing' && doc.predictionId && env.REPLICATE_API_TOKEN) {
      try {
        const result = await checkReplicatePrediction(String(env.REPLICATE_API_TOKEN), String(doc.predictionId));
        if (result.status !== 'processing') {
          // Update Firestore with the result
          await db.upsertWithTransforms('video_generations', gid, {
            status: result.status,
            resultVideoUrl: result.videoUrl || null,
            errorMessage: result.error || null,
          }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);

          if (result.status === 'completed') {
            const fakeCtx2 = { auth: { uid: userId }, db, env, ctx: executionCtx };
            await deductCredits(fakeCtx2, userId, String(doc.modelId || 'replicate-wan-t2v'));
          }

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

    const cost = args.quality === 'high' ? 5 : 2;
    const userSnap = await db.get('users', userId);
    if (Number(userSnap?.credits ?? 0) < cost) return { error: `Insufficient credits. Need ${cost}.` };

    const aspectRatio = String(args.aspect_ratio || '1:1');
    const dims: Record<string, [number, number]> = { '1:1': [1024, 1024], '16:9': [1280, 720], '9:16': [720, 1280], '4:3': [1024, 768] };
    const [width, height] = dims[aspectRatio] || [1024, 1024];
    const model = args.quality === 'high' ? 'flux' : 'flux';

    if (env.REPLICATE_API_TOKEN) {
      // Use Replicate for both fast (Flux Schnell) and high (Flux Dev) — avoids Pollinations IP rate limits
      const jobId = crypto.randomUUID().replace(/-/g, '');
      const replicateModel = args.quality === 'high' ? 'black-forest-labs/flux-dev' : 'black-forest-labs/flux-schnell';
      await db.upsertWithTransforms('image_jobs', jobId, {
        userId, type: 'generate_image', prompt, model: replicateModel, aspectRatio, status: 'processing',
      }, [{ field: 'createdAt', type: 'serverTimestamp' }, { field: 'updatedAt', type: 'serverTimestamp' }]);
      executionCtx.waitUntil(
        runImageJob(db, env, jobId, userId, replicateModel, { prompt, num_outputs: 1, aspect_ratio: aspectRatio }, 'generate_image'),
      );
      return { job_id: jobId, status: 'processing', model: replicateModel, cost_credits: cost, message: `Image generation started! Use get_image_status("${jobId}") to check. Usually 10-30 seconds.` };
    }

    // Fallback: Pollinations.ai (no API key) — may hit rate limits on shared IPs
    const encodedPrompt = encodeURIComponent(prompt);
    const seed = Math.floor(Math.random() * 1000000);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=${model}&seed=${seed}&nologo=true&enhance=true`;

    // Deduct credits
    await db.runTransaction(async (tx) => {
      const snap = await tx.get('users', userId);
      const balanceBefore = Number(snap?.credits || 0);
      const balanceAfter = Math.max(0, balanceBefore - cost);
      tx.setWithTransforms('users', userId, { credits: balanceAfter }, [{ field: 'creditsUpdatedAt', type: 'serverTimestamp' }]);
      tx.setWithTransforms('creditLogs', crypto.randomUUID().replace(/-/g, ''), {
        userId, type: 'deduction', amount: -cost, description: 'Image generation (Pollinations)',
        balanceBefore, balanceAfter,
      }, [{ field: 'createdAt', type: 'serverTimestamp' }]);
    });

    return {
      status: 'completed',
      image_url: imageUrl,
      provider: 'pollinations.ai',
      cost_credits: cost,
      width, height,
      note: 'Image URL is ready — open it in a browser or use it as reference_image_url in generate_video. First load may take a few seconds.',
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

    const cost = IMAGE_CREDITS['upscale_image'];
    const userSnap = await db.get('users', userId);
    if (Number(userSnap?.credits ?? 0) < cost) return { error: `Insufficient credits. Need ${cost}.` };

    const jobId = crypto.randomUUID().replace(/-/g, '');
    await db.upsertWithTransforms('image_jobs', jobId, {
      userId, type: 'upscale_image', sourceUrl: imageUrl, status: 'processing',
    }, [{ field: 'createdAt', type: 'serverTimestamp' }, { field: 'updatedAt', type: 'serverTimestamp' }]);

    executionCtx.waitUntil(
      runImageJob(db, env, jobId, userId, 'nightmareai/real-esrgan', { image: imageUrl, scale: 4, face_enhance: false }, 'upscale_image'),
    );

    return {
      job_id: jobId, status: 'processing', cost_credits: cost,
      message: `Upscaling started! Use get_image_status("${jobId}") to check. Usually 30-60 seconds.`,
    };
  }

  // ── upscale_video ─────────────────────────────────────────────────────────
  if (toolName === 'upscale_video') {
    const videoUrl = String(args.video_url || '');
    if (!videoUrl) return { error: 'video_url is required' };
    if (!env.REPLICATE_API_TOKEN) return { error: 'Upscale video requires REPLICATE_API_TOKEN.' };

    const cost = IMAGE_CREDITS['upscale_video'];
    const userSnap = await db.get('users', userId);
    if (Number(userSnap?.credits ?? 0) < cost) return { error: `Insufficient credits. Need ${cost}.` };

    const jobId = crypto.randomUUID().replace(/-/g, '');
    await db.upsertWithTransforms('image_jobs', jobId, {
      userId, type: 'upscale_video', sourceUrl: videoUrl, status: 'processing',
    }, [{ field: 'createdAt', type: 'serverTimestamp' }, { field: 'updatedAt', type: 'serverTimestamp' }]);

    executionCtx.waitUntil(
      runImageJob(db, env, jobId, userId, 'lucataco/real-esrgan-video', { video_path: videoUrl, scale: 2 }, 'upscale_video'),
    );

    return {
      job_id: jobId, status: 'processing', cost_credits: cost,
      message: `Video upscaling started! Use get_image_status("${jobId}") to check. Usually 2-5 minutes.`,
    };
  }

  // ── remove_background ─────────────────────────────────────────────────────
  if (toolName === 'remove_background') {
    const imageUrl = String(args.image_url || '');
    if (!imageUrl) return { error: 'image_url is required' };
    if (!env.REPLICATE_API_TOKEN) return { error: 'Remove background requires REPLICATE_API_TOKEN.' };

    const cost = IMAGE_CREDITS['remove_background'];
    const userSnap = await db.get('users', userId);
    if (Number(userSnap?.credits ?? 0) < cost) return { error: `Insufficient credits. Need ${cost}.` };

    const jobId = crypto.randomUUID().replace(/-/g, '');
    await db.upsertWithTransforms('image_jobs', jobId, {
      userId, type: 'remove_background', sourceUrl: imageUrl, status: 'processing',
    }, [{ field: 'createdAt', type: 'serverTimestamp' }, { field: 'updatedAt', type: 'serverTimestamp' }]);

    executionCtx.waitUntil(
      runImageJob(db, env, jobId, userId, 'lucataco/remove-bg', { image_url: imageUrl }, 'remove_background'),
    );

    return {
      job_id: jobId, status: 'processing', cost_credits: cost,
      message: `Background removal started! Use get_image_status("${jobId}") to check. Usually 10-20 seconds.`,
    };
  }

  // ── outpaint_image ────────────────────────────────────────────────────────
  if (toolName === 'outpaint_image') {
    const imageUrl = String(args.image_url || '');
    const prompt = String(args.prompt || '').trim();
    if (!imageUrl || !prompt) return { error: 'image_url and prompt are required' };
    if (!env.REPLICATE_API_TOKEN) return { error: 'Outpaint requires REPLICATE_API_TOKEN.' };

    const cost = IMAGE_CREDITS['outpaint_image'];
    const userSnap = await db.get('users', userId);
    if (Number(userSnap?.credits ?? 0) < cost) return { error: `Insufficient credits. Need ${cost}.` };

    const jobId = crypto.randomUUID().replace(/-/g, '');
    await db.upsertWithTransforms('image_jobs', jobId, {
      userId, type: 'outpaint_image', sourceUrl: imageUrl, prompt, status: 'processing',
    }, [{ field: 'createdAt', type: 'serverTimestamp' }, { field: 'updatedAt', type: 'serverTimestamp' }]);

    executionCtx.waitUntil(
      runImageJob(db, env, jobId, userId, 'stability-ai/stable-diffusion-inpainting',
        { image: imageUrl, prompt, negative_prompt: 'blurry, low quality', num_outputs: 1 }, 'outpaint_image'),
    );

    return {
      job_id: jobId, status: 'processing', cost_credits: cost,
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

  // ── balance ───────────────────────────────────────────────────────────────
  if (toolName === 'balance') {
    const snap = await db.get('users', userId);
    const credits = Number(snap?.credits ?? 0);
    return { credits, message: `You have ${credits} credits.` };
  }

  // ── show_plans_and_credits ────────────────────────────────────────────────
  if (toolName === 'show_plans_and_credits') {
    const snap = await db.get('users', userId);
    return {
      current_balance: Number(snap?.credits ?? 0),
      credit_costs: {
        'generate_video (ltx-fast, svd)': 5,
        'generate_video (wavespeed-wan, replicate-wan)': 10,
        'generate_video (seedance-2-fast, replicate-luma)': 15,
        'generate_video (replicate-kling)': 20,
        'generate_video (seedance-2 best quality)': 25,
        'generate_image (FLUX Schnell fast)': 2,
        'generate_image (FLUX Dev high quality)': 5,
        'remove_background': 3,
        'upscale_image (4x Real-ESRGAN)': 5,
        'outpaint_image': 5,
        'video_analysis': 5,
        'upscale_video': 15,
      },
      top_up_url: 'https://gp-video-studio.web.app',
      new_users: '100 free credits on signup',
    };
  }

  // ── transactions ──────────────────────────────────────────────────────────
  if (toolName === 'transactions') {
    const limit = Math.min(Number(args.limit || 10), 20);
    const docs = await db.query('creditLogs', [{ field: 'userId', op: 'EQUAL', value: userId }]);
    return {
      transactions: docs.slice(0, limit).map((d) => ({
        type: d.data.type, amount: d.data.amount,
        description: d.data.description, balance_after: d.data.balanceAfter,
      })),
      total: docs.length,
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
      aspect_ratios: ['16:9', '9:16', '1:1'],
      durations_seconds: [5, 10, 15],
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
        '1. Generate or find a character portrait image',
        '2. Host it publicly (Imgur, Cloudinary, etc.)',
        '3. Pass the URL as reference_image_url in generate_video',
        '4. Use similar prompts each time for consistency',
      ],
      example: {
        prompt: 'A young woman with red hair walking through a forest',
        reference_image_url: 'https://your-character-portrait.jpg',
        model: 'seedance-2',
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

    const cost = IMAGE_CREDITS['video_analysis'];
    const userSnap = await db.get('users', userId);
    if (Number(userSnap?.credits ?? 0) < cost) return { error: `Insufficient credits. Need ${cost}.` };

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
      analysis_id: analysisId, status: 'processing', cost_credits: cost,
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

  // ── recharge_credits ─────────────────────────────────────────────────────
  if (toolName === 'recharge_credits') {
    const amount = Math.min(Math.max(Number(args.amount || 1000), 1), 10000);
    let newBalance = 0;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get('users', userId);
      const balanceBefore = Number(snap?.credits || 0);
      newBalance = balanceBefore + amount;
      tx.setWithTransforms('users', userId, { credits: newBalance }, [{ field: 'creditsUpdatedAt', type: 'serverTimestamp' }]);
      tx.setWithTransforms('creditLogs', crypto.randomUUID().replace(/-/g, ''), {
        userId, type: 'recharge', amount, balanceBefore, balanceAfter: newBalance,
        description: 'Self-recharge via MCP token',
      }, [{ field: 'createdAt', type: 'serverTimestamp' }]);
    });
    return { credits: newBalance, added: amount, message: `Added ${amount} credits. New balance: ${newBalance}.` };
  }

  // ── generate_video_with_references ───────────────────────────────────────
  if (toolName === 'generate_video_with_references') {
    const prompt = String(args.prompt || '').trim();
    if (!prompt) return { error: 'prompt is required' };
    if (!env.REPLICATE_API_TOKEN) return { error: 'REPLICATE_API_TOKEN not configured' };

    const locationDescription = String(args.location_description || 'busy urban street, warm sunlight, people walking in background, modern city');
    const duration = Math.min(Math.max(Number(args.duration || 5), 1), 15);
    const apiToken = String(env.REPLICATE_API_TOKEN);

    // Check credits: 6 (3x Flux images) + 25 (Seedance video) = 31
    const totalCost = 31;
    const userSnap = await db.get('users', userId);
    if (!userSnap) {
      // Auto-provision new user with 100 free credits
      await db.upsertWithTransforms('users', userId, { credits: 100 }, [{ field: 'creditsGrantedAt', type: 'serverTimestamp' }]);
    }
    const currentCredits = Number(userSnap?.credits ?? 100);
    if (currentCredits < totalCost) {
      return { error: `Insufficient credits. Need ${totalCost} (25 video + 6 reference images), you have ${currentCredits}.` };
    }

    try {
      await checkRateLimit(fakeCtx, userId);
    } catch (e) {
      if (e instanceof Error && e.message.includes('Превышен лимит')) return { error: e.message };
      return { error: `rate_limit_failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    // STEP 1 — Generate 3 reference images via Flux Schnell in parallel
    const fluxModel = 'black-forest-labs/flux-schnell';
    const imagePrompts = [
      'Close-up of a human hand holding a modern smartphone, relaxed natural grip, warm soft lighting, photorealistic, clean neutral background, no text',
      locationDescription,
      'Mobile app social feed UI screenshot, white background, short video thumbnails grid, profile picture circles, live streaming badge, amber and white color scheme, clean modern design, PingTop social video platform interface',
    ];

    // Create sequentially — Replicate burst limit is 1 request on low-credit accounts
    let predIds: string[];
    try {
      const ids: string[] = [];
      for (const p of imagePrompts) {
        if (ids.length > 0) await new Promise((r) => setTimeout(r, 11000));
        ids.push(await replicateCreate(apiToken, fluxModel, { prompt: p, num_outputs: 1, aspect_ratio: '1:1' }));
      }
      predIds = ids;
    } catch (e) {
      return { error: `flux_create_failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    // STEP 2 — Poll all 3 until complete (Flux Schnell finishes in ~5-15 seconds)
    let pollResults: Array<{ status: string; output: unknown; error: string | null }>;
    try {
      pollResults = await Promise.all(predIds.map((id) => replicatePoll(apiToken, id, 15)));
    } catch (e) {
      return { error: `flux_poll_failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    const imageUrls: string[] = [];
    for (let i = 0; i < pollResults.length; i++) {
      const r = pollResults[i];
      if (r.status !== 'completed') return { error: `flux_image_${i + 1}_failed: ${r.error || r.status}` };
      const imgUrl = Array.isArray(r.output) ? String(r.output[0] || '') : String(r.output || '');
      if (!imgUrl) return { error: `flux_image_${i + 1}_empty_output` };
      imageUrls.push(imgUrl);
    }

    // Deduct 6 credits for the 3 Flux images (2 credits each) — video credits charged on completion via get_video_status
    await db.runTransaction(async (tx) => {
      const snap = await tx.get('users', userId);
      const balanceBefore = Number(snap?.credits || 0);
      const balanceAfter = Math.max(0, balanceBefore - 6);
      tx.setWithTransforms('users', userId, { credits: balanceAfter }, [{ field: 'creditsUpdatedAt', type: 'serverTimestamp' }]);
      tx.setWithTransforms('creditLogs', crypto.randomUUID().replace(/-/g, ''), {
        userId, type: 'deduction', amount: -6, description: '3x reference image generation (Flux Schnell)',
        balanceBefore, balanceAfter,
      }, [{ field: 'createdAt', type: 'serverTimestamp' }]);
    });

    // STEP 3 — Send to Seedance 2.0 with reference_images array
    // Wait to ensure Replicate rate limit has reset (burst=1 at <$5 balance resets in ~10s)
    await new Promise((r) => setTimeout(r, 12000));

    const enrichedPrompt = `${prompt} [Image1] hand is holding the phone, [Image2] is the location background, [Image3] is the app interface visible on screen`;

    let predictionId: string;
    try {
      predictionId = await replicateCreate(apiToken, 'bytedance/seedance-2.0', {
        prompt: enrichedPrompt,
        reference_images: imageUrls,
        aspect_ratio: '9:16',
        generate_audio: true,
        duration,
        resolution: '720p',
      });
    } catch (e) {
      return { error: `seedance_create_failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    // STEP 4 — Persist and return generation_id (status polled via get_video_status)
    const generationId = crypto.randomUUID().replace(/-/g, '');
    try {
      await db.upsertWithTransforms('video_generations', generationId, {
        userId, prompt, enrichedPrompt, modelId: 'seedance-2', aspectRatio: '9:16',
        duration, status: 'processing', source: 'mcp',
        provider: 'replicate', predictionId,
        referenceImages: imageUrls,
        mode: 'text_to_video',
      }, [{ field: 'createdAt', type: 'serverTimestamp' }, { field: 'updatedAt', type: 'serverTimestamp' }]);
    } catch (e) {
      return { error: `firestore_write_failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    return {
      generation_id: generationId,
      status: 'processing',
      model: 'seedance-2',
      reference_images: imageUrls,
      cost_credits: totalCost,
      message: `Video generation started with 3 reference images! Use get_video_status("${generationId}") to check progress. Usually 2-3 minutes.`,
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
