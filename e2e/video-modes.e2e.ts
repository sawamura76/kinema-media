import { test, expect, type Page } from '@playwright/test';
const nav = (page: Page, name: string) => page.locator('.top-nav').getByRole('button',{name,exact:true}).click();
async function settings(page: Page, section: string) {
  await nav(page,'Settings');
  await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:section,exact:true}).click();
}
test.beforeEach(async ({page})=>{await page.goto('/');});
test('movie and TV collection selections stay independent after folder assignment', async ({page})=>{
  await nav(page,'Movies');
  await page.locator('.collection-sidebar').getByRole('button',{name:'Manage collections',exact:true}).click();
  const movies=page.getByRole('region',{name:'Movie collections',exact:true});
  await movies.getByRole('button',{name:'Add collection',exact:true}).click();
  await movies.getByLabel('Collection name',{exact:true}).fill('Christmas movies');
  await movies.getByRole('button',{name:'Create collection',exact:true}).click();
  await page.evaluate(()=>localStorage.setItem('kinemaMockPick','C:/Christmas movies'));
  await movies.getByRole('button',{name:'Add folder',exact:true}).click();
  await expect(movies.getByRole('status')).toContainText(/Scan finished|Folder added/);
  await nav(page,'Movies');
  const sidebar=page.locator('.collection-sidebar');
  await sidebar.getByRole('button',{name:'Christmas movies (1)',exact:true}).click();
  await expect(page.locator('.search-grid .card-title')).toHaveText(['Example Film']);
  await nav(page,'TV shows');
  await sidebar.getByRole('button',{name:'Manage collections',exact:true}).click();
  const tv=page.getByRole('region',{name:'TV collections',exact:true});
  await tv.getByRole('button',{name:'Add collection',exact:true}).click();
  await tv.getByLabel('Collection name',{exact:true}).fill('Anime TV');
  await tv.getByRole('button',{name:'Create collection',exact:true}).click();
  const path=await page.evaluate(async()=>{const module='/src/library/api.ts'; return (await(await import(/* @vite-ignore */ module)).listLibraryRoots()).find((root:{kind:string;path:string})=>root.kind==='tv')!.path;});
  await page.getByRole('combobox',{name:'Collection for '+path,exact:true}).selectOption({label:'Anime TV'});
  await nav(page,'TV shows');
  await sidebar.getByRole('button',{name:'Anime TV (2)',exact:true}).click();
  await expect(page.locator('.search-grid .card-title')).toHaveText(['Example Show','Example Saga']);
  await nav(page,'Movies');
  await expect(sidebar.getByRole('button',{name:'Christmas movies (1)',exact:true})).toHaveAttribute('aria-pressed','true');
});
test('PC TV and Handheld modes resize the UI and save the selected preset', async ({ page }) => {
  await page.evaluate(() => { localStorage.setItem('kinemaMockMusic','1'); localStorage.setItem('kinemaMockMusicGrid','1'); });
  await settings(page,'Playback');
  const modes = page.getByRole('radiogroup', { name: 'Where Kinema is used', exact: true });
  await modes.getByRole('button', { name: 'Handheld', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-ui-mode','handheld');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('18px');
  expect(await modes.getByRole('button', { name: /Handheld$/ }).evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  for (const size of [{width:1280,height:720},{width:854,height:480}]) {
    await page.setViewportSize(size);
    await nav(page,'Music');
    await expect(page.locator('.library-view-tabs')).toBeVisible();
    const tiles = page.locator('.music-album-grid > button');
    await expect(tiles).toHaveCount(20);
    await tiles.nth(0).focus(); await page.keyboard.press('ArrowRight');
    await expect(tiles.nth(1)).toHaveClass(/focused/);
    await page.screenshot({ path: 'work/handheld-music-' + size.width + '.png' });
    if (size.width === 854) {
      await page.getByRole('button', { name: 'Album', exact: true }).click();
      await page.getByRole('button', { name: 'Album 01 Artist 01', exact: true }).click();
      await page.getByRole('button', { name: '▶ Play', exact: true }).click();
      await page.getByRole('button', { name: 'Open full-screen music', exact: true }).click();
      for (const button of await page.locator('.music-player button').all()) {
        const box = (await button.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(855);
        expect(box.y + box.height).toBeLessThanOrEqual(481);
      }
      await page.screenshot({ path: 'work/handheld-music-stage.png' });
      await page.getByRole('button', { name: 'Exit full-screen music', exact: true }).last().click();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await nav(page,'Games');
    await expect(page.locator('.games-empty').getByRole('button',{name:'Manage games & apps',exact:true})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'work/handheld-' + size.width + '.png' });
  }
  await settings(page,'Playback');
  await modes.getByRole('button', { name: 'TV', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-tv','on');
  await modes.getByRole('button', { name: 'PC', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-ui-mode','pc');
  expect(await page.evaluate(async () => { const path='/src/metadata/api.ts'; return (await import(/* @vite-ignore */ path)).getSetting('ui_mode'); })).toBe('pc');
});

test('saved handheld mode is restored at launch', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kinemaMockUiMode','handheld'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ui-mode','handheld');
});


test('collection folder management scans new folders and returns to the sidebar library', async ({page})=>{
  await nav(page,'Movies');
  await page.locator('.collection-sidebar').getByRole('button',{name:'Manage collections',exact:true}).click();
  const manager=page.getByRole('region',{name:'Movie collections',exact:true});
  await manager.getByRole('button',{name:'Add collection',exact:true}).click();
  await manager.getByLabel('Collection name',{exact:true}).fill('Seasonal movies');
  await manager.getByRole('button',{name:'Create collection',exact:true}).click();
  await page.evaluate(()=>localStorage.setItem('kinemaMockPick','C:/Seasonal movies'));
  await manager.getByRole('button',{name:'Add folder',exact:true}).click();
  await expect(manager.getByRole('status')).toContainText(/Scan finished|Folder added/);
  await expect(page.getByRole('combobox',{name:'Collection for C:/Seasonal movies',exact:true}).locator('option:checked')).toHaveText('Seasonal movies');
  await nav(page,'Movies');
  await page.locator('.collection-sidebar').getByRole('button',{name:'Seasonal movies (1)',exact:true}).click();
  await expect(page.locator('.search-grid .card-title')).toHaveText(['Example Film']);
});
