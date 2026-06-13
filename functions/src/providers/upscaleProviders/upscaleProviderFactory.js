'use strict';

const replicate = require('./replicate_upscaleProvider');

async function upscaleVideo(params) {
  return replicate.upscaleVideo(params);
}

module.exports = { upscaleVideo };
