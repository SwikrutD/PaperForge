import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Preload is bundled as CommonJS because sandboxed preload scripts cannot be ES modules.
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'preload.js',
      },
    },
  },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
});
