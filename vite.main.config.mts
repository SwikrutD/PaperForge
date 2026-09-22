import { defineConfig } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { version } = createRequire(import.meta.url)('./package.json') as { version: string };

// The Electron Forge Vite plugin supplies entry, format (cjs), externals and output paths.
// This file only adds PaperForge-specific resolution.
export default defineConfig({
  // Unpackaged runs have no package.json next to the bundle, so app.getVersion()
  // would report Electron's version instead of PaperForge's.
  define: { __APP_VERSION__: JSON.stringify(version) },
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
