/**
 * Matching on this computer, against IMDb's list of titles (imdb_titles.rs).
 *
 * "Keep everything on this computer" (PRIVATE-MODE.md §2): no name is sent
 * anywhere. The list's titles that a name may be are scored by the same
 * scorer and the same rules as online (0.75, a 0.05 margin, Needs attention
 * when unsure), with two rules of its own, both the owner's choices:
 *
 * - **A name that only partly matches needs the exact year (2a).** IMDb's
 *   list has one name and an original name per title, not TMDB's other
 *   names, so a "Part 2" or an "Episode VIII …" a year off could win where
 *   TMDB would have known the plain name. The design's dry run: 2 wrong → 0.
 * - **Ties by votes, then by running time.** Votes are what TMDB's popularity
 *   and votes were (IMDb's vote count stands for both); two titles still tied
 *   are told apart by the file's own length against IMDb's runtime, when the
 *   file has been read and exactly one is close.
 */
import { invoke } from '@tauri-apps/api/core';
import type { TitleMetadata } from './providers';
import {
  MATCH_MARGIN,
  MATCH_THRESHOLD,
  normaliseTitle,
  pickBest,
  type Candidate,
  type ScoreContext,
  type ScoredCandidate,
} from './score';

/** One title of IMDb's list, as `imdb_titles_search` returns it. */
export interface ImdbTitle {
  imdbId: string;
  series: boolean;
  title: string;
  originalTitle: string | null;
  year: number | null;
  endYear: number | null;
  runtimeMins: number | null;
  genres: string[];
  votes: number;
  rating: number;
}

/** A candidate with IMDb's runtime beside it, for the tie-break. */
export interface ImdbCandidate extends Candidate {
  runtimeMins?: number | null;
}

export function toCandidate(t: ImdbTitle): ImdbCandidate {
  return {
    providerId: t.imdbId,
    title: t.title,
    originalTitle: t.originalTitle,
    year: t.year,
    // IMDb's vote count is both signals TMDB gives: how many voted, and how
    // much the entry is the one people mean.
    voteCount: t.votes,
    popularity: t.votes,
    runtimeMins: t.runtimeMins,
  };
}

/** The list's titles a name may be. Throws when the list is not there yet. */
export async function imdbSearch(
  names: string[],
  isSeries: boolean,
): Promise<ImdbCandidate[]> {
  const found = await invoke<ImdbTitle[]>('imdb_titles_search', {
    names,
    series: isSeries,
  });
  return found.map(toCandidate);
}

/** One title by its IMDb id, or null when the list does not have it. */
export const imdbGet = (imdbId: string) =>
  invoke<ImdbTitle | null>('imdb_titles_get', { imdbId });

/** The running time of the first of these files that has been read, in minutes. */
export const fileMinutes = (fileIds: number[]) =>
  invoke<number | null>('imdb_file_minutes', { fileIds });

/** What a title from the list stores: names, year, genres, runtime, IMDb's score. */
export function imdbMetadata(t: ImdbTitle): TitleMetadata {
  return {
    kind: t.series ? 'series' : 'movie',
    provider: 'imdb',
    provider_id: t.imdbId,
    imdb_id: t.imdbId,
    tmdb_id: null,
    title: t.title,
    year: t.year,
    overview: null,
    genres: t.genres.length ? JSON.stringify(t.genres) : null,
    runtime_mins: t.runtimeMins,
    rating: t.rating,
    poster_url: null,
    backdrop_url: null,
    logo_url: null,
    trailer_key: null,
    trailer_site: null,
    cast: [],
  };
}

/** Names the scorer takes as the same name, not a part of one. */
function sameName(parsed: string, c: Candidate): boolean {
  const p = normaliseTitle(parsed);
  return (
    p === normaliseTitle(c.title) ||
    (!!c.originalTitle && p === normaliseTitle(c.originalTitle))
  );
}

/** Within a few minutes: a cut's credits, PAL speed-up (4 %). */
function closeRuntime(file: number, imdb: number): boolean {
  return Math.abs(file - imdb) <= Math.max(4, imdb * 0.05);
}

/** Clearly another film: a quarter of an hour or more apart. */
function farRuntime(file: number, imdb: number): boolean {
  return Math.abs(file - imdb) >= Math.max(12, imdb * 0.15);
}

/** Votes that make another title the one people mean: ten times, and many. */
const KNOWN_RATIO = 10;
const KNOWN_VOTES = 1000;

function words(name: string): string[] {
  return normaliseTitle(name).split(' ').filter(Boolean);
}

/** `c` has every word of one of the names, the year (±1), and far more votes. */
function outweighs(c: Candidate, chosen: Candidate, names: string[], year: number | null): boolean {
  const votes = c.voteCount ?? 0;
  if (votes < KNOWN_VOTES || votes < (chosen.voteCount ?? 0) * KNOWN_RATIO) return false;
  if (!year || c.year === null || Math.abs(c.year - year) > 1) return false;
  const theirs = new Set([...words(c.title), ...(c.originalTitle ? words(c.originalTitle) : [])]);
  return names.some((n) => {
    const mine = words(n);
    return mine.length > 0 && mine.every((w) => theirs.has(w));
  });
}

export interface ImdbChoice {
  best: ScoredCandidate | null;
  matched: boolean;
}

/**
 * The scorer's answer, with the offline rules on top. Pure, so the dry run
 * (`imdbDryRun.test.ts`) decides exactly what the app decides.
 */
export function chooseImdb(
  candidates: ImdbCandidate[],
  ctx: ScoreContext,
  minutes: number | null,
): ImdbChoice {
  const { best, matched, all } = pickBest(candidates, ctx);
  if (!best) return { best: null, matched: false };

  let chosen: ScoredCandidate = best;
  let ok = matched;

  // Still tied after votes: the file's length, when exactly one is close and
  // every other tied one is clearly another length.
  if (
    !ok &&
    minutes &&
    best.confidence >= MATCH_THRESHOLD &&
    /ambiguous/.test(best.reason)
  ) {
    const top = all[0];
    const tied = all.filter((c) => top.score - c.score < MATCH_MARGIN) as Array<
      ScoredCandidate & ImdbCandidate
    >;
    const close = tied.filter(
      (c) => c.runtimeMins && closeRuntime(minutes, c.runtimeMins),
    );
    const others = tied.filter((c) => !close.includes(c));
    if (
      close.length === 1 &&
      others.every(
        (c) => c.runtimeMins && farRuntime(minutes, c.runtimeMins),
      ) &&
      close[0].confidence >= MATCH_THRESHOLD
    ) {
      chosen = {
        ...close[0],
        reason: `${close[0].reason}; tie broken by running time (${Math.round(minutes)} min)`,
      };
      ok = true;
    }
  }

  // 2a: a name only partly the same needs the exact year.
  if (ok) {
    const names = [ctx.parsedTitle, ...(ctx.otherParsedTitles ?? [])];
    const whole = names.some((n) => sameName(n, chosen));
    if (!whole && !(ctx.parsedYear && chosen.year === ctx.parsedYear)) {
      return {
        best: {
          ...chosen,
          reason: `${chosen.reason}; only part of the name, year not exact`,
        },
        matched: false,
      };
    }
    // IMDb names some famous films longer than people do ("… or (The
    // Unexpected Virtue …)", "Episode VIII - …"), and a little-known entry
    // called just the name then wins. A title of the year with every word
    // of the name and ten times the votes says the winner is doubtful.
    const known = all.find(
      (c) => c.providerId !== chosen.providerId && outweighs(c, chosen, names, ctx.parsedYear)
    );
    if (known) {
      return {
        best: { ...chosen, reason: `${chosen.reason}; "${known.title}" of that year is far better known` },
        matched: false,
      };
    }
  }
  return { best: chosen, matched: ok };
}

/** Status of the list on this computer (imdb_titles.rs). */
export interface ImdbTitlesStatus {
  allowed: boolean;
  present: boolean;
  rows: number;
  builtAt: number | null;
  bytes: number;
  progress: {
    phase: 'ratings' | 'titles';
    done: number;
    total: number | null;
  } | null;
}

export const imdbTitlesStatus = () =>
  invoke<ImdbTitlesStatus>('imdb_titles_status');

/** Download and build the list when allowed and over a month old; `force` skips the month only. */
export const refreshImdbTitles = (force = false) =>
  invoke<{ built: boolean; rows: number; skipped: string | null }>(
    'refresh_imdb_titles',
    { force },
  );

/** The library setting P2b's switch writes: "1" = Keep everything on this computer. */
export const OFFLINE_KEY = 'keep_on_device';
/** The library setting allowing the list's download (imdb_titles.rs ALLOWED_KEY). */
export const IMDB_TITLES_ALLOWED_KEY = 'imdb_titles_allowed';
