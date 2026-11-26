import { expect, test, type Page } from '@playwright/test';

interface Fake { path: string | null; paused: boolean; position: number; volume: number; commands: { name: string; args: unknown[] }[] }
const mpv = (page: Page) => page.evaluate(() => {
  const value = (window as unknown as { __fakeMpv: Fake }).__fakeMpv;
  return { path: value.path, paused: value.paused, position: value.position, volume: value.volume, loads: value.commands.filter((c) => c.name === 'loadfile').length };
});
const minimize = (page: Page) => page.evaluate(() => (window as unknown as { __kinemaMock: { minimizePlayer: () => void } }).__kinemaMock.minimizePlayer());
async function music(page: Page) {
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  await page.getByRole('button', { name: 'Album', exact: true }).click();
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.locator('.music-player')).toHaveAttribute('aria-busy', 'false');
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('kinemaMockMusic', '1'); localStorage.setItem('kinema.music.language', 'en'); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Music', exact: true })).toBeVisible();
});
test('music mini-player keeps the queue, controls volume and restores without reloading', async ({ page }) => {
  await music(page);
  const before = await mpv(page);
  await minimize(page);
  const mini = page.getByRole('dialog', { name: 'Floating mini-player', exact: true });
  await expect(mini).toContainText('Song 1');
  await page.setViewportSize({ width: 460, height: 230 });
  await mini.getByRole('button', { name: 'Pause music', exact: true }).click();
  await expect.poll(async () => (await mpv(page)).paused).toBe(true);
  await mini.getByRole('button', { name: 'Play music', exact: true }).click();
  await expect.poll(async () => (await mpv(page)).paused).toBe(false);
  await mini.getByRole('slider', { name: 'Volume', exact: true }).fill('35');
  await expect.poll(async () => (await mpv(page)).volume).toBe(35);
  await expect.poll(async () => (await mpv(page)).loads).toBe(before.loads);
  await page.screenshot({ path: 'work/music-mini-player.png' });
  await page.setViewportSize({ width: 320, height: 200 });
  expect(await mini.evaluate((node) => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight)).toBe(true);
  await mini.getByRole('button', { name: 'Next song', exact: true }).click();
  await expect(mini).toContainText('Song 2');
  const loads = (await mpv(page)).loads;
  await mini.getByRole('button', { name: 'Restore main window', exact: true }).click();
  await expect(mini).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator('.music-now-title strong')).toHaveText('Song 2');
  await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toHaveValue('35');
  expect((await mpv(page)).loads).toBe(loads);
});
test('fullscreen visualizer suspends while floating and resumes its existing session', async ({ page }) => {
  await music(page);
  await page.getByRole('button', { name: 'Open full-screen music', exact: true }).click();
  const before = await mpv(page);
  await minimize(page);
  await expect(page.locator('.music-now-playing')).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Floating mini-player', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.music-now-playing')).toBeVisible();
  expect((await mpv(page)).loads).toBe(before.loads);
});
test('mini-player preference disables automatic floating', async ({ page }) => {
  await music(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Navigation & controls', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Music mini-player', exact: true }).getByRole('button', { name: 'Off', exact: true }).click();
  await minimize(page);
  await expect(page.locator('.floating-player')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kinema.media.musicMiniPlayer'))).toBe('off');
  await expect(page.getByRole('radiogroup', { name: 'Video mini-player', exact: true }).getByRole('button', { name: /On/ })).toHaveClass(/chosen/);
  await page.evaluate(() => {
    const mock = (window as unknown as { __kinemaMock: { files: { path: string }[]; openVideo: (path: string) => void } }).__kinemaMock;
    mock.openVideo(mock.files[0].path);
  });
  await expect(page.locator('.player')).toBeVisible();
  await minimize(page);
  await expect(page.locator('.floating-video')).toBeVisible();
});
test('video stays on the same playback session when floating, resizing and restoring', async ({ page }) => {
  await page.evaluate(() => {
    const mock = (window as unknown as { __kinemaMock: { files: { path: string }[]; openVideo: (path: string) => void } }).__kinemaMock;
    mock.openVideo(mock.files[0].path);
  });
  await expect(page.locator('.player')).toBeVisible();
  await expect.poll(async () => (await mpv(page)).position).toBeGreaterThan(.2);
  const before = await mpv(page);
  const bottom = () => page.locator('.player .player-controls').evaluate((node) => Math.abs(node.getBoundingClientRect().bottom-window.innerHeight));
  for(const size of [{width:1280,height:720},{width:854,height:480}]) {
    await page.setViewportSize(size);
    await expect.poll(bottom).toBeLessThan(2);
    await page.keyboard.press('f');
    await expect.poll(bottom).toBeLessThan(2);
  }
  await minimize(page);
  const mini = page.getByRole('dialog', { name: 'Floating mini-player', exact: true });
  await expect(mini).toBeVisible();
  await expect(page.locator('.full-player-ui')).toBeHidden();
  await page.setViewportSize({ width: 560, height: 340 });
  await mini.getByRole('button', { name: 'Pause video', exact: true }).click();
  await expect.poll(async () => (await mpv(page)).paused).toBe(true);
  await mini.getByRole('button', { name: 'Forward 10 seconds', exact: true }).click();
  await expect.poll(async () => (await mpv(page)).position).toBeGreaterThan(before.position + 8);
  await mini.getByRole('slider', { name: 'Volume', exact: true }).fill('45');
  await expect.poll(async () => (await mpv(page)).volume).toBe(45);
  await page.setViewportSize({ width: 320, height: 200 });
  expect(await mini.evaluate((node) => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight)).toBe(true);
  await mini.getByRole('button', { name: 'Restore main window', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator('.full-player-ui')).toBeVisible();
  await expect.poll(bottom).toBeLessThan(2);
  await page.mouse.move(40,40);
  await page.screenshot({path:'work/video-bottom-controls-fix.png'});
  expect((await mpv(page)).loads).toBe(before.loads);
});

test('video mini-player can be disabled while music floating stays enabled', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Navigation & controls', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Video mini-player', exact: true }).getByRole('button', { name: 'Off', exact: true }).click();
  await page.evaluate(() => {
    const mock = (window as unknown as { __kinemaMock: { files: { path: string }[]; openVideo: (path: string) => void } }).__kinemaMock;
    mock.openVideo(mock.files[0].path);
  });
  await expect(page.locator('.player')).toBeVisible();
  await minimize(page);
  await expect(page.locator('.floating-player')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Music', exact: true })).toBeVisible();
  await music(page);
  await minimize(page);
  await expect(page.locator('.floating-music')).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kinema.media.videoMiniPlayer'))).toBe('off');
});
