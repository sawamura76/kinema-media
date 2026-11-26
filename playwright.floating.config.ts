import base from './playwright.music.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({ ...base, testMatch: '**/floating.e2e.ts' });
