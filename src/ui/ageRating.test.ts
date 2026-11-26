import { describe, expect, it } from 'vitest';
import { chooseCountry, localRating, systemRegions } from './ageRating';

describe('the local age rating', () => {
  const held = 'DK=15\tGB=12A\tUS=PG-13';

  it("shows the given country's rating", () => {
    expect(localRating(held, 'DK')).toBe('15');
    expect(localRating(held, 'GB')).toBe('12A');
  });

  it('says nothing when TMDB has none for that country, rather than another one', () => {
    expect(localRating(held, 'DE')).toBeNull();
    expect(localRating(held, null)).toBeNull();
    expect(localRating('', 'US')).toBeNull();
    expect(localRating(null, 'US')).toBeNull();
    expect(localRating('NO=', 'NO')).toBeNull();
  });

  it('reads regions from language codes', () => {
    expect(systemRegions(['nb-NO', 'en', 'en-US', 'nb_NO'])).toEqual(['NO', 'US']);
  });
});

describe('the country the rating follows', () => {
  it("is the system's own answer first, whatever the languages say", () => {
    expect(chooseCountry('NO', ['en-US'])).toBe('NO');
    expect(chooseCountry('no', ['da-DK'])).toBe('NO');
  });

  it('falls back to the first language only, where the system names none', () => {
    expect(chooseCountry(null, ['da-DK', 'en-US'])).toBe('DK');
    expect(chooseCountry(undefined, ['en-GB'])).toBe('GB');
    // a first language with no region: not the next one's
    expect(chooseCountry(null, ['nb', 'en-GB'])).toBeNull();
    expect(chooseCountry(null, [])).toBeNull();
  });

  it('ignores an answer that is not a country', () => {
    expect(chooseCountry('150', ['en-US'])).toBe('US');
    expect(chooseCountry('', ['nb'])).toBeNull();
  });
});
