'use strict';

// TODO: Open-Sora self-hosted integration
// Self-host setup: https://github.com/hpcaitech/Open-Sora
// Endpoint integration: configure OPENSORA_ENDPOINT in functions/.env
// Local GPU inference: requires A100/H100 GPU with 40GB+ VRAM

function isMockMode() {
  return true; // Always mock until self-hosted endpoint is configured
}

function isConfigured() {
  return Boolean(String(process.env.OPENSORA_ENDPOINT || '').trim());
}

function getDiagnostics() {
  return { configured: isConfigured(), mockMode: isMockMode(), note: 'Self-hosted endpoint required' };
}

async function generateOpenSoraVideo() {
  throw new Error('Open-Sora is not yet available. Self-hosted endpoint configuration is required. See openSoraProvider.js for setup instructions.');
}

module.exports = { generateOpenSoraVideo, isMockMode, isConfigured, getDiagnostics };
