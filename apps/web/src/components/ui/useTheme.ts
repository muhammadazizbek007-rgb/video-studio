import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'vs-theme';

const listeners = new Set<() => void>();

let current: Theme | null = null;

function systemTheme(): Theme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStored(): Theme | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : null;
  } catch {
    return null;
  }
}

function applyToDocument(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  // Both classes are explicit so `.light` can beat the prefers-color-scheme fallback in the CSS.
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
}

function resolve(): Theme {
  if (current === null) {
    current = readStored() ?? systemTheme();
    applyToDocument(current);
  }
  return current;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): Theme {
  return resolve();
}

function getServerSnapshot(): Theme {
  return 'light';
}

export function setTheme(theme: Theme): void {
  current = theme;
  applyToDocument(theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private-mode storage failures must not break theming.
  }
  for (const listener of listeners) listener();
}

export interface UseThemeResult {
  theme: Theme;
  setTheme(theme: Theme): void;
  toggle(): void;
}

export function useTheme(): UseThemeResult {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme]);

  return { theme, setTheme, toggle };
}

/** Test-only: drops the memoised theme so the next read re-derives it from storage/system. */
export function resetThemeCache(): void {
  current = null;
}
