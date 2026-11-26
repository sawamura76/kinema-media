/**
 * A film named in home-top.txt (home_top.rs, hero.ts) fills the top of Home,
 * for screenshots; a name that matches nothing leaves the day's pick alone.
 * The mock reads `kinemaMockHomeTop` in place of the file.
 */
import { expect, test } from '@playwright/test';

const homeWith = async (page: import('@playwright/test').Page, name: string | null) => {
  await page.addInitScript((n) => {
    if (n === null) localStorage.removeItem('kinemaMockHomeTop');
    else localStorage.setItem('kinemaMockHomeTop', n);
  }, name);
  await page.goto('/');
  return page.locator('.hero .hero-overview');
};

test('the film named in home-top.txt is at the top of Home', async ({ page }) => {
  const overview = await homeWith(page, 'example saga');
  await expect(overview).toContainText('A fixture series across two seasons');
});

test('a name with its year picks that one', async ({ page }) => {
  const overview = await homeWith(page, 'Example Film (2017)');
  await expect(overview).toHaveText('A fixture film.');
});

test('a name that matches nothing changes nothing', async ({ browser }) => {
  const plain = await browser.newPage();
  const usual = await (await homeWith(plain, null)).textContent();
  const other = await browser.newPage();
  await expect(await homeWith(other, 'Not in the library')).toHaveText(usual ?? '');
});
