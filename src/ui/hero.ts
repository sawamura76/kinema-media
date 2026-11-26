/**
 * Which title fills the top of Home.
 *
 * It was always the newest addition, so the same picture sat there for weeks
 * and the same show then appeared again right below it in Continue watching.
 * Now:
 *
 *  - Something added in the last few days and not yet watched still gets the
 *    spotlight — that is what new arrivals are for.
 *  - Otherwise a different title each day, from what you have not finished,
 *    never the one already first in Continue watching.
 *  - Only titles with a backdrop, while any have one: the hero is a picture.
 *
 * "Each day" is by the calendar, not by launch, so reopening the app does not
 * reshuffle it. Pure, with the clock passed in, so it is testable.
 *
 * One exception, for screenshots: a film named in `home-top.txt` in the data
 * folder (`home_top.rs`) is shown instead, watched or not. A name that matches
 * nothing changes nothing.
 */
import { invoke } from '@tauri-apps/api/core';
import type { Title } from './api';

let asked: Promise<string | null> | null = null;

/** The name in `home-top.txt`, read once per launch; null when there is none. */
export function chosenHero(): Promise<string | null> {
  asked ??= invoke<string | null>('home_top').catch(() => null);
  return asked;
}

/** Letters and digits only, lower case: "Dune: Part Two" is "dune part two". */
const plain = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** The title a name in `home-top.txt` means: "Title" or "Title (Year)". */
export function findChosen(titles: Title[], name: string): Title | null {
  const m = /^(.*?)\s*\((\d{4})\)\s*$/.exec(name);
  const want = plain(m ? m[1] : name);
  const year = m ? Number(m[2]) : null;
  if (!want) return null;
  const same = titles.filter((t) => plain(t.title) === want && (year === null || t.year === year));
  return same.find((t) => t.backdrop_url || t.backdrop_path) ?? same[0] ?? null;
}

const NEW_FOR_DAYS = 3;
const DAY_MS = 86_400_000;

/** Days since the epoch in local time, so the pick changes at midnight here. */
function localDay(now: number): number {
  const d = new Date(now);
  return Math.floor((now - d.getTimezoneOffset() * 60_000) / DAY_MS);
}

export function pickHero(
  titles: Title[],
  continueFirst: number | null,
  now: number,
  chosen: string | null = null
): Title | null {
  const named = chosen ? findChosen(titles, chosen) : null;
  if (named) return named;

  const withBackdrop = titles.filter((t) => t.backdrop_url || t.backdrop_path);
  const pictures = withBackdrop.length > 0 ? withBackdrop : titles;
  if (pictures.length === 0) return null;

  const candidates = pictures.filter((t) => !t.watched && t.id !== continueFirst);
  const pool = candidates.length > 0 ? candidates : pictures;

  // added_at is in seconds.
  const since = now / 1000 - NEW_FOR_DAYS * 86_400;
  const fresh = pool
    .filter((t) => (t.added_at ?? 0) >= since)
    .sort((a, b) => (b.added_at ?? 0) - (a.added_at ?? 0));
  if (fresh.length > 0) return fresh[0];

  const stable = [...pool].sort((a, b) => a.id - b.id);
  return stable[localDay(now) % stable.length];
}
