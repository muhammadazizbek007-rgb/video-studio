import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 127.0.0.1 rather than localhost: on a dual-stack machine `localhost` resolves to ::1
// first, so a proxy target or health probe written as 127.0.0.1 finds nothing listening.
const API_DEV_TARGET = 'http://127.0.0.1:8080';
const DEV_HOST = '127.0.0.1';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: DEV_HOST,
    port: 5173,
    strictPort: true,
    // Proxying keeps the browser on one origin in dev so the httpOnly session
    // cookies the API sets are treated as first-party.
    proxy: {
      '/api': { target: API_DEV_TARGET, changeOrigin: true },
      '/media': { target: API_DEV_TARGET, changeOrigin: true },
    },
  },
  preview: {
    host: DEV_HOST,
    port: 4173,
  },
  build: {
    sourcemap: true,
    outDir: 'dist',
  },
});
