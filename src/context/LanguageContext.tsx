import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Language } from '../data/translations';

type LanguageContextValue = {
  currentLanguage: Language;
  setCurrentLanguage: (language: Language) => void;
};

const DEFAULT_LANGUAGE: Language = 'ru';

const LanguageContext = createContext<LanguageContextValue | null>(null);

function resolveLanguageFromUrl() {
  if (typeof window === 'undefined') return '';

  const urlLanguage = new URLSearchParams(window.location.search).get('lang');
  return urlLanguage === 'ru' || urlLanguage === 'uz' || urlLanguage === 'en' ? urlLanguage : '';
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [currentLanguage, setCurrentLanguage] = useState<Language>(() => {
    const urlLanguage = resolveLanguageFromUrl();
    if (urlLanguage) {
      return urlLanguage;
    }

    const stored = localStorage.getItem('language');
    return stored === 'ru' || stored === 'uz' || stored === 'en' ? stored : DEFAULT_LANGUAGE;
  });

  useEffect(() => {
    localStorage.setItem('language', currentLanguage);
    document.documentElement.lang = currentLanguage === 'uz' ? 'uz' : currentLanguage;
  }, [currentLanguage]);

  const value = useMemo(
    () => ({
      currentLanguage,
      setCurrentLanguage,
    }),
    [currentLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
}
