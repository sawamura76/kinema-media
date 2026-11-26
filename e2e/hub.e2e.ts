
import { test, expect, type Page } from '@playwright/test';

async function library(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Library', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kinemaMockMusic', '1');
    localStorage.setItem('kinema.music.language', 'en');
  });
  await page.goto('/');
});

test('collection sort defaults appear after Collection and apply on the music page', async ({ page }) => {
  await library(page);
  await page.getByRole('combobox', { name: 'Default collection sorting' }).selectOption('genre');
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  await expect(page.getByRole('button',{name:'Genre',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.library-view-tabs button')).toHaveText(['Artist', 'Album', 'Year', 'Genre', 'Song title']);
  await page.getByRole('button',{name:'Year',exact:true}).click();
  await expect(page.getByRole('button',{name:'Year',exact:true})).toHaveAttribute('aria-pressed','true');
  await library(page);
  await expect(page.getByRole('combobox',{name:'Default collection sorting'})).toHaveValue('year');
});

test('image folders and muted video backgrounds keep the music player running', async ({ page }) => {
  await page.route('http://asset.localhost/**', async (route) => {
    if (route.request().url().includes('.mp4')) {
      await route.fulfill({ path: 'e2e/fixtures/hub-background.mp4', contentType: 'video/mp4' });
    } else {
      await route.fulfill({ body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#b64b28"/></svg>', contentType: 'image/svg+xml' });
    }
  });
  await library(page);
  await page.evaluate(() => localStorage.setItem('kinemaMockPick', 'C:/custom/images'));
  await page.getByRole('button', { name: 'Choose image folder' }).click();
  await expect(page.getByText('C:/custom/images', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  await page.getByRole('button', { name: 'Album', exact: true }).click();
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await page.getByRole('button', { name: 'Open full-screen music', exact: true }).click();
  await expect(page.locator('.music-slide.current')).toHaveAttribute('src', /custom.*one.jpg/);
  await page.getByRole('button', { name: 'Exit full-screen music', exact: true }).last().click();
  await library(page);
  await page.evaluate(() => localStorage.setItem('kinemaMockPick', 'C:/custom/fireplace.mp4'));
  await page.getByRole('button', { name: 'Choose video', exact: true }).click();
  await expect(page.getByText('C:/custom/fireplace.mp4', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  await page.getByRole('button', { name: 'Open full-screen music', exact: true }).click();
  const video = page.locator('.music-background-video');
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  expect(await video.evaluate((element: HTMLVideoElement) => element.muted && element.loop)).toBe(true);
  await expect(page.getByRole('button', { name: 'Pause music', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause music', exact: true }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
});

test('game shortcuts can be added, launched, edited and removed', async ({ page }) => {
  await page.route('http://asset.localhost/**', (route) => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#413f70"/><text x="35" y="210" fill="white" font-size="30">GAME COVER</text></svg>',
  }));
  await page.getByRole('button', { name: 'Games', exact: true }).click();
  await page.locator('.games-empty').getByRole('button',{name:'Manage games & apps',exact:true}).click();
  await page.getByRole('button', { name: 'Add game or app', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Game or app shortcut' });
  await editor.getByLabel('Title', { exact: true }).fill('Test Game');
  await editor.getByLabel('Executable, shortcut, or launch link', { exact: true }).fill('steam://rungameid/123');
  await editor.getByLabel('Platform or launcher', { exact: true }).fill('Steam');
  await page.evaluate(() => localStorage.setItem('kinemaMockPick', 'C:/Games/cover.jpg'));
  await editor.getByRole('button', { name: 'Choose cover art', exact: true }).click();
  await page.getByRole('dialog',{name:'Preview and crop box art'}).getByRole('button',{name:'Use image',exact:true}).click();
  await expect(editor.getByRole('img', { name: 'Cover preview' })).toBeVisible();
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('dialog',{name:'Manage games & apps',exact:true}).getByRole('button',{name:'Done',exact:true}).click();
  await page.getByRole('button', { name: 'Launch Test Game', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('kinemaMockLaunchedGame'))).toBe('1');
  await page.locator('.collection-sidebar').getByRole('button',{name:'Manage collections',exact:true}).click();
  await page.getByRole('button', { name: 'Edit selected', exact: true }).click();
  await editor.getByLabel('Title', { exact: true }).fill('Updated Game');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog',{name:'Manage games & apps',exact:true}).getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByRole('button', { name: 'Launch Updated Game' })).toBeVisible();
  await page.screenshot({ path: 'work/games-preview.png' });
  await page.setViewportSize({ width: 854, height: 480 });
  await expect(page.getByRole('button', { name: 'Launch Updated Game' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Collections',exact:true}).click();
  await page.locator('.collection-sidebar').getByRole('button',{name:'Manage collections',exact:true}).click();
  await page.getByRole('button', { name: 'Remove selected', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Updated Game', exact: true }).click();
  await expect(page.locator('.game-tile')).toHaveCount(0);
});

test('saved slideshow folders can be selected in the full-screen visualizer panel', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Visualizations', exact: true }).click();
  await page.evaluate(() => localStorage.setItem('kinemaMockPick', 'C:/Christmas/Fireplace images'));
  await page.getByRole('button', { name: 'Add slideshow folder', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Slideshow source', exact: true })).toContainText('Fireplace images');
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  await page.getByRole('button', { name: 'Album', exact: true }).click();
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await page.getByRole('button', { name: 'Open full-screen music', exact: true }).click();
  await expect(page.locator('.music-slide.current')).toHaveAttribute('src', /custom.*one.jpg/);
  await page.getByRole('button', { name: 'Visualizer', exact: true }).click();
  const source = page.getByRole('combobox', { name: 'Slideshow source', exact: true });
  await expect(source.locator('option:checked')).toHaveText('Fireplace images');
  await source.selectOption('album');
  await expect(source).toHaveValue('album');
  await expect(page.locator('.music-slide')).toHaveCount(0);
});



test('music header keeps sorting and Queue beside the selected collection', async ({ page }) => {
  await page.getByRole('button',{name:'Music',exact:true}).click();
  await expect(page.locator('.library-toolbar').getByRole('button',{name:'Queue (0)',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Album',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Sort music by',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Year',exact:true}).click();
  await expect(page.locator('.music-library-group > h2')).toHaveText(['2026']);
  await expect(page.locator('.music-album-tile')).toHaveCount(2);
  await page.getByRole('button',{name:'Genre',exact:true}).click();
  await expect(page.locator('.music-library-group > h2')).toHaveText(['Electronic']);
});
