import type { Env } from './types';

interface VideoRequest {
  generationId: string; prompt: string; enrichedPrompt?: string;
  modelId: string; mode: string; aspectRatio: string; duration: number;
  stylePreset?: string; cameraMotion?: string;
  referenceImageUrl?: string; referenceVideoUrl?: string; referenceAudioUrl?: string;
  referenceImageUrls?: string[];
  lastFrameImageUrl?: string;
}

interface VideoResult {
  resultVideoUrl: string;
  storagePath?: string;
}

function wait(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function readJson(res: Response) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// ─── WaveSpeed ────────────────────────────────────────────────────────────────

async function generateWavespeed(env: Env, req: VideoRequest): Promise<VideoResult> {
  const apiKey = String(env.WAVESPEED_API_KEY || '').trim();
  if (!apiKey) throw new Error('WAVESPEED_API_KEY not configured');

  const base = 'https://api.wavespeed.ai/api/v3';
  const isI2V = Boolean(req.referenceImageUrl);
  const endpoint = isI2V
    ? `${base}/wavespeed-ai/wan-2.1/i2v-480p-ultra-fast`
    : `${base}/wavespeed-ai/wan-2.1/t2v-480p-ultra-fast`;

  const size = req.aspectRatio === '9:16' ? '480*832' : req.aspectRatio === '1:1' ? '480*480' : '832*480';
  const input: Record<string, unknown> = {
    prompt: req.prompt, size, duration: 5, num_inference_steps: 30,
    guidance_scale: 5.0, flow_shift: 5.0, seed: -1, enable_safety_checker: true,
  };
  if (isI2V) input.image = req.referenceImageUrl;

  const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  const createRes = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(input) });
  const createData = await readJson(createRes) as Record<string, unknown>;
  if (!createRes.ok) throw new Error(`WaveSpeed create failed: ${createRes.status} ${JSON.stringify(createData)}`);

  const d = (createData.data || createData) as Record<string, unknown>;
  const taskId = String(d.id || '').trim();
  const pollUrl = String((d as Record<string, Record<string, string>>).urls?.get || d.url || `${base}/predictions/${taskId}`);
  if (!taskId) throw new Error(`WaveSpeed: no task id in response`);

  for (let i = 0; i < 60; i++) {
    await wait(5000);
    const pollRes = await fetch(pollUrl, { headers });
    const pollData = await readJson(pollRes) as Record<string, unknown>;
    if (!pollRes.ok) throw new Error(`WaveSpeed poll failed: ${pollRes.status}`);

    const pd = (pollData.data || pollData) as Record<string, unknown>;
    const status = String(pd.status || '').toLowerCase();
    if (['completed', 'succeeded', 'success'].includes(status)) {
      const outputs = pd.outputs as string[] | undefined;
      const videoUrl = String((outputs?.[0]) || (pd as Record<string, Record<string, string>>).output?.video_url || pd.video_url || '').trim();
      if (!videoUrl) throw new Error('WaveSpeed: no video URL in response');
      return { resultVideoUrl: videoUrl };
    }
    if (['failed', 'canceled', 'error'].includes(status)) {
      throw new Error(`WaveSpeed failed: ${(pd as Record<string, string>).error || 'unknown'}`);
    }
  }
  throw new Error('WaveSpeed timeout');
}

// ─── Seedance ─────────────────────────────────────────────────────────────────

async function generateSeedance(env: Env, req: VideoRequest): Promise<VideoResult> {
  const apiKey = String(env.SEEDANCE_API_KEY || '').trim();
  const baseUrl = String(env.SEEDANCE_API_BASE_URL || 'https://seedance2.app').trim().replace(/\/+$/, '');
  if (!apiKey) throw new Error('SEEDANCE_API_KEY not configured');

  const isFast = req.modelId === 'seedance-2-fast';
  const endpoint = `${baseUrl}/api/v1/video/generate${isFast ? '/fast' : ''}`;
  const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  const body: Record<string, unknown> = {
    prompt: req.enrichedPrompt || req.prompt,
    aspect_ratio: req.aspectRatio,
    duration: req.duration,
    style: req.stylePreset,
    camera_motion: req.cameraMotion,
  };
  if (req.referenceImageUrl) body.image_url = req.referenceImageUrl;

  const createRes = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  const createData = await readJson(createRes) as Record<string, unknown>;
  if (!createRes.ok) throw new Error(`Seedance create failed: ${createRes.status} ${JSON.stringify(createData)}`);

  const taskId = String(createData.task_id || createData.id || '').trim();
  if (!taskId) throw new Error('Seedance: no task_id in response');

  const pollEndpoint = `${baseUrl}/api/v1/video/status/${taskId}`;

  for (let i = 0; i < 120; i++) {
    await wait(5000);
    const pollRes = await fetch(pollEndpoint, { headers });
    const pollData = await readJson(pollRes) as Record<string, unknown>;
    if (!pollRes.ok) throw new Error(`Seedance poll failed: ${pollRes.status}`);

    const status = String(pollData.status || '').toLowerCase();
    if (status === 'completed' || status === 'success') {
      const videoUrl = String(pollData.video_url || pollData.output_url || '').trim();
      if (!videoUrl) throw new Error('Seedance: no video URL');
      return { resultVideoUrl: videoUrl };
    }
    if (status === 'failed' || status === 'error') {
      throw new Error(`Seedance failed: ${(pollData as Record<string, string>).error || 'unknown'}`);
    }
  }
  throw new Error('Seedance timeout');
}

// ─── Replicate ────────────────────────────────────────────────────────────────

const REPLICATE_MODELS: Record<string, string> = {
  'seedance-2': 'bytedance/seedance-2.0',
  'seedance-2-fast': 'bytedance/seedance-2.0',
  'seedance-2-i2v': 'bytedance/seedance-2.0',
  'replicate-wan-t2v': 'minimax/video-01',
  'replicate-wan-i2v': 'minimax/video-01',
  'replicate-kling': 'tencent/hunyuan-video',
  'replicate-luma': 'minimax/video-01-live',
};

function buildReplicateInput(modelPath: string, req: VideoRequest): Record<string, unknown> {
  if (modelPath === 'bytedance/seedance-2.0') {
    // aspect_ratio: enum '16:9'|'4:3'|'1:1'|'3:4'|'9:16'|'21:9'|'9:21'|'adaptive'
    // duration: -1 (intelligent) or 1–15 seconds
    const input: Record<string, unknown> = {
      prompt: req.prompt,
      aspect_ratio: req.aspectRatio || '9:16',
      duration: req.duration || 5,
      resolution: '720p',
      generate_audio: true,
    };
    if (req.referenceImageUrl) input.image = req.referenceImageUrl;
    if (req.lastFrameImageUrl) input.last_frame_image = req.lastFrameImageUrl;
    return input;
  }
  if (modelPath === 'minimax/video-01' || modelPath === 'minimax/video-01-live') {
    const arMap: Record<string, string> = { '9:16': '9:16', '16:9': '16:9', '1:1': '1:1' };
    const input: Record<string, unknown> = {
      prompt: req.prompt,
      prompt_optimizer: true,
      aspect_ratio: arMap[req.aspectRatio] || '16:9',
    };
    if (req.referenceImageUrl) input.first_frame_image = req.referenceImageUrl;
    return input;
  }
  if (modelPath === 'tencent/hunyuan-video') {
    const sizeMap: Record<string, string> = { '9:16': '544x960', '16:9': '960x544', '1:1': '720x720' };
    return { prompt: req.prompt, resolution: sizeMap[req.aspectRatio] || '544x960', video_length: Math.min(req.duration, 5) };
  }
  const input: Record<string, unknown> = { prompt: req.prompt };
  if (req.referenceImageUrl) input.image = req.referenceImageUrl;
  return input;
}

// Uploads a data URL to Replicate Files API and returns a public URL
async function uploadDataUrlToReplicate(apiToken: string, dataUrl: string): Promise<string> {
  const [meta, b64] = dataUrl.split(',');
  const mimeMatch = meta.match(/data:([^;]+)/);
  const mime = mimeMatch?.[1] ?? 'image/jpeg';
  const ext = mime.split('/')[1] ?? 'jpg';

  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  const form = new FormData();
  form.append('content', new Blob([bytes], { type: mime }), `frame.${ext}`);

  const res = await fetch('https://api.replicate.com/v1/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiToken}` },
    body: form,
  });
  const data = await readJson(res) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Replicate file upload failed: ${res.status} ${JSON.stringify(data)}`);

  const urls = data.urls as Record<string, string> | undefined;
  const url = urls?.get ?? String(data.url ?? '');
  if (!url) throw new Error('Replicate file upload: no URL returned');
  return url;
}

// Creates a Replicate prediction and returns the ID immediately (no polling)
export async function createReplicatePrediction(apiToken: string, modelId: string, req: VideoRequest): Promise<string> {
  const model = REPLICATE_MODELS[modelId];
  if (!model) throw new Error(`No Replicate model for ${modelId}`);

  // Upload any data: URLs to Replicate Files API so they become public HTTP URLs
  if (req.referenceImageUrl?.startsWith('data:')) {
    req = { ...req, referenceImageUrl: await uploadDataUrlToReplicate(apiToken, req.referenceImageUrl) };
  }
  if (req.lastFrameImageUrl?.startsWith('data:')) {
    req = { ...req, lastFrameImageUrl: await uploadDataUrlToReplicate(apiToken, req.lastFrameImageUrl) };
  }

  const headers = { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' };
  const input = buildReplicateInput(model, req);

  const createRes = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST', headers, body: JSON.stringify({ input }),
  });
  const createData = await readJson(createRes) as Record<string, unknown>;
  if (!createRes.ok) throw new Error(`Replicate create failed: ${createRes.status} ${JSON.stringify(createData)}`);

  const predictionId = String(createData.id || '').trim();
  if (!predictionId) throw new Error('Replicate: no prediction id');
  return predictionId;
}

// Checks status of an existing Replicate prediction
export async function checkReplicatePrediction(apiToken: string, predictionId: string): Promise<{ status: string; videoUrl: string | null; error: string | null }> {
  const res = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
    headers: { 'Authorization': `Bearer ${apiToken}` },
  });
  if (!res.ok) throw new Error(`Replicate check failed: ${res.status}`);
  const data = await readJson(res) as Record<string, unknown>;
  const status = String(data.status || '').toLowerCase();

  if (status === 'succeeded') {
    const output = data.output;
    const videoUrl = Array.isArray(output) ? String(output[0] || '') : String(output || '');
    return { status: 'completed', videoUrl: videoUrl || null, error: null };
  }
  if (status === 'failed' || status === 'canceled') {
    return { status: 'failed', videoUrl: null, error: String((data as Record<string, string>).error || 'Unknown error') };
  }
  return { status: 'processing', videoUrl: null, error: null };
}

async function generateReplicate(env: Env, req: VideoRequest): Promise<VideoResult> {
  const apiToken = String(env.REPLICATE_API_TOKEN || '').trim();
  if (!apiToken) throw new Error('REPLICATE_API_TOKEN not configured');

  const predictionId = await createReplicatePrediction(apiToken, req.modelId, req);

  for (let i = 0; i < 120; i++) {
    await wait(5000);
    const result = await checkReplicatePrediction(apiToken, predictionId);
    if (result.status === 'completed') {
      if (!result.videoUrl) throw new Error('Replicate: no video URL');
      return { resultVideoUrl: result.videoUrl };
    }
    if (result.status === 'failed') {
      throw new Error(`Replicate failed: ${result.error}`);
    }
  }
  throw new Error('Replicate timeout');
}

// ─── HuggingFace ──────────────────────────────────────────────────────────────

async function generateHuggingFace(env: Env, req: VideoRequest): Promise<VideoResult> {
  const apiToken = String(env.HUGGINGFACE_API_TOKEN || '').trim();
  if (!apiToken) throw new Error('HUGGINGFACE_API_TOKEN not configured');

  const MODEL_MAP: Record<string, string> = {
    'huggingface-cogvideox': 'THUDM/CogVideoX-5b',
    'cogvideox-free': 'THUDM/CogVideoX-5b',
    'ltx-fast': 'Lightricks/LTX-Video',
    'svd': 'stabilityai/stable-video-diffusion-img2vid-xt',
    'huggingface-opensora': 'hpcai-tech/Open-Sora',
  };

  const modelId = MODEL_MAP[req.modelId];
  if (!modelId) throw new Error(`No HuggingFace model for ${req.modelId}`);

  const res = await fetch(`https://api-inference.huggingface.co/models/${modelId}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: req.prompt }),
  });

  if (!res.ok) throw new Error(`HuggingFace generation failed: ${res.status} ${await res.text()}`);

  const blob = await res.blob();
  if (!blob.type.startsWith('video/')) throw new Error('HuggingFace did not return a video');

  // Store as data URL for now (HuggingFace returns the video directly)
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const base64 = btoa(String.fromCharCode(...bytes));
  const dataUrl = `data:video/mp4;base64,${base64}`;

  return { resultVideoUrl: dataUrl };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export async function generateVideo(env: Env, req: VideoRequest): Promise<VideoResult> {
  const provider = {
    'wavespeed-wan': 'wavespeed', 'wavespeed-wan-i2v': 'wavespeed',
    'seedance-2': 'replicate', 'seedance-2-fast': 'replicate',
    'replicate-wan-t2v': 'replicate', 'replicate-wan-i2v': 'replicate',
    'replicate-kling': 'replicate', 'replicate-luma': 'replicate',
    'huggingface-cogvideox': 'huggingface', 'huggingface-opensora': 'huggingface',
    'cogvideox-free': 'huggingface', 'ltx-fast': 'huggingface', 'svd': 'huggingface',
  }[req.modelId];

  switch (provider) {
    case 'wavespeed': return generateWavespeed(env, req);
    case 'seedance': return generateSeedance(env, req);
    case 'replicate': return generateReplicate(env, req);
    case 'huggingface': return generateHuggingFace(env, req);
    default: throw new Error(`Provider not supported in Cloudflare Worker: ${req.modelId}`);
  }
}
