import { invoke } from '@tauri-apps/api/core';
import { useVisualizationSettings } from './visualizationSettings';
import { useEffect, useState } from 'react';
import { MUSIC_LIBRARY_CHANGED, getCollectionMedia, getMusicLibrary, type MusicCollection, type CollectionMedia } from './api';

export function useCollectionBackground(trackId: number | undefined) {
  const settings = useVisualizationSettings();
  const source = settings.mediaSources.find((item) => item.id === settings.mediaSource);
  const sourceKind = source?.kind, sourcePath = source?.path;
  const [collection, setCollection] = useState<MusicCollection | null>(null);
  const [media, setMedia] = useState<CollectionMedia>({ images: [], video: null });
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true, request = 0;
    const load = async () => {
      const token = ++request;
      try {
        const library = await getMusicLibrary();
        const id = library.collection_tracks?.find((item) => item.track_id === trackId)?.collection_id;
        const found = library.collections?.find((item) => item.id === id) ?? null;
        const result = sourceKind && sourcePath ? await invoke<CollectionMedia>('visualization_media', { kind: sourceKind, path: sourcePath }) : settings.mediaSource !== 'collection' ? { images: [], video: null } : found && ['images', 'video'].includes(found.background_kind ?? '')
          ? await getCollectionMedia(found.id) : { images: [], video: null };
        if (alive && token === request) { setCollection(settings.mediaSource === 'collection' ? found : null); setMedia(result); setError(''); }
      } catch (reason) {
        if (alive && token === request) { setCollection(null); setMedia({ images: [], video: null }); setError(String(reason)); }
      }
    };
    void load();
    window.addEventListener(MUSIC_LIBRARY_CHANGED, load);
    return () => { alive = false; window.removeEventListener(MUSIC_LIBRARY_CHANGED, load); };
  }, [trackId, settings.mediaSource, sourceKind, sourcePath]);
  return { collection, media, error };
}

