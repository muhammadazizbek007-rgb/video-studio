/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin. Empty in production, where the API is served from the same origin. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
