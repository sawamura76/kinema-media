/**
 * "Keep everything on this computer" (net.rs gate, PRIVATE-MODE.md §2), by
 * keyboard alone: the first run's quiet line and its page (Use it / Back),
 * and Settings → Privacy's switch, found by the search box, with every
 * service row saying it is off, IMDb's two files with their own switches,
 * the remove press that asks first, and the way back online.
 */
import { expect, test, type Page } from '@playwright/test';
import { press } from './kb';

function focused(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const el = document.querySelector('.focused');
    return el instanceof HTMLInputElement ? `[${el.placeholder}]` : el?.textContent?.trim();
  });
}

function setting(page: Page, key: string): Promise<string | null> {
  return page.evaluate(async (k) => {
    const path = '/src/metadata/api.ts';
    const api = await import(/* @vite-ignore */ path);
    return api.getSetting(k) as Promise<string | null>;
  }, key);
}

test('first run: the quiet line opens its page; Back returns, Use it switches the mode on', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kinemaMockEmpty', '1'));
  await page.goto('/');
  await expect.poll(() => focused(page)).toBe('A TV, from the sofa');

  // Above the first question: a line, not a step.
  await press(page, 'ArrowUp');
  await expect.poll(() => focused(page)).toBe('Keep everything on this computer');
  await press(page, 'Enter');
  const keepPage = page.locator('.first-run-keep-page');
  await expect(keepPage.locator('h2')).toHaveText('Keep everything on this computer');
  await expect(keepPage).toContainText('76 MB kept');
  await expect(keepPage).toContainText('nothing about your library is sent');
  await expect.poll(() => focused(page)).toBe('Use it');

  // Back: nothing changed, the ring on the line again.
  await press(page, 'ArrowRight');
  await expect.poll(() => focused(page)).toBe('Back');
  await press(page, 'Enter');
  await expect(keepPage).toHaveCount(0);
  await expect.poll(() => focused(page)).toBe('Keep everything on this computer');
  expect(await setting(page, 'keep_on_device')).toBeNull();

  // Use it: on, the list allowed, and the line says so.
  await press(page, 'Enter');
  await expect.poll(() => focused(page)).toBe('Use it');
  await press(page, 'Enter');
  await expect.poll(() => setting(page, 'keep_on_device')).toBe('1');
  expect(await setting(page, 'imdb_titles_allowed')).toBe('1');
  await expect.poll(() => focused(page)).toBe('Keep everything on this computer: on');
  // The rest of the first run is as before, one press down.
  await press(page, 'ArrowDown');
  await expect.poll(() => focused(page)).toBe('A TV, from the sofa');
});

async function openKeep(page: Page): Promise<void> {
  await page.goto('/');
  await expect.poll(() => focused(page)).toContain('Play');
  await press(page, 'ArrowUp', 2);
  for (let i = 0; i < 6 && (await focused(page)) !== 'Settings'; i++) await press(page, 'ArrowRight');
  await press(page, 'Enter');
  await press(page, 'ArrowDown');
  await expect.poll(() => focused(page)).toBe('Library');
  await press(page, 'ArrowUp');
  await expect.poll(() => focused(page)).toBe('[Search settings]');
  await page.keyboard.type('offline');
  await expect(page.locator('.settings-search-result').first()).toContainText(
    'Keep everything on this computer'
  );
  await press(page, 'Enter');
  await press(page, 'Enter');
  await expect(page.locator('.settings-section h2').first()).toHaveText('Keep everything on this computer');
}

test('Settings → Privacy: on says every service is off, the IMDb files have their own switches, remove asks first, off goes back online', async ({
  page,
}) => {
  await openKeep(page);
  const section = page.locator('.keep-on-device');
  await expect(section).toContainText('Nothing about your library leaves this device');
  // The search lands on the row's first choice; Off is chosen.
  await expect(section.locator('.choice.chosen').first()).toHaveText('✓Off');
  await expect.poll(() => focused(page)).toBe('On');
  await press(page, 'Enter');
  await expect.poll(() => setting(page, 'keep_on_device')).toBe('1');
  await expect(section).toContainText('Skrin looks nothing up online from now on');

  // Every service row but IMDb's and the own server: off, saying why.
  const offRows = page.locator('.what-leaves-state', {
    hasText: 'Off: Keep everything on this computer is on.',
  });
  await expect(offRows).toHaveCount(12);
  await expect(page.locator('.what-leaves-state', { hasText: 'On: list of titles and ratings' })).toHaveCount(1);

  // IMDb's list: its own switch; off removes it.
  await expect(section).toContainText('IMDb’s list of titles');
  await expect(section).toContainText(/504.143 titles/);
  // The list's row, one down: On is chosen; Off removes it.
  const row = () =>
    page.evaluate(() => document.querySelector('.focused')?.closest('.choice-row')?.querySelector('.choice-label')?.textContent);
  await press(page, 'ArrowDown');
  await expect.poll(row).toBe('IMDb’s list of titles');
  await expect.poll(() => focused(page)).toBe('✓On');
  await press(page, 'ArrowRight');
  await press(page, 'Enter');
  await expect.poll(() => setting(page, 'imdb_titles_allowed')).toBe('0');
  await expect(section).toContainText('names come from the files only');
  await expect(section).toContainText('was removed');

  // The remove press: first it asks.
  for (let i = 0; i < 6 && (await focused(page)) !== 'Remove pictures and details fetched online'; i++)
    await press(page, 'ArrowDown');
  await expect.poll(() => focused(page)).toBe('Remove pictures and details fetched online');
  await press(page, 'Enter');
  await expect.poll(() => focused(page)).toBe('Yes, remove them');
  await press(page, 'Enter');
  await expect(section).toContainText('Removed: the details of 12 titles');

  // Off: lookups back, and the way back online is said.
  for (let i = 0; i < 8 && (await row()) !== 'Keep everything on this computer'; i++) await press(page, 'ArrowUp');
  await expect.poll(() => focused(page)).toBe('✓On');
  await press(page, 'ArrowRight');
  await expect.poll(() => focused(page)).toBe('Off');
  await press(page, 'Enter');
  await expect.poll(() => setting(page, 'keep_on_device')).toBe('0');
  await expect(section).toContainText('Off. Lookups are back on.');
  await expect(page.locator('.what-leaves-state', { hasText: 'Keep everything' })).toHaveCount(0);
});
