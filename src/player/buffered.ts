/**
 * The part of the film loaded ahead of the play head, for the seek bar
 * (round 9): mpv's demuxer cache on a computer, Media3's buffered position on
 * Android (`bufferedAhead`, engine.ts). Says only what the player reports, and
 * nothing while the bar is hidden.
 *
 * Read once a second while the controls show, rather than observed: observed
 * properties register once at init (docs/GOTCHAS.md), and the bar needs it
 * only while it can be seen. Steady on purpose — a local file that loads at
 * once keeps one band that moves along with the film; it never blinks off
 * between reads, because a read that fails keeps the last answer.
 */
import { useEffect, useRef, useState } from 'react';
import { bufferedAhead } from './engine';

export const BUFFER_POLL_MS = 1000;

/**
 * Where the loaded part ends on the bar (seconds), or null for no band: the
 * read's end (`at + ahead`), never behind the play head, never past the end,
 * and the whole rest of the film once it reaches within half a second of it.
 */
export function bufferedEnd(
  read: { at: number; ahead: number } | null,
  timePos: number | null,
  duration: number | null
): number | null {
  if (!read || timePos === null || !duration || duration <= 0) return null;
  const end = read.at + read.ahead;
  if (end >= duration - 0.5) return duration;
  return end > timePos ? end : null;
}

/** The loaded part's end while `on` (the controls show); null otherwise. */
export function useBufferedEnd(
  on: boolean,
  path: string,
  timePos: number | null,
  duration: number | null
): number | null {
  const pos = useRef(timePos);
  useEffect(() => {
    pos.current = timePos;
  }, [timePos]);
  const [read, setRead] = useState<{ at: number; ahead: number; path: string } | null>(null);

  useEffect(() => {
    if (!on) return;
    let live = true;
    const ask = () => {
      const at = pos.current;
      void bufferedAhead()
        .catch(() => null)
        .then((ahead) => {
          if (live && ahead !== null && at !== null) setRead({ at, ahead, path });
        });
    };
    ask();
    const poll = window.setInterval(ask, BUFFER_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(poll);
    };
  }, [on, path]);

  return on && read?.path === path ? bufferedEnd(read, timePos, duration) : null;
}
