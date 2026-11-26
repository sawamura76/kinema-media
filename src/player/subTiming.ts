/**
 * Automatic subtitle timing (round 10, notes/SUBTITLE-TIMING.md option A):
 * the typed side of `src-tauri/src/sub_timing.rs`, and what the player says
 * about what it found. The check compares when a subtitle file shows its
 * lines with when people speak (or with a subtitle built into the film) in
 * short stretches of the film; the page applies what it found through
 * `subDelay.ts` — mpv's `sub-delay` and `sub-speed`, never the file.
 *
 * Desktop only (mpv). Android has no button: PLAN.md's Android list.
 */
import { invoke } from '@tauri-apps/api/core';
import type { Track } from './engine';
import { describeSubDelay } from './subDelay';
import { isPictureSubtitle } from './tracks';

export type TimingOutcome = 'fixed' | 'in_time' | 'other_cut' | 'unsure' | 'too_short' | 'no_lines';

export interface TimingFinding {
  outcome: TimingOutcome;
  /** mpv's `sub-delay`, seconds; positive shows the lines later. */
  delay_secs: number;
  /** mpv's `sub-speed`; 1 when the speed is right. */
  speed: number;
  /** The frame rates behind `speed`: the subtitle's release, the film. */
  from_fps: number;
  to_fps: number;
  agree: number;
  usable: number;
  checks: number;
  /** 'speech', 'subtitles' (a built-in one) or 'both'. */
  reference: string;
  millis: number;
}

/** Ask the computer to check `subtitle` (a file) against the film at `video`. */
export const checkSubTiming = (args: {
  video: string;
  subtitle: string;
  aid: number | null;
  /** The sound track has a centre channel, where the dialogue is (5.1, 7.1). */
  centre: boolean;
  reference: number | null;
  duration: number;
}) => invoke<TimingFinding>('sub_timing_check', args);

/** Whether a sound track has a centre channel; a wrong guess only costs a retry. */
export const hasCentre = (t: Track | undefined) =>
  !!t && ((t.channels ?? 0) >= 5 || /^[3567]\./.test(t.layout ?? ''));

/** A subtitle the check can time: a text file of its own, not one inside the film. */
export function timableFile(track: Track | undefined): string | null {
  if (!track?.external || !track.externalFilename) return null;
  return /\.(srt|ass|ssa|vtt)$/i.test(track.externalFilename) ? track.externalFilename : null;
}

/** A text subtitle built into the film, other than `chosen`, to compare with. */
export function builtInReference(tracks: Track[], chosen: number | null): number | null {
  const found = tracks.find(
    (t) => t.type === 'sub' && !t.external && t.id !== chosen && !isPictureSubtitle(t)
  );
  return found?.id ?? null;
}

/** The new delay in ms. */
export const findingMs = (f: TimingFinding) => Math.round(f.delay_secs * 1000);

/** After a download: worth offering only when clearly off. */
export const worthOffering = (f: TimingFinding) =>
  f.outcome === 'fixed' && (Math.abs(f.delay_secs) >= 0.3 || f.speed !== 1);

const fps = (v: number) => String(Number(v.toFixed(3)));

/** "…and slowed to match the film (made for 25 fps; the film is 23.976)". */
function speedWords(f: TimingFinding): string {
  if (f.speed === 1) return '';
  const how = f.speed > 1 ? 'slowed' : 'sped up';
  return `, and ${how} to match the film (made for ${fps(f.from_fps)} fps; the film is ${fps(f.to_fps)})`;
}

const against = (f: TimingFinding) =>
  f.reference === 'subtitles'
    ? 'against the subtitles built into the film'
    : f.reference === 'both'
      ? 'against the speech and the built-in subtitles'
      : 'against the speech';

/** What the panel says after a check, in full. */
export function describeFinding(f: TimingFinding): string {
  const agree = `${f.agree} of ${f.checks} checks agree`;
  switch (f.outcome) {
    case 'fixed':
      return `${describeSubDelay(findingMs(f))}${speedWords(f)} — ${agree}, ${against(f)}.`;
    case 'in_time':
      return `Already in time — ${agree}. Nothing changed.`;
    case 'other_cut':
      return 'These subtitles seem made for another version of the film — nothing changed. Earlier and later still work.';
    case 'too_short':
      return 'Too short to check — nothing changed.';
    case 'no_lines':
      return 'This subtitle file has too few lines to check — nothing changed.';
    default:
      return 'Could not tell the timing for sure — nothing changed. Earlier and later still work.';
  }
}

/** The offer after a download: "These subtitles look 2.3 s late." */
export function describeOffer(f: TimingFinding): string {
  const s = Math.abs(f.delay_secs).toFixed(1).replace(/\.0$/, '');
  // Positive delay moves them later, so they came early.
  const off = f.delay_secs >= 0.3 ? `${s} s early` : f.delay_secs <= -0.3 ? `${s} s late` : null;
  const drift = f.speed !== 1 ? 'made for another frame rate' : null;
  return `These subtitles look ${[off, drift].filter(Boolean).join(' and ')}.`;
}
