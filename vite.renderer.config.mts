import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

/**
 * PDF.js needs its character maps, standard fonts and colour profiles at
 * runtime. They are copied from the installed package into `public/pdfjs`, so
 * the dev server and the packaged build both serve them from the application
 * itself — nothing is ever fetched from the network.
 */
function stagePdfjsAssets(): Plugin {
  const assets = ['cmaps', 'standard_fonts', 'iccs'];

  return {
    name: 'paperforge:stage-pdfjs-assets',
    async buildStart() {
      const source = path.join(projectRoot, 'node_modules', 'pdfjs-dist');
      const target = path.join(projectRoot, 'public', 'pdfjs');

      for (const asset of assets) {
        const from = path.join(source, asset);
        const to = path.join(target, asset);
        try {
          await fs.access(from);
        } catch {
          this.warn(`pdfjs-dist/${asset} is missing; PDF rendering may be degraded.`);
          continue;
        }
        await fs.rm(to, { recursive: true, force: true });
        await fs.cp(from, to, { recursive: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [react({}), stagePdfjsAssets()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@pdf': fileURLToPath(new URL('./src/pdf', import.meta.url)),
      '@conversion': fileURLToPath(new URL('./src/conversion', import.meta.url)),
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
