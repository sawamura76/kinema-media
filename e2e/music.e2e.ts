import { expect, test, type Page } from '@playwright/test';
import { settled, pause } from './kb';

test('approved artist and album layouts show clean details and hierarchical Back', async ({ page }) => {
  await page.route('http://asset.localhost/**',(route)=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#376c80"/></svg>'}));
  await page.evaluate(()=>{
    localStorage.setItem('kinemaMockMusicFirstArtwork','C:/mock/first-cover.jpg');
    localStorage.setItem('kinemaMockArtistThumb','C:/mock/artist-portrait.jpg');
    localStorage.setItem('kinemaMockArtistBio','A biography for this artist, cached with artist artwork.');
    window.dispatchEvent(new Event('kinema-music-library-changed'));
  });
  await expect(page.getByRole('button',{name:'First album Test artist'}).locator('img')).toHaveCount(1);
  await page.getByRole('button', { name: 'Artist', exact: true }).click();
  await page.locator('.music-artist-list > button').click();
  const artist=page.locator('.music-artist-detail');
  await expect(artist.getByRole('heading',{name:'Test artist',exact:true})).toBeVisible();
  await expect(artist.locator('.music-detail-image img')).toHaveAttribute('src',/artist-portrait.jpg/);
  await expect(artist.locator('.music-detail-bio')).toContainText('A biography for this artist');
  await expect(artist.locator('.music-tabs,.music-search,.music-heading,.music-artist-credit')).toHaveCount(0);
  await expect(artist.getByRole('heading',{name:'Albums',exact:true})).toBeVisible();
  await expect(artist.locator('.music-album-tile')).toHaveCount(2);
  await page.screenshot({path:'work/approved-artist-page.png'});
  await artist.getByRole('button',{name:'First album Test artist'}).click();
  const album=page.locator('.music-album-detail');
  await expect(album.getByRole('heading',{name:'First album',exact:true})).toBeVisible();
  await expect(album.locator('.music-detail-metadata')).toContainText('2026');
  await expect(album.locator('.music-detail-metadata')).toContainText('Electronic');
  await expect(album.locator('.music-song')).toHaveCount(2);
  await expect(album.getByRole('button',{name:'▶ Play',exact:true})).toHaveClass(/focused/);
  await expect(album.locator('.music-detail-artist-name')).toHaveText('Test artist');
  await expect(album.getByRole('button',{name:'Test artist',exact:true})).toHaveCount(0);
  await expect.poll(()=>page.locator('.top-nav').evaluate((node)=>node.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
  await expect(album.locator('.music-tabs,.music-search,.music-heading,.music-artist-credit')).toHaveCount(0);
  await page.screenshot({path:'work/approved-album-page.png'});
  await page.keyboard.press('Enter');
  await expect(page.locator('.music-player')).toHaveAttribute('aria-busy', 'false');
  const playing=await mpvPath(page);
  await page.keyboard.press('Escape');
  await expect(artist).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.library-toolbar')).toBeVisible();
  expect(await mpvPath(page)).toBe(playing);
});

test('detail layouts fit handheld sizes and artist images fall back to album covers', async ({ page }) => {
  await page.route('http://asset.localhost/**',(route)=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#376c80"/></svg>'}));
  await page.evaluate(()=>{localStorage.setItem('kinemaMockMusicFirstArtwork','C:/mock/album-cover.jpg');window.dispatchEvent(new Event('kinema-music-library-changed'));});
  await expect(page.getByRole('button',{name:'First album Test artist'}).locator('img')).toHaveCount(1);
  await page.getByRole('button', { name: 'Artist', exact: true }).click();
  await page.locator('.music-artist-list > button').click();
  await expect(page.locator('.music-detail-image img')).toHaveAttribute('src',/album-cover.jpg/);
  for(const size of [{width:1280,height:720},{width:854,height:480}]) {
    await page.setViewportSize(size);
    expect(await page.locator('.music-artist-detail').evaluate((node)=>node.scrollWidth<=node.clientWidth)).toBe(true);
  }
  await page.getByRole('button',{name:'First album Test artist'}).click();
  expect(await page.locator('.music-album-detail').evaluate((node)=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await expect(page.locator('.music-detail-artist-name')).toHaveText('Test artist');
  await expect(page.getByRole('button',{name:'▶ Play',exact:true})).toHaveClass(/focused/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.music-artist-detail')).toBeVisible();
});

test('top Music navigation returns from artist and album details without stopping playback', async ({ page }) => {
  await page.getByRole('button', { name: 'Artist', exact: true }).click();
  await page.locator('.music-artist-list > button').click();
  await expect(page.getByRole('button',{name:'First album Test artist'})).toBeVisible();
  await page.getByRole('button',{name:'Music',exact:true}).click();
  await expect(page.getByRole('button',{name:'Artist',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.music-artist-list > button')).toHaveCount(1);
  await page.getByRole('button', { name: 'Album', exact: true }).click();
  await page.getByRole('button',{name:'First album Test artist'}).click();
  await page.getByRole('button',{name:'▶ Play',exact:true}).click();
  await expect(page.locator('.music-player')).toHaveAttribute('aria-busy', 'false');
  const playing=await mpvPath(page);
  await page.getByRole('button',{name:'Music',exact:true}).click();
  await expect(page.getByRole('button',{name:'Album',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.music-album-heading')).toHaveCount(0);
  await expect(page.locator('.music-player')).toBeVisible();
  expect(await mpvPath(page)).toBe(playing);
});

test('missing album art preserves existing covers and refreshes the playing queue', async ({ page }) => {
  await page.route('http://asset.localhost/**',(route)=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#376c80"/></svg>'}));
  await page.evaluate(()=>localStorage.setItem('kinemaMockMusicFirstArtwork','C:/mock/existing-cover.jpg'));
  await page.getByRole('button',{name:'Second album Test artist'}).click();
  await page.getByRole('button',{name:'▶ Play',exact:true}).click();
  await expect(page.locator('.music-player')).toHaveAttribute('aria-busy', 'false');
  const playing=await mpvPath(page);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Library',exact:true}).click();
  await page.getByRole('button',{name:'Find missing album art',exact:true}).click();
  await expect(page.locator('.album-art-progress')).toContainText('1 albums updated');
  await expect(page.locator('.music-now-art img')).toHaveAttribute('src',/found-cover.jpg/);
  expect(await mpvPath(page)).toBe(playing);
  await page.getByRole('button',{name:'Music',exact:true}).click();
  await page.getByRole('button', { name: 'Album', exact: true }).click();
  await expect(page.getByRole('button',{name:'First album Test artist'}).locator('img')).toHaveAttribute('src',/existing-cover.jpg/);
  await expect(page.getByRole('button',{name:'Second album Test artist'}).locator('img')).toHaveAttribute('src',/found-cover.jpg/);
});

test('artist slideshow download supplies cached gallery images and rotates them', async ({ page }) => {
  await page.route('http://asset.localhost/**',(route)=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#573c75"/></svg>'}));
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Library',exact:true}).click();
  await page.getByRole('button',{name:'Download artist slideshow art',exact:true}).click();
  await expect(page.locator('.album-art-progress')).toContainText('6 images available');
  await page.getByRole('button',{name:'Music',exact:true}).click();
  await page.getByRole('button', { name: 'Album', exact: true }).click();
  await page.getByRole('button',{name:'First album Test artist'}).click();
  await page.getByRole('button',{name:'▶ Play',exact:true}).click();
  await expect(page.locator('.music-player')).toHaveAttribute('aria-busy', 'false');
  await page.clock.install();
  await page.getByRole('button',{name:'Open full-screen music',exact:true}).click();
  await expect(page.locator('.music-slide')).toHaveCount(3);
  await expect(page.locator('.music-slide.current')).toHaveAttribute('src',/artist-photo-0.jpg/);
  await page.clock.fastForward(15_100);
  await expect(page.locator('.music-slide.current')).toHaveAttribute('src',/artist-photo-1.jpg/);
});

test('artwork search can be cancelled without filling covers', async ({ page }) => {
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Library',exact:true}).click();
  await page.getByRole('button',{name:'Find missing album art',exact:true}).click();
  await page.getByRole('button',{name:'Cancel artwork search',exact:true}).click();
  await expect(page.locator('.album-art-progress')).toContainText('Search cancelled');
  expect(await page.evaluate(()=>localStorage.getItem('kinemaMockMusicSecondArtwork'))).toBeNull();
});

async function openPanel(page: Page) {
  if (!await page.getByRole('dialog', { name: 'Visualizer', exact: true }).count()) await page.getByRole('button', { name: 'Visualizer', exact: true }).click();
}
async function background(page: Page, name: string) {
  await openPanel(page);
  const panel = page.getByRole('dialog', { name: 'Visualizer', exact: true });
  const category = name === 'Butterchurn' ? 'Butterchurn' : ['Plain image', 'Blurred image'].includes(name) ? 'Art' : 'Spectrum analyzer';
  if (!await panel.getByRole('button', { name: `Category: ${category}`, exact: true }).count()) {
    await panel.getByRole('button', { name: /^Category:/ }).click();
    await panel.getByRole('button', { name: category, exact: true }).click();
  }
  if (name !== 'Butterchurn') await panel.getByRole('button', { name: `Show ${name}`, exact: true }).click();
  await panel.getByRole('button', { name: 'Close visualizer panel', exact: true }).click();
}

test('visualizer drawer filters rotation, saves sensitivity and closes on idle or Back', async ({ page }) => {
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.locator('.music-player')).toHaveAttribute('aria-busy', 'false');
  await page.clock.install();
  await page.getByRole('button', { name: 'Open full-screen music', exact: true }).click();
  await expect(page.locator('.music-now-toolbar button')).toHaveText(['← Exit full-screen music', 'Visualizer']);
  await background(page, 'Radial spectrum');
  await openPanel(page);
  const panel = page.getByRole('dialog', { name: 'Visualizer', exact: true });
  await panel.getByRole('button', { name: 'Include Retro LED', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Include Retro LED', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await panel.getByRole('radiogroup', { name: 'Rotation time', exact: true }).getByRole('button', { name: '5s', exact: true }).click();
  await panel.getByRole('radiogroup', { name: 'Sensitivity', exact: true }).getByRole('button', { name: '2×', exact: true }).click();
  await panel.getByRole('radiogroup', { name: 'Playback mode', exact: true }).getByRole('button', { name: 'Rotate', exact: true }).click();
  await panel.getByRole('button', { name: 'Close visualizer panel', exact: true }).click();
  await page.clock.fastForward(5_100);
  await expect(page.locator('.music-now-playing')).toHaveClass(/background-spectrum/);
  await page.clock.fastForward(5_100);
  await expect(page.locator('.music-now-playing')).toHaveClass(/background-radial/);
  await page.mouse.move(30,30);
  await openPanel(page);
  await panel.getByRole('radiogroup', { name: 'Playback mode', exact: true }).getByRole('button', { name: 'Static', exact: true }).click();
  await page.setViewportSize({ width: 854, height: 480 });
  await page.screenshot({ path: 'work/music-visualizer-panel.png' });
  expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(panel.getByRole('button', { name: 'Close visualizer panel', exact: true })).toBeInViewport();
  await page.clock.fastForward(20_000);
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.music-now-playing')).toHaveClass(/background-radial/);
  await page.mouse.move(50,50);
  await openPanel(page);
  await panel.getByRole('button', { name: 'Category: Spectrum analyzer', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Butterchurn', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.music-now-playing')).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('kinema.media.visualizations')!))).toMatchObject({ spectrumModes: ['radial', 'spectrum'], spectrumRotate: false, spectrumSeconds: 5, spectrumSensitivity: 2 });
});

test('drawer supports controller keys, holds artwork and skips unchecked presets', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('kinemaMockArtistGallery', JSON.stringify(['C:/mock/art-1.jpg', 'C:/mock/art-2.jpg'])));
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.locator('.music-player')).toHaveAttribute('aria-busy', 'false');
  await page.clock.install();
  await page.getByRole('button', { name: 'Open full-screen music', exact: true }).click();
  await openPanel(page);
  const panel = page.getByRole('dialog', { name: 'Visualizer', exact: true });
  await panel.getByRole('radiogroup', { name: 'Playback mode', exact: true }).getByRole('button', { name: 'Static', exact: true }).click();
  const image = await page.locator('.music-slide.current').getAttribute('src');
  await page.clock.fastForward(31_000);
  await page.clock.runFor(400);
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.music-slide.current')).toHaveAttribute('src', image!);
  await expect(page.locator('.music-now-playing')).toHaveClass(/background-blurred/);
  await page.mouse.move(25,25);
  await openPanel(page);
  await page.clock.runFor(50);
  await expect(panel.getByRole('button', { name: 'Category: Art', exact: true })).toHaveClass(/focused/);
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('button', { name: 'Category: Butterchurn', exact: true })).toBeVisible();
  const selected = () => page.evaluate(() => localStorage.getItem('kinema.music.preset'));
  const first = await selected();
  await panel.getByRole('button', { name: `Include ${first}`, exact: true }).click();
  await expect.poll(selected).not.toBe(first);
  for (let i = 0; i < 14; i++) {
    await panel.getByRole('button', { name: /Next preset:/ }).click();
    await expect.poll(selected).not.toBe(first);
  }
  await expect(panel.getByRole('button', { name: 'Close visualizer panel', exact: true })).toBeInViewport();
});


test('spectrum styles respond to PCM, resize, pause, silence and capture failure', async ({ page }) => {
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.locator('.music-player')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Open full-screen music', exact: true }).click();
  await background(page, 'Butterchurn');
  await background(page, 'Radial spectrum');
  const canvas = page.locator('.music-spectrum');
  for (const label of ['Radial spectrum', 'Retro LED', 'Color spectrum']) {
    await expect(canvas).toHaveAttribute('aria-label', label);
    await expect(canvas).toHaveAttribute('data-status', 'live');
    await expect.poll(() => canvas.getAttribute('data-energy').then(Number)).toBeGreaterThan(.1);
    await expect.poll(() => canvas.getAttribute('data-frame').then(Number)).toBeGreaterThan(2);
    await canvas.screenshot({ path: `work/spectrum-${label.replaceAll(' ', '-')}.png` });
    if (label !== 'Color spectrum') await background(page, label === 'Radial spectrum' ? 'Retro LED' : 'Color spectrum');
  }
  await page.setViewportSize({ width: 854, height: 480 });
  await expect.poll(() => canvas.evaluate((node) => [(node as HTMLCanvasElement).width, (node as HTMLCanvasElement).height])).toEqual([854, 480]);
  await page.getByRole('button', { name: 'Pause music', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-status', 'paused');
  const frame = await canvas.getAttribute('data-frame');
  await pause(page, 120, 'Verify a paused analyzer stops drawing across several frame periods');
  await expect(canvas).toHaveAttribute('data-frame', frame!);
  await page.getByRole('button', { name: 'Play music', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-status', 'live');
  await page.evaluate(() => localStorage.setItem('kinemaMockMusicRms', '-inf'));
  await expect.poll(() => canvas.getAttribute('data-energy').then(Number)).toBeLessThan(.01);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(canvas).toHaveAttribute('data-status', 'paused');
  await expect(page.getByRole('status').filter({ hasText: 'Reduced motion enabled' })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(canvas).toHaveAttribute('data-status', 'live');
  await page.evaluate(() => localStorage.setItem('kinemaMockPcmError', 'capture test failure'));
  await expect(canvas).toHaveAttribute('data-status', 'error');
  await expect(page.getByRole('status').filter({ hasText: 'Audio capture unavailable' })).toBeVisible();
});

test('mouse history follows albums and its settings switch disables navigation', async ({ page }) => {
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await expect(page.locator('.music-song')).toHaveCount(2);
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 3, cancelable: true })));
  await expect(page.locator('.music-album-tile')).toHaveCount(2);
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 4, cancelable: true })));
  await expect(page.locator('.music-song')).toHaveCount(2);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Navigation & controls', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Mouse Back / Forward', exact: true }).getByRole('button', { name: 'Off', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 3, cancelable: true })));
  await expect(page.getByRole('heading', { name: 'Navigation & controls', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kinema.media.mouseNavigation'))).toBe('off');
});

test('visualization settings persist performance and timing preferences and reset', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Visualizations', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Visualization duration', exact: true }).getByRole('button', { name: '60 seconds', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Visualizer performance', exact: true }).getByRole('button', { name: 'Battery saver', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Hide playback controls after', exact: true }).getByRole('button', { name: 'Always visible', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('kinema.media.visualizations')!))).toMatchObject({ presetSeconds: 60, quality: 'battery', controlsSeconds: 0 });
  await page.getByRole('button', { name: 'Reset visualization settings', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('kinema.media.visualizations')!))).toMatchObject({ presetSeconds: 30, quality: 'balanced', controlsSeconds: 10 });
});
const mpvPath = (page: Page) => page.evaluate(() => (window as unknown as { __fakeMpv: { path: string | null } }).__fakeMpv.path);
const playheadTo = (page: Page, seconds: number) => page.evaluate((position) => { (window as unknown as { __fakeMpv: { position: number } }).__fakeMpv.position = position; }, seconds);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('kinemaMockMusic', '1'); localStorage.setItem('kinema.music.language', 'en'); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Music', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Album', exact: true }).click();
});

test('browse albums, play audio, keep it playing across pages, and manage queue', async ({ page }) => {
  await expect(page.locator('.music-album-tile')).toHaveCount(2);
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await expect(page.locator('.music-song')).toHaveCount(2);
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.locator('.music-player')).toBeVisible();
  await expect(page.locator('.music-now-title strong')).toHaveText('Song 1');
  await page.getByRole('button', { name: 'Movies', exact: true }).click();
  await expect(page.locator('.music-player')).toBeVisible();
  await page.getByRole('button', { name: 'Next song', exact: true }).click();
  await expect(page.locator('.music-now-title strong')).toHaveText('Song 2');
  await page.getByRole('button', { name: 'Queue', exact: true }).click();
  await expect(page.locator('.music-song')).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove Song 1 from queue' }).click();
  await expect(page.locator('.music-song')).toHaveCount(1);
  await expect(page.locator('.music-now-title strong')).toHaveText('Song 2');
  await page.getByRole('button', { name: 'Remove Song 2 from queue' }).click();
  await expect(page.locator('.music-player')).toHaveCount(0);
});

test('search and artist grouping work, and keyboard focus reaches music controls', async ({ page }) => {
  await page.getByRole('button', { name: 'Artist', exact: true }).click();
  await expect(page.locator('.music-artist-list button')).toHaveCount(1);
  await page.locator('.music-artist-list button').click();
  await expect(page.locator('.music-album-tile')).toHaveCount(2);
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  await page.getByRole('button', { name: 'Song title', exact: true }).click();
  await openMusicSearch(page);
  await page.getByRole('searchbox').fill('Song 3');
  await expect(page.locator('.music-song')).toHaveCount(1);
  await openMusicSearch(page);
  await page.getByRole('searchbox').fill('');
  await expect(page.locator('.music-song')).toHaveCount(3);
  await page.getByRole('button', { name: 'Shuffle', exact: true }).click();
  await expect(page.locator('.music-player')).toBeVisible();
  await page.keyboard.press(' ');
  await expect(page.getByRole('button', { name: 'Play music', exact: true })).toBeVisible();
});

test('automatic queue advance and video handoff have one playback owner', async ({ page }) => {
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect.poll(() => mpvPath(page)).toContain('Song 1.flac');
  await playheadTo(page, 1500);
  await expect.poll(() => mpvPath(page)).toContain('Song 2.flac');
  await expect(page.locator('.music-now-title strong')).toHaveText('Song 2');
  await page.evaluate(() => {
    const mock = (window as unknown as { __kinemaMock: { files: { path: string }[]; openVideo: (path: string) => void } }).__kinemaMock;
    mock.openVideo(mock.files[0].path);
  });
  await expect(page.locator('.player')).toBeVisible();
  await expect(page.locator('.music-player')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Music', exact: true })).toBeVisible();
});

test('music fits the Ally viewport and exposes controller focus', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.locator('.music-now-title strong')).toHaveText('Song 1');
  await expect(page.locator('.music-player')).toHaveAttribute('aria-busy', 'false');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.focused')).not.toHaveCount(0);
  await settled(page);
  const focused = await page.locator('.focused').first().boundingBox();
  const bar = await page.locator('.music-player').boundingBox();
  expect(focused!.y + focused!.height).toBeLessThanOrEqual(bar!.y);
  await page.screenshot({ path: 'work/music-preview.png', fullPage: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('video-style transport has track buttons and pointer/keyboard seeking', async ({ page }) => {
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.locator('.music-player')).toHaveAttribute('aria-busy', 'false');
  const transport = page.locator('.music-player .player-group-centre');
  await expect(transport.getByRole('button')).toHaveCount(3);
  await expect(transport.getByRole('button').nth(0)).toHaveAccessibleName('Previous song');
  await expect(transport.getByRole('button').nth(1)).toHaveAccessibleName('Pause music');
  await expect(transport.getByRole('button').nth(2)).toHaveAccessibleName('Next song');
  await expect(page.getByRole('button', { name: /ten seconds/i })).toHaveCount(0);
  const seek = page.locator('.music-player input.player-seek');
  const rect = (await seek.boundingBox())!;
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fakeMpv: { position: number } }).__fakeMpv.position)).toBeGreaterThan(600);
  const before = await page.evaluate(() => (window as unknown as { __fakeMpv: { position: number } }).__fakeMpv.position);
  await page.getByRole('slider', { name: 'Song position', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fakeMpv: { position: number } }).__fakeMpv.position)).toBeGreaterThan(before + 4);
  await page.screenshot({ path: 'work/music-player-updated.png' });
});

test('Japanese music UI preserves titles and supports kana searches', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('kinemaMockMusicJapanese', '1'));
  await page.reload();
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Language & subtitles', exact: true }).click();
  await page.getByRole('button', { name: 'Music language / 音楽の表示言語' }).click();
  await page.getByRole('button', { name: '音楽', exact: true }).click();
  await expect(page.getByRole('heading', { name: '音楽', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '曲名', exact: true }).click();
  await openMusicSearch(page);
  await page.getByRole('searchbox').fill('かたかな');
  await expect(page.locator('.music-song')).toHaveCount(1);
  await page.locator('.music-song-main').click();
  await expect(page.locator('.music-now-title strong')).toHaveText('カタカナ');
  await expect.poll(() => mpvPath(page)).toContain('音楽/曲2.flac');
  await expect(page.getByRole('button', { name: '次の曲', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'リピート: オフ', exact: true })).toBeVisible();
  await expect(page.getByRole('slider', { name: '曲の再生位置', exact: true })).toBeVisible();
  await expect(page.locator('.music-player')).toHaveAttribute('aria-busy', 'false');
  await page.screenshot({ path: 'work/music-japanese-preview.png' });
});

test('native extended paths finish loading and pause can resume repeatedly', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('kinemaMockMusicExtendedPaths', '1'));
  await page.reload();
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  await page.getByRole('button', { name: 'Album', exact: true }).click();
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.locator('.music-player')).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => mpvPath(page)).toBe('C:\\Music\\Song 1.flac');
  for (let i = 0; i < 2; i++) {
    const pause = page.getByRole('button', { name: 'Pause music', exact: true });
    await expect(pause.locator('svg')).toBeVisible();
    await pause.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __fakeMpv: { paused: boolean } }).__fakeMpv.paused)).toBe(true);
    const play = page.getByRole('button', { name: 'Play music', exact: true });
    await expect(play.locator('svg')).toBeVisible();
    await play.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __fakeMpv: { paused: boolean } }).__fakeMpv.paused)).toBe(false);
  }
});

test('full-screen music uses artwork and details, keeps playback, and exits from its bar', async ({ page }) => {
  await page.route('http://asset.localhost/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="#2d778c"/><stop offset=".6" stop-color="#89b2b0"/><stop offset="1" stop-color="#d3b89e"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="305" cy="90" r="37" fill="#f5e4c1"/><path d="M0 300Q170 190 400 300V400H0" fill="#253e4d"/></svg>' }));
  await page.evaluate(() => localStorage.setItem('kinemaMockMusicArtwork', 'C:/mock/cover.jpg'));
  await page.reload();
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  await page.getByRole('button', { name: 'Album', exact: true }).click();
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.locator('.music-player')).toHaveAttribute('aria-busy', 'false');
  const playing = await mpvPath(page);
  await page.getByRole('button', { name: 'Open full-screen music', exact: true }).click();
  await expect(page.locator('.music-now-playing')).toBeVisible();
  await expect(page.locator('.music-now-cover img')).toHaveJSProperty('naturalWidth', 400);
  await expect(page.locator('.music-now-artist')).toHaveText('Test artist');
  await expect(page.locator('.music-now-album')).toHaveText('First album');
  await expect(page.locator('.music-now-track')).toHaveText('Song 1');
  await expect.poll(() => mpvPath(page)).toBe(playing);
  await background(page, 'Butterchurn');
  await background(page, 'Radial spectrum');
  for(const mode of ['Radial spectrum','Retro LED','Color spectrum','Butterchurn']) {
    await background(page,mode);
    await expect(page.locator('.music-now-content')).toHaveCSS('opacity','1');
    await expect(page.locator('.music-now-cover img')).toHaveCSS('opacity','1');
  }
  await page.screenshot({path:'work/music-opaque-cover-fix.png'});
  await background(page, 'Plain image');
  await expect(page.locator('.music-now-playing')).toHaveClass(/background-plain/);
  await page.screenshot({ path: 'work/music-fullscreen-preview.png' });
  await page.getByRole('button', { name: 'Exit full-screen music', exact: true }).last().click();
  await expect(page.locator('.music-now-playing')).toHaveCount(0);
  await expect(page.locator('.music-player')).toBeVisible();
  await expect.poll(() => mpvPath(page)).toBe(playing);
  await page.getByRole('button', { name: 'Open full-screen music', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.music-now-playing')).toHaveCount(0);
});

test('Japanese full-screen controls fit the minimum handheld window', async ({ page }) => {
  await page.setViewportSize({ width: 854, height: 480 });
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Language & subtitles', exact: true }).click();
  await page.getByRole('button', { name: 'Music language / 音楽の表示言語' }).click();
  await page.getByRole('button', { name: '音楽', exact: true }).click();
  await page.getByRole('button', { name: '音楽を全画面表示', exact: true }).click();
  await expect(page.locator('.music-now-playing')).toBeVisible();
  for (const control of await page.locator('.music-player button').all()) {
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(854);
    expect(box.y + box.height).toBeLessThanOrEqual(480);
  }
});


test('full-screen controls hide, wake on input, and remain at queue end', async ({ page }) => {
  await page.getByRole('button', { name: 'Second album Test artist' }).click();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.locator('.music-player')).toHaveAttribute('aria-busy', 'false');
  await page.clock.install();
  await page.getByRole('button', { name: 'Open full-screen music', exact: true }).click();
  const stage = page.locator('.music-now-playing');
  await expect(page.getByRole('button',{name:'Close music player',exact:true})).toBeVisible();
  for (const input of ['mouse', 'keyboard', 'controller']) {
    await page.clock.fastForward(10_100);
    await expect(stage).toHaveClass(/music-controls-hidden/);
    if (input === 'mouse') await page.mouse.move(20, 20);
    else if (input === 'keyboard') await page.keyboard.press('Shift');
    else {
      await page.evaluate(() => Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ connected: true, mapping: 'standard', axes: [0, 0, 0.8, 0], buttons: [] }] }));
      await page.clock.runFor(50);
      await page.evaluate(() => Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [] }));
    }
    await expect(stage).not.toHaveClass(/music-controls-hidden/);
  }
  await page.clock.fastForward(10_100);
  await playheadTo(page, 1500);
  await page.clock.runFor(500);
  await expect(stage).not.toHaveClass(/music-controls-hidden/);
  await page.clock.fastForward(20_000);
  await expect(stage).not.toHaveClass(/music-controls-hidden/);
  await expect(page.getByRole('button', { name: 'Play music', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Play music', exact: true }).click();
  await page.clock.runFor(500);
  await expect(page.getByRole('button', { name: 'Pause music', exact: true })).toBeVisible();
  await expect.poll(() => mpvPath(page)).toContain('Song 3.flac');
});


test('album and artist tiles follow visible rows and columns at handheld sizes', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('kinemaMockMusicGrid', '1'));
  await page.reload();
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  for (const width of [1280, 854]) {
    await page.setViewportSize({ width, height: 720 });
    for (const tab of ['Album', 'Artist']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      const tiles = page.locator('.music-album-grid > button');
      await expect(tiles).toHaveCount(20);
      await settled(page);
      const first = (await tiles.nth(0).boundingBox())!;
      const across = await tiles.evaluateAll((items) => items.filter((item) => (item as HTMLElement).offsetTop === (items[0] as HTMLElement).offsetTop).length);
      expect(across).toBeGreaterThan(1);
      await tiles.nth(0).focus();
      await page.keyboard.press('ArrowRight');
      await expect(tiles.nth(1)).toHaveClass(/focused/);
      await page.keyboard.press('ArrowDown');
      await expect(tiles.nth(across + 1)).toHaveClass(/focused/);
      const below = (await tiles.nth(across + 1).boundingBox())!;
      expect(below.y).toBeGreaterThan(first.y);
      await page.keyboard.press('ArrowLeft');
      await expect(tiles.nth(across)).toHaveClass(/focused/);
      await page.keyboard.press('ArrowUp');
      await expect(tiles.nth(0)).toHaveClass(/focused/);
    }
  }
});

test('artist cards use first album covers and artist backgrounds fall back offline', async ({ page }) => {
  await page.route('http://asset.localhost/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#4686a0"/></svg>' }));
  await page.evaluate(() => { localStorage.setItem('kinemaMockMusicArtwork', 'C:/mock/first-cover.jpg'); localStorage.setItem('kinemaMockMusicSecondArtwork', 'C:/mock/second-cover.jpg'); localStorage.setItem('kinemaMockArtistBackground', 'C:/mock/artist.jpg'); localStorage.setItem('kinemaMockArtistThumb', 'C:/mock/portrait.jpg'); });
  await page.reload();
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  await page.getByRole('button', { name: 'Artist', exact: true }).click();
  const card = page.locator('.music-artist-list > button').first();
  await expect(card.locator('strong')).toHaveText('Test artist');
  await expect(card.locator('img')).toHaveAttribute('src', /first-cover.jpg/);
  await card.click();
  await expect(page.locator('.music-artist-backdrop img')).toHaveAttribute('src', /artist.jpg/);
  await expect(page.locator('.music-artist-detail .music-detail-image img')).toHaveAttribute('src', /portrait.jpg/);
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await page.getByRole('button', { name: 'Open full-screen music', exact: true }).click();
  await expect(page.locator('.music-now-backdrop img.current')).toHaveAttribute('src', /artist.jpg/);
  await openPanel(page);
  await page.getByRole('radiogroup', { name: 'Artwork source', exact: true }).getByRole('button', { name: 'Album background', exact: true }).click();
  await page.getByRole('button', { name: 'Close visualizer panel', exact: true }).click();
  await expect(page.locator('.music-now-backdrop img.current')).toHaveAttribute('src', /first-cover.jpg/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Album', exact: true }).click();
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await page.evaluate(() => localStorage.setItem('kinemaMockArtOffline', '1'));
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  await page.getByRole('button', { name: 'Artist', exact: true }).click();
  await page.locator('.music-artist-list > button').click();
  await expect(page.locator('.music-artist-detail .music-detail-image img')).toHaveAttribute('src', /first-cover.jpg/);
  await expect(page.locator('.music-artist-credit')).toHaveCount(0);
  await expect(page.locator('.music-player')).toBeVisible();
});

test('Butterchurn renders real presets and pauses without interrupting playback', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.locator('.music-player')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.music-player')).toHaveAttribute('aria-busy', 'false');
  const path = await mpvPath(page);
  await page.getByRole('button', { name: 'Open full-screen music', exact: true }).click();
  await page.evaluate(() => Object.defineProperty(window, 'Function', { value: new Proxy(Function, { construct() { throw new Error('Runtime code generation forbidden'); }, apply() { throw new Error('Runtime code generation forbidden'); } }) }));
  await background(page, 'Butterchurn');
  const canvas = page.locator('.music-butterchurn');
  await expect(canvas).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
  for (const size of [{ width: 1280, height: 720 }, { width: 854, height: 480 }]) {
    await page.setViewportSize(size);
    await expect.poll(() => canvas.evaluate((c) => ({ width: (c as HTMLCanvasElement).width, height: (c as HTMLCanvasElement).height }))).toEqual(size.width === 1280 ? { width: 960, height: 540 } : size);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator('.music-reactive-canvas, .music-ambient-waves')).toHaveCount(0);
  await openPanel(page);
  await expect(page.getByRole('button', { name: /Next preset:/ })).toBeVisible();
  const firstPreset = await page.getByRole('button', { name: /Next preset:/ }).textContent();
  await page.getByRole('button', { name: /Next preset:/ }).click();
  await expect(page.getByRole('button', { name: /Next preset:/ })).not.toHaveText(firstPreset!);
  for (let i = 0; i < 12; i++) {
    const frame = Number(await canvas.getAttribute('data-frame'));
    await page.getByRole('button', { name: /Next preset:/ }).click();
    await expect.poll(async () => Number(await canvas.getAttribute('data-frame'))).toBeGreaterThan(frame + 1);
    await expect(canvas).toHaveAttribute('data-status', 'live');
  }
  await page.getByRole('button', { name: 'Close visualizer panel', exact: true }).click();
  await page.screenshot({ path: 'work/music-butterchurn-preview.png' });
  await page.getByRole('button', { name: 'Pause music', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-status', 'paused');
  await page.getByRole('button', { name: 'Play music', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-status', 'live');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(canvas).toHaveAttribute('data-status', 'paused');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(canvas).toHaveAttribute('data-status', 'live');
  await expect.poll(() => mpvPath(page)).toBe(path);
  expect(errors).toEqual([]);
});

test('downloaded art slideshows switch between plain and blurred images', async ({ page }) => {
  await page.route('http://asset.localhost/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#42718b"/></svg>' }));
  await page.evaluate(() => localStorage.setItem('kinemaMockArtistGallery', JSON.stringify(['C:/mock/art-1.jpg', 'C:/mock/art-2.jpg', 'C:/mock/art-3.jpg'])));
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await page.clock.install();
  await page.getByRole('button', { name: 'Open full-screen music', exact: true }).click();
  await expect(page.locator('.music-slide')).toHaveCount(3);
  await expect(page.locator('.music-slide.current')).toHaveAttribute('src', /art-1.jpg/);
  await page.clock.fastForward(15_100);
  await expect(page.locator('.music-slide.current')).toHaveAttribute('src', /art-2.jpg/);
  await page.mouse.move(20,20);
  await background(page, 'Butterchurn');
  await background(page, 'Radial spectrum');
  await background(page, 'Plain image');
  await expect(page.locator('.music-now-playing')).toHaveClass(/background-plain/);
  await expect(page.locator('.music-slide.current')).toHaveCSS('filter', 'none');
  await background(page, 'Blurred image');
  await expect(page.locator('.music-slide.current')).toHaveCSS('filter', 'blur(40px)');
  await page.getByRole('button', { name: 'Pause music', exact: true }).click();
  const current = await page.locator('.music-slide.current').getAttribute('src');
  await page.clock.fastForward(31_000);
  await expect(page.locator('.music-slide.current')).toHaveAttribute('src', current!);
});


test('Butterchurn audio failure falls back to artwork and music keeps playing', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('kinemaMockPcmError', 'Audio service unavailable'));
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.locator('.music-player')).toHaveAttribute('aria-busy', 'false');
  const path = await mpvPath(page);
  await page.getByRole('button', { name: 'Open full-screen music', exact: true }).click();
  await background(page, 'Butterchurn');
  await expect(page.locator('.music-butterchurn')).toHaveAttribute('data-status', 'error');
  await expect(page.getByRole('status')).toHaveText('Butterchurn unavailable — showing artwork. Switch background to retry.');
  await background(page, 'Radial spectrum');
  await background(page, 'Plain image');
  await expect(page.locator('.music-now-playing')).toHaveClass(/background-plain/);
  await expect(page.getByRole('button', { name: 'Pause music', exact: true })).toBeVisible();
  await expect.poll(() => mpvPath(page)).toBe(path);
});


test('preset rotation can stay fixed or advance and persists through fullscreen', async ({ page }) => {
  await page.clock.install();
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.locator('.music-player')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Open full-screen music', exact: true }).click();
  await background(page, 'Butterchurn');
  await expect(page.locator('.music-butterchurn')).toHaveAttribute('data-status', 'live');
  await openPanel(page);
  await page.getByRole('radiogroup', { name: 'Playback mode', exact: true }).getByRole('button', { name: 'Static', exact: true }).click();
  const selected = () => page.evaluate(() => localStorage.getItem('kinema.music.preset'));
  const initial = await selected();
  await page.clock.fastForward(31_000);
  await expect.poll(selected).toBe(initial);
  await page.mouse.move(20,20);
  await openPanel(page);
  await page.getByRole('button', { name: /Next preset:/ }).click();
  await expect.poll(selected).not.toBe(initial);
  const manual = await selected();
  await page.getByRole('radiogroup', { name: 'Playback mode', exact: true }).getByRole('button', { name: 'Rotate', exact: true }).click();
  await page.clock.fastForward(30_100);
  await page.clock.runFor(50);
  await expect.poll(selected).not.toBe(manual);
  await page.mouse.move(30,30);
  await openPanel(page);
  await page.getByRole('radiogroup', { name: 'Playback mode', exact: true }).getByRole('button', { name: 'Static', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.music-now-playing')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open full-screen music', exact: true }).click();
  await openPanel(page);
  await expect(page.getByRole('radiogroup', { name: 'Playback mode', exact: true }).getByRole('button', { name: /Static/ })).toHaveClass(/chosen/);
});


test('Music restores the saved mode with a clean toolbar and settings manage music folders', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Library', exact: true }).click();
  const folders = page.locator('.music-folder-settings');
  await expect(folders.getByText('C:/Music', { exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('kinemaMockPick', 'C:/New Music'));
  await folders.getByRole('button', { name: 'Add music folder', exact: true }).click();
  await expect(folders.getByText('C:/New Music', { exact: true })).toBeVisible();
  await expect(folders.getByRole('status')).toContainText('unchanged');
  await folders.getByRole('button', { name: 'Scan music now', exact: true }).click();
  await expect(folders.getByRole('status')).toContainText('unchanged');
  const row = folders.locator('li').filter({ hasText: 'C:/New Music' });
  await row.getByRole('button', { name: 'Remove', exact: true }).click();
  await row.getByRole('button', { name: 'Remove music folder', exact: true }).click();
  await expect(folders.getByText('C:/New Music', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  await expect(page.locator('.brand')).toHaveText('Kinema Media');
  await expect(page.locator('.music-tabs')).toHaveCount(0);
  await expect(page.locator('.library-view-tabs button')).toHaveText(['Artist', 'Album', 'Year', 'Genre', 'Song title']);
  await expect(page.getByRole('button',{name:'Album',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.music-page').getByRole('button', { name: /Add music folder|Rescan|Music language|Folders/ })).toHaveCount(0);
});


test('a settings scan refreshes Music after returning before the scan completes', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('kinemaMockMusicScanDelay', '1'));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Library', exact: true }).click();
  await page.locator('.music-folder-settings').getByRole('button', { name: 'Scan music now', exact: true }).click();
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  await expect(page.locator('.music-album-grid > button')).toHaveCount(20);
});




test('MP3 tag workflows stage matches and bulk edits until Save', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => {
    localStorage.setItem('kinemaMockMp3', '1');
    window.dispatchEvent(new Event('kinema-music-library-changed'));
  });
  await page.getByRole('button', { name: 'First album Test artist' }).click();
  const album = page.locator('.music-album-detail');
  await album.getByRole('button', { name: 'Auto Music Match', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit Tags' });
  const preview = page.getByRole('dialog', { name: 'Preview match' });
  await expect(preview.getByText('Song 1.mp3', { exact: true })).toBeVisible();
  await expect(preview.getByText('1.1 · Matched Song 1', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: 'Use this match' }).click();
  await expect(editor.getByLabel('Song title').first()).toHaveValue('Matched Song 1');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('kinemaMockSavedTags'))).toBeNull();

  await album.getByRole('button', { name: 'Manual Match', exact: true }).click();
  const manual = page.getByRole('dialog', { name: 'Manual Match' });
  await manual.getByRole('button', { name: 'Search', exact: true }).click();
  await manual.getByRole('button', { name: /Matched Album.*Matched Artist/ }).click();
  await preview.getByRole('button', { name: 'Use this match' }).click();
  await expect(editor.getByLabel('Album artist', { exact: true })).toHaveValue('Matched Artist');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();

  await album.getByRole('button', { name: 'Edit Tags', exact: true }).click();
  await editor.getByLabel('Album artist', { exact: true }).fill('Correct Artist');
  await editor.getByLabel('Album', { exact: true }).fill('Correct Album');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(album.getByRole('heading', { name: 'Correct Album' })).toBeVisible();
  await expect(album.getByText('Song 1', { exact: true })).toBeVisible();
  await expect(album.getByText('Song 2', { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('kinemaMockSavedTags')!));
  expect(saved[1]).toMatchObject({ album_artist: 'Correct Artist', album: 'Correct Album' });
  expect(saved[2]).toMatchObject({ album_artist: 'Correct Artist', album: 'Correct Album' });
  expect(saved[1]).not.toHaveProperty('title');
  expect(saved[2]).not.toHaveProperty('title');
});

async function openMusicSearch(page: Page) {
  if (!(await page.getByRole('searchbox').isVisible())) await page.locator('.sidebar-music .library-toolbar button[aria-expanded]').last().click();
}
