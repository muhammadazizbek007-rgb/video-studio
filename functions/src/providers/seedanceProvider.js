const crypto = require('crypto');

const DEFAULT_POLL_CONFIG = {
  maxAttempts: 60,
  intervalMs: 5000,
};

function isMockMode() {
  return false;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProviderContext(request, extra = {}) {
  return {
    generationId: request.id,
    userId: request.userId,
    modelId: request.modelId,
    ...extra,
  };
}

function logProviderInfo(message, context) {
  console.info(`[SeedanceProvider] ${message}`, context);
}

function logProviderError(message, context) {
  console.error(`[SeedanceProvider] ${message}`, context);
}

function getStorageDownloadUrl(bucketName, filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

function getSeedanceConfig() {
  const apiKey = String(process.env.SEEDANCE_API_KEY || '').trim();
  const apiBaseUrl = String(process.env.SEEDANCE_API_BASE_URL || '').trim().replace(/\/+$/, '');

  if (!apiKey) {
    throw new Error('Seedance API key is missing. Set SEEDANCE_API_KEY in Firebase Functions.');
  }

  if (!apiBaseUrl) {
    throw new Error('Seedance API base URL is missing. Set SEEDANCE_API_BASE_URL in Firebase Functions.');
  }

  return { apiKey, apiBaseUrl };
}

function getSeedanceApiFlavor(apiBaseUrl) {
  if (apiBaseUrl.includes('seedanceapi.org')) {
    return 'seedanceapi_v2';
  }
  if (apiBaseUrl.includes('seedance2.app')) {
    return 'seedance2_app';
  }
  return 'seedance2_movie';
}

function getSeedanceHeaders(config) {
  const flavor = getSeedanceApiFlavor(config.apiBaseUrl);
  const authHeader = flavor === 'seedance2_movie'
    ? { 'X-API-Key': config.apiKey }
    : { authorization: `Bearer ${config.apiKey}` };

  return {
    'content-type': 'application/json',
    ...authHeader,
  };
}

function getSeedanceModelId(request, flavor) {
  if (request.modelId === 'seedance-2') {
    return flavor === 'seedance2_app' ? 'doubao-seedance-2-0' : 'seedance-2.0';
  }

  return request.modelId;
}

function getSeedancePrompt(request) {
  return [
    request.prompt,
    `Style preset: ${request.stylePreset}.`,
    `Camera movement: ${request.cameraMotion}.`,
    `Mode: ${request.mode}.`,
  ].filter(Boolean).join(' ');
}

function getCreateEndpoint(config) {
  const flavor = getSeedanceApiFlavor(config.apiBaseUrl);

  if (flavor === 'seedanceapi_v2') {
    const baseUrl = config.apiBaseUrl.endsWith('/v2') ? config.apiBaseUrl : `${config.apiBaseUrl}/v2`;
    return { endpoint: `${baseUrl}/generate`, flavor };
  }

  if (flavor === 'seedance2_app') {
    const baseUrl = config.apiBaseUrl.endsWith('/api/v1') ? config.apiBaseUrl : `${config.apiBaseUrl}/api/v1`;
    return { endpoint: `${baseUrl}/generate`, flavor };
  }

  const baseUrl = config.apiBaseUrl.endsWith('/api/v1') ? config.apiBaseUrl : `${config.apiBaseUrl}/api/v1`;
  return { endpoint: `${baseUrl}/video/task`, flavor };
}

function getPollEndpoint(config, providerJobId) {
  const flavor = getSeedanceApiFlavor(config.apiBaseUrl);

  if (flavor === 'seedanceapi_v2') {
    const baseUrl = config.apiBaseUrl.endsWith('/v2') ? config.apiBaseUrl : `${config.apiBaseUrl}/v2`;
    return { endpoint: `${baseUrl}/status?task_id=${encodeURIComponent(providerJobId)}`, flavor };
  }

  if (flavor === 'seedance2_app') {
    const baseUrl = config.apiBaseUrl.endsWith('/api/v1') ? config.apiBaseUrl : `${config.apiBaseUrl}/api/v1`;
    return { endpoint: `${baseUrl}/videos/${encodeURIComponent(providerJobId)}`, flavor };
  }

  const baseUrl = config.apiBaseUrl.endsWith('/api/v1') ? config.apiBaseUrl : `${config.apiBaseUrl}/api/v1`;
  return { endpoint: `${baseUrl}/video/task/${encodeURIComponent(providerJobId)}`, flavor };
}

function buildSeedanceCreatePayload(request, flavor) {
  const prompt = getSeedancePrompt(request);
  const model = getSeedanceModelId(request, flavor);

  if (flavor === 'seedance2_movie') {
    const content = [];

    if (request.referenceImageUrl) {
      content.push({ type: 'image_url', image_url: request.referenceImageUrl });
    }

    if (request.referenceVideoUrl) {
      content.push({ type: 'video_url', video_url: request.referenceVideoUrl });
    }

    if (request.referenceAudioUrl) {
      content.push({ type: 'audio_url', audio_url: request.referenceAudioUrl });
    }

    content.push({ type: 'text', text: prompt });

    return {
      model,
      content,
      resolution: '720p',
      ratio: request.aspectRatio,
      duration: request.duration,
      generate_audio: Boolean(request.referenceAudioUrl),
      watermark: false,
    };
  }

  if (flavor === 'seedance2_app') {
    return {
      prompt,
      model,
      generation_type: request.referenceImageUrl ? 'image_to_video' : 'text_to_video',
      image_url: request.referenceImageUrl || undefined,
      aspect_ratio: request.aspectRatio,
      duration: request.duration,
      resolution: '720p',
    };
  }

  return {
    prompt,
    model,
    aspect_ratio: request.referenceImageUrl ? undefined : request.aspectRatio,
    images: request.referenceImageUrl ? [request.referenceImageUrl] : undefined,
    duration: request.duration,
    public: false,
  };
}

function extractProviderJobId(payload, flavor) {
  if (flavor === 'seedance2_movie') {
    return String(payload.result?.task_id || '').trim();
  }

  if (flavor === 'seedance2_app') {
    return String(payload.data?.video_id || payload.data?.id || payload.data?.task_id || '').trim();
  }

  return String(payload.data?.task_id || '').trim();
}

function extractStatus(payload, flavor) {
  if (flavor === 'seedance2_movie') {
    return String(payload.result?.status || '').trim().toLowerCase();
  }

  return String(payload.data?.status || '').trim().toLowerCase();
}

function extractFinalVideoUrl(payload, flavor) {
  if (flavor === 'seedance2_movie') {
    return String(payload.result?.video_url || '').trim();
  }

  if (flavor === 'seedance2_app') {
    return String(payload.data?.video_url || payload.data?.result?.video_url || '').trim();
  }

  const response = payload.data?.response;
  return String(Array.isArray(response) ? response[0] : payload.data?.video_url || '').trim();
}

function extractProviderError(payload, flavor) {
  if (flavor === 'seedance2_movie') {
    return payload.result?.error_message || payload.message || 'Seedance provider failed.';
  }

  return payload.data?.error_message || payload.data?.error || payload.error?.message || payload.message || 'Seedance provider failed.';
}

async function createSeedanceGeneration({ request, config }) {
  const { endpoint, flavor } = getCreateEndpoint(config);
  const body = buildSeedanceCreatePayload(request, flavor);

  logProviderInfo('Creating generation', getProviderContext(request, { endpoint, flavor }));

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: getSeedanceHeaders(config),
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`Seedance create generation request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Seedance create generation failed: ${response.status} ${response.statusText} ${JSON.stringify(payload)}`);
  }

  const providerJobId = extractProviderJobId(payload, flavor);
  if (!providerJobId) {
    throw new Error('Seedance create generation response did not include a provider job id.');
  }

  logProviderInfo('Generation created', getProviderContext(request, { providerJobId }));
  return { providerJobId, raw: payload };
}

async function pollSeedanceGeneration({ request, config, providerJobId, pollConfig = DEFAULT_POLL_CONFIG }) {
  const startedAt = Date.now();
  const timeoutMs = pollConfig.maxAttempts * pollConfig.intervalMs;

  for (let attempt = 1; attempt <= pollConfig.maxAttempts; attempt += 1) {
    const { endpoint, flavor } = getPollEndpoint(config, providerJobId);
    let response;

    try {
      response = await fetch(endpoint, {
        method: 'GET',
        headers: getSeedanceHeaders(config),
      });
    } catch (error) {
      throw new Error(`Seedance poll request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(`Seedance poll failed: ${response.status} ${response.statusText} ${JSON.stringify(payload)}`);
    }

    const status = extractStatus(payload, flavor);
    const finalVideoUrl = extractFinalVideoUrl(payload, flavor);

    logProviderInfo('Poll status', getProviderContext(request, {
      providerJobId,
      attempt,
      status,
    }));

    if (['completed', 'complete', 'succeeded', 'success', 'finished'].includes(status)) {
      if (!finalVideoUrl) {
        throw new Error('Seedance generation completed, but final video URL is missing.');
      }

      return { status: 'completed', finalVideoUrl, raw: payload };
    }

    if (['failed', 'error', 'cancelled', 'canceled', 'expired'].includes(status)) {
      const providerError = extractProviderError(payload, flavor);
      throw new Error(`Seedance provider failed: ${typeof providerError === 'string' ? providerError : JSON.stringify(providerError)}`);
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Seedance provider timeout after ${Math.round(timeoutMs / 1000)} seconds.`);
    }

    if (attempt < pollConfig.maxAttempts) {
      await wait(pollConfig.intervalMs);
    }
  }

  throw new Error(`Seedance provider timeout after ${Math.round(timeoutMs / 1000)} seconds.`);
}

async function downloadSeedanceVideo({ request, providerJobId, finalVideoUrl }) {
  if (!finalVideoUrl) {
    throw new Error('Seedance final video URL is missing.');
  }

  logProviderInfo('Downloading final video', getProviderContext(request, {
    providerJobId,
    finalVideoUrl,
  }));

  let response;
  try {
    response = await fetch(finalVideoUrl);
  } catch (error) {
    throw new Error(`Seedance video download failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    throw new Error(`Seedance video download failed: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get('content-type') || 'video/mp4',
  };
}

async function uploadResultToStorage({ bucket, request, videoBuffer, contentType, fileName = 'result.mp4' }) {
  const destinationPath = `video-generations/${request.userId}/${request.id}/${fileName}`;
  const downloadToken = crypto.randomUUID();
  const file = bucket.file(destinationPath);

  logProviderInfo('Uploading result to storage', getProviderContext(request, { destinationPath }));

  try {
    await file.save(videoBuffer, {
      resumable: false,
      contentType,
      metadata: {
        cacheControl: 'private, max-age=3600',
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });
  } catch (error) {
    throw new Error(`Firebase Storage upload failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    resultVideoUrl: getStorageDownloadUrl(bucket.name, destinationPath, downloadToken),
    storagePath: destinationPath,
  };
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function generateRealSeedanceVideo({ bucket, request }) {
  const config = getSeedanceConfig();

  try {
    const created = await createSeedanceGeneration({ request, config });
    const completed = await pollSeedanceGeneration({
      request,
      config,
      providerJobId: created.providerJobId,
      pollConfig: DEFAULT_POLL_CONFIG,
    });
    const downloaded = await downloadSeedanceVideo({
      request,
      providerJobId: created.providerJobId,
      finalVideoUrl: completed.finalVideoUrl,
    });

    return uploadResultToStorage({
      bucket,
      request,
      videoBuffer: downloaded.buffer,
      contentType: downloaded.contentType,
      fileName: `result-${created.providerJobId}.mp4`,
    });
  } catch (error) {
    logProviderError('Generation failed', getProviderContext(request, {
      error: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  }
}

async function generateSeedanceVideo(options) {
  return generateRealSeedanceVideo(options);
}

function isConfigured() {
  const apiKey = String(process.env.SEEDANCE_API_KEY || '').trim();
  const apiBaseUrl = String(process.env.SEEDANCE_API_BASE_URL || '').trim();
  return Boolean(apiKey && apiBaseUrl);
}

function getDiagnostics() {
  const apiBaseUrl = String(process.env.SEEDANCE_API_BASE_URL || '').trim().replace(/\/+$/, '');
  return {
    configured: isConfigured(),
    mockMode: isMockMode(),
    baseUrl: apiBaseUrl,
    hasApiKey: Boolean(String(process.env.SEEDANCE_API_KEY || '').trim()),
  };
}

module.exports = {
  createSeedanceGeneration,
  pollSeedanceGeneration,
  downloadSeedanceVideo,
  uploadResultToStorage,
  generateSeedanceVideo,
  isMockMode,
  isConfigured,
  getDiagnostics,
};
