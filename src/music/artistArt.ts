import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ARTIST_ART_CHANGED } from './api';

export interface ArtistArt { artist: string; gallery: string[]; background: string | null; thumb: string | null; source: string; biography_en?: string | null; biography_url?: string | null; biography_ja?: string | null }
export function useArtistArt(artist: string | null) {
  const [result, setResult] = useState<{ artist: string; art?: ArtistArt; error?: string } | null>(null);
  const generation = useRef(0);
  const load = useCallback((refresh: boolean) => {
    if (!artist) return;
    const token = ++generation.current;
    void invoke<ArtistArt>('music_artist_art', { artist, refresh }).then(
      (art) => { if (generation.current === token) setResult({ artist, art }); },
      (error) => { if (generation.current === token) setResult({ artist, error: String(error) }); },
    );
  }, [artist]);
  const cancel = useCallback(() => { ++generation.current; }, []);
  useEffect(() => {
    const updated=()=>load(false);load(false);window.addEventListener(ARTIST_ART_CHANGED,updated);
    return ()=>{cancel();window.removeEventListener(ARTIST_ART_CHANGED,updated);};
  }, [load, cancel]);
  return { art: result?.artist === artist ? result.art : undefined, error: result?.artist === artist ? result.error : undefined, refresh: () => load(true) };
}
