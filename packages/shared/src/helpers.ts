import type { VideoElementCategory } from './types.js';

const HANDLE_STRIP = /[^a-zA-Z0-9_а-яёА-ЯЁ]/g;
const MENTION_PATTERN = /@[\wа-яёА-ЯЁ]+/g;

export function buildHandle(name: string): string {
  const clean = name.trim().replace(/\s+/g, '_').replace(HANDLE_STRIP, '');
  return `@${clean}`;
}

export function extractMentions(prompt: string): string[] {
  const matches = prompt.match(MENTION_PATTERN) ?? [];
  return [...new Set(matches)];
}

export const ELEMENT_CATEGORY_LABELS: Record<VideoElementCategory, string> = {
  general: 'Общие',
  character: 'Персонажи',
  location: 'Локации',
  prop: 'Реквизит',
};
