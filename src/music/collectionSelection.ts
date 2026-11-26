import { useSyncExternalStore } from 'react';

const KEY = 'kinema.music.collection';
const EVENT = 'kinema-music-collection-changed';
function selected(): number {
  const id = Number(localStorage.getItem(KEY));
  return Number.isSafeInteger(id) && id >= 0 && localStorage.getItem(KEY) !== null ? id : 1;
}
function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}
export const useMusicCollection = () => useSyncExternalStore(subscribe, selected);
export function setMusicCollection(id: number) {
  localStorage.setItem(KEY, String(id));
  window.dispatchEvent(new Event(EVENT));
}
