
import { describe, it, expect } from 'vitest';
import { sortTracks, sortAlbums, groupAlbums } from './sorting';
import { albumsOf } from './model';
import type { MusicTrack } from './api';

const track = (id: number, title: string, album: string, year: number | null, genre: string): MusicTrack => ({
  id, path: 'C:/Music/' + id + '.mp3', title, album, year, genre,
  artist: 'Artist', album_artist: 'Artist', disc: 1, track: id,
  duration: 100, artwork: null, missing: false,
});
describe('collection sort order', () => {
  it('sorts year and genre while retaining album track order', () => {
    const songs = [track(1, 'First', 'Later', 2000, 'Rock'), track(2, 'Last', 'Early', 1980, 'Jazz'),
      track(3, 'Unknown', 'Unknown', null, '')];
    expect(sortTracks(songs, 'year').map((item) => item.id)).toEqual([2, 1, 3]);
    expect(sortTracks(songs.slice(0, 2), 'genre').map((item) => item.id)).toEqual([2, 1]);
    expect(sortAlbums(albumsOf(songs), 'year').map((item) => item.title)).toEqual(['Early', 'Later', 'Unknown']);
    expect(songs.map((item) => item.id)).toEqual([1, 2, 3]);
  });
});

it('groups whole albums with year and genre headings and explicit missing metadata labels', () => {
  const songs = [track(1, 'First', 'A', 1983, 'Pop'), track(2, 'Second', 'A', 1983, 'Pop'), track(3, 'Third', 'B', 2001, 'Rock'), track(4, 'Fourth', 'C', null, '')];
  const albums = albumsOf(songs);
  expect(groupAlbums(sortAlbums(albums, 'year'), 'year').map((group) => [group.label, group.albums.length])).toEqual([['1983', 1], ['2001', 1], ['Unknown year', 1]]);
  expect(groupAlbums(sortAlbums(albums, 'genre'), 'genre').map((group) => group.label)).toEqual(['Unknown genre', 'Pop', 'Rock']);
  expect(groupAlbums(albums, 'album')).toEqual([{ label: '', albums }]);
  expect(albums[0].tracks).toHaveLength(2);
});
