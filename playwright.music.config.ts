import base from './playwright.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({ ...base, webServer: undefined, use: { ...base.use, baseURL: 'http://127.0.0.1:1442' }, testMatch: '**/music.e2e.ts', workers: 1, projects: [{ name: 'chromium', use: { browserName: 'chromium' } }] });
