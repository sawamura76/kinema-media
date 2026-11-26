import { useCallback, useEffect, useRef, useState } from 'react';
import { isPaused, mpvCommand, onPlaybackEvent, openPath, readProperty, setPaused, startEngine, stopPlayback } from '../player/engine';
import type { MusicTrack } from './api';
import { getMusicLibrary, MUSIC_LIBRARY_CHANGED } from './api';
import { nextIndex, shuffled, type Repeat } from './model';
import { sameMusicPath } from './path';

interface State { queue: MusicTrack[]; index: number; active: boolean; paused: boolean; loading: boolean; position: number; duration: number; repeat: Repeat; error: string | null }
const EMPTY: State = { queue: [], index: 0, active: false, paused: false, loading: false, position: 0, duration: 0, repeat: 'off', error: null };

/** Lives in Browse, above its route pages, so changing pages never unmounts audio. */
export function useMusicPlayer(videoActive: boolean) {
  const [state, setState] = useState<State>(EMPTY);
  const current = useRef(state);
  const generation = useRef(0);
  const commands = useRef(Promise.resolve());
  const advance = useRef<(ended?: boolean) => void>(() => {});
  const patch = useCallback((change: Partial<State>) => {
    current.current = { ...current.current, ...change };
    setState(current.current);
  }, []);
  useEffect(() => {
    let alive = true;
    const refresh = () => { void getMusicLibrary().then((library) => {
      if (!alive) return;
      const art = new Map(library.tracks.map((track) => [track.id, track]));
      patch({ queue: current.current.queue.map((track) => {
        const updated = art.get(track.id);
        return updated && sameMusicPath(updated.path,track.path) ? { ...track, artwork: updated.artwork } : track;
      }) });
    }).catch(console.warn); };
    window.addEventListener(MUSIC_LIBRARY_CHANGED,refresh); return () => { alive=false; window.removeEventListener(MUSIC_LIBRARY_CHANGED,refresh); };
  }, [patch]);
  const enqueue = useCallback((action: () => Promise<void>) => {
    const next = commands.current.then(action);
    commands.current = next.catch(() => {});
    return next;
  }, []);
  const load = useCallback((queue: MusicTrack[], index: number) => {
    const token = ++generation.current;
    const track = queue[index];
    if (!track) return;
    patch({ queue, index, active: true, paused: false, loading: true, position: 0, duration: track.duration, error: null });
    void enqueue(async () => {
      await startEngine();
      if (token !== generation.current) return;
      // Per-file options: do not disable video globally for the next movie.
      await mpvCommand('loadfile', [track.path, 'replace', '-1', 'vid=no,sid=no,aid=auto,start=0']);
      await setPaused(false);
    }).catch((e) => { if (token === generation.current) patch({ loading: false, error: String(e) }); });
  }, [enqueue, patch]);
  const stop = useCallback(() => {
    ++generation.current;
    const wasActive = current.current.active;
    patch({ active: false, loading: false, error: null });
    return wasActive ? enqueue(stopPlayback) : Promise.resolve();
  }, [enqueue, patch]);
  const step = useCallback((direction: number, ended = false) => {
    const s = current.current;
    const next = nextIndex(s.queue.length, s.index, direction, s.repeat, ended);
    if (next === null) { void stop(); return; }
    load(s.queue, next);
  }, [load, stop]);
  const togglePause = useCallback(() => {
    if (!current.current.active) { load(current.current.queue, current.current.index); return; }
    const token = generation.current;
    void enqueue(async () => {
      if (!current.current.active || token !== generation.current) return;
      const paused = await isPaused();
      if (token !== generation.current) return;
      await setPaused(!paused);
      if (token === generation.current) patch({ paused: !paused });
    }).catch((e) => { if (token === generation.current) patch({ error: String(e) }); });
  }, [enqueue, patch, load]);
  useEffect(() => { advance.current = (ended = false) => step(1, ended); }, [step]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!current.current.active || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      const target = e.target;
      if (target instanceof HTMLElement && (target.matches('input,textarea,select') || target.isContentEditable)) return;
      if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); togglePause(); }
      if (e.key === 'PageDown') { e.preventDefault(); e.stopPropagation(); step(1); }
      if (e.key === 'PageUp') { e.preventDefault(); e.stopPropagation(); step(-1); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [togglePause, step]);
  useEffect(() => {
    // All video routes replace the shared engine themselves. Retire the audio
    // owner without issuing a delayed stop which could stop the new movie.
    if (videoActive) { ++generation.current; patch({ active: false, loading: false }); }
  }, [videoActive, patch]);
  useEffect(() => {
    let alive = true;
    let off: (() => void) | undefined;
    let openToken = -1;
    void startEngine().then(() => onPlaybackEvent((event) => {
      const s = current.current;
      if (!alive || !s.active) return;
      if (event.type === 'loaded') {
        const token = generation.current;
        void Promise.all([openPath(), readProperty<number>('duration', 'double'), readProperty<boolean>('pause', 'flag')]).then(([path, duration, paused]) => {
          if (!alive || token !== generation.current || !path || !sameMusicPath(path, current.current.queue[current.current.index]?.path ?? '')) return;
          openToken = token;
          patch({ loading: false, duration: duration ?? current.current.duration, paused: paused ?? false });
        }).catch((e) => patch({ error: String(e), loading: false }));
      } else if (openToken === generation.current) {
        if (event.type === 'position' && event.value !== null) patch({ position: event.value });
        if (event.type === 'paused') patch({ paused: event.value });
        if (event.type === 'reached-end' || (event.type === 'ended' && event.reason === 'eof')) { openToken = -1; advance.current(true); }
        if (event.type === 'ended' && event.reason === 'error') patch({ error: event.detail ?? 'This song could not be played.', loading: false });
      } else if (event.type === 'ended' && event.reason === 'error') {
        patch({ error: event.detail ?? 'This song could not be opened.', loading: false });
      }
    })).then((unlisten) => { if (alive) off = unlisten; else unlisten(); }).catch((e) => patch({ error: String(e) }));
    return () => { alive = false; off?.(); };
  }, [patch]);
  return {
    ...state, track: state.queue[state.index] ?? null,
    play: (tracks: MusicTrack[], index = 0, shuffle = false) => {
      const playable = tracks.filter((t) => !t.missing);
      const target = tracks[index];
      const queue = shuffle ? shuffled(playable) : playable;
      if (queue.length) load(queue, shuffle ? 0 : Math.max(0, queue.findIndex((t) => t.id === target?.id)));
    },
    add: (tracks: MusicTrack[]) => patch({ queue: [...current.current.queue, ...tracks.filter((t) => !t.missing)] }),
    remove: (index: number) => {
      const s = current.current;
      const queue = s.queue.filter((_, i) => i !== index);
      if (!queue.length) { void stop(); patch({ queue: [], index: 0 }); }
      else if (index === s.index && s.active) load(queue, Math.min(index, queue.length - 1));
      else patch({ queue, index: index < s.index ? s.index - 1 : Math.min(s.index, queue.length - 1) });
    },
    jump: (index: number) => load(current.current.queue, index),
    next: () => step(1), previous: () => step(-1), stop,
    pause: togglePause,
    seek: (seconds: number) => { void mpvCommand('seek', [String(seconds), 'absolute']).catch((e) => patch({ error: String(e) })); },
    cycleRepeat: () => patch({ repeat: current.current.repeat === 'off' ? 'all' : current.current.repeat === 'all' ? 'one' : 'off' }),
    shuffleQueue: () => {
      const s = current.current;
      if (s.active) patch({ queue: [...s.queue.slice(0, s.index + 1), ...shuffled(s.queue.slice(s.index + 1))] });
      else patch({ queue: shuffled(s.queue) });
    },
  };
}
export type MusicPlayer = ReturnType<typeof useMusicPlayer>;
