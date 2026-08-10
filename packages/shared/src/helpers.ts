import type { VideoElementCategory } from './types.js';

/**
 * A handle keeps letters, digits and underscores in *any* script. An ASCII-only rule silently
 * mangled every non-Latin name — `Mustaqillik oʻzbek` and `Мұхаммед` alike — into something
 * the user never typed and could no longer mention.
 */
const HANDLE_STRIP = /[^\p{L}\p{N}_]/gu;
const MENTION_PATTERN = /@[\p{L}\p{N}_]+/gu;

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
