'use strict';

const wavespeed = require('./wavespeedImageProvider');

const IMAGE_PROVIDERS = [
  {
    id: 'wavespeed',
    name: 'WaveSpeed HiDream',
    status: 'active',
    description: 'Быстрая генерация изображений, модель HiDream-I1',
    costCredits: 5,
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    models: ['hidream-i1-fast', 'hidream-i1-full'],
  },
];

async function generateImage(params) {
  const provider = String(params.provider || 'wavespeed').toLowerCase();

  switch (provider) {
    case 'wavespeed':
      return wavespeed.generateImage(params);
    default:
      throw new Error(
        `Провайдер изображений '${provider}' не поддерживается. Доступные: wavespeed`
      );
  }
}

function getImageProviders() {
  return IMAGE_PROVIDERS;
}

module.exports = { generateImage, getImageProviders };
