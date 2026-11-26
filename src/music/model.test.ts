import { describe, expect, it } from 'vitest';
import { albumsOf, nextIndex, shuffled } from './model';
import type { MusicTrack } from './api';
const song = (id: number, fields: Partial<MusicTrack> = {}): MusicTrack => ({ id, path: `C:/Music/${id}.mp3`, title: `Song ${id}`, artist: 'Guest', album_artist: 'Various Artists', album: 'Compilation', track: id, disc: 1, duration: 90, artwork: null, genre: '', year: null, missing: false, ...fields });
describe('music library grouping', () => {
  it('keeps a compilation together and sorts disc before track', () => {
    const albums = albumsOf([song(1, { disc: 2 }), song(3, { artist: 'Other' }), song(2)]);
    expect(albums).toHaveLength(1);
    expect(albums[0].tracks.map((s) => s.id)).toEqual([2, 3, 1]);
  });
  it('separates identically named albums by album artist and untagged folders', () => {
    expect(albumsOf([song(1), song(2, { album_artist: 'Other' })])).toHaveLength(2);
    expect(albumsOf([song(1, { album: 'Unknown album', path: 'C:/A/1.wav' }), song(2, { album: 'Unknown album', path: 'C:/B/2.wav' })])).toHaveLength(2);
  });
});
describe('queue stepping', () => {
  it('stops at the end unless repeat is requested', () => {
    expect(nextIndex(2, 1, 1, 'off', true)).toBeNull();
    expect(nextIndex(2, 1, 1, 'all', true)).toBe(0);
    expect(nextIndex(2, 1, 1, 'one', true)).toBe(1);
    expect(nextIndex(2, 0, 1, 'one', false)).toBe(1);
  });
  it('shuffles without losing or duplicating songs or changing the source', () => {
    const input = [1, 2, 3, 4];
    expect(shuffled(input, () => 0).sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4]);
  });
});
