/**
 * The age rating the page shows: the one TMDB holds for the system's own
 * country (`titles.certifications`, tab-separated `DK=15`), and nothing when
 * it has none for it — never another country's, never a guess.
 *
 * The country is what the system itself says (`system_region`, region.rs:
 * Windows' region setting, Linux's locale territory). Where it names none —
 * and on Android, which has no such command — the region of the webview's
 * *first* language is used (`da-DK` → `DK`; Android always gives one). A first
 * language with no region (`en`, `nb`) names no country, so it shows nothing:
 * a later language's country is not "here" (a Norwegian system listing
 * `en-GB` second is not British).
 */
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

/** The regions the system's languages name, first choice first. */
export function systemRegions(languages: readonly string[]): string[] {
  const regions: string[] = [];
  for (const code of languages) {
    const region = /^[A-Za-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(code)?.[1]?.toUpperCase();
    if (region && !regions.includes(region)) regions.push(region);
  }
  return regions;
}

/** The country the rating is for: the system's own answer, else the first language's. */
export function chooseCountry(
  osRegion: string | null | undefined,
  languages: readonly string[]
): string | null {
  const os = osRegion?.trim().toUpperCase();
  if (os && /^[A-Z]{2}$/.test(os)) return os;
  return systemRegions(languages.slice(0, 1))[0] ?? null;
}

/** The rating for a country TMDB has one for, or null. */
export function localRating(
  certifications: string | null | undefined,
  country: string | null
): string | null {
  if (!certifications || !country) return null;
  for (const part of certifications.split('\t')) {
    const [c, rating] = part.split('=');
    if (c === country && rating) return rating;
  }
  return null;
}

/** The running system's languages, as the webview reports them. */
export function systemLanguages(): string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? [...navigator.languages] : [navigator.language];
}

let asked: Promise<string | null> | null = null;

/** Asked once per run: the system's country. */
function systemCountry(): Promise<string | null> {
  asked ??= invoke<string | null>('system_region')
    .catch(() => null)
    .then((region) => chooseCountry(region, systemLanguages()));
  return asked;
}

/** The country the age rating follows; null until the system has answered, and after it if none. */
export function useSystemCountry(): string | null {
  const [country, setCountry] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void systemCountry().then((c) => {
      if (live) setCountry(c);
    });
    return () => {
      live = false;
    };
  }, []);
  return country;
}
