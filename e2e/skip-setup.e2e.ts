import { test, expect } from '@playwright/test';

test('fresh audio-only launch can skip setup by remote with no movie folders', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kinemaMockEmpty', '1'));
  await page.goto('/');
  const skip = page.getByRole('button', { name: 'Skip setup', exact: true });
  await expect(skip).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scan my library', exact: true })).toBeDisabled();
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Music', exact: true })).toBeVisible();
  expect(await page.evaluate(async () => {
    const path = '/src/metadata/api.ts';
    const api = await import(/* @vite-ignore */ path);
    return api.getSetting('setup_pages');
  })).toBe('done');
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Kinema', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add music folder', exact: true })).toBeVisible();
});

test('saved setup dismissal keeps an empty library out of first-run setup on restart', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('kinemaMockEmpty', '1'); localStorage.setItem('kinemaMockSetupDone', '1'); });
  await page.goto('/');
  await expect(page.locator('.top-nav')).toBeVisible();
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Music', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('.first-run')).toHaveCount(0);
});
