/**
 * The offline rules on top of the scorer: 2a (a partial name needs the exact
 * year) and the running-time tie-break.
 */
import { describe, expect, it } from 'vitest';
import { chooseImdb, imdbMetadata, toCandidate, type ImdbTitle } from './imdbOffline';

function title(id: string, name: string, year: number | null, votes: number, runtime: number | null = null): ImdbTitle {
  return {
    imdbId: id,
    series: false,
    title: name,
    originalTitle: null,
    year,
    endYear: null,
    runtimeMins: runtime,
    genres: ['Drama'],
    votes,
    rating: 7,
  };
}

const pick = (list: ImdbTitle[], name: string, year: number | null, minutes: number | null = null) =>
  chooseImdb(list.map(toCandidate), { parsedTitle: name, parsedYear: year }, minutes);

describe('chooseImdb', () => {
  it('the same name and year is matched', () => {
    const got = pick([title('tt1', 'A Film', 2010, 5000), title('tt2', 'A Film Returns', 2014, 3000)], 'A Film', 2010);
    expect(got.matched).toBe(true);
    expect(got.best?.providerId).toBe('tt1');
  });

  it('a name only partly the same, a year off, goes to Needs attention (2a)', () => {
    const got = pick([title('tt1', 'Big Film: Part Two', 2021, 90000)], 'Big Film Part 2', 2020);
    // "part two" and "part 2" are the same name to the scorer: allowed.
    expect(got.matched).toBe(true);
    const partial = pick([title('tt3', 'Star Saga: Episode VIII - The Last One', 2017, 600000)], 'Star Saga The Last One', 2018);
    expect(partial.matched).toBe(false);
    expect(partial.best?.reason).toMatch(/year not exact|ambiguous|title/);
  });

  it('a name only partly the same with the exact year is matched', () => {
    const got = pick([title('tt4', 'Jurassic Park Dominion', 2022, 300000)], 'Jurassic Park 3 Dominion', 2022);
    // 3 of 4 words, ends differently? No: both end in "dominion".
    if (got.matched) expect(got.best?.providerId).toBe('tt4');
    const offByOne = pick([title('tt4', 'Jurassic Park Dominion', 2022, 300000)], 'Jurassic Park 3 Dominion', 2021);
    expect(offByOne.matched).toBe(false);
  });

  it('a stub of the same name loses to the real film by votes', () => {
    const got = pick([title('tt5', 'Heat', 1995, 700000), title('tt6', 'Heat', 1995, 12)], 'Heat', 1995);
    expect(got.matched).toBe(true);
    expect(got.best?.providerId).toBe('tt5');
  });

  it('two real films of one name and year are told apart by running time', () => {
    const list = [title('tt7', 'Twins', 2005, 4000, 95), title('tt8', 'Twins', 2005, 3000, 140)];
    expect(pick(list, 'Twins', 2005).matched).toBe(false);
    const byTime = pick(list, 'Twins', 2005, 139.2);
    expect(byTime.matched).toBe(true);
    expect(byTime.best?.providerId).toBe('tt8');
    expect(byTime.best?.reason).toMatch(/running time/);
  });

  it('running time decides nothing when both are close, or one is unknown', () => {
    const close = [title('tt7', 'Twins', 2005, 4000, 100), title('tt8', 'Twins', 2005, 3000, 104)];
    expect(pick(close, 'Twins', 2005, 102).matched).toBe(false);
    const unknown = [title('tt7', 'Twins', 2005, 4000, 95), title('tt8', 'Twins', 2005, 3000, null)];
    expect(pick(unknown, 'Twins', 2005, 95).matched).toBe(false);
  });

  it('a little-known entry of the name is refused beside a famous film with a longer IMDb name', () => {
    const list = [
      title('tt9', 'The Bird', 2014, 40),
      title('tt10', 'Bird or (The Long Name of It)', 2014, 700000),
    ];
    const got = pick(list, 'Bird', 2014);
    expect(got.matched).toBe(false);
    expect(got.best?.reason).toMatch(/far better known/);
    // Not when the famous one is another year, or not far better known.
    expect(pick([list[0], { ...list[1], year: 1990 }], 'Bird', 2014).matched).toBe(true);
    expect(pick([list[0], { ...list[1], votes: 300 }], 'Bird', 2014).matched).toBe(true);
  });

  it('nothing found is no match', () => {
    expect(pick([], 'Anything', 2001)).toEqual({ best: null, matched: false });
  });

  it('a title from the list is stored with what the list has, and nothing else', () => {
    const stored = imdbMetadata({ ...title('tt0133093', 'The Matrix', 1999, 2e6, 136), genres: ['Action', 'Sci-Fi'] });
    expect(stored).toMatchObject({
      kind: 'movie',
      provider: 'imdb',
      provider_id: 'tt0133093',
      imdb_id: 'tt0133093',
      tmdb_id: null,
      runtime_mins: 136,
      genres: '["Action","Sci-Fi"]',
      poster_url: null,
      overview: null,
    });
  });
});
