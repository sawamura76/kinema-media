/**
 * The language film and series details are fetched in from TMDB — titles,
 * descriptions and episode names (GitHub #18, #19). English by default, as
 * before; the interface itself stays English.
 *
 * Only the details fetched after a match follow it. Searching, and so
 * matching, is always in English: a wrong match is worse than none, and the
 * scorer's rules were tuned on English answers.
 *
 * TMDB does not fall back by itself: a Polish request for a film with no
 * Polish description answers with an empty one. So the details are fetched in
 * English as always, with TMDB's translations alongside, and each field is
 * taken from the chosen language where it has one and from English where it
 * has not (`localiseDetail`, `mergeEpisodes`).
 */
import { getSetting, setSetting } from './api';
import type { EpisodeMetadata } from './providers';

export const DETAILS_LANGUAGE_KEY = 'details_language';

/** The default, and what every title fetched before this setting was in. */
export const ENGLISH = 'en';

export interface DetailsLanguage {
  /** What TMDB is asked with: a language and, where it matters, a region. */
  code: string;
  label: string;
}

/**
 * The languages offered. TMDB's own list, cut to the ones with a real share
 * of translated titles; a region only where TMDB keeps two apart (Spain and
 * Latin America, Portugal and Brazil, France and Canada, the two Chinese
 * scripts). Names in English, like the rest of the interface.
 */
export const DETAILS_LANGUAGES: DetailsLanguage[] = [
  { code: ENGLISH, label: 'English' },
  { code: 'ar-SA', label: 'Arabic' },
  { code: 'bg-BG', label: 'Bulgarian' },
  { code: 'zh-CN', label: 'Chinese (Simplified)' },
  { code: 'zh-TW', label: 'Chinese (Traditional)' },
  { code: 'hr-HR', label: 'Croatian' },
  { code: 'cs-CZ', label: 'Czech' },
  { code: 'da-DK', label: 'Danish' },
  { code: 'nl-NL', label: 'Dutch' },
  { code: 'fi-FI', label: 'Finnish' },
  { code: 'fr-FR', label: 'French' },
  { code: 'fr-CA', label: 'French (Canada)' },
  { code: 'de-DE', label: 'German' },
  { code: 'el-GR', label: 'Greek' },
  { code: 'he-IL', label: 'Hebrew' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'hu-HU', label: 'Hungarian' },
  { code: 'id-ID', label: 'Indonesian' },
  { code: 'it-IT', label: 'Italian' },
  { code: 'ja-JP', label: 'Japanese' },
  { code: 'ko-KR', label: 'Korean' },
  { code: 'no-NO', label: 'Norwegian' },
  { code: 'pl-PL', label: 'Polish' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)' },
  { code: 'pt-PT', label: 'Portuguese (Portugal)' },
  { code: 'ro-RO', label: 'Romanian' },
  { code: 'ru-RU', label: 'Russian' },
  { code: 'sr-RS', label: 'Serbian' },
  { code: 'sk-SK', label: 'Slovak' },
  { code: 'es-ES', label: 'Spanish (Spain)' },
  { code: 'es-MX', label: 'Spanish (Latin America)' },
  { code: 'sv-SE', label: 'Swedish' },
  { code: 'th-TH', label: 'Thai' },
  { code: 'tr-TR', label: 'Turkish' },
  { code: 'uk-UA', label: 'Ukrainian' },
  { code: 'vi-VN', label: 'Vietnamese' },
];

/** The offered language with this code, or null for anything else. */
export function knownLanguage(code: string | null | undefined): DetailsLanguage | null {
  return DETAILS_LANGUAGES.find((l) => l.code === code) ?? null;
}

export function isEnglish(code: string): boolean {
  return code === ENGLISH;
}

/** `pl-PL` → `pl` and `PL`; `en` → `en` and null. */
export function splitLanguage(code: string): { lang: string; region: string | null } {
  const [lang, region] = code.split('-');
  return { lang: lang.toLowerCase(), region: region ? region.toUpperCase() : null };
}

/**
 * The offered language closest to the system's (`navigator.language`), for
 * putting it first among the choices; null when it is English or not offered.
 * Norwegian Bokmål and Nynorsk are TMDB's one `no`.
 */
export function languageForSystem(system: string | null | undefined): DetailsLanguage | null {
  if (!system) return null;
  const { lang: raw, region } = splitLanguage(system);
  const lang = raw === 'nb' || raw === 'nn' ? 'no' : raw;
  if (lang === 'en') return null;
  const same = DETAILS_LANGUAGES.filter((l) => splitLanguage(l.code).lang === lang);
  return same.find((l) => splitLanguage(l.code).region === region) ?? same[0] ?? null;
}

let current: Promise<string> | null = null;

/** The chosen language, English when none is chosen or the setting cannot be read. */
export function detailsLanguage(): Promise<string> {
  current ??= getSetting(DETAILS_LANGUAGE_KEY)
    .then((v) => knownLanguage(v)?.code ?? ENGLISH)
    .catch(() => ENGLISH);
  return current;
}

export async function saveDetailsLanguage(code: string): Promise<void> {
  const chosen = knownLanguage(code)?.code ?? ENGLISH;
  await setSetting(DETAILS_LANGUAGE_KEY, chosen);
  current = Promise.resolve(chosen);
}

// ---------------------------------------------------------------------------
// TMDB's answers, merged with English underneath
// ---------------------------------------------------------------------------

/**
 * `include_image_language`: the chosen language first, then English, then
 * pictures with no lettering. English alone is what was asked before.
 */
export function imageLanguages(code: string): string {
  const { lang } = splitLanguage(code);
  return lang === 'en' ? 'en,null' : `${lang},en,null`;
}

/** One entry of TMDB's `translations` list. */
export interface TmdbTranslation {
  iso_639_1?: string;
  iso_3166_1?: string;
  data?: { title?: string; name?: string; overview?: string; tagline?: string };
}

/**
 * One field in the chosen language, or null when TMDB has none. The chosen
 * region first, then the same language from another region — a Mexican
 * Spanish description is a better answer for a reader in Spain than English.
 */
export function translatedField(
  translations: TmdbTranslation[] | undefined,
  code: string,
  field: 'title' | 'name' | 'overview' | 'tagline'
): string | null {
  const { lang, region } = splitLanguage(code);
  const same = (translations ?? []).filter((t) => t.iso_639_1?.toLowerCase() === lang);
  const ordered = [
    ...same.filter((t) => t.iso_3166_1?.toUpperCase() === region),
    ...same.filter((t) => t.iso_3166_1?.toUpperCase() !== region),
  ];
  for (const t of ordered) {
    const value = t.data?.[field]?.trim();
    if (value) return value;
  }
  return null;
}

/** What a detail answer holds that is worded in a language. */
export interface DetailText {
  /** TMDB's title as fetched without a language: the English one, or the original. */
  title: string;
  overview: string | null;
  originalTitle?: string | null;
  originalLanguage?: string | null;
}

/**
 * The title and description in the chosen language, each falling back to
 * English on its own. A film made in the chosen language often has no
 * translation into it — its own title is the original one.
 */
export function localiseDetail(
  english: DetailText,
  translations: TmdbTranslation[] | undefined,
  code: string,
  kind: 'movie' | 'series'
): { title: string; overview: string | null } {
  if (isEnglish(code)) return { title: english.title, overview: english.overview };
  const { lang } = splitLanguage(code);
  const titleField = kind === 'movie' ? 'title' : 'name';
  const original =
    english.originalLanguage?.toLowerCase() === lang ? english.originalTitle?.trim() || null : null;
  return {
    title: translatedField(translations, code, titleField) ?? original ?? english.title,
    overview: translatedField(translations, code, 'overview') ?? english.overview,
  };
}

/** One of TMDB's posters, as `images.posters` lists them. */
export interface TmdbPosterImage {
  file_path: string;
  iso_639_1?: string | null;
  vote_average?: number;
}

/**
 * The best-rated poster lettered in the chosen language, or null — then the
 * poster TMDB gives for English stands, as before. English itself is never
 * re-picked: what was shown stays shown.
 */
export function posterInLanguage(
  posters: TmdbPosterImage[] | undefined,
  code: string
): string | null {
  if (isEnglish(code)) return null;
  const { lang } = splitLanguage(code);
  const best = [...(posters ?? [])]
    .filter((p) => p.iso_639_1?.toLowerCase() === lang)
    .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))[0];
  return best?.file_path ?? null;
}

/**
 * An episode name TMDB made up because it has none: `Episode 4`, `Odcinek 4`,
 * `Episodio 4` — a word and the episode's own number. TMDB answers that in
 * place of a missing translation; the English name, when there is a real
 * one, is the better answer.
 */
export function isPlaceholderName(name: string, episode: number): boolean {
  const m = /^\p{L}+\s+(\d+)$/u.exec(name.trim());
  return m !== null && Number(m[1]) === episode;
}

/** An episode's name and description as one language's request gave them. */
export interface EpisodeText {
  name: string | null;
  overview: string | null;
}

export const episodeKey = (season: number, episode: number) => `${season}x${episode}`;

/**
 * English episodes with the chosen language laid over them, field by field:
 * a name or description the chosen language has replaces the English one; an
 * empty one, or a made-up `Odcinek 4`, leaves the English.
 */
export function mergeEpisodes(
  english: EpisodeMetadata[],
  local: Map<string, EpisodeText>
): EpisodeMetadata[] {
  return english.map((e) => {
    const l = local.get(episodeKey(e.season, e.episode));
    if (!l) return e;
    const name = l.name?.trim() || null;
    const keepEnglishName =
      !name || (isPlaceholderName(name, e.episode) && !!e.name && !isPlaceholderName(e.name, e.episode));
    return {
      ...e,
      name: keepEnglishName ? e.name : name,
      overview: l.overview?.trim() || e.overview,
    };
  });
}
