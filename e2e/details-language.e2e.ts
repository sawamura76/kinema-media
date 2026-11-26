/**
 * The details language (DetailsLanguageRow.tsx, detailsLanguage.ts), by
 * keyboard only: Settings → Language & subtitles → Film and show details →
 * More languages → Polish. The choice is saved, a scan fetches the library's
 * titles again in Polish against the mock TMDB (`kinemaMockTmdb`), a title
 * with a translation takes it and one without keeps its English.
 */
import { expect, test, type Page } from '@playwright/test';
import { press } from './kb';

function focused(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.querySelector('.focused')?.textContent?.trim());
}

/** The label of the choice row the ring is in, or ''. */
function focusedRow(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      document.querySelector('.focused')?.closest('.choice-row')?.querySelector('.choice-label')
        ?.textContent ?? ''
  );
}

function invoke<T>(page: Page, cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  return page.evaluate(
    ([c, a]) =>
      (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__.invoke(c as string, a),
    [cmd, args] as const
  ) as Promise<T>;
}

async function titleNamed(page: Page, id: number): Promise<string | undefined> {
  const titles = await invoke<Array<{ id: number; title: string }>>(page, 'list_titles');
  return titles.find((t) => t.id === id)?.title;
}

test('details language: chosen by remote, and the library follows it', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kinemaMockTmdb', '1'));
  await page.goto('/');
  await expect.poll(() => focused(page)).toContain('Play');
  const englishFilm = await titleNamed(page, 2);

  // Home → Settings → Language & subtitles.
  await page.locator('.top-nav').getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Language & subtitles',exact:true}).click();
  // OK opens the section; Right goes into it.
  await press(page, 'Enter');
  await expect(page.locator('.settings-section h2').first()).toHaveText('Language and subtitles');
  await press(page, 'ArrowRight');

  // Down the section to the row, then along it to More languages.
  for (let i = 0; i < 10 && (await focusedRow(page)) !== 'Film and show details'; i++) {
    await press(page, 'ArrowDown');
  }
  expect(await focusedRow(page)).toBe('Film and show details');
  expect(await focused(page)).toBe('✓English');
  for (let i = 0; i < 4 && (await focused(page)) !== 'More languages'; i++) await press(page, 'ArrowRight');
  await press(page, 'Enter');
  await expect.poll(() => focused(page)).toBe('Fewer languages');

  // Down into every language, and along it to Polish.
  await press(page, 'ArrowDown');
  await expect.poll(() => focusedRow(page)).toBe('All languages');
  for (let i = 0; i < 40 && (await focused(page)) !== 'Polish'; i++) await press(page, 'ArrowRight');
  expect(await focused(page)).toBe('Polish');
  await press(page, 'Enter');
  await expect.poll(() => focused(page)).toBe('✓Polish');
  // The row above now offers it among the few.
  await expect(
    page.locator('[aria-label="Film and show details"] .choice.chosen')
  ).toHaveText('✓Polish');
  expect(await invoke(page, 'get_setting', { key: 'details_language' })).toBe('pl-PL');

  // The scan the change started fetches the titles again: a translation
  // where TMDB has one, the English kept where it has none.
  await expect.poll(() => titleNamed(page, 1)).toBe('Przykładowy serial');
  expect(await titleNamed(page, 2)).toBe(englishFilm);

  // And back to English by the row's own first choice: the title is English again.
  await press(page, 'ArrowUp');
  await expect.poll(() => focusedRow(page)).toBe('Film and show details');
  for (let i = 0; i < 4 && (await focused(page)) !== 'English'; i++) await press(page, 'ArrowLeft');
  await press(page, 'Enter');
  await expect.poll(() => focused(page)).toBe('✓English');
  await expect.poll(() => titleNamed(page, 1)).toBe('Example Show');
});
