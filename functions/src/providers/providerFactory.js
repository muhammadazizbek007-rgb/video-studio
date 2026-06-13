'use strict';

const { PROVIDER_IDS, MODEL_TO_PROVIDER } = require('./videoProviderTypes');
const { generateSeedanceVideo, isMockMode: isSeedanceMock, getDiagnostics: getSeedanceDiagnostics } = require('./seedanceProvider');
const { generateReplicateVideo, isMockMode: isReplicateMock, isConfigured: isReplicateConfigured, getDiagnostics: getReplicateDiagnostics } = require('./replicateProvider');
const { generateWavespeedVideo, isMockMode: isWavespeedMock, isConfigured: isWavespeedConfigured, getDiagnostics: getWavespeedDiagnostics } = require('./wavespeedProvider');
const { generateHuggingfaceVideo, isMockMode: isHuggingfaceMock, isConfigured: isHuggingfaceConfigured, getDiagnostics: getHuggingfaceDiagnostics } = require('./huggingfaceProvider');
const { generateLeonardoVideo, isMockMode: isLeonardoMock, isConfigured: isLeonardoConfigured, getDiagnostics: getLeonardoDiagnostics } = require('./leonardoProvider');
const { generateJson2videoVideo, isMockMode: isJson2videoMock, isConfigured: isJson2videoConfigured, getDiagnostics: getJson2videoDiagnostics } = require('./json2videoProvider');
// Free / Open-Source providers
const { generateCogVideoXVideo, isMockMode: isCogVideoXMock, isConfigured: isCogVideoXConfigured, getDiagnostics: getCogVideoXDiagnostics } = require('./cogVideoXProvider');
const { generateLtxVideo, isMockMode: isLtxMock, isConfigured: isLtxConfigured, getDiagnostics: getLtxDiagnostics } = require('./ltxVideoProvider');
const { generateSvdVideo, isMockMode: isSvdMock, isConfigured: isSvdConfigured, getDiagnostics: getSvdDiagnostics } = require('./stableVideoDiffusionProvider');
const { generateOpenSoraVideo, isMockMode: isOpenSoraMock, isConfigured: isOpenSoraConfigured, getDiagnostics: getOpenSoraDiagnostics } = require('./openSoraProvider');

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
    case PROVIDER_IDS.SEEDANCE:
      return generateSeedanceVideo({ bucket, request });
    case PROVIDER_IDS.REPLICATE:
      return generateReplicateVideo({ bucket, request });
    case PROVIDER_IDS.WAVESPEED:
      return generateWavespeedVideo({ bucket, request });
    case PROVIDER_IDS.HUGGINGFACE:
      return generateHuggingfaceVideo({ bucket, request });
    case PROVIDER_IDS.LEONARDO:
      return generateLeonardoVideo({ bucket, request });
    case PROVIDER_IDS.JSON2VIDEO:
      return generateJson2videoVideo({ bucket, request });
    case PROVIDER_IDS.COGVIDEOX:
      return generateCogVideoXVideo({ bucket, request });
    case PROVIDER_IDS.LTX:
      return generateLtxVideo({ bucket, request });
    case PROVIDER_IDS.SVD:
      return generateSvdVideo({ bucket, request });
    case PROVIDER_IDS.OPENSORA:
      return generateOpenSoraVideo({ bucket, request });
    default:
      throw new Error(`Provider not implemented: ${providerId}`);
  }
}

function isMockModeForModel(modelId) {
  const providerId = getProviderIdForModel(modelId);
  switch (providerId) {
    case PROVIDER_IDS.SEEDANCE:    return isSeedanceMock();
    case PROVIDER_IDS.REPLICATE:   return isReplicateMock();
    case PROVIDER_IDS.WAVESPEED:   return isWavespeedMock();
    case PROVIDER_IDS.HUGGINGFACE: return isHuggingfaceMock();
    case PROVIDER_IDS.LEONARDO:    return isLeonardoMock();
    case PROVIDER_IDS.JSON2VIDEO:  return isJson2videoMock();
    case PROVIDER_IDS.COGVIDEOX:   return isCogVideoXMock();
    case PROVIDER_IDS.LTX:         return isLtxMock();
    case PROVIDER_IDS.SVD:         return isSvdMock();
    case PROVIDER_IDS.OPENSORA:    return isOpenSoraMock();
    default: return true;
  }
}

function getAllProviderDiagnostics() {
  const seedanceDiag = getSeedanceDiagnostics ? getSeedanceDiagnostics() : { configured: true, mockMode: isSeedanceMock() };
  return {
    seedance: { providerId: PROVIDER_IDS.SEEDANCE, name: 'Seedance 2.0', ...seedanceDiag },
    replicate: { providerId: PROVIDER_IDS.REPLICATE, name: 'Replicate', configured: isReplicateConfigured(), mockMode: isReplicateMock() },
    wavespeed: { providerId: PROVIDER_IDS.WAVESPEED, name: 'WaveSpeed', configured: isWavespeedConfigured(), mockMode: isWavespeedMock() },
    huggingface: { providerId: PROVIDER_IDS.HUGGINGFACE, name: 'HuggingFace (legacy)', configured: isHuggingfaceConfigured(), mockMode: isHuggingfaceMock() },
    leonardo: { providerId: PROVIDER_IDS.LEONARDO, name: 'Leonardo AI', configured: isLeonardoConfigured(), mockMode: isLeonardoMock() },
    json2video: { providerId: PROVIDER_IDS.JSON2VIDEO, name: 'JSON2Video', configured: isJson2videoConfigured(), mockMode: isJson2videoMock() },
    // Free / Open-Source
    cogvideox: { providerId: PROVIDER_IDS.COGVIDEOX, name: 'CogVideoX Free', ...getCogVideoXDiagnostics(), free: true },
    ltx: { providerId: PROVIDER_IDS.LTX, name: 'LTX-Video Fast', ...getLtxDiagnostics(), free: true },
    svd: { providerId: PROVIDER_IDS.SVD, name: 'Stable Video Diffusion', ...getSvdDiagnostics(), free: true },
    opensora: { providerId: PROVIDER_IDS.OPENSORA, name: 'Open-Sora', ...getOpenSoraDiagnostics(), free: true },
  };
}

module.exports = { generateVideo, getProviderIdForModel, isMockModeForModel, getAllProviderDiagnostics };
