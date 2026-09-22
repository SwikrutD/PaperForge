import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests drive the packaged Windows application, so they exercise the
 * real main process, the app:// renderer and the security fuses. Run
 * `npm run package` first; `npm run test:e2e` does that for you.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  // Electron cannot be driven by several workers at once, and PaperForge holds
  // a single-instance lock.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
});
