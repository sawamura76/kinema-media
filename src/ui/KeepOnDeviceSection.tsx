/**
 * Settings → Privacy: "Keep everything on this computer" (PRIVATE-MODE.md §2;
 * the owner chose every recommended option, 2026-11-21; Discussion #9).
 *
 * The switch, the note (wording a), and while it is on: IMDb's two files, each
 * with its own switch (both off = fully offline, names from files only), and
 * "Remove pictures and details fetched online", a separate press that asks
 * first. On: SIMKL and Trakt must be disconnected first (the mode would stop
 * them, and they would think nothing more was watched). Off: the list goes,
 * and every title matched on this computer moves to TMDB by its IMDb number
 * in one background run (choice 4a), said here while it runs.
 */
import { useCallback, useEffect, useState } from 'react';
import ChoiceRow from './ChoiceRow';
import ConfirmButton from './ConfirmButton';
import FocusButton from './FocusButton';
import FocusGroup from './FocusGroup';
import { userError } from './errors';
import { count, formatBytes } from './format';
import { accountApi } from '../metadata/tracking';
import { imdbTitlesStatus, refreshImdbTitles, type ImdbTitlesStatus } from '../metadata/imdbOffline';
import { upgradeFallbackTitles } from '../metadata/match';
import { cacheArtwork } from '../metadata/api';
import {
  keepOnDevice,
  leaveDevice,
  removeFetchedOnline,
  setImdbFile,
  useOfflineState,
} from '../net/offline';

export const KEEP_ON_DEVICE_TITLE = 'Keep everything on this computer';
export const KEEP_ON_DEVICE_NOTE =
  'Nothing about your library leaves this device. Every service below is off. Two files are still downloaded, each with its own switch: IMDb’s list of titles and IMDb’s ratings.';

/** The way back online, kept while Settings closes: one run for the whole library. */
let backOnline: string | null = null;
const backListeners = new Set<(s: string | null) => void>();
function sayBack(text: string | null) {
  backOnline = text;
  backListeners.forEach((l) => l(text));
}

/** Every title matched on this computer to TMDB by its IMDb number, then its pictures. */
export async function goBackOnline(): Promise<void> {
  sayBack('Moving titles matched on this computer to TMDB by their IMDb number…');
  try {
    const moved = await upgradeFallbackTitles({ all: true });
    await cacheArtwork().catch(() => undefined);
    const done = moved.films + moved.shows;
    sayBack(
      `${done === 0 ? 'No title needed moving' : `${count(done, 'title')} moved to TMDB`}` +
        (moved.left > 0
          ? `; ${count(moved.left, 'title')} TMDB had no sure answer for stay as they are and are asked again in a month.`
          : '.') +
        (moved.errors.length > 0 ? ` Not every lookup worked: ${moved.errors[0]}` : '')
    );
  } catch (e) {
    sayBack(`Moving to TMDB stopped: ${userError(e)} The next scan carries on.`);
  }
}

function useBackOnline(): string | null {
  const [text, setText] = useState(backOnline);
  useEffect(() => {
    backListeners.add(setText);
    return () => {
      backListeners.delete(setText);
    };
  }, []);
  return text;
}

function listWords(s: ImdbTitlesStatus | null): string {
  if (!s) return '';
  if (s.progress) {
    const what = s.progress.phase === 'ratings' ? 'IMDb’s ratings' : 'IMDb’s list of titles';
    const share = s.progress.total ? ` ${Math.floor((100 * s.progress.done) / s.progress.total)} %` : '';
    return `Downloading ${what}…${share}`;
  }
  if (!s.present) return 'Not downloaded yet: it is downloaded at the next scan, about 230 MB, and 76 MB is kept.';
  const when = s.builtAt ? new Date(s.builtAt * 1000).toLocaleDateString() : null;
  return `${s.rows.toLocaleString()} titles, ${formatBytes(s.bytes)} on this device${when ? `, from ${when}` : ''}. Downloaded again once a month.`;
}

export default function KeepOnDeviceSection({ onGo }: { onGo: (section: string) => void }) {
  const state = useOfflineState();
  const back = useBackOnline();
  const [list, setList] = useState<ImdbTitlesStatus | null>(null);
  const [message, setMessage] = useState<{ text: string; bad: boolean; go?: boolean } | null>(null);
  const on = state?.offline ?? false;

  const readList = useCallback(() => {
    void imdbTitlesStatus()
      .then(setList)
      .catch(() => setList(null));
  }, []);

  // While a download runs, its progress, every second or so.
  const building = list?.progress != null;
  useEffect(() => {
    if (!on) return;
    readList();
    if (!building) return;
    const timer = setInterval(readList, 1500);
    return () => clearInterval(timer);
  }, [on, building, readList]);

  async function switchOn() {
    setMessage(null);
    const [simkl, trakt] = await Promise.all(
      (['simkl', 'trakt'] as const).map((s) =>
        accountApi(s)
          .status()
          .then((st) => st.connected)
          .catch(() => false)
      )
    );
    if (simkl || trakt) {
      const names = simkl && trakt ? 'SIMKL and Trakt' : simkl ? 'SIMKL' : 'Trakt';
      setMessage({
        text: `Disconnect ${names} first, in Keep track of what I watch: with this on, Skrin could not tell ${simkl && trakt ? 'them' : 'it'} what you watch.`,
        bad: true,
        go: true,
      });
      return;
    }
    try {
      await keepOnDevice();
      setMessage({ text: 'On. Skrin looks nothing up online from now on. IMDb’s list of titles is downloaded now.', bad: false });
      // Start the list now rather than at the next scan; progress is shown below.
      void refreshImdbTitles().catch(() => undefined);
      setTimeout(readList, 500);
    } catch (e) {
      setMessage({ text: userError(e), bad: true });
    }
  }

  async function switchOff() {
    setMessage(null);
    try {
      const freed = await leaveDevice();
      setMessage({
        text: `Off. Lookups are back on.${freed > 0 ? ` IMDb’s list of titles was removed (${formatBytes(freed)}).` : ''}`,
        bad: false,
      });
      void goBackOnline();
    } catch (e) {
      setMessage({ text: userError(e), bad: true });
    }
  }

  async function setFile(which: 'ratings' | 'titles', value: boolean) {
    try {
      const freed = await setImdbFile(which, value);
      if (which === 'titles' && value) void refreshImdbTitles().catch(() => undefined);
      setMessage(
        freed > 0 ? { text: `IMDb’s list of titles was removed (${formatBytes(freed)}).`, bad: false } : null
      );
      setTimeout(readList, 500);
    } catch (e) {
      setMessage({ text: userError(e), bad: true });
    }
  }

  async function removeOnline() {
    try {
      const removed = await removeFetchedOnline();
      setMessage({
        text: `Removed: the details of ${count(removed.titles, 'title')}, and ${count(removed.pictures, 'picture')} (${formatBytes(removed.bytes)}). Names, years and what you have watched stay.`,
        bad: false,
      });
    } catch (e) {
      setMessage({ text: userError(e), bad: true });
    }
  }

  return (
    <section className="settings-section keep-on-device">
      <h2>{KEEP_ON_DEVICE_TITLE}</h2>
      <ChoiceRow
        label={KEEP_ON_DEVICE_TITLE}
        choices={[
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ]}
        value={state === null ? '' : on ? 'on' : 'off'}
        onChange={(v) => void (v === 'on' ? switchOn() : switchOff())}
        note={KEEP_ON_DEVICE_NOTE}
      />
      {message && (
        <p className={message.bad ? 'settings-error' : 'muted'} role="status">
          {message.text}
        </p>
      )}
      {message?.go && (
        <FocusGroup kind="row" className="settings-row">
          <FocusButton className="btn-secondary" onSelect={() => onGo('tracking')}>
            Go to Keep track of what I watch
          </FocusButton>
        </FocusGroup>
      )}
      {back && !on && (
        <p className="muted" role="status">
          {back}
        </p>
      )}
      {on && state && (
        <>
          <ChoiceRow
            label="IMDb’s list of titles"
            choices={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            value={state.imdbTitles ? 'on' : 'off'}
            onChange={(v) => void setFile('titles', v === 'on')}
            note={
              state.imdbTitles
                ? `Names are matched here, against it. ${listWords(list)}`
                : 'Off: names come from the files only (NFO files and file names).'
            }
          />
          {state.imdbTitles && list?.present && !building && (
            <FocusGroup kind="row" className="settings-row">
              <FocusButton
                className="btn-secondary"
                onSelect={() =>
                  void refreshImdbTitles(true)
                    .catch((e: unknown) => setMessage({ text: userError(e), bad: true }))
                    .finally(readList)
                }
              >
                Get a new copy now
              </FocusButton>
            </FocusGroup>
          )}
          <ChoiceRow
            label="IMDb’s ratings"
            choices={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            value={state.imdbRatings ? 'on' : 'off'}
            onChange={(v) => void setFile('ratings', v === 'on')}
            note="About 9 MB, once a month at most; only the rows for your titles are kept."
          />
          <FocusGroup kind="row" className="settings-row">
            <ConfirmButton
              className="btn-secondary"
              confirmLabel="Yes, remove them"
              onConfirm={() => void removeOnline()}
            >
              Remove pictures and details fetched online
            </ConfirmButton>
          </FocusGroup>
          <p className="muted">
            Posters, plots, cast and trailers that came from the internet. Names, years, pictures
            beside your files and what you have watched stay.
          </p>
        </>
      )}
    </section>
  );
}
