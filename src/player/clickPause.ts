/**
 * A click on the picture pauses, but only after a short wait to see whether a
 * second click follows: a double click is full screen and must not pause
 * (GitHub #24; mpv and VLC do the same). Each click schedules the pause; the
 * second click of a double click, or leaving the player, cancels it.
 */

/** How long a single click waits for a second one. */
export const DOUBLE_CLICK_WAIT_MS = 250;

export interface ClickPause {
  /** A click on the picture; `count` is the click's `detail` (1, then 2). */
  click(count: number): void;
  /** What a single click does; the latest one is used when the wait ends. */
  setAction(pause: () => void): void;
  /** Drop a pending pause (double click, or the player closing). */
  cancel(): void;
}

export function createClickPause(
  initial: () => void = () => {},
  wait = DOUBLE_CLICK_WAIT_MS
): ClickPause {
  let pause = initial;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    setAction(fn) {
      pause = fn;
    },
    click(count) {
      cancel();
      if (count >= 2) return;
      timer = setTimeout(() => {
        timer = null;
        pause();
      }, wait);
    },
    cancel,
  };
}
