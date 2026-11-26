/**
 * The player's volume: the level, mute, and whether a receiver has the
 * volume instead (sound bitstreamed to it, where this level would do
 * nothing). The level is remembered across films (volume.ts). It goes to
 * `max`: 200 where mpv boosts the sound, 100 on Media3, which cannot. The
 * part above 100 is a gain and a limiter (soundLevel.ts `setBoost`), so it
 * never clips, with volume levelling or without.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  setMuted as applyMute,
  setVolume as applyVolume,
  soundGoesUntouched,
  volumeMax,
} from './engine';
import { setBoost } from './soundLevel';
import { clampVolume, persistVolume, savedVolume, stepVolume } from './volume';

export function useVolume({
  fail,
  showOsd,
  osdVisible,
  path,
  frameShown,
}: {
  fail: (e: unknown) => void;
  showOsd: () => void;
  /** The controls are up: the only time the receiver's answer is on screen. */
  osdVisible: boolean;
  /** The file playing, and whether its first frame is up: asked again at each. */
  path: string;
  frameShown: boolean;
}) {
  const [volume, setVolume] = useState(100);
  // The level as last set, ahead of the render that shows it. Steps arrive
  // faster than renders — a quick turn of the wheel, a held key, each behind
  // volumeKey's await — and a step taken from the rendered `volume` started
  // from the same old level each time: three notches moved it once.
  const levelNow = useRef(100);
  const [muted, setMuted] = useState(false);
  /** Sound bitstreamed to a receiver: this volume would do nothing. */
  const [receiver, setReceiver] = useState(false);
  const max = volumeMax();
  /** When the last step came, for the rest at 100% (volume.ts `stepVolume`). */
  const lastStep = useRef(0);

  // The remembered level, applied once per player; mpv keeps it across files.
  useEffect(() => {
    let live = true;
    void savedVolume(volumeMax()).then((level) => {
      if (!live) return;
      setVolume(level);
      levelNow.current = level;
      void applyVolume(level).catch((e) => console.warn('volume: could not apply', e));
      void setBoost(level);
    });
    return () => {
      live = false;
    };
  }, []);

  /**
   * Set the level outright. `save` is false while a mouse drags the bar, so a
   * drag is one saved setting when it is let go, not one per pixel.
   */
  const setVolumeLevel = useCallback(
    (value: number, save = true) => {
      const level = clampVolume(value, max);
      levelNow.current = level;
      setVolume(level);
      void applyVolume(level).catch(fail);
      void setBoost(level);
      if (save) void persistVolume(level).catch((e) => console.warn('volume: could not save', e));
      // Turning it up is a clear enough request to hear something.
      if (muted && level > volume) {
        setMuted(false);
        void applyMute(false).catch(fail);
      }
      showOsd();
    },
    [volume, muted, max, fail, showOsd]
  );

  const changeVolume = useCallback(
    (delta: number) => {
      const now = performance.now();
      const since = now - lastStep.current;
      lastStep.current = now;
      setVolumeLevel(stepVolume(levelNow.current, delta, max, since));
    },
    [setVolumeLevel, max]
  );


  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    void applyMute(next).catch(fail);
    showOsd();
  }, [muted, fail, showOsd]);

  /**
   * A volume key, asked of the sound path at the moment it is pressed rather
   * than of the last answer: a fallback part-way through a file can change it,
   * and a key that silently did nothing because of a stale answer is the kind
   * of failure nobody can report.
   */
  const volumeKey = useCallback(
    (act: () => void) => {
      void soundGoesUntouched().then((yes) => {
        setReceiver(yes);
        if (yes) showOsd();
        else act();
      });
    },
    [showOsd]
  );

  /**
   * Whether the receiver has the volume, asked whenever the controls come up
   * — the only time the answer is on screen, and a cheap scalar read — and
   * again at the first frame: the controls are often already up while a file
   * opens, before its sound output exists, and the answer asked then was "no".
   */
  useEffect(() => {
    if (!osdVisible) return;
    let live = true;
    void soundGoesUntouched().then((yes) => live && setReceiver(yes));
    return () => {
      live = false;
    };
  }, [osdVisible, path, frameShown]);

  return {
    volume,
    max,
    muted,
    receiver,
    setVolumeLevel,
    changeVolume,
    toggleMute,
    volumeKey,
  };
}
