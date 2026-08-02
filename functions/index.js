const crypto = require('crypto');
const functions = require('firebase-functions');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { admin, db } = require('./adminApp');

let _providerFactory, _videoProviderTypes;
function getProviderFactory() {
  if (!_providerFactory) _providerFactory = require('./src/providers/providerFactory');
  return _providerFactory;
}
function getVideoProviderTypes() {
  if (!_videoProviderTypes) _videoProviderTypes = require('./src/providers/videoProviderTypes');
  return _videoProviderTypes;
}
function generateVideo(...args) { return getProviderFactory().generateVideo(...args); }
function isMockModeForModel(...args) { return getProviderFactory().isMockModeForModel(...args); }
function getAllProviderDiagnostics(...args) { return getProviderFactory().getAllProviderDiagnostics(...args); }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripJsonFence(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
}

function extractJsonObject(value) {
  const input = stripJsonFence(value);
  const start = input.indexOf('{');
  if (start === -1) return input;
  let depth = 0, inString = false, escapeNext = false;
  for (let index = start; index < input.length; index++) {
    const ch = input[index];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\') { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') { depth++; continue; }
    if (ch === '}') { depth--; if (depth === 0) return input.slice(start, index + 1); }
  }
  return input.slice(start);
}

function cleanUndefinedValues(value) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

function ensureCallableAuth(authContext) {
  if (!authContext || !authContext.uid) throw new HttpsError('unauthenticated', 'Sign in is required.');
  return authContext.uid;
}

function requireStringField(data, fieldName, maxLength = 4000) {
  const value = String(data?.[fieldName] || '').trim();
  if (!value || value.length > maxLength) throw new HttpsError('invalid-argument', `${fieldName} is required.`);
  return value;
}

function optionalStringField(data, fieldName, maxLength = 4000) {
  const rawValue = data?.[fieldName];
  if (rawValue === undefined || rawValue === null || rawValue === '') return undefined;
  const value = String(rawValue).trim();
  if (!value || value.length > maxLength) throw new HttpsError('invalid-argument', `${fieldName} is invalid.`);
  return value;
}

function requireEnumField(data, fieldName, allowedValues) {
  const value = String(data?.[fieldName] || '').trim();
  if (!allowedValues.includes(value)) throw new HttpsError('invalid-argument', `${fieldName} is invalid.`);
  return value;
}

// Union of every duration any active model accepts; each provider snaps the
// value to what its own model actually supports (Veo: 4/6/8, JSON2Video: up to 15).
const ALLOWED_DURATIONS = [4, 5, 6, 7, 8, 10, 15];

function requireDuration(data) {
  const duration = Number(data?.duration);
  if (!ALLOWED_DURATIONS.includes(duration)) throw new HttpsError('invalid-argument', 'duration is invalid.');
  return duration;
}

// ─── Rate limiting ───────────────────────────────────────────────────────────

async function checkRateLimit(userId) {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const limitRef = db.collection('rateLimits').doc(userId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(limitRef);
    const timestamps = ((snap.data() || {}).timestamps || []).filter((ts) => ts > oneHourAgo);
    if (timestamps.length >= 10) {
      const waitMin = Math.ceil((Math.min(...timestamps) + 60 * 60 * 1000 - now) / 60000);
      throw new HttpsError('resource-exhausted', `Превышен лимит: 10 генераций в час. Попробуйте через ${waitMin} мин.`);
    }
    timestamps.push(now);
    tx.set(limitRef, { timestamps, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
}

// ─── Access control ───────────────────────────────────────────────────────────

function getVideoStudioAllowedEmails() {
  return String(process.env.VIDEO_STUDIO_ALLOWED_EMAILS || process.env.VITE_VIDEO_STUDIO_ALLOWED_EMAILS || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

function ensureAllowedVideoStudioEmail(authContext) {
  const allowedEmails = getVideoStudioAllowedEmails();
  if (allowedEmails.length === 0) return;
  const email = String(authContext?.token?.email || '').trim().toLowerCase();
  if (!email || !allowedEmails.includes(email)) {
    throw new HttpsError('permission-denied', 'This email is not allowed to access Video Studio.');
  }
}


// ─── Anthropic helper ─────────────────────────────────────────────────────────

function callAnthropicApi(apiKey, body) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('Request timeout')); });
    req.write(payload);
    req.end();
  });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

exports.testVertexConnection = onCall({ cors: true, timeoutSeconds: 60 }, async (request) => {
  ensureCallableAuth(request.auth);
  ensureAllowedVideoStudioEmail(request.auth);

  const vertex = require('./src/providers/google/vertexClient');
  const { VEO_MODEL_IDS } = require('./src/providers/google/veoProvider');
  const { IMAGE_MODEL_IDS } = require('./src/providers/google/imagenProvider');

  let projectId = '';
  let location = '';
  try {
    projectId = vertex.getProjectId();
    location = vertex.getLocation();
  } catch (err) {
    return {
      status: 'error', projectId: '', location: '', tokenOk: false,
      videoModels: VEO_MODEL_IDS, imageModels: IMAGE_MODEL_IDS,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // Verifies the service account can actually mint a cloud-platform token
  try {
    await vertex.getAccessToken();
  } catch (err) {
    return {
      status: 'error', projectId, location, tokenOk: false,
      videoModels: VEO_MODEL_IDS, imageModels: IMAGE_MODEL_IDS,
      message: `Не удалось получить токен доступа: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return {
    status: 'ok', projectId, location, tokenOk: true,
    videoModels: VEO_MODEL_IDS, imageModels: IMAGE_MODEL_IDS,
    message: `Vertex AI подключён: проект ${projectId}, регион ${location}.`,
  };
});

exports.testProviderConnection = onCall({ cors: true, timeoutSeconds: 30 }, async (request) => {
  ensureCallableAuth(request.auth);
  ensureAllowedVideoStudioEmail(request.auth);
  const allDiagnostics = getAllProviderDiagnostics();
  return {
    providers: Object.fromEntries(
      Object.entries(allDiagnostics).map(([key, diag]) => [key, {
        name: diag.name, configured: diag.configured, mockMode: diag.mockMode,
        status: diag.configured || diag.mockMode ? 'ok' : 'not_configured',
      }]),
    ),
  };
});

exports.saveClaudeSettings = onCall({ cors: true, timeoutSeconds: 30 }, async (request) => {
  const userId = ensureCallableAuth(request.auth);
  ensureAllowedVideoStudioEmail(request.auth);
  const apiKey = String(request.data?.apiKey || '').trim();
  const mcpUrl = String(request.data?.mcpUrl || '').trim();
  if (!apiKey && !mcpUrl) throw new HttpsError('invalid-argument', 'Укажите API-ключ или MCP URL.');
  const settingsRef = db.collection('videoStudioSettings').doc(userId);
  const updateData = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (apiKey) updateData.claudeApiKey = apiKey;
  if (mcpUrl) updateData.claudeMcpUrl = mcpUrl;
  await settingsRef.set(updateData, { merge: true });
  return { success: true, hasSavedKey: Boolean(apiKey), hasSavedMcpUrl: Boolean(mcpUrl) };
});

exports.testClaudeConnection = onCall({ cors: true, timeoutSeconds: 30 }, async (request) => {
  const userId = ensureCallableAuth(request.auth);
  ensureAllowedVideoStudioEmail(request.auth);
  const snap = await db.collection('videoStudioSettings').doc(userId).get();
  const data = snap.data() || {};
  const apiKey = String(data.claudeApiKey || '').trim();
  const mcpUrl = String(data.claudeMcpUrl || '').trim();
  if (!apiKey) return { status: 'error', hasApiKey: false, hasMcpUrl: Boolean(mcpUrl), model: null, message: 'API-ключ Claude не найден.' };
  try {
    const result = await callAnthropicApi(apiKey, { model: 'claude-haiku-4-5', max_tokens: 5, messages: [{ role: 'user', content: 'Hi' }] });
    if (result.statusCode === 200) {
      const parsed = JSON.parse(result.body);
      return { status: 'ok', hasApiKey: true, hasMcpUrl: Boolean(mcpUrl), mcpUrl: mcpUrl || null, model: parsed.model || 'claude-haiku-4-5', message: 'Claude API подключён успешно.' };
    }
    if (result.statusCode === 401) return { status: 'error', hasApiKey: true, hasMcpUrl: Boolean(mcpUrl), model: null, message: 'API-ключ недействителен (401).' };
    const errBody = JSON.parse(result.body || '{}');
    return { status: 'error', hasApiKey: true, hasMcpUrl: Boolean(mcpUrl), model: null, message: `Ошибка API: ${errBody?.error?.message || `HTTP ${result.statusCode}`}` };
  } catch (err) {
    return { status: 'error', hasApiKey: true, hasMcpUrl: Boolean(mcpUrl), model: null, message: `Ошибка подключения: ${err.message}` };
  }
});

exports.getClaudeSettings = onCall({ cors: true, timeoutSeconds: 10 }, async (request) => {
  const userId = ensureCallableAuth(request.auth);
  ensureAllowedVideoStudioEmail(request.auth);
  const snap = await db.collection('videoStudioSettings').doc(userId).get();
  const data = snap.data() || {};
  return { hasApiKey: Boolean(String(data.claudeApiKey || '').trim()), mcpUrl: String(data.claudeMcpUrl || '').trim() || null };
});

exports.setAdminClaim = onCall({ cors: true, timeoutSeconds: 30 }, async (request) => {
  ensureCallableAuth(request.auth);
  const targetEmail = String(request.data?.email || '').trim().toLowerCase();
  if (!targetEmail) throw new HttpsError('invalid-argument', 'Email обязателен.');
  const bootstrapDoc = await db.collection('_adminBootstrap').doc('config').get();
  const isInitialized = bootstrapDoc.exists && bootstrapDoc.data()?.initialized === true;
  if (isInitialized && !request.auth.token.admin) {
    throw new HttpsError('permission-denied', 'Только администратор может выдавать права администратора.');
  }
  let userRecord;
  try { userRecord = await admin.auth().getUserByEmail(targetEmail); }
  catch { throw new HttpsError('not-found', `Пользователь ${targetEmail} не найден.`); }
  await admin.auth().setCustomUserClaims(userRecord.uid, { admin: true });
  if (!isInitialized) {
    await db.collection('_adminBootstrap').doc('config').set({
      initialized: true, firstAdminEmail: targetEmail,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  return { success: true, message: `Права администратора выданы для ${targetEmail}.` };
});

exports.generateMcpToken = onCall({ cors: true, timeoutSeconds: 15 }, async (request) => {
  const userId = ensureCallableAuth(request.auth);
  ensureAllowedVideoStudioEmail(request.auth);
  const oldTokens = await db.collection('mcpTokens').where('userId', '==', userId).get();
  const batch = db.batch();
  oldTokens.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  const token = crypto.randomBytes(32).toString('hex');
  await db.collection('mcpTokens').doc(token).set({ userId, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  const mcpUrl = `https://mcpvideostudio-5ewqb3guda-uc.a.run.app?token=${token}`;
  return { token, mcpUrl };
});

exports.getMcpToken = onCall({ cors: true, timeoutSeconds: 10 }, async (request) => {
  const userId = ensureCallableAuth(request.auth);
  ensureAllowedVideoStudioEmail(request.auth);
  const snap = await db.collection('mcpTokens').where('userId', '==', userId).limit(1).get();
  if (snap.empty) return { mcpUrl: null };
  const token = snap.docs[0].id;
  return { mcpUrl: `https://mcpvideostudio-5ewqb3guda-uc.a.run.app?token=${token}` };
});

exports.startVideoGeneration = onCall({ cors: true, timeoutSeconds: 1800, memory: '1GiB' }, async (request) => {
  const userId = ensureCallableAuth(request.auth);
  const data = request.data || {};
  const generationId = requireStringField(data, 'generationId', 160);
  const prompt = requireStringField(data, 'prompt', 8000);
  const modelId = requireEnumField(data, 'modelId', getVideoProviderTypes().ALL_MODEL_IDS);
  const mode = requireEnumField(data, 'mode', ['text_to_video', 'image_to_video', 'reference_to_video']);
  const aspectRatio = requireEnumField(data, 'aspectRatio', ['9:16', '16:9', '1:1']);
  const duration = requireDuration(data);
  const stylePreset = requireEnumField(data, 'stylePreset', ['Cinematic', 'UGC', 'App Promo', 'AI Social Platform Ad', 'School Viral Reel', 'Product Demo', 'Character Story']);
  const cameraMotion = requireEnumField(data, 'cameraMotion', ['Static', 'Zoom in', 'Dolly in', 'Handheld', 'Orbit', 'Pan']);
  const referenceImageUrl = optionalStringField(data, 'referenceImageUrl');
  const referenceVideoUrl = optionalStringField(data, 'referenceVideoUrl');
  const referenceAudioUrl = optionalStringField(data, 'referenceAudioUrl');
  const enrichedPrompt = optionalStringField(data, 'enrichedPrompt', 16000);
  const referenceImageUrls = Array.isArray(data.referenceImageUrls)
    ? data.referenceImageUrls.filter((u) => typeof u === 'string' && u.trim()).slice(0, 9)
    : undefined;
  const referenceMode = optionalStringField(data, 'referenceMode', 40);
  const referenceCount = typeof data.referenceCount === 'number' ? data.referenceCount : (referenceImageUrls?.length ?? (referenceImageUrl ? 1 : 0));
  const elements = Array.isArray(data.elements) ? data.elements.slice(0, 20) : undefined;

  const generationRef = db.collection('video_generations').doc(generationId);
  const snapshot = await generationRef.get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'Video generation was not found.');
  const existing = snapshot.data() || {};
  if (existing.userId !== userId) throw new HttpsError('permission-denied', 'This generation belongs to another user.');

  await checkRateLimit(userId);

  const providerId = getVideoProviderTypes().MODEL_TO_PROVIDER[modelId] || 'unknown';
  const effectivePrompt = enrichedPrompt || prompt;

  console.info('[startVideoGeneration] routing', { generationId, modelId, providerId, userId });

  const providerRequest = cleanUndefinedValues({
    id: generationId, userId, prompt: effectivePrompt, rawPrompt: prompt,
    modelId, provider: providerId, mode, aspectRatio, duration, stylePreset, cameraMotion,
    referenceImageUrl, referenceVideoUrl, referenceAudioUrl,
  });

  await generationRef.update(cleanUndefinedValues({
    ...providerRequest, status: 'processing', provider: providerId,
    errorMessage: admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }));

  const mockForModel = isMockModeForModel(modelId);

  try {
    const bucket = admin.storage().bucket();
    const result = await generateVideo({ bucket, request: providerRequest });
    await generationRef.update(cleanUndefinedValues({
      status: 'completed', resultVideoUrl: result.resultVideoUrl,
      resultStoragePath: result.storagePath, provider: providerRequest.provider,
      providerMockMode: false, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }));
    return { ok: true, generationId, status: 'completed', resultVideoUrl: result.resultVideoUrl, resultStoragePath: result.storagePath, mock: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('startVideoGeneration failed:', { generationId, userId, modelId, mock: mockForModel, message, stack: error?.stack || '' });
    await generationRef.update({ status: 'failed', errorMessage: message, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    throw new HttpsError('internal', message);
  }
});
