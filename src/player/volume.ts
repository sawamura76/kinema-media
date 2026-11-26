/**
 * Volume and mute.
 *
 * There was none: the app assumed a receiver or the Windows mixer would do it,
 * which holds on a sofa and fails the first time someone on a laptop reaches
 * for a slider that is not there.
 *
 * The level is remembered across launches (settings key `volume`), because
 * a volume that resets to full every time the app opens is its own complaint.
 * Mute is not: coming back to a silent film you have forgotten muting is worse.
 *
 * Nothing here is observed from the engine. Only this app changes the volume,
 * so the state it sets is the state there is — and an observed mpv property
 * would only start arriving after a full restart (docs/GOTCHAS.md). Setting it
 * is the engine's (engine.ts `setVolume`, `setMuted`).
 */
import { getSetting, setSetting } from '../metadata/api';

export const VOLUME_KEY = 'volume';
export const VOLUME_STEP = 5;
/** The film's own level: no gain and no cut. Above it is a boost. */
export const VOLUME_NORMAL = 100;
/**
 * The top of the control, as VLC's: twice the film's level on the slider.
 * mpv is told the same ceiling (mpvOptions.ts `volume-max`). Media3 has no
 * gain above its own 100, so on Android the top is VOLUME_NORMAL
 * (engine.ts `volumeMax`).
 */
export const VOLUME_MAX = 200;
const DEFAULT_VOLUME = VOLUME_NORMAL;

/** Clamp to what the control offers: 0 to `max` in steps. */
export function clampVolume(value: number, max: number = VOLUME_MAX): number {
  const stepped = Math.round(value / VOLUME_STEP) * VOLUME_STEP;
  return Math.min(max, Math.max(0, stepped));
}

/**
 * The remembered level. A level saved before the boost (0–100) is read as it
 * was; one saved above `max` — a boost from a computer, read where there is
 * none — is brought down to it.
 */
export async function savedVolume(max: number = VOLUME_MAX): Promise<number> {
  const raw = await getSetting(VOLUME_KEY).catch(() => null);
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? clampVolume(parsed, max) : Math.min(DEFAULT_VOLUME, max);
}

export async function persistVolume(level: number): Promise<void> {
  await setSetting(VOLUME_KEY, String(level));
}

/**
 * Where the bar is drawn, as percentages of its height: the fill up to the
 * film's own level, the boost above it, and the mark at 100. Always a share
 * of `max`, so 200% fills the bar rather than spilling past its top.
 */
export function volumeBar(
  level: number,
  max: number
): { normal: number; boost: number; mark: number | null } {
  const share = (v: number) => (Math.min(Math.max(v, 0), max) / max) * 100;
  return {
    normal: share(Math.min(level, VOLUME_NORMAL)),
    boost: share(level) - share(Math.min(level, VOLUME_NORMAL)),
    mark: max > VOLUME_NORMAL ? share(VOLUME_NORMAL) : null,
  };
}

/**
 * How close to 100% on the bar a click or drag lands on 100% itself: the
 * film's own level is the one worth hitting, and a pixel either side is a
 * boost or a cut nobody meant.
 */
const NORMAL_SNAP = 10;

/** The level at a height up the bar, 0 at the bottom to 1 at the top. */
export function levelOnBar(fraction: number, max: number): number {
  const level = fraction * max;
  if (max > VOLUME_NORMAL && Math.abs(level - VOLUME_NORMAL) <= NORMAL_SNAP) return VOLUME_NORMAL;
  return clampVolume(level, max);
}

/**
 * How long the level rests at 100% before steps carry on past it. Steps that
 * keep coming — a held key, a wheel still turning, a remote's button held
 * down — stop there; a pause, then the next step goes on into the boost (or
 * down from it). As a slider with a notch at its middle.
 */
export const NORMAL_REST_MS = 600;

/**
 * One step of the volume (keys, wheel, remote), from `from` by `delta`.
 * Where a boost is possible, a step that would cross 100% lands on it, and
 * one that would leave it within NORMAL_REST_MS of the last step stays.
 */
export function stepVolume(
  from: number,
  delta: number,
  max: number,
  sinceLastStepMs: number
): number {
  const to = clampVolume(from + delta, max);
  if (max <= VOLUME_NORMAL) return to;
  const crosses = (from < VOLUME_NORMAL && to > VOLUME_NORMAL) || (from > VOLUME_NORMAL && to < VOLUME_NORMAL);
  if (crosses) return VOLUME_NORMAL;
  if (from === VOLUME_NORMAL && sinceLastStepMs < NORMAL_REST_MS) return VOLUME_NORMAL;
  return to;
}

/** One notch of an ordinary mouse wheel, in pixels (`WheelEvent.deltaMode` 0). */
const WHEEL_NOTCH_PX = 100;

/**
 * Volume steps for a turn of the wheel over the picture, and what is left over.
 *
 * A mouse sends one event of about 100 px a notch; a touchpad sends dozens of a
 * few pixels each, which as a step apiece would swing the volume from silent to
 * full in one stroke. So the travel is added up and a step taken per notch's
 * worth. Lines (WebKitGTK, Firefox) and pages are turned into pixels first.
 * Up is louder, as on every player.
 */
export function wheelVolumeSteps(
  carried: number,
  deltaY: number,
  deltaMode: number
): { steps: number; carried: number } {
  const px = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 800 : deltaY;
  const total = carried + px;
  const notches = Math.trunc(total / WHEEL_NOTCH_PX);
  return { steps: -notches, carried: total - notches * WHEEL_NOTCH_PX };
}
