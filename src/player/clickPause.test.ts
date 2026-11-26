import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClickPause } from './clickPause';

describe('clickPause', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pauses once, after the wait, for a single click', () => {
    const pause = vi.fn();
    const c = createClickPause(pause, 250);
    c.click(1);
    vi.advanceTimersByTime(249);
    expect(pause).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('never pauses for a double click', () => {
    const pause = vi.fn();
    const c = createClickPause(pause, 250);
    c.click(1);
    vi.advanceTimersByTime(100);
    c.click(2);
    vi.advanceTimersByTime(1000);
    expect(pause).not.toHaveBeenCalled();
  });

  it('drops a pending pause when cancelled (player closes)', () => {
    const pause = vi.fn();
    const c = createClickPause(pause, 250);
    c.click(1);
    c.cancel();
    vi.advanceTimersByTime(1000);
    expect(pause).not.toHaveBeenCalled();
  });
});
