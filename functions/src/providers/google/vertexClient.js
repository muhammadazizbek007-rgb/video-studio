'use strict';

/**
 * Shared Vertex AI client for all Google generative models (Veo, Imagen, Gemini).
 *
 * Auth uses Application Default Credentials — inside Cloud Functions this is the
 * project's own service account, so no API key needs to be configured anywhere.
 * The service account needs the "Vertex AI User" role (roles/aiplatform.user).
 */

const { GoogleAuth } = require('google-auth-library');

const DEFAULT_LOCATION = 'us-central1';

let authClient = null;

function getAuth() {
  if (!authClient) {
    authClient = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  }
  return authClient;
}

function getProjectId() {
  const projectId = String(
    process.env.VERTEX_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    '',
  ).trim();
  if (!projectId) {
    throw new Error('Vertex AI project id is not resolvable. Set VERTEX_PROJECT_ID in Firebase Functions config.');
  }
  return projectId;
}

function getLocation() {
  return String(process.env.VERTEX_LOCATION || DEFAULT_LOCATION).trim() || DEFAULT_LOCATION;
}

function isConfigured() {
  try {
    getProjectId();
    return true;
  } catch {
    return false;
  }
}

async function getAccessToken() {
  const token = await getAuth().getAccessToken();
  if (!token) throw new Error('Failed to obtain a Google Cloud access token for Vertex AI.');
  return token;
}

/** Base URL for a publisher model, e.g. .../publishers/google/models/veo-3.1-generate-preview */
function modelUrl(modelName) {
  const location = getLocation();
  const project = getProjectId();
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${modelName}`;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/**
 * POST to a Vertex AI model endpoint.
 * @param {string} modelName  publisher model id
 * @param {string} method     ':predict' | ':predictLongRunning' | ':fetchPredictOperation' | ':generateContent'
 * @param {object} body       request payload
 */
async function callVertex(modelName, method, body) {
  const token = await getAccessToken();
  const url = `${modelUrl(modelName)}${method}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`Vertex AI request failed (${modelName}${method}): ${error instanceof Error ? error.message : String(error)}`);
  }

  const payload = await readJson(response);

  if (!response.ok) {
    const detail = payload?.error?.message || JSON.stringify(payload);
    throw new Error(`Vertex AI ${modelName}${method} failed: ${response.status} ${detail}`);
  }

  return payload;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  DEFAULT_LOCATION,
  callVertex,
  getAccessToken,
  getLocation,
  getProjectId,
  isConfigured,
  modelUrl,
  readJson,
  wait,
};
