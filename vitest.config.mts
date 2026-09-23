import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@pdf': fileURLToPath(new URL('./src/pdf', import.meta.url)),
      '@conversion': fileURLToPath(new URL('./src/conversion', import.meta.url)),
    },
  },
  plugins: [react({})],
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    // Testing Library registers its automatic DOM cleanup through the global
    // afterEach hook.
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    reporters: ['default'],
  },
});
