/**
 * Seek preview pictures (round 10): the typed side of
 * `src-tauri/src/seek_preview.rs`, and the two hooks that use it — the
 * picture above the seek bar, and filling the pictures in while watching.
 *
 * A picture comes as JPEG bytes and is shown from a `blob:` URL (allowed by
 * the content security policy already), so it needs no folder in the asset
 * scope. The nearest step of ten seconds answers every request.
 */
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { capabilitiesNow } from '../capabilities';
import { hasMpv, playerFacts, readProperty } from './engine';
import type { Session } from './session';

/** Seconds between two pictures (`STEP_SECS` in seek_preview.rs). */
export const STEP_SECS = 10;

export const stepFor = (secs: number): number =>
  Number.isFinite(secs) && secs > 0 ? Math.round(secs / STEP_SECS) * STEP_SECS : 0;

/** Whether pictures are made here: mpv on a computer, a software decoder on Android. */
export const previewsHere = (): boolean => !!capabilitiesNow()?.seek_previews;

/** Frames the player has dropped since the film opened: mpv's counts, or Media3's. */
async function droppedFrames(): Promise<number> {
  if (!hasMpv()) return (await playerFacts()).frames?.dropped ?? 0;
  return (
    ((await readProperty<number>('frame-drop-count', 'int64')) ?? 0) +
    ((await readProperty<number>('decoder-frame-drop-count', 'int64')) ?? 0)
  );
}

export async function seekPreviewPicture(fileId: number, secs: number): Promise<Blob | null> {
  const bytes = await invoke<ArrayBuffer | Uint8Array | number[]>('seek_preview', { fileId, secs });
  const data =
    bytes instanceof ArrayBuffer || bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  if (data.byteLength === 0) return null;
  return new Blob([data], { type: 'image/jpeg' });
}

export const seekPreviewFill = (fileId: number, on: boolean, fromSecs: number) =>
  invoke<void>('seek_preview_fill', { fileId, on, fromSecs });
export const seekPreviewClose = () => invoke<void>('seek_preview_close');

export interface SeekPreviewUsage {
  files: number;
  bytes: number;
  /** The most they may take on this device (Android: a tenth of its room), or none. */
  limit: number | null;
}
export const seekPreviewUsage = () => invoke<SeekPreviewUsage>('seek_preview_usage');
export const deleteSeekPreviews = () => invoke<number>('delete_seek_previews');

/** The whole-library job (`preview_job.rs`): its switch and how far it is. */
export interface PreviewJobStatus {
  enabled: boolean;
  /** off · idle (on, not started) · running · waiting (a film plays) · finished */
  state: 'off' | 'idle' | 'running' | 'waiting' | 'finished';
  /** Files with every picture made, and files in the library. */
  done: number;
  total: number;
  /** Files left for the next start: their folder did not answer. */
  unreachable: number;
}
export const previewJobStatus = () => invoke<PreviewJobStatus>('preview_job_status');
export const setPreviewJob = (enabled: boolean) => invoke<PreviewJobStatus>('preview_job_set', { enabled });

/** Pictures of this film already shown, so going back over the bar is instant. */
const KEPT = 240;

/**
 * The picture for `at` seconds into the file, or the nearest one asked for
 * so far. One request at a time: while one is out, only the newest point
 * waits, and is asked for when it comes back — older points are dropped.
 */
export function useSeekPreview(fileId: number | null, at: number | null): { url: string | null; at: number | null } {
  const [shown, setShown] = useState<{ url: string | null; at: number | null }>({ url: null, at: null });
  const kept = useRef(new Map<number, string>());
  const busy = useRef(false);
  const wanted = useRef<number | null>(null);
  const live = useRef(true);

  // A new file: nothing of the last one's.
  useEffect(() => {
    const pictures = kept.current;
    live.current = true;
    return () => {
      live.current = false;
      for (const url of pictures.values()) URL.revokeObjectURL(url);
      pictures.clear();
      busy.current = false;
      wanted.current = null;
      setShown({ url: null, at: null });
    };
  }, [fileId]);

  useEffect(() => {
    if (fileId === null || at === null || !previewsHere()) return;
    const step = stepFor(at);
    wanted.current = step;
    const ready = kept.current.get(step);
    if (ready) {
      setShown({ url: ready, at: step });
      return;
    }
    if (busy.current) return;
    const ask = (asked: number) => {
      busy.current = true;
      const started = performance.now();
      seekPreviewPicture(fileId, asked)
        .then((blob) => {
          if (!live.current) return;
          if (blob) {
            const url = URL.createObjectURL(blob);
            kept.current.set(asked, url);
            if (kept.current.size > KEPT) {
              const [oldest, oldUrl] = kept.current.entries().next().value as [number, string];
              kept.current.delete(oldest);
              URL.revokeObjectURL(oldUrl);
            }
            if (wanted.current === asked) setShown({ url, at: asked });
            console.info(`seek preview: ${asked} s in ${Math.round(performance.now() - started)} ms`);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!live.current) return;
          busy.current = false;
          const next = wanted.current;
          if (next === null || next === asked) return;
          const ready2 = kept.current.get(next);
          if (ready2) setShown({ url: ready2, at: next });
          else ask(next);
        });
    };
    ask(step);
  }, [fileId, at]);

  return shown;
}

/** After the first picture, how long the film plays before filling starts. */
const FILL_AFTER_MS = 20_000;
/** How often the dropped frames are read while filling. */
const FILL_POLL_MS = 5_000;
/** After a drop, how long the film plays clean before filling goes on. */
const FILL_REST_MS = 60_000;
/** Drops filling itself caused, after which it leaves this film alone (a weak PC: 1 core, 4K). */
const FILL_STRIKES = 2;

/**
 * Filling in the pictures while watching, in the background: from the play
 * head on, about one a second (seek_preview.rs; not for a film on a network
 * share on Android), never while the film drops frames — it stops at the first drop and goes on after a clean minute. The
 * second handle goes when the player closes.
 */
export function useSeekPreviewFill({
  fileId,
  sessionRef,
  watching,
}: {
  fileId: number | null;
  sessionRef: RefObject<Session>;
  /** The film is open and its first picture is up. */
  watching: boolean;
}) {
  useEffect(() => {
    if (fileId === null || !watching || !previewsHere()) return;
    let on = false;
    let restUntil = performance.now() + FILL_AFTER_MS;
    let lastDrops: number | null = null;
    let strikes = 0;
    let stopped = false;
    const tick = async () => {
      const count = await droppedFrames().catch(() => lastDrops ?? 0);
      if (stopped) return;
      const s = sessionRef.current;
      const dropped = lastDrops !== null && count > lastDrops && !s.paused && !s.scrubbing;
      lastDrops = count;
      if (dropped) {
        restUntil = performance.now() + FILL_REST_MS;
        if (on) {
          on = false;
          // Filling is what the film dropped under: twice, and it stays off.
          if (++strikes >= FILL_STRIKES) restUntil = Number.POSITIVE_INFINITY;
          console.info('seek preview: frames dropped; filling in rests');
          void seekPreviewFill(fileId, false, 0).catch(() => {});
        }
        return;
      }
      if (!on && performance.now() >= restUntil) {
        on = true;
        void seekPreviewFill(fileId, true, s.timePos ?? 0).catch(() => {});
      }
    };
    const timer = window.setInterval(() => void tick(), FILL_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      if (on) void seekPreviewFill(fileId, false, 0).catch(() => {});
    };
  }, [fileId, watching, sessionRef]);

  // The player closing: the second handle and its memory go.
  useEffect(() => {
    if (!previewsHere()) return;
    return () => void seekPreviewClose().catch(() => {});
  }, []);
}
