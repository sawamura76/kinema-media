import base from './playwright.music.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({ ...base, testMatch: '**/player.e2e.ts' });

