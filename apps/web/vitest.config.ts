import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const setupFile = fileURLToPath(new URL('./src/test/setup.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    css: false,
    restoreMocks: true,
    // Optional so component-test agents can drop in a jest-dom setup without
    // this config having to change.
    setupFiles: existsSync(setupFile) ? [setupFile] : [],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
