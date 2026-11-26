import type { Album } from './model';
import type { MusicSort, MusicTrack } from './api';

export const MUSIC_SORTS: { value: MusicSort; label: string; ja: string }[] = [
  { value: 'artist', label: 'Artist', ja: 'アーティスト' },
  { value: 'album', label: 'Album', ja: 'アルバム' },
  { value: 'year', label: 'Year', ja: '年' },
  { value: 'genre', label: 'Genre', ja: 'ジャンル' },
  { value: 'title', label: 'Song title', ja: '曲名' },
];
function compare(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}
export function sortTracks(tracks: MusicTrack[], by: MusicSort): MusicTrack[] {
  return [...tracks].sort((a, b) => {
    const primary = by === 'year' ? (a.year ?? 99999) - (b.year ?? 99999)
      : compare(by === 'artist' ? a.album_artist : a[by], by === 'artist' ? b.album_artist : b[by]);
    return primary || compare(a.album_artist, b.album_artist) || compare(a.album, b.album) ||
      a.disc - b.disc || a.track - b.track || compare(a.title, b.title);
  });
}
export function sortAlbums(albums: Album[], by: MusicSort): Album[] {
  return [...albums].sort((a, b) => {
    const first = (album: Album) => sortTracks(album.tracks, by)[0];
    const x = first(a), y = first(b);
    const primary = by === 'year' ? (x?.year ?? 99999) - (y?.year ?? 99999)
      : compare(by === 'artist' ? a.artist : by === 'album' ? a.title : x?.[by] ?? '',
        by === 'artist' ? b.artist : by === 'album' ? b.title : y?.[by] ?? '');
    return primary || compare(a.artist, b.artist) || compare(a.title, b.title);
  });
}

/** Group complete albums by their first sorted year/genre, retaining track order. */
export function groupAlbums(albums: Album[], by: MusicSort, japanese = false): { label: string; albums: Album[] }[] {
  if (by !== 'year' && by !== 'genre') return [{ label: '', albums }];
  const groups = new Map<string, Album[]>();
  for (const album of albums) {
    const track = sortTracks(album.tracks, by)[0];
    const label = by === 'year' ? track?.year && track.year > 0 ? String(track.year) : japanese ? '年不明' : 'Unknown year'
      : track?.genre.trim() || (japanese ? 'ジャンル不明' : 'Unknown genre');
    const key = label.toLocaleLowerCase();
    const existing = [...groups.keys()].find((name) => name.toLocaleLowerCase() === key);
    if (existing) groups.get(existing)!.push(album); else groups.set(label, [album]);
  }
  return [...groups].map(([label, items]) => ({ label, albums: items }));
}
