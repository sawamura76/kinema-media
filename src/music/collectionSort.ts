import { useSyncExternalStore } from 'react';
import type { MusicSort } from './api';

const EVENT = 'kinema-music-sort-changed';
const key = (id: number) => `kinema.music.collection.${id}.sort`;
const valid = (value: string | null): value is MusicSort =>
  value !== null && ['artist', 'album', 'year', 'genre', 'title'].includes(value);

export function readCollectionSort(id: number, fallback: MusicSort): MusicSort {
  if (id !== 0) return fallback;
  const value = localStorage.getItem(key(id));
  return valid(value) ? value : fallback;
}
export function saveCollectionSort(id: number, value: MusicSort) {
  localStorage.setItem(key(id), value);
  window.dispatchEvent(new Event(EVENT));
}
function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}
export function useCollectionSort(id: number, fallback: MusicSort) {
  return useSyncExternalStore(subscribe, () => readCollectionSort(id, fallback));
}
