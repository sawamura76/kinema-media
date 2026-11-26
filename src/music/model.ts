import type { MusicTrack } from './api';
export interface Album { key: string; title: string; artist: string; artwork: string | null; tracks: MusicTrack[] }
export function albumsOf(tracks: MusicTrack[]): Album[] {
  const albums = new Map<string, Album>();
  for (const track of tracks) {
    // Untagged albums in different folders must not collapse into one giant album.
    const folder = track.album === 'Unknown album' ? track.path.replace(/[/\\][^/\\]+$/, '') : '';
    const key = JSON.stringify([track.album_artist.normalize('NFC').toLocaleLowerCase(), track.album.normalize('NFC').toLocaleLowerCase(), folder.toLocaleLowerCase()]);
    const album = albums.get(key) ?? { key, title: track.album, artist: track.album_artist, artwork: null, tracks: [] };
    album.tracks.push(track);
    album.artwork ??= track.artwork;
    albums.set(key, album);
  }
  return [...albums.values()].map((a) => ({ ...a, tracks: a.tracks.sort((x, y) => x.disc - y.disc || x.track - y.track || x.path.localeCompare(y.path, undefined, { numeric: true })) }))
    .sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
}
export type Repeat = 'off' | 'all' | 'one';
export function nextIndex(length: number, index: number, direction: number, repeat: Repeat, ended = false): number | null {
  if (!length) return null;
  if (ended && repeat === 'one') return index;
  const next = index + direction;
  if (next >= 0 && next < length) return next;
  return repeat === 'all' ? (next + length) % length : null;
}
export function shuffled<T>(items: T[], random = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
export function clock(seconds: number): string {
  const n = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

export const isMp3 = (track: MusicTrack) => /\.mp3$/i.test(track.path);
const folder = (track: MusicTrack) => track.path.replace(/[/\\][^/\\]+$/, '').toLowerCase();

export function folderMp3s(album: MusicTrack[], library: MusicTrack[]) {
  const folders = new Set(album.filter(isMp3).map(folder));
  return library.filter((track) => isMp3(track) && folders.has(folder(track)));
}

