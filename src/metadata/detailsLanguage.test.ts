/**
 * The details language: which translation each field is taken from, and when
 * the English underneath stays.
 */
import { describe, expect, it } from 'vitest';
import {
  DETAILS_LANGUAGES,
  imageLanguages,
  isPlaceholderName,
  languageForSystem,
  localiseDetail,
  mergeEpisodes,
  posterInLanguage,
  translatedField,
  type TmdbTranslation,
} from './detailsLanguage';

const translations: TmdbTranslation[] = [
  { iso_639_1: 'es', iso_3166_1: 'MX', data: { title: 'Título de México', overview: 'Descripción de México.' } },
  { iso_639_1: 'es', iso_3166_1: 'ES', data: { title: 'Título de España', overview: '' } },
  { iso_639_1: 'en', iso_3166_1: 'US', data: { title: 'English Title', overview: 'English.' } },
];

describe('details language', () => {
  it('takes the chosen region first, then the same language elsewhere', () => {
    expect(translatedField(translations, 'es-ES', 'title')).toBe('Título de España');
    // Spain's is empty: Mexico's Spanish before English.
    expect(translatedField(translations, 'es-ES', 'overview')).toBe('Descripción de México.');
    expect(translatedField(translations, 'es-MX', 'title')).toBe('Título de México');
    expect(translatedField(translations, 'pl-PL', 'title')).toBeNull();
    expect(translatedField(undefined, 'pl-PL', 'title')).toBeNull();
  });

  it('falls back to English field by field', () => {
    const english = { title: 'English Title', overview: 'English.' };
    const only = [{ iso_639_1: 'pl', iso_3166_1: 'PL', data: { title: 'Polski', overview: '  ' } }];
    expect(localiseDetail(english, only, 'pl-PL', 'movie')).toEqual({
      title: 'Polski',
      overview: 'English.',
    });
    // A show's title is its `name`.
    const show = [{ iso_639_1: 'pl', data: { name: 'Serial', overview: 'Opis.' } }];
    expect(localiseDetail(english, show, 'pl-PL', 'series')).toEqual({ title: 'Serial', overview: 'Opis.' });
    expect(localiseDetail(english, show, 'en', 'series')).toEqual(english);
  });

  /** A film made in the chosen language often has no translation into it. */
  it('uses the original title for a film in the chosen language', () => {
    const english = {
      title: 'English Title',
      overview: 'English.',
      originalTitle: 'Tytuł oryginalny',
      originalLanguage: 'pl',
    };
    expect(localiseDetail(english, [], 'pl-PL', 'movie').title).toBe('Tytuł oryginalny');
    expect(localiseDetail(english, [], 'de-DE', 'movie').title).toBe('English Title');
  });

  it('asks for pictures in the chosen language, then English, then none', () => {
    expect(imageLanguages('en')).toBe('en,null');
    expect(imageLanguages('pl-PL')).toBe('pl,en,null');
    expect(imageLanguages('pt-BR')).toBe('pt,en,null');
  });

  it('picks the best poster lettered in the chosen language, never re-picks English', () => {
    const posters = [
      { file_path: '/a.jpg', iso_639_1: 'pl', vote_average: 2 },
      { file_path: '/b.jpg', iso_639_1: 'pl', vote_average: 5 },
      { file_path: '/c.jpg', iso_639_1: 'en', vote_average: 9 },
    ];
    expect(posterInLanguage(posters, 'pl-PL')).toBe('/b.jpg');
    expect(posterInLanguage(posters, 'de-DE')).toBeNull();
    expect(posterInLanguage(posters, 'en')).toBeNull();
  });

  it("knows TMDB's made-up episode names", () => {
    expect(isPlaceholderName('Episode 4', 4)).toBe(true);
    expect(isPlaceholderName('Odcinek 4', 4)).toBe(true);
    expect(isPlaceholderName('Épisode 12', 12)).toBe(true);
    expect(isPlaceholderName('Odcinek 4', 5)).toBe(false);
    expect(isPlaceholderName('Catch-22', 22)).toBe(false);
    expect(isPlaceholderName('The Return', 2)).toBe(false);
  });

  it('lays a translated episode over the English, field by field', () => {
    const english = [
      { season: 1, episode: 1, name: 'Pilot', overview: 'Start.', air_date: null, runtime_mins: 25, still_url: null },
      { season: 1, episode: 2, name: 'Episode 2', overview: null, air_date: null, runtime_mins: 25, still_url: null },
      { season: 1, episode: 3, name: 'Three', overview: 'Third.', air_date: null, runtime_mins: 25, still_url: null },
    ];
    const local = new Map([
      ['1x1', { name: 'Odcinek 1', overview: 'Początek.' }],
      ['1x2', { name: 'Odcinek 2', overview: null }],
    ]);
    expect(mergeEpisodes(english, local).map((e) => [e.name, e.overview])).toEqual([
      // A made-up name keeps the English one; the description is real.
      ['Pilot', 'Początek.'],
      // Both made up: the chosen language's at least reads in it.
      ['Odcinek 2', null],
      // Not in the translated answer at all.
      ['Three', 'Third.'],
    ]);
  });

  it("puts the system's language first when it is offered", () => {
    expect(languageForSystem('pl-PL')?.code).toBe('pl-PL');
    expect(languageForSystem('pl')?.code).toBe('pl-PL');
    expect(languageForSystem('es-MX')?.code).toBe('es-MX');
    expect(languageForSystem('es-AR')?.code).toBe('es-ES');
    expect(languageForSystem('nb-NO')?.code).toBe('no-NO');
    expect(languageForSystem('en-GB')).toBeNull();
    expect(languageForSystem('xx')).toBeNull();
  });

  it('offers each language once, English first', () => {
    const codes = DETAILS_LANGUAGES.map((l) => l.code);
    expect(codes[0]).toBe('en');
    expect(new Set(codes).size).toBe(codes.length);
  });
});
