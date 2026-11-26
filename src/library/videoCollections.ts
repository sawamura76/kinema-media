import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
export type VideoKind = 'movies' | 'tv';
export interface VideoCollection { id: number; name: string; kind: VideoKind }
export interface VideoCollections {
  collections: VideoCollection[];
  roots: { root_id: number; collection_id: number }[];
  titles: { title_id: number; collection_id: number }[];
}
export const VIDEO_COLLECTIONS_CHANGED = 'kinema-video-collections-changed';
export const getVideoCollections = () => invoke<VideoCollections>('video_collections');
export async function addVideoCollection(name: string, kind: VideoKind) {
  const id = await invoke<number>('video_add_collection', { name, kind });
  window.dispatchEvent(new Event(VIDEO_COLLECTIONS_CHANGED));
  return id;
}
export async function assignVideoRoot(rootId: number, collectionId: number) {
  await invoke('video_assign_root', { rootId, collectionId });
  window.dispatchEvent(new Event(VIDEO_COLLECTIONS_CHANGED));
}
export function useVideoCollections(refreshKey?: unknown) {
  const [library, setLibrary] = useState<VideoCollections | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true, request = 0;
    const load = () => {
      const token = ++request;
      void getVideoCollections().then((data) => { if (live && token === request) { setLibrary(data); setError(''); } }).catch((reason) => { if (live && token === request) setError(String(reason)); });
    };
    load();
    window.addEventListener(VIDEO_COLLECTIONS_CHANGED, load);
    return () => { live = false; window.removeEventListener(VIDEO_COLLECTIONS_CHANGED, load); };
  }, [refreshKey]);
  return { library, error };
}
export function selectedVideoCollection(kind: VideoKind): number {
  try { const value = Number(localStorage.getItem('kinema.collection.' + kind) ?? (kind === 'movies' ? 1 : 2)); return Number.isSafeInteger(value) && value >= 0 ? value : kind === 'movies' ? 1 : 2; } catch { return kind === 'movies' ? 1 : 2; }
}
export function filterCollectionTitles<T extends { id: number }>(titles: T[], library: VideoCollections | null, collectionId: number) {
  if (!library || collectionId === 0) return titles;
  const ids = new Set(library.titles.filter((item) => item.collection_id === collectionId).map((item) => item.title_id));
  return titles.filter((title) => ids.has(title.id));
}
