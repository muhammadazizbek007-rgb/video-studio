'use strict';

const POLL_CONFIG = { maxAttempts: 60, intervalMs: 5000 }; // 5 minutes max

function getToken() {
  const token = String(process.env.REPLICATE_API_TOKEN || '').trim();
  if (!token) throw new Error('REPLICATE_API_TOKEN не задан в Firebase Functions.');
  return token;
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(level, msg, ctx) {
  console[level](`[ReplicateUpscaleProvider] ${msg}`, ctx || {});
}

async function upscaleVideo({ videoUrl, targetResolution }) {
  const token = getToken();
  const scale = targetResolution === '4k' ? 4 : 2;

  log('info', 'Starting upscale', { videoUrl, targetResolution, scale });

  // ── Step 1: Create prediction ──────────────────────────────────────────────
  const createRes = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: 'nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa',
      input: {
        video: videoUrl,
        scale,
        face_enhance: false,
      },
    }),
  });

  const createData = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    throw new Error(`Replicate upscale error ${createRes.status}: ${JSON.stringify(createData)}`);
  }

  const predictionId = createData.id;
  const pollUrl = createData.urls?.get;
  if (!predictionId || !pollUrl) {
    throw new Error(`Replicate не вернул prediction ID: ${JSON.stringify(createData)}`);
  }

  log('info', 'Prediction created', { predictionId });

  // ── Step 2: Poll until done ────────────────────────────────────────────────
  for (let attempt = 1; attempt <= POLL_CONFIG.maxAttempts; attempt++) {
    await wait(POLL_CONFIG.intervalMs);

    const pollRes = await fetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const pollData = await pollRes.json().catch(() => ({}));

    const status = String(pollData.status || '').toLowerCase();
    log('info', `Poll ${attempt}`, { predictionId, status });

    if (status === 'succeeded') {
      const output = pollData.output;
      const outputUrl = Array.isArray(output) ? output[0] : output;
      if (!outputUrl) throw new Error('Replicate upscale: succeeded но output URL отсутствует');
      log('info', 'Upscale complete', { predictionId, outputUrl });
      return { videoUrl: outputUrl, predictionId };
    }

    if (status === 'failed' || status === 'canceled') {
      throw new Error(`Replicate upscale failed: ${pollData.error || status}`);
    }
  }

  throw new Error('Upscale timeout (5 минут)');
}

module.exports = { upscaleVideo };
