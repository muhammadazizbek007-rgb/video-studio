'use strict';

const POLL_CONFIG = { maxAttempts: 40, intervalMs: 3000 }; // 2 minutes max

const SIZE_MAP = {
  '1:1':  '1024*1024',
  '16:9': '1344*768',
  '9:16': '768*1344',
  '4:3':  '1152*896',
  '3:4':  '896*1152',
};

function getApiKey() {
  const key = String(process.env.WAVESPEED_API_KEY || '').trim();
  if (!key) throw new Error('WAVESPEED_API_KEY не задан в Firebase Functions.');
  return key;
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(level, msg, ctx) {
  console[level](`[WaveSpeedImageProvider] ${msg}`, ctx || {});
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function generateImage({ prompt, aspect_ratio, model, width, height }) {
  const key = getApiKey();

  // Size: explicit width/height takes priority, then aspect_ratio mapping
  const size = (width && height)
    ? `${width}*${height}`
    : (SIZE_MAP[aspect_ratio || '1:1'] || SIZE_MAP['1:1']);

  // Select model endpoint — default to hidream-i1-fast
  const modelEndpoint = (model === 'hidream-i1-full')
    ? 'https://api.wavespeed.ai/api/v3/wavespeed-ai/hidream-i1-full'
    : 'https://api.wavespeed.ai/api/v3/wavespeed-ai/hidream-i1-fast';

  const headers = {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  // ── Step 1: Create prediction ──────────────────────────────────────────────
  log('info', 'Creating image prediction', { size, model: modelEndpoint });

  const createRes = await fetch(modelEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt,
      size,
      num_inference_steps: 28,
      guidance_scale: 7,
      num_outputs: 1,
      output_format: 'webp',
      seed: -1,
      enable_safety_checker: true,
    }),
  });

  const createData = await readJson(createRes);
  if (!createRes.ok) {
    throw new Error(`WaveSpeed Image API ${createRes.status}: ${JSON.stringify(createData)}`);
  }

  const data = createData.data || createData;
  const predictionId = String(data.id || '').trim();
  const pollUrl = String(data.urls?.get || data.url || '').trim()
    || `https://api.wavespeed.ai/api/v3/predictions/${predictionId}`;

  if (!predictionId) {
    throw new Error(`WaveSpeed не вернул prediction ID: ${JSON.stringify(createData)}`);
  }

  log('info', 'Prediction created', { predictionId, pollUrl });

  // ── Step 2: Poll until done ────────────────────────────────────────────────
  for (let attempt = 1; attempt <= POLL_CONFIG.maxAttempts; attempt++) {
    await wait(POLL_CONFIG.intervalMs);

    const pollRes = await fetch(pollUrl, { method: 'GET', headers });
    if (!pollRes.ok) {
      log('warn', `Poll ${attempt} HTTP error`, { status: pollRes.status });
      continue;
    }

    const pollData = await readJson(pollRes);
    const pd = pollData.data || pollData;
    const status = String(pd.status || '').toLowerCase();
    const outputs = pd.outputs;

    log('info', `Poll ${attempt}`, { predictionId, status });

    if (['completed', 'succeeded', 'success'].includes(status)) {
      const imageUrl = String(
        (Array.isArray(outputs) && outputs.length > 0 ? outputs[0] : null)
        || pd.output?.image_url || pd.image_url || ''
      ).trim();
      if (!imageUrl) throw new Error('WaveSpeed: генерация завершена, но URL изображения отсутствует');
      log('info', 'Image ready', { predictionId, imageUrl });
      return { imageUrl, predictionId };
    }

    if (['failed', 'canceled', 'error'].includes(status)) {
      throw new Error(`WaveSpeed image failed: ${pd.error || pollData.message || status}`);
    }
  }

  throw new Error('WaveSpeed image generation timeout (2 минуты)');
}

module.exports = { generateImage };
