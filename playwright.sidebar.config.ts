import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e', testMatch: ['sidebar.e2e.ts'], workers: 1,
  timeout: 60000, expect: { timeout: 12000 },
  use: { baseURL: 'http://127.0.0.1:15529', viewport: {width:1280,height:720}, screenshot:'only-on-failure' },
  webServer: {command:'node node_modules/vite/bin/vite.js --mode mock --port 15529 --strictPort --host 127.0.0.1',url:'http://127.0.0.1:15529'},
});
