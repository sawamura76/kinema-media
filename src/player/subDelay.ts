/**
 * Subtitle timing, per file (PLAN phase 2, AFTER-0.10.0 "Subtitle timing").
 *
 * A subtitle made for another release of the film — another cut, another
 * intro — comes early or late by the same amount all through. Nothing Skrin
 * reads says by how much, so it is asked: earlier or later in steps of 0.1 s
 * and 0.5 s, from the player (keys, remote, mouse), and kept **per file**:
 * the next film's subtitles are timed differently. Moved by mpv's
 * `sub-delay`, a plain runtime property that mpv keeps from one file to the
 * next — so it is put on as every file starts, 0 included.
 *
 * "Fix timing automatically" (subTiming.ts, round 10) finds the amount by
 * itself and may also set mpv's `sub-speed`, for a subtitle made for a
 * release at another frame rate; kept per file beside the amount, and Reset
 * clears both. Manual steps after it move the amount on top.
 *
 * Desktop only: Media3 has no subtitle offset (PLAN.md, Android list).
 */
import { getSetting, setSetting } from '../metadata/api';
import { hasMpv, mpvCommand } from './engine';

/** Where the amounts live: one JSON object, milliseconds by file path. */
export const SUB_DELAY_KEY = 'subtitle_delay';
export const SUB_STEP_MS = 100;
export const SUB_BIG_STEP_MS = 500;
/** Ten minutes: past any intro or cut; a held key stops here. */
export const MAX_SUB_DELAY_MS = 600_000;
/** The speeds, by file path, where one was found (subTiming.ts); 1 is none. */
export const SUB_SPEED_KEY = 'subtitle_speed';
/** The files remembered; the oldest go first, so the setting stays small. */
export const MAX_FILES = 500;

type Delays = Record<string, number>;

/** To 10 ms: steps are 100 ms, but a found amount is finer. */
const clamp = (ms: number) =>
  Math.max(-MAX_SUB_DELAY_MS, Math.min(MAX_SUB_DELAY_MS, Math.round(ms / 10) * 10));

/** mpv's `sub-speed` range kept: the known frame-rate pairs are within 4.5 %. */
const validSpeed = (v: number) => Number.isFinite(v) && v > 0.9 && v < 1.1 && Math.abs(v - 1) > 1e-6;

/** The stored speeds; anything damaged or 1 is left out. */
export function parseSubSpeeds(value: string | null): Delays {
  const out: Delays = {};
  try {
    const parsed: unknown = value ? JSON.parse(value) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'number' && validSpeed(v)) out[key] = v;
      }
    }
  } catch {
    // Damaged: every file at its own speed.
  }
  return out;
}

/** The stored amounts; anything damaged is left out, which is no delay. */
export function parseSubDelays(value: string | null): Delays {
  const out: Delays = {};
  try {
    const parsed: unknown = value ? JSON.parse(value) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v) && clamp(v) !== 0) out[key] = clamp(v);
      }
    }
  } catch {
    // Damaged: every file as it is.
  }
  return out;
}

/** The amounts with this file's set (last, as the newest), 0 removing it. */
export function withSubDelay(delays: Delays, path: string, ms: number): Delays {
  const next = { ...delays };
  delete next[path];
  if (ms !== 0) next[path] = ms;
  const paths = Object.keys(next);
  for (const old of paths.slice(0, Math.max(0, paths.length - MAX_FILES))) delete next[old];
  return next;
}

/** Seconds as said: one decimal where that is exact, else two. */
const seconds = (ms: number) => {
  const a = Math.round(Math.abs(ms));
  return (a / 1000).toFixed(a % 100 === 0 ? 1 : 2).replace(/\.0$/, '');
};

/** The amount as the controls show it: "+0.5 s", "−2.3 s", "0 s". */
export function subDelayLabel(ms: number): string {
  const s = seconds(ms);
  return ms > 0 ? `+${s} s` : ms < 0 ? `−${s} s` : '0 s';
}

/** In words. mpv's sign: positive shows the subtitles later. */
export function describeSubDelay(ms: number): string {
  if (ms === 0) return 'Subtitles at their own timing';
  const s = seconds(ms);
  return ms > 0 ? `Subtitles ${s} s later` : `Subtitles ${s} s earlier`;
}

/** The file the timing now applied belongs to, the amount and the speed. */
let applied: { path: string | null; ms: number; speed: number } = { path: null, ms: 0, speed: 1 };
export const appliedSubDelay = () => applied;

/** Tell mpv. A refusal costs only the timing, said in the log. */
async function setMpv(ms: number): Promise<void> {
  if (!hasMpv()) return;
  try {
    await mpvCommand('set', ['sub-delay', (ms / 1000).toFixed(3)]);
  } catch (e) {
    console.warn(`subtitles: mpv refused sub-delay=${ms} ms`, e);
  }
}

async function setMpvSpeed(speed: number): Promise<void> {
  if (!hasMpv()) return;
  try {
    await mpvCommand('set', ['sub-speed', speed.toFixed(6)]);
  } catch (e) {
    console.warn(`subtitles: mpv refused sub-speed=${speed}`, e);
  }
}

/** As each file starts: the timing kept for it, or none. */
export async function applySubDelay(path: string): Promise<number> {
  const ms = parseSubDelays(await getSetting(SUB_DELAY_KEY).catch(() => null))[path] ?? 0;
  const speed = parseSubSpeeds(await getSetting(SUB_SPEED_KEY).catch(() => null))[path] ?? 1;
  if (ms !== 0) console.log(`subtitles: ${describeSubDelay(ms).toLowerCase()}, kept for this file`);
  if (speed !== 1) console.log(`subtitles: speed ${speed.toFixed(5)}, kept for this file`);
  applied = { path, ms, speed };
  await setMpv(ms);
  await setMpvSpeed(speed);
  return ms;
}

/** Saves one after another, so the last press is the one kept. */
let saving: Promise<unknown> = Promise.resolve();

/**
 * From the player: a step (`delta` in ms), or 0 with `reset`. The amount
 * moves on the press, before the save, so every repeat of a held key counts.
 */
export async function changeSubDelay(delta: number, reset = false): Promise<number> {
  const { ms, speed } = applied;
  const next = clamp(reset ? 0 : ms + delta);
  await setSubTiming(next, reset ? 1 : speed);
  return next;
}

/**
 * Both at once: a found timing, its Undo, or Reset. The speed is kept with
 * the same rules as the amount (newest last, 1 removing it).
 */
export async function setSubTiming(ms: number, speed: number): Promise<void> {
  const { path } = applied;
  const next = clamp(ms);
  const nextSpeed = validSpeed(speed) ? speed : 1;
  const speedChanged = nextSpeed !== applied.speed;
  applied = { path, ms: next, speed: nextSpeed };
  await setMpv(next);
  if (speedChanged) await setMpvSpeed(nextSpeed);
  if (path === null) return;
  const saved = saving.then(async () => {
    const delays = parseSubDelays(await getSetting(SUB_DELAY_KEY).catch(() => null));
    await setSetting(SUB_DELAY_KEY, JSON.stringify(withSubDelay(delays, path, next)));
    if (!speedChanged) return;
    const speeds = parseSubSpeeds(await getSetting(SUB_SPEED_KEY).catch(() => null));
    await setSetting(
      SUB_SPEED_KEY,
      JSON.stringify(withSubDelay(speeds, path, nextSpeed === 1 ? 0 : nextSpeed))
    );
  });
  saving = saved.catch(() => undefined);
  await saved;
}
