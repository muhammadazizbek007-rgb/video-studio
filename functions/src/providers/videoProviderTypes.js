'use strict';

const PROVIDER_IDS = Object.freeze({
  SEEDANCE: 'seedance',
  REPLICATE: 'replicate',
  WAVESPEED: 'wavespeed',
  HUGGINGFACE: 'huggingface',
  LEONARDO: 'leonardo',
  JSON2VIDEO: 'json2video',
  // Free / Open-Source providers
  COGVIDEOX: 'cogvideox',
  LTX: 'ltx',
  SVD: 'svd',
  OPENSORA: 'opensora',
});

const MODEL_TO_PROVIDER = Object.freeze({
  // ── Existing premium providers ───────────────────────────────────────────────
  'seedance-2': PROVIDER_IDS.SEEDANCE,
  'replicate-wan-t2v': PROVIDER_IDS.REPLICATE,
  'replicate-wan-i2v': PROVIDER_IDS.REPLICATE,
  'replicate-kling': PROVIDER_IDS.REPLICATE,
  'replicate-luma': PROVIDER_IDS.REPLICATE,
  'wavespeed-wan': PROVIDER_IDS.WAVESPEED,
  'huggingface-cogvideox': PROVIDER_IDS.HUGGINGFACE,
  'huggingface-opensora': PROVIDER_IDS.HUGGINGFACE,
  'leonardo-motion': PROVIDER_IDS.LEONARDO,
  'json2video': PROVIDER_IDS.JSON2VIDEO,
  // ── Free / Open-Source providers ────────────────────────────────────────────
  'cogvideox-free': PROVIDER_IDS.COGVIDEOX,
  'ltx-fast': PROVIDER_IDS.LTX,
  'svd': PROVIDER_IDS.SVD,
  'opensora-prep': PROVIDER_IDS.OPENSORA,
});

const ALL_MODEL_IDS = Object.keys(MODEL_TO_PROVIDER);

module.exports = { PROVIDER_IDS, MODEL_TO_PROVIDER, ALL_MODEL_IDS };
