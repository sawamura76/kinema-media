import { useEffect, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const KEY = 'kinema.media.floatingPlayer';
type Kind = 'music' | 'video';
const KEYS = { music: 'kinema.media.musicMiniPlayer', video: 'kinema.media.videoMiniPlayer' };
const listeners = new Set<() => void>();
const snapshot = (kind: Kind) => localStorage.getItem(KEYS[kind]) ? localStorage.getItem(KEYS[kind]) !== 'off' : localStorage.getItem(KEY) !== 'off';
function subscribe(listener: () => void) { listeners.add(listener); window.addEventListener('storage', listener); return () => { listeners.delete(listener); window.removeEventListener('storage', listener); }; }
export function useFloatingEnabled(kind: Kind) { return useSyncExternalStore(subscribe, () => snapshot(kind)); }
export function setFloatingEnabled(kind: Kind, value: boolean) { localStorage.setItem(KEYS[kind], value ? 'on' : 'off'); listeners.forEach((fn) => fn()); }
export function restoreFloating() { return invoke<void>('mini_player_restore'); }

/** Keeps the same React/native playback owner alive when its window shrinks. */
export function useFloatingPlayer(kind: 'music' | 'video' | null) {
  const music = useFloatingEnabled('music'), video = useFloatingEnabled('video');
  const enabled = kind === 'video' ? video : music;
  const [floating, setFloating] = useState(false);
  useEffect(() => {
    let alive = true, off: (() => void) | undefined;
    void listen<boolean>('floating-player', (event) => { if (alive) setFloating(event.payload); }).then((fn) => { if (alive) off = fn; else fn(); }).catch(console.warn);
    return () => { alive = false; off?.(); };
  }, []);
  useEffect(() => {
    let alive = true;
    void invoke<boolean>('mini_player_sync', { kind: enabled ? kind : null }).then((value) => { if (alive) setFloating(value); }).catch(console.warn);
    return () => { alive = false; };
  }, [kind, enabled]);
  useEffect(() => {
    if (!floating) return;
    const key = (event: KeyboardEvent) => {
      if (['Escape', 'Backspace', 'BrowserBack', 'F11'].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation(); void restoreFloating().catch(console.warn);
      }
    };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  }, [floating]);
  return floating;
}
