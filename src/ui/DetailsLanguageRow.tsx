/**
 * Settings → the language film and show details come in from TMDB (GitHub
 * #18, #19; detailsLanguage.ts). Menus stay English.
 *
 * English, the system's own language and the one chosen are on the row; the
 * rest of TMDB's languages one press away under "More languages", so the row
 * stays short on a television and every language is reachable by remote.
 *
 * A change starts a scan, which fetches every title in another language again
 * in the background (owner, 2026-11-20: the whole library, not each title as
 * it is opened).
 */
import { useEffect, useState } from 'react';
import {
  DETAILS_LANGUAGES,
  detailsLanguage,
  ENGLISH,
  knownLanguage,
  languageForSystem,
  saveDetailsLanguage,
  type DetailsLanguage,
} from '../metadata/detailsLanguage';
import { scanAfterThis } from '../library/pipeline';
import ChoiceRow, { type Choice } from './ChoiceRow';
import { userError } from './errors';

const MORE = 'more';

export default function DetailsLanguageRow({ onError }: { onError: (message: string) => void }) {
  const [value, setValue] = useState(ENGLISH);
  const [more, setMore] = useState(false);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    let live = true;
    void detailsLanguage().then((code) => {
      if (live) setValue(code);
    });
    return () => {
      live = false;
    };
  }, []);

  const choose = (code: string) => {
    if (code === value) return;
    setValue(code);
    setChanged(true);
    void saveDetailsLanguage(code)
      .then(() => scanAfterThis())
      .then((outcome) => {
        if (outcome.status === 'failed') onError(outcome.error);
      })
      .catch((e) => onError(userError(e)));
  };

  const system = languageForSystem(typeof navigator === 'undefined' ? null : navigator.language);
  const shown: DetailsLanguage[] = [knownLanguage(ENGLISH) as DetailsLanguage];
  for (const l of [system, knownLanguage(value)]) {
    if (l && !shown.some((s) => s.code === l.code)) shown.push(l);
  }
  const choices: Choice<string>[] = [
    ...shown.map((l) => ({ value: l.code, label: l.label })),
    { value: MORE, label: more ? 'Fewer languages' : 'More languages' },
  ];

  return (
    <>
      <ChoiceRow
        label="Film and show details"
        choices={choices}
        value={value}
        onChange={(v) => (v === MORE ? setMore((m) => !m) : choose(v))}
        note="The language of titles, descriptions and episode names, as TMDB has them. Where TMDB has no translation, the English is shown. Menus stay in English."
        hint={
          changed
            ? 'Titles already in your library are fetched again in this language, in the background. Search still finds them by their English names.'
            : 'Changing it fetches the titles already in your library again, in the background. Search still finds them by their English names.'
        }
      />
      {more && (
        <ChoiceRow
          label="All languages"
          choices={DETAILS_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
          value={value}
          onChange={choose}
        />
      )}
    </>
  );
}
