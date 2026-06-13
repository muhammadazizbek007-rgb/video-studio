import type { Language } from '../data/translations';

export const LANGUAGE_OPTIONS: Array<{ id: Language; label: string }> = [
  { id: 'ru', label: 'Русский' },
  { id: 'uz', label: "O'zbek" },
  { id: 'en', label: 'English' },
];

export function getLanguageLabel(language: Language) {
  return LANGUAGE_OPTIONS.find((item) => item.id === language)?.label || 'Русский';
}

export function getLocalizedProductName(product: any, language: Language) {
  if (language === 'uz') {
    return String(product?.nameUz || product?.name_uz || product?.name || '').trim();
  }

  if (language === 'en') {
    return String(product?.nameEn || product?.name_en || product?.name || '').trim();
  }

  return String(product?.name || product?.nameRu || product?.name_ru || '').trim();
}

export function getLocalizedProductDescription(product: any, language: Language) {
  if (language === 'uz') {
    return String(product?.descriptionUz || product?.description_uz || product?.description || '').trim();
  }

  if (language === 'en') {
    return String(product?.descriptionEn || product?.description_en || product?.description || '').trim();
  }

  return String(product?.description || product?.descriptionRu || product?.description_ru || '').trim();
}

export function getLocalizedCategoryName(category: any, language: Language) {
  if (language === 'uz') {
    return String(category?.name_uz || category?.name_ru || '').trim();
  }

  if (language === 'en') {
    return String(category?.name_en || category?.name_ru || category?.name_uz || '').trim();
  }

  return String(category?.name_ru || category?.name_uz || '').trim();
}
