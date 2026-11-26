
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e', testMatch: ['hub.e2e.ts', 'collections.e2e.ts', 'music.e2e.ts'], workers: 1,
  timeout: 60000, expect: { timeout: 15000 },
  use: { baseURL: 'http://127.0.0.1:15526', viewport: { width: 1280, height: 720 } },
  webServer: { command: 'node node_modules/vite/bin/vite.js --mode mock --port 15526 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:15526' },
});


