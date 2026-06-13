import { initializeApp } from 'firebase/app';

function envValue(key: string) {
  const value = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export const runtimeFirebaseConfig = {
  projectId: envValue('VITE_FIREBASE_PROJECT_ID') || '',
  appId: envValue('VITE_FIREBASE_APP_ID') || '',
  apiKey: envValue('VITE_FIREBASE_API_KEY') || '',
  authDomain: envValue('VITE_FIREBASE_AUTH_DOMAIN') || '',
  storageBucket: envValue('VITE_FIREBASE_STORAGE_BUCKET') || '',
  messagingSenderId: envValue('VITE_FIREBASE_MESSAGING_SENDER_ID') || '',
  measurementId: envValue('VITE_FIREBASE_MEASUREMENT_ID') || '',
};

export const firestoreDatabaseId =
  envValue('VITE_FIREBASE_DATABASE_ID') || '(default)';

export const app = initializeApp(runtimeFirebaseConfig);
