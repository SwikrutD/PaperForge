import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react({})],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  build: {
    target: 'chrome140',
    sourcemap: true,
    chunkSizeWarningLimit: 1024,
  },
  server: {
    // Offline-first: never let the dev server reach outside localhost.
    host: '127.0.0.1',
    strictPort: false,
  },
});
