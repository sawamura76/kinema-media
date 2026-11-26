/**
 * "Keep everything on this computer", as the page sees it (Rust side: the
 * gate in net.rs). PRIVATE-MODE.md §2, owner's choices 2026-11-21.
 *
 * One question every network caller asks: Rust's clients by `net::client`,
 * the page's own requests here (`fetchPolitely` calls `refuseOffline`), and a
 * picture from the internet in `useProxiedSrc` (cache only in the mode). The
 * buttons that would reach a service hide by `useOffline()`.
 */
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { setSetting } from '../metadata/api';
import { IMDB_TITLES_ALLOWED_KEY, OFFLINE_KEY } from '../metadata/imdbOffline';

export { OFFLINE_KEY, IMDB_TITLES_ALLOWED_KEY };
/** In the mode, IMDb's ratings file: "0" = off (net.rs IMDB_RATINGS_KEY). */
export const IMDB_RATINGS_ALLOWED_KEY = 'imdb_ratings_allowed';

/** What a refused request says (net.rs KEPT_HERE). */
export const KEPT_HERE =
  'Keep everything on this computer is on, so Kinema Media does not ask the internet for this.';

export interface OfflineState {
  offline: boolean;
  imdbRatings: boolean;
  imdbTitles: boolean;
}

/** A request the mode did not make. Not a failure of the service. */
export class KeptOnDevice extends Error {
  constructor() {
    super(KEPT_HERE);
    this.name = 'KeptOnDevice';
  }
}

const ONLINE: OfflineState = { offline: false, imdbRatings: true, imdbTitles: false };
let current: Promise<OfflineState> | null = null;
const listeners = new Set<() => void>();

/** The mode now; asked of Rust once, again after a change. */
export function offlineState(): Promise<OfflineState> {
  current ??= Promise.resolve()
    .then(() => invoke<OfflineState>('offline_current'))
    .then((s) => (s && typeof s.offline === 'boolean' ? s : ONLINE))
    .catch(() => ONLINE);
  return current;
}

export const offlineNow = () => offlineState().then((s) => s.offline);

/** Tell everything that asks that the settings changed. */
export function offlineChanged(): void {
  current = null;
  listeners.forEach((l) => l());
}

/** Before any request of the page's own: refused in the mode. */
export async function refuseOffline(): Promise<void> {
  if (await offlineNow()) throw new KeptOnDevice();
}

/** The mode's settings, kept up to date. Null until known. */
export function useOfflineState(): OfflineState | null {
  const [state, setState] = useState<OfflineState | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => void offlineState().then((s) => live && setState(s));
    read();
    listeners.add(read);
    return () => {
      live = false;
      listeners.delete(read);
    };
  }, []);
  return state;
}

/** Whether the mode is on. Null until known. */
export function useOffline(): boolean | null {
  return useOfflineState()?.offline ?? null;
}

/** Switch the mode on: the list of titles allowed, then the mode. */
export async function keepOnDevice(): Promise<void> {
  await setSetting(IMDB_TITLES_ALLOWED_KEY, '1');
  await setSetting(OFFLINE_KEY, '1');
  offlineChanged();
}

/** Switch the mode off; the list of titles goes (it is only for the mode). */
export async function leaveDevice(): Promise<number> {
  await setSetting(OFFLINE_KEY, '0');
  await setSetting(IMDB_TITLES_ALLOWED_KEY, '0');
  offlineChanged();
  return removeImdbTitles();
}

/** One IMDb file's own switch, in the mode. Off removes the list at once. */
export async function setImdbFile(which: 'ratings' | 'titles', on: boolean): Promise<number> {
  if (which === 'ratings') {
    await setSetting(IMDB_RATINGS_ALLOWED_KEY, on ? '1' : '0');
    offlineChanged();
    return 0;
  }
  await setSetting(IMDB_TITLES_ALLOWED_KEY, on ? '1' : '0');
  offlineChanged();
  return on ? 0 : removeImdbTitles();
}

export const removeImdbTitles = () => invoke<number>('imdb_titles_remove');

export interface RemovedOnline {
  titles: number;
  pictures: number;
  bytes: number;
}
export const removeFetchedOnline = () => invoke<RemovedOnline>('remove_fetched_online');
