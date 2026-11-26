import { describe, expect, it } from 'vitest';
import type { Title } from './api';
import { pickHero } from './hero';

const day = 86_400_000;
const now = new Date(2026, 8, 28, 12).getTime();

const title = (id: number, fields: Partial<Title> = {}): Title => ({
  id,
  kind: 'movie',
  provider: 'tmdb',
  title: `T${id}`,
  year: 2020,
  overview: null,
  genres: null,
  runtime_mins: null,
  poster_url: null,
  backdrop_url: `b${id}`,
  poster_path: null,
  backdrop_path: null,
  logo_url: null,
  logo_path: null,
  trailer_key: null,
  trailer_site: null,
  rating: null,
  file_count: 1,
  added_at: 0,
  episodes_owned: 0,
  episodes_watched: 0,
  watched: false,
  progress: null,
  cast: [],
  ...fields,
});

describe('pickHero', () => {
  const library = [title(1), title(2), title(3), title(4)];

  it('changes from one day to the next, and holds within a day', () => {
    const today = pickHero(library, null, now)?.id;
    expect(pickHero(library, null, now + 3_600_000)?.id).toBe(today);
    expect(pickHero(library, null, now + day)?.id).not.toBe(today);
  });

  it('never picks something finished, or what Continue watching leads with', () => {
    const lib = [title(1, { watched: true }), title(2), title(3, { watched: true })];
    for (let d = 0; d < 5; d++) expect(pickHero(lib, null, now + d * day)?.id).toBe(2);
    expect(pickHero([title(2), title(5)], 2, now)?.id).toBe(5);
  });

  it('puts a new, unwatched arrival first for a few days', () => {
    const lib = [...library, title(9, { added_at: now / 1000 - 3600 })];
    expect(pickHero(lib, null, now)?.id).toBe(9);
    expect(pickHero(lib, null, now + 5 * day)?.id).not.toBe(undefined);
  });

  it('shows the film named in home-top.txt, watched or new arrival or not', () => {
    const lib = [
      title(1, { title: 'Dune: Part Two', year: 2024, watched: true }),
      title(2, { title: 'Dune', year: 1984 }),
      title(3, { title: 'Dune', year: 2021 }),
      title(9, { added_at: now / 1000 - 3600 }),
    ];
    expect(pickHero(lib, null, now, 'dune part two')?.id).toBe(1);
    expect(pickHero(lib, 1, now, 'Dune: Part Two')?.id).toBe(1);
    expect(pickHero(lib, null, now, 'Dune (2021)')?.id).toBe(3);
    expect(pickHero(lib, null, now, '  DUNE (1984) ')?.id).toBe(2);
  });

  it('ignores a name that matches nothing', () => {
    const lib = [...library, title(9, { added_at: now / 1000 - 3600 })];
    expect(pickHero(lib, null, now, 'Not in the library')?.id).toBe(9);
    expect(pickHero(lib, null, now, '(2024)')?.id).toBe(9);
  });

  it('prefers a picture, but falls back to anything', () => {
    const lib = [title(1, { backdrop_url: null }), title(2)];
    expect(pickHero(lib, null, now)?.id).toBe(2);
    expect(pickHero([title(1, { backdrop_url: null })], null, now)?.id).toBe(1);
    expect(pickHero([], null, now)).toBeNull();
  });
});
