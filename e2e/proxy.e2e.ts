/**
 * Settings → Privacy → "Send Skrin's lookups through a proxy" (net.rs), by
 * keyboard alone: the search box finds it, a bad address is refused in words
 * and stays off, "Check" says what happened, and a good address turns it on.
 */
import { expect, test, type Page } from '@playwright/test';
import { press } from './kb';

function focused(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const el = document.querySelector('.focused');
    return el instanceof HTMLInputElement ? `[${el.placeholder}]` : el?.textContent?.trim();
  });
}

async function openProxy(page: Page): Promise<void> {
  await page.goto('/');
  await expect.poll(() => focused(page)).toContain('Play');
  await page.locator('.top-nav').getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByPlaceholder('Search settings',{exact:true}).focus();
  await page.keyboard.type('proxy');
  await expect(page.locator('.settings-search-result').first()).toContainText('Send Skrin’s lookups through a proxy');
  await press(page, 'Enter');
  await press(page, 'Enter');
  // Below Keep everything on this computer, at the top of Privacy.
  await expect(page.locator('.proxy-section h2')).toHaveText('Proxy');
}

/** Down from where the search landed until `want` has the ring. */
async function reach(page: Page, want: string): Promise<void> {
  for (let i = 0; i < 8 && (await focused(page)) !== want; i++) await press(page, 'ArrowDown');
  await expect.poll(() => focused(page)).toBe(want);
}

test('off by default; a bad address is refused in words, Check says what happened, a good one turns it on', async ({
  page,
}) => {
  await openProxy(page);
  const row = page.locator('.proxy-section .choice-row');
  await expect(row.locator('.choice-hint')).toContainText('never go direct');
  await expect(row.locator('.focused, [aria-pressed="true"], .selected').first()).toContainText('Off');

  // On with nothing typed: refused, still off.
  await expect.poll(() => focused(page)).toBe('✓Off');
  await press(page, 'ArrowRight');
  await expect.poll(() => focused(page)).toBe('On');
  await press(page, 'Enter');
  await expect(page.locator('.proxy-section .settings-error')).toContainText('Type the proxy');
  

  // An address with no port is refused too.
  await reach(page, '[127.0.0.1:8080]');
  await page.keyboard.type('127.0.0.1');
  await press(page, 'ArrowDown');
  await expect.poll(() => focused(page)).toBe('Check');
  await press(page, 'Enter');
  await expect(page.locator('.proxy-section .settings-error')).toContainText('needs a host and a port');

  // A proxy that is not there: the cause, in words.
  await press(page, 'ArrowUp');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('dead.example:8080');
  await press(page, 'ArrowDown');
  await press(page, 'Enter');
  await expect(page.locator('.proxy-section .settings-error')).toContainText('did not accept the connection');
});

test('a working address checks out and switches on, and the page says nothing goes direct', async ({
  page,
}) => {
  await openProxy(page);
  await reach(page, '[127.0.0.1:8080]');
  await page.keyboard.type('127.0.0.1:9050');
  await press(page, 'ArrowDown');
  await expect.poll(() => focused(page)).toBe('Check');
  await press(page, 'Enter');
  await expect(page.locator('.proxy-section .settings-note')).toContainText('TMDB answered through it');
  await press(page, 'ArrowUp');
  await expect.poll(() => focused(page)).toBe('[127.0.0.1:8080]');
  await press(page, 'ArrowUp');
  if ((await focused(page)) !== 'On') await press(page, 'ArrowRight');
  await expect.poll(() => focused(page)).toBe('On');
  await press(page, 'Enter');
  await expect(page.locator('.proxy-section .settings-note')).toContainText('do not go direct');
});
