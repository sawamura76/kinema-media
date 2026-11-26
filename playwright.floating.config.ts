import base from './playwright.single-music-bar.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({ ...base, testMatch: '**/floating.e2e.ts' });
