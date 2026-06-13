import { useEffect, type ReactNode } from 'react';
import { useLanguage } from '../../context/LanguageContext';

const RU_VIDEO_COPY: Record<string, string> = {
  Dashboard: 'Панель',
  Studio: 'Студия',
  Settings: 'Настройки',
  'Video Dashboard': 'Панель видео',
  'Video Studio': 'Видео студия',
  'Video Studio settings': 'Настройки Video Studio',
  'Language settings': 'Настройки языка',
  'Choose the site language. Russian is saved as your default on this device.':
    'Выберите язык сайта. Русский будет сохранён на этом устройстве.',
  'Translate site to Russian': 'Перевести сайт на русский',
  'Seedance API Diagnostics': 'Диагностика Seedance API',
  'Safe backend-only check. The API key is never shown in the browser.':
    'Безопасная backend-проверка. API-ключ никогда не показывается в браузере.',
  'Test Seedance Connection': 'Проверить Seedance',
  Testing: 'Проверяем...',
  'Mock mode': 'Mock-режим',
  'Live test mode': 'Live test mode',
  'Provider flavor': 'Тип провайдера',
  'API key': 'API-ключ',
  'Base URL': 'Base URL',
  Status: 'Статус',
  active: 'активен',
  inactive: 'неактивен',
  configured: 'настроен',
  'not configured': 'не настроен',
  'not tested': 'не проверено',
  error: 'ошибка',
  'New video': 'Новое видео',
  'Total videos': 'Всего видео',
  Completed: 'Готово',
  Processing: 'В процессе',
  Failed: 'Ошибка',
  'Recent generations': 'Последние генерации',
  'No videos yet.': 'Видео пока нет.',
  Open: 'Открыть',
  'Back to dashboard': 'Назад на панель',
  'Creative brief': 'Креативный бриф',
  Prompt: 'Промпт',
  'Enhance Prompt': 'Улучшить промпт',
  'Shot List': 'Shot List',
  Add: 'Добавить',
  'Shot title': 'Название shot',
  'Shot description': 'Описание shot',
  'Build prompt from shots': 'Собрать промпт из shots',
  Model: 'Модель',
  Mode: 'Режим',
  'Reference media': 'Reference media',
  Output: 'Параметры',
  'Aspect ratio': 'Формат',
  Duration: 'Длительность',
  'Style preset': 'Стиль',
  'Camera movement': 'Движение камеры',
  'Generate Video': 'Сгенерировать видео',
  Download: 'Скачать',
  'Copy prompt': 'Скопировать промпт',
  Regenerate: 'Повторить',
  'Save to Gallery': 'Сохранить',
  'Continue as guest': 'Войти как гость',
  'Sign in to generate videos': 'Войдите, чтобы генерировать видео',
  'Sign in to view your video dashboard': 'Войдите, чтобы открыть панель видео',
  'Your generations are private and attached to your Firebase user.':
    'Ваши генерации приватны и привязаны к Firebase-пользователю.',
};

const textNodeOriginals = new WeakMap<Text, string>();

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function translateValue(value: string) {
  const normalized = normalizeText(value);
  return normalized ? RU_VIDEO_COPY[normalized] : undefined;
}

function shouldSkipElement(element: Element | null) {
  if (!element) return false;
  return Boolean(element.closest('script, style, code, pre, textarea'));
}

function translateNode(root: ParentNode, language: string) {
  const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  while (textWalker.nextNode()) {
    textNodes.push(textWalker.currentNode as Text);
  }

  textNodes.forEach((textNode) => {
    if (shouldSkipElement(textNode.parentElement)) return;

    const original = textNodeOriginals.get(textNode) ?? textNode.nodeValue ?? '';
    if (!textNodeOriginals.has(textNode)) textNodeOriginals.set(textNode, original);

    if (language !== 'ru') {
      if (textNode.nodeValue !== original) textNode.nodeValue = original;
      return;
    }

    const translated = translateValue(original);
    if (translated && textNode.nodeValue !== translated) {
      textNode.nodeValue = original.match(/^\s/) ? ` ${translated}` : translated;
    }
  });
}

export default function VideoLanguageBridge({ children }: { children: ReactNode }) {
  const { currentLanguage } = useLanguage();

  useEffect(() => {
    const root = document.querySelector('[data-video-i18n-root]');
    if (!root) return undefined;

    translateNode(root, currentLanguage);

    const observer = new MutationObserver(() => {
      translateNode(root, currentLanguage);
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, [currentLanguage]);

  return <div data-video-i18n-root="true">{children}</div>;
}
