import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from './engine';
import { hasMpv } from './engine';
import { appliedSubDelay, changeSubDelay, describeSubDelay, setSubTiming } from './subDelay';
import {
  builtInReference,
  checkSubTiming,
  describeFinding,
  describeOffer,
  findingMs,
  hasCentre,
  timableFile,
  worthOffering,
  type TimingFinding,
} from './subTiming';

/** What the subtitle panel shows of "Fix timing automatically". */
export interface AutoTiming {
  /** The chosen subtitle can be checked (a text file of its own). */
  canCheck: boolean;
  checking: boolean;
  /** What the last check said, in full. */
  line: string | null;
  canUndo: boolean;
  /** After a download: "These subtitles look 2.3 s late." with a Fix. */
  offer: string | null;
  onFix: () => void;
  onUndo: () => void;
  onAcceptOffer: () => void;
}

/**
 * The player's side of subtitle timing (subDelay.ts): the amount the panel
 * shows, and a step from the keys or the panel, said in a notice. Read from
 * what was last applied at every render, so a new file shows its own.
 *
 * And "Fix timing automatically" (subTiming.ts): a check on a press, applied
 * when sure and said with Undo; after an OpenSubtitles download a quiet check
 * that only offers (`quietCheck`) — never moved without a yes.
 */
export function useSubDelay(
  say: (text: string) => void,
  playing?: {
    video: string;
    tracks: Track[];
    sid: number | null;
    subVisible: boolean;
    aid: number | null;
    duration: number | null;
  }
) {
  const [, setChanged] = useState(0);
  const [auto, setAuto] = useState<{
    checking: boolean;
    line: string | null;
    undo: { ms: number; speed: number } | null;
    offer: TimingFinding | null;
  }>({ checking: false, line: null, undo: null, offer: null });
  /** Which file a check belongs to: one that ends after the film changed is dropped. */
  const fileRef = useRef<string | null>(null);
  const video = playing?.video ?? null;

  useEffect(() => {
    fileRef.current = video;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAuto({ checking: false, line: null, undo: null, offer: null });
  }, [video]);

  const changeTiming = useCallback(
    (delta: number, reset = false) => {
      if (!hasMpv()) return;
      void changeSubDelay(delta, reset)
        .then((ms) => {
          setChanged((n) => n + 1);
          // A step by hand: what was found and its Undo are no longer what shows.
          setAuto((a) => ({ ...a, offer: null, undo: null, line: null }));
          say(`${describeSubDelay(ms)}, for this file`);
        })
        .catch((e) => console.warn('subtitles: timing not kept', e));
    },
    [say]
  );

  const tracks = playing?.tracks;
  const sid = playing?.sid ?? null;
  const shown = playing?.subVisible ? tracks?.find((t) => t.type === 'sub' && t.id === sid) : undefined;
  const subtitle = timableFile(shown);
  const aid = playing?.aid ?? null;
  const duration = playing?.duration ?? null;

  /** Put a found timing on, keeping what was there for Undo. */
  const apply = useCallback((f: TimingFinding, line: string) => {
    const before = appliedSubDelay();
    const undo = { ms: before.ms, speed: before.speed };
    void setSubTiming(findingMs(f), f.speed).then(() => {
      setChanged((n) => n + 1);
      setAuto({ checking: false, line, undo, offer: null });
    });
  }, []);

  const run = useCallback(
    (file: string, quiet: boolean) => {
      if (!hasMpv() || video === null || !duration || !tracks) return;
      const forFile = video;
      if (!quiet) setAuto((a) => ({ ...a, checking: true, line: null, offer: null, undo: null }));
      checkSubTiming({
        video,
        subtitle: file,
        aid,
        centre: hasCentre(tracks.find((t) => t.type === 'audio' && t.id === aid)),
        reference: builtInReference(tracks, sid),
        duration,
      })
        .then((f) => {
          if (fileRef.current !== forFile) return;
          if (quiet) {
            if (!worthOffering(f)) return;
            setAuto((a) => ({ ...a, offer: f }));
            say(`${describeOffer(f)} The subtitle menu can fix it.`);
            return;
          }
          if (f.outcome === 'fixed') apply(f, describeFinding(f));
          else setAuto((a) => ({ ...a, checking: false, line: describeFinding(f) }));
        })
        .catch((e) => {
          console.warn('subtitles: timing check failed', e);
          if (!quiet && fileRef.current === forFile) {
            setAuto((a) => ({
              ...a,
              checking: false,
              line: `The timing could not be checked: ${String(e)}`,
            }));
          }
        });
    },
    [video, duration, tracks, aid, sid, say, apply]
  );

  /** After an OpenSubtitles download that was not made for this exact file. */
  const quietCheck = useCallback((file: string) => run(file, true), [run]);

  const offer = auto.offer;
  const autoTiming: AutoTiming | null =
    playing && hasMpv()
      ? {
          canCheck: subtitle !== null,
          checking: auto.checking,
          line: auto.line,
          canUndo: auto.undo !== null,
          offer: offer ? describeOffer(offer) : null,
          onFix: () => {
            if (subtitle && !auto.checking) run(subtitle, false);
          },
          onUndo: () => {
            const undo = auto.undo;
            if (!undo) return;
            void setSubTiming(undo.ms, undo.speed).then(() => {
              setChanged((n) => n + 1);
              setAuto((a) => ({ ...a, undo: null, line: 'Undone: the timing is as it was.' }));
              say(`${describeSubDelay(undo.ms)}, for this file`);
            });
          },
          onAcceptOffer: () => {
            if (offer) apply(offer, describeFinding(offer));
          },
        }
      : null;

  return { subDelayMs: appliedSubDelay().ms, changeTiming, autoTiming, quietCheck };
}
