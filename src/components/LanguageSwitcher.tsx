import React from 'react';
import { Globe } from 'lucide-react';
import type { Language } from '../data/translations';
import { LANGUAGE_OPTIONS, getLanguageLabel } from '../utils/languageHelpers';

interface LanguageSwitcherProps {
  value: Language;
  onChange: (language: Language) => void;
  variant?: 'light' | 'dark';
  compact?: boolean;
  currencyCompact?: boolean;
}

export default function LanguageSwitcher({
  value,
  onChange,
  variant = 'light',
  compact = false,
  currencyCompact = false,
}: LanguageSwitcherProps) {
  const isDark = variant === 'dark';

  if (currencyCompact) {
    return (
      <label className="relative inline-flex h-7 items-center gap-1.5 overflow-hidden rounded-lg border border-white/15 bg-white/12 px-2 text-white shadow-[0_8px_18px_-14px_rgba(15,23,42,0.45)] transition hover:bg-white/18">
        <span className="pointer-events-none flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] leading-none">
          🇺🇿
        </span>
        <span className="pointer-events-none text-[13px] font-bold leading-none">UZS</span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value as Language)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label="Выбор языка"
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label
      className={`relative inline-flex items-center gap-2 overflow-hidden rounded-xl border px-3 ${
        compact ? 'h-10' : 'h-11'
      } ${isDark ? 'border-white/10 bg-white/5 text-white' : 'border-gray-200 bg-white text-gray-700'}`}
    >
      <Globe className={`h-4 w-4 shrink-0 ${isDark ? 'text-gray-300' : 'text-gray-500'}`} />
      <span className={`pointer-events-none text-sm font-medium ${compact ? 'hidden sm:inline' : 'inline'}`}>
        {getLanguageLabel(value)}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as Language)}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label="Выбор языка"
      >
        {LANGUAGE_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
