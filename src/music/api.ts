import { invoke } from '@tauri-apps/api/core';
export interface MusicTrack {
  id: number; path: string; title: string; artist: string; album_artist: string;
  album: string; track: number; disc: number; duration: number; genre: string;
  year: number | null; artwork: string | null; missing: boolean;
}
export type MusicSort = 'artist' | 'album' | 'year' | 'genre' | 'title';
export type CollectionBackground = 'artist' | 'album' | 'images' | 'video';
export interface MusicCollection {
  id: number; name: string; default_sort?: MusicSort;
  background_kind?: CollectionBackground; background_path?: string;
}
export interface MusicRoot { id: number; path: string; collection_id?: number }
export interface MusicLibrary {
  roots: MusicRoot[];
  tracks: MusicTrack[];
  collections?: MusicCollection[];
  collection_tracks?: { track_id: number; collection_id: number }[];
}
export interface ScanReport { added: number; updated: number; unchanged: number; missing: number; errors: string[] }
export const getMusicLibrary = () => invoke<MusicLibrary>('music_library');
export const addMusicRoot = (path: string, collectionId = 1) => invoke<void>('music_add_root', { path, collectionId });
export const removeMusicRoot = (id: number) => invoke<void>('music_remove_root', { id });
export const MUSIC_LIBRARY_CHANGED = 'kinema-music-library-changed';
export interface AlbumArtProgress { kind: string; images: number; running: boolean; total: number; checked: number; found: number; unmatched: number; errors: number; cancelled: boolean; current: string; last_error: string | null }
export const albumArtStatus = () => invoke<AlbumArtProgress>('music_album_art_status');
export const cancelAlbumArt = () => invoke<void>('music_cancel_album_art');
export const findAlbumArt = async () => {
  try { return await invoke<AlbumArtProgress>('music_find_album_art'); }
  finally { window.dispatchEvent(new Event(MUSIC_LIBRARY_CHANGED)); }
};
export const ARTIST_ART_CHANGED = 'kinema-artist-art-changed';
export const findArtistArt = async () => {
  try { return await invoke<AlbumArtProgress>('music_find_artist_art'); }
  finally { window.dispatchEvent(new Event(ARTIST_ART_CHANGED)); }
};
export const scanMusic = async () => {
  const report = await invoke<ScanReport>('music_scan');
  window.dispatchEvent(new Event(MUSIC_LIBRARY_CHANGED));
  return report;
};

export interface TagPatch {
  id: number;
  album?: string;
  album_artist?: string;
  artist?: string;
  title?: string;
  genre?: string;
  year?: string;
  track?: string;
  disc?: string;
}

export interface MusicReleaseChoice {
  id: string;
  album: string;
  artist: string;
  date: string;
  country: string;
  description: string;
  track_count: number;
}

export interface MatchDraft {
  artist: string;
  album: string;
  tracks: TagPatch[];
  cover: string | null;
}

export const matchMusicAlbum = (ids: number[]) =>
  invoke<MatchDraft | null>('music_match_album', { ids });
export const searchMusicReleases = (album: string, artist: string) =>
  invoke<MusicReleaseChoice[]>('music_search_releases', { album, artist });
export interface ReleasePreview {
  album: string;
  artist: string;
  tracks: { title: string; disc: number; track: number }[];
  draft: MatchDraft | null;
}

export const getMusicReleaseMatch = (ids: number[], releaseId: string) =>
  invoke<ReleasePreview>('music_use_release', { ids, releaseId });
export const saveMusicTags = (patches: (TagPatch & { embed_cover: boolean })[], cover: string | null) =>
  invoke<ScanReport>('music_save_tags', { patches, cover });

export const previewMusicCover = (path: string) => invoke<string>('music_preview_cover', { path });

export const addMusicCollection = (name: string) => invoke<number>('music_add_collection', { name });
export const moveMusicRoot = (id: number, collectionId: number) => invoke<void>('music_move_root', { id, collectionId });

export const saveCollectionPreferences = (collection: MusicCollection) => invoke<void>('music_collection_preferences', {
  preferences: {
    id: collection.id,
    default_sort: collection.default_sort ?? 'artist',
    background_kind: collection.background_kind ?? 'artist',
    background_path: collection.background_path ?? '',
  },
});
export interface CollectionMedia { images: string[]; video: string | null }
export const getCollectionMedia = (id: number) => invoke<CollectionMedia>('music_collection_media', { id });
