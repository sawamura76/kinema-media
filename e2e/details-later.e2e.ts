/**
 * The details page's later items (round 10 B): the age rating of the
 * system's own country, More like this (recommendations the library holds),
 * Extras beside the files, and a season's poster — each reached by keyboard,
 * and each absent, not empty, where there is nothing to say.
 * Against `dev:mock` with `kinemaMockPeople` (mockBackend.ts `ABOUT`); the
 * browser's language is en-US, so the country is US unless the mock names a region.
 */
import { expect, test, type Page } from '@playwright/test';
import { focused, press } from './kb';

async function open(page: Page, region?: string): Promise<void> {
  await page.addInitScript((r) => {
    localStorage.removeItem('kinemaMockSystem');
    localStorage.setItem('kinemaMockPeople', '1');
    if (r) localStorage.setItem('kinemaMockRegion', r);
    else localStorage.removeItem('kinemaMockRegion');
  }, region);
  await page.goto('/');
  await expect.poll(() => focused(page)).toContain('Play');
}

async function openTitle(page: Page, shelf: 'Movies' | 'TV shows', name: string): Promise<void> {
  await page.getByRole('button', { name: shelf }).first().click();
  await page.locator('.search .card', { hasText: name }).click();
  await expect(page.locator('.detail h1')).toHaveText(name);
  await expect.poll(() => focused(page)).toMatch(/Play/);
}

async function moveTo(page: Page, key: string, name: RegExp, times = 10): Promise<void> {
  for (let i = 0; i < times && !name.test((await focused(page)) ?? ''); i++) await press(page, key);
  expect(await focused(page)).toMatch(name);
}

test('the age rating is the system country\'s, and nothing when TMDB has none for it', async ({ page }) => {
  await open(page);
  // US is held for Part One and for the show; Part Two has only Denmark's.
  await openTitle(page, 'Movies', 'Example Part Two');
  await expect(page.locator('.detail-cert')).toHaveCount(0);
  await press(page, 'Escape');
  await page.locator('.search .card', { hasText: 'Example Part One' }).click();
  await expect(page.locator('.detail-cert')).toHaveText('PG-13');
  await press(page, 'Escape');
  await page.getByRole('button', { name: 'TV shows' }).first().click();
  await page.locator('.search .card', { hasText: 'Example Show' }).click();
  await expect(page.locator('.detail-cert')).toHaveText('TV-MA');
});

test("the system's own region wins over the browser's language", async ({ page }) => {
  await open(page, 'DK');
  // The browser says en-US, the system says Denmark: Part Two has Denmark's.
  await openTitle(page, 'Movies', 'Example Part Two');
  await expect(page.locator('.detail-cert')).toHaveText('15');
  await press(page, 'Escape');
  await page.getByRole('button', { name: 'TV shows' }).first().click();
  await page.locator('.search .card', { hasText: 'Example Show' }).click();
  await expect(page.locator('.detail h1')).toHaveText('Example Show');
  // The show holds GB and US ratings, neither of which is here.
  await expect(page.locator('.detail-cert')).toHaveCount(0);
});

test('More like this and Extras are rows a keyboard reaches; a title with neither shows neither', async ({ page }) => {
  await open(page);
  await openTitle(page, 'Movies', 'Example Part Two');
  await expect(page.locator('.detail-similar h2')).toHaveText('More like this');
  await expect(page.locator('.detail-similar .card-title')).toHaveText(['Example Show', 'Example Part One']);
  await expect(page.locator('.detail-extras h2')).toHaveText('Extras');

  await moveTo(page, 'ArrowDown', /Example Show/);
  await press(page, 'ArrowRight');
  await press(page, 'Enter');
  await expect(page.locator('.detail h1')).toHaveText('Example Part One');
  // Part One was recommended by nothing and has no extras.
  await expect(page.locator('.detail-similar')).toHaveCount(0);
  await expect(page.locator('.detail-extras')).toHaveCount(0);
  await press(page, 'Escape');
  await expect(page.locator('.detail h1')).toHaveText('Example Part Two');
  // The page reads itself again on return: wait for the rows before moving.
  await expect(page.locator('.detail-extras h2')).toBeVisible();

  await moveTo(page, 'ArrowDown', /Bloopers/);
  await press(page, 'ArrowRight');
  expect(await focused(page)).toMatch(/The Look/);
  // The cast is still one more row down: the new rows are not in its way.
  await moveTo(page, 'ArrowDown', /Pat Fixture/);
});

test('a season shows its own poster', async ({ page }) => {
  await open(page);
  await openTitle(page, 'TV shows', 'Example Show');
  await expect(page.locator('.season-picture')).toContainText(/Season 1/);
  await expect(page.locator('.season-picture img, .season-picture .season-poster').first()).toBeVisible();
});
