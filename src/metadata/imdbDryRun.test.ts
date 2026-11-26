/**
 * The offline dry run, second half: the candidates `dry_run_candidates`
 * (imdb_titles.rs) found for every title of a library matched online, decided
 * by the app's own rules (`chooseImdb`), against the IMDb id the online match
 * holds. Prints matched right / wrong / Needs attention, and every wrong one.
 *
 * Runs only with `DRYRUN_JSON` set (a file of private names, never in the
 * repository): `DRYRUN_JSON=… npx vitest run src/metadata/imdbDryRun.test.ts`.
 * scripts/proof/offline-match-dryrun.sh runs both halves.
 */
import { describe, expect, it } from 'vitest';
import { chooseImdb, toCandidate, type ImdbTitle } from './imdbOffline';

interface Entry {
  series: boolean;
  expected: string;
  name: string;
  year: number | null;
  names: string[];
  minutes: number | null;
  candidates: ImdbTitle[];
}

// The app's tsconfig has no Node types: the two Node things this needs, by hand.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process.env;
const file = env.DRYRUN_JSON;
const nodeFs = 'node:fs';
type Fs = {
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, text: string): void;
};

describe.skipIf(!file)('offline dry run', () => {
  it('matches a library without a wrong match', async () => {
    const { readFileSync, writeFileSync } = (await import(/* @vite-ignore */ nodeFs)) as Fs;
    const entries = JSON.parse(readFileSync(file as string, 'utf8')) as Entry[];
    const right: string[] = [];
    const wrong: string[] = [];
    const attention: string[] = [];
    for (const e of entries) {
      const { best, matched } = chooseImdb(
        e.candidates.map(toCandidate),
        {
          parsedTitle: e.names[0],
          parsedYear: e.year,
          otherParsedTitles: e.names.length > 1 ? e.names.slice(1) : undefined,
        },
        e.minutes
      );
      const line = `${e.series ? 'show' : 'film'} "${e.name}" ${e.year ?? '-'} → ${
        best ? `${best.title} ${best.year ?? '-'} ${best.providerId}` : 'none'
      } (want ${e.expected}; ${e.candidates.length} candidates) ${best?.reason ?? ''}`;
      if (!matched) attention.push(line);
      else if (best?.providerId === e.expected) right.push(line);
      else wrong.push(line);
    }
    const report = [
      `groups ${entries.length}: right ${right.length}, wrong ${wrong.length}, Needs attention ${attention.length}`,
      '',
      'WRONG',
      ...wrong,
      '',
      'NEEDS ATTENTION',
      ...attention,
    ].join('\n');
    if (env.DRYRUN_REPORT) writeFileSync(env.DRYRUN_REPORT, report);
    console.log(report.split('\n')[0]);
    expect(wrong).toEqual([]);
  });
});
