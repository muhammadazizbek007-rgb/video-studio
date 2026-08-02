'use strict';

const { VEO_MODEL_IDS } = require('./google/veoProvider');

const PROVIDER_IDS = Object.freeze({
  VEO: 'veo',
  // Template slideshow renderer — not AI generation, kept as a utility
  JSON2VIDEO: 'json2video',
});

const MODEL_TO_PROVIDER = Object.freeze({
  ...Object.fromEntries(VEO_MODEL_IDS.map((modelId) => [modelId, PROVIDER_IDS.VEO])),
  json2video: PROVIDER_IDS.JSON2VIDEO,
});

const ALL_MODEL_IDS = Object.keys(MODEL_TO_PROVIDER);

module.exports = { PROVIDER_IDS, MODEL_TO_PROVIDER, ALL_MODEL_IDS };
