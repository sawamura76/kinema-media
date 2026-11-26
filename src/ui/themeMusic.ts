/**
 * Theme music (details page, round 10): a `theme.mp3` kept beside a show or
 * film (extras.rs `read_theme`) plays softly while its page is open, when
 * Settings → Playback → Theme music is on. Off by default. Local files only;
 * nothing is fetched from anywhere.
 *
 * The file is read by the app and handed to a page player as bytes: the page
 * may open only the artwork folder by address, and a film's folder is
 * anywhere. A webview refusing to start sound before a key or click is
 * waited out with the first one; one that cannot play the format says nothing.
 */
import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getSetting } from '../metadata/api';

export const THEME_MUSIC_KEY = 'theme_music';
const VOLUME = 0.4;

/** The theme tune's type and bytes, or null when there is none. */
async function readTheme(videoPath: string): Promise<Blob | null> {
  const raw = await invoke<ArrayBuffer | number[] | Uint8Array>('read_theme', { videoPath });
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);
  const cut = bytes.indexOf(10);
  if (cut < 1) return null;
  const type = new TextDecoder().decode(bytes.subarray(0, cut));
  return new Blob([bytes.subarray(cut + 1)], { type });
}

/** Plays the theme beside `anchor` while the calling page is mounted. */
export function useThemeMusic(anchor: string | null | undefined): void {
  useEffect(() => {
    if (!anchor) return;
    let stopped = false;
    let audio: HTMLAudioElement | null = null;
    let url: string | null = null;
    const waiting: Array<() => void> = [];

    void (async () => {
      try {
        if ((await getSetting(THEME_MUSIC_KEY)) !== 'on') return;
        const blob = await readTheme(anchor);
        if (!blob || stopped) return;
        url = URL.createObjectURL(blob);
        audio = new Audio(url);
        audio.loop = true;
        audio.volume = VOLUME;
        const play = () => audio?.play();
        try {
          await play();
        } catch {
          // No sound before a gesture: start with the first one.
          const start = () => {
            cleanup();
            if (!stopped) void play()?.catch(() => undefined);
          };
          const cleanup = () => {
            window.removeEventListener('keydown', start);
            window.removeEventListener('pointerdown', start);
          };
          window.addEventListener('keydown', start);
          window.addEventListener('pointerdown', start);
          waiting.push(cleanup);
        }
      } catch (e) {
        console.warn('theme music', e);
      }
    })();

    return () => {
      stopped = true;
      waiting.forEach((f) => f());
      audio?.pause();
      audio = null;
      if (url) URL.revokeObjectURL(url);
    };
  }, [anchor]);
}
