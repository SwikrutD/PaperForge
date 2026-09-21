import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The Electron Forge Vite plugin supplies entry, format (cjs), externals and output paths.
// This file only adds PaperForge-specific resolution.
export default defineConfig({
  build: {
    // Deterministic output name so package.json "main" stays stable and the
    // main bundle cannot collide with the preload bundle.
    lib: {
      entry: 'src/main/index.ts',
      fileName: () => 'main.js',
      formats: ['cjs'],
    },
  },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
});
