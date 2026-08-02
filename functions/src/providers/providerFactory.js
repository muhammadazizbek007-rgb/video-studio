'use strict';

const { PROVIDER_IDS, MODEL_TO_PROVIDER } = require('./videoProviderTypes');
const {
  generateVeoVideo,
  isMockMode: isVeoMock,
  isConfigured: isVeoConfigured,
  getDiagnostics: getVeoDiagnostics,
} = require('./google/veoProvider');
const {
  generateJson2videoVideo,
  isMockMode: isJson2videoMock,
  isConfigured: isJson2videoConfigured,
  getDiagnostics: getJson2videoDiagnostics,
} = require('./json2videoProvider');

function getProviderIdForModel(modelId) {
  return MODEL_TO_PROVIDER[modelId] || null;
}

async function generateVideo({ bucket, request }) {
  const providerId = getProviderIdForModel(request.modelId);

  if (!providerId) {
    throw new Error(`Unknown model: ${request.modelId}. No provider is registered for this model.`);
  }

  console.info(`[providerFactory] generateVideo → modelId=${request.modelId} providerId=${providerId}`);

  switch (providerId) {
    case PROVIDER_IDS.VEO:
      return generateVeoVideo({ bucket, request });
    case PROVIDER_IDS.JSON2VIDEO:
      return generateJson2videoVideo({ bucket, request });
    default:
      throw new Error(`Provider not implemented: ${providerId}`);
  }
}

function isMockModeForModel(modelId) {
  switch (getProviderIdForModel(modelId)) {
    case PROVIDER_IDS.VEO:        return isVeoMock();
    case PROVIDER_IDS.JSON2VIDEO: return isJson2videoMock();
    default: return true;
  }
}

function getAllProviderDiagnostics() {
  return {
    veo: {
      providerId: PROVIDER_IDS.VEO,
      name: 'Google Veo (Vertex AI)',
      configured: isVeoConfigured(),
      ...getVeoDiagnostics(),
    },
    json2video: {
      providerId: PROVIDER_IDS.JSON2VIDEO,
      name: 'JSON2Video (slideshow)',
      configured: isJson2videoConfigured(),
      mockMode: isJson2videoMock(),
      ...getJson2videoDiagnostics(),
    },
  };
}

module.exports = { generateVideo, getProviderIdForModel, isMockModeForModel, getAllProviderDiagnostics };
