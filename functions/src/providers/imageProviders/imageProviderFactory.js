'use strict';

const imagen = require('../google/imagenProvider');

const IMAGE_PROVIDERS = [
  {
    id: 'google',
    name: 'Google Imagen / Gemini Image',
    status: 'active',
    description: 'Imagen 4 — генерация с нуля, Gemini Image — редактирование готового фото',
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    models: imagen.IMAGE_MODEL_IDS,
    defaultModel: imagen.DEFAULT_IMAGE_MODEL,
  },
];

async function generateImage(params) {
  const provider = String(params.provider || 'google').toLowerCase();

  switch (provider) {
    case 'google':
      return imagen.generateImage(params);
    default:
      throw new Error(
        `Провайдер изображений '${provider}' не поддерживается. Доступные: google`,
      );
  }
}

function getImageProviders() {
  return IMAGE_PROVIDERS;
}

module.exports = { generateImage, getImageProviders };
