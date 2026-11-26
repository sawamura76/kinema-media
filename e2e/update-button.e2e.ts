/**
 * Settings → Advanced → Updates: "Update to Skrin X" (round 9). Reached and
 * pressed by keys alone; says what happens at each step; a copy that cannot
 * update itself keeps the download page; a failed update says why and offers
 * the page.
 */
import { expect, test, type Page } from '@playwright/test';
import { focusKey, focused, open, press } from './kb';

async function toUpdates(page: Page, flags: Record<string, string>, system: 'windows' | 'linux' = 'windows') {
  await page.addInitScript((f) => {
    for (const [k, v] of Object.entries(f)) localStorage.setItem(k, v);
  }, flags);
  await open(page, system);
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.locator('.settings-nav button', { hasText: 'Advanced' }).first().click();
  await expect.poll(() => focusKey(page)).toMatch(/^settings-nav:/);
}

async function ringOn(page: Page, name: string) {
  await press(page, 'ArrowRight');
  for (let i = 0; i < 12 && (await focused(page)) !== name; i++) await press(page, 'ArrowDown');
  expect(await focused(page)).toBe(name);
}

test('a Linux package copy updates by keys, then offers the restart', async ({ page }) => {
  await toUpdates(page, { kinemaMockUpdate: '99.0.0', kinemaMockUpdateInstall: 'deb' }, 'linux');
  const box = page.locator('.settings-update');
  await expect(box).toContainText('Skrin 99.0.0 is available.');
  await expect(box.getByRole('button', { name: /download page/ })).toHaveCount(0);

  await ringOn(page, 'Update to Skrin 99.0.0');
  await press(page, 'Enter');
  await expect(box).toContainText(/Downloading… \d+ % of 40 MB/);
  await expect(box).toContainText('Skrin 99.0.0 is installed.');
  // The ring followed the pressed button to its successor, by itself.
  await expect.poll(() => focused(page)).toBe('Restart Skrin');
});

test('the Windows setup copy says Skrin closes for the installer', async ({ page }) => {
  await toUpdates(page, { kinemaMockUpdate: '99.0.0', kinemaMockUpdateInstall: 'setup' });
  await ringOn(page, 'Update to Skrin 99.0.0');
  await press(page, 'Enter');
  await expect(page.locator('.settings-update')).toContainText('Skrin closes now so it can be replaced');
});

test('a copy that cannot update itself keeps the download page', async ({ page }) => {
  await toUpdates(page, { kinemaMockUpdate: '99.0.0' });
  const box = page.locator('.settings-update');
  await expect(box.getByRole('button', { name: /Update to/ })).toHaveCount(0);
  await ringOn(page, 'Open the download page ↗');
});

test('a failed update says why and offers the download page', async ({ page }) => {
  await toUpdates(page, {
    kinemaMockUpdate: '99.0.0',
    kinemaMockUpdateInstall: 'apk',
    kinemaMockUpdateFails: 'The download did not match the release’s checksum, so it was deleted.',
  });
  await ringOn(page, 'Update to Skrin 99.0.0');
  await press(page, 'Enter');
  const box = page.locator('.settings-update');
  await expect(box.getByRole('alert')).toContainText('did not match the release’s checksum');
  await expect.poll(() => focused(page)).toBe('Open the download page ↗');
});
