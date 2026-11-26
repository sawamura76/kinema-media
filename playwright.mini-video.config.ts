import base from './playwright.single-music-bar.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({ ...base, testMatch: '**/player.e2e.ts' });

