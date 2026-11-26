import { beforeEach, describe, expect, it, vi } from 'vitest';

const settings = new Map<string, string>();
vi.mock('../metadata/api', () => ({
  getSetting: async (key: string) => settings.get(key) ?? null,
  setSetting: async (key: string, value: string) => void settings.set(key, value),
}));

import {
  clampVolume,
  levelOnBar,
  NORMAL_REST_MS,
  persistVolume,
  stepVolume,
  savedVolume,
  VOLUME_MAX,
  VOLUME_NORMAL,
  volumeBar,
  wheelVolumeSteps,
} from './volume';

describe('clampVolume', () => {
  it('keeps every level of the control, 0 to 200', () => {
    for (const level of [0, 50, 100, 150, 200]) expect(clampVolume(level)).toBe(level);
    expect(VOLUME_MAX).toBe(200);
    expect(VOLUME_NORMAL).toBe(100);
  });

  it('holds below 0 and above 200 at the ends', () => {
    expect(clampVolume(-5)).toBe(0);
    expect(clampVolume(-1000)).toBe(0);
    expect(clampVolume(205)).toBe(200);
    expect(clampVolume(1000)).toBe(200);
  });

  it('keeps to 5% steps', () => {
    expect(clampVolume(102)).toBe(100);
    expect(clampVolume(148)).toBe(150);
    expect(clampVolume(197.5)).toBe(200);
  });

  it('stops at a lower top where there is no boost (Media3)', () => {
    expect(clampVolume(150, 100)).toBe(100);
    expect(clampVolume(95, 100)).toBe(95);
  });
});

describe('the remembered level', () => {
  beforeEach(() => settings.clear());

  it('comes back as it was saved, boosted or not', async () => {
    for (const level of [0, 50, 100, 150, 200]) {
      await persistVolume(level);
      expect(await savedVolume()).toBe(level);
    }
  });

  it('reads a level saved before the boost unchanged', async () => {
    settings.set('volume', '80');
    expect(await savedVolume()).toBe(80);
  });

  it('is full when nothing, or nothing sensible, was saved', async () => {
    expect(await savedVolume()).toBe(100);
    settings.set('volume', 'loud');
    expect(await savedVolume()).toBe(100);
  });

  it('brings an out-of-range or boosted level down to the top it has', async () => {
    settings.set('volume', '350');
    expect(await savedVolume()).toBe(200);
    settings.set('volume', '-20');
    expect(await savedVolume()).toBe(0);
    settings.set('volume', '150');
    expect(await savedVolume(100)).toBe(100);
  });
});

describe('volumeBar', () => {
  it('draws a share of 200, so 200% fills the bar and no more', () => {
    expect(volumeBar(0, 200)).toEqual({ normal: 0, boost: 0, mark: 50 });
    expect(volumeBar(50, 200)).toEqual({ normal: 25, boost: 0, mark: 50 });
    expect(volumeBar(100, 200)).toEqual({ normal: 50, boost: 0, mark: 50 });
    expect(volumeBar(150, 200)).toEqual({ normal: 50, boost: 25, mark: 50 });
    expect(volumeBar(200, 200)).toEqual({ normal: 50, boost: 50, mark: 50 });
    expect(volumeBar(400, 200)).toEqual({ normal: 50, boost: 50, mark: 50 });
  });

  it('has no boost and no mark where the top is 100', () => {
    expect(volumeBar(100, 100)).toEqual({ normal: 100, boost: 0, mark: null });
    expect(volumeBar(40, 100)).toEqual({ normal: 40, boost: 0, mark: null });
  });
});

describe('levelOnBar', () => {
  it('maps the pointer height to 0–200', () => {
    expect(levelOnBar(0, 200)).toBe(0);
    expect(levelOnBar(0.25, 200)).toBe(50);
    expect(levelOnBar(0.5, 200)).toBe(100);
    expect(levelOnBar(0.75, 200)).toBe(150);
  });

  it('lands on 100% from just either side of it, where a boost is possible', () => {
    expect(levelOnBar(0.47, 200)).toBe(100);
    expect(levelOnBar(0.53, 200)).toBe(100);
    expect(levelOnBar(0.44, 200)).toBe(90);
    expect(levelOnBar(0.56, 200)).toBe(110);
    // With 100 as the top there is nothing to snap to.
    expect(levelOnBar(0.95, 100)).toBe(95);
    expect(levelOnBar(1, 200)).toBe(200);
  });

  it('holds a drag past either end of the bar', () => {
    expect(levelOnBar(-0.3, 200)).toBe(0);
    expect(levelOnBar(1.4, 200)).toBe(200);
    expect(levelOnBar(1.4, 100)).toBe(100);
  });
});

describe('stepVolume: a rest at 100%', () => {
  const later = NORMAL_REST_MS + 1;

  it('a step that would cross 100% lands on it, either way', () => {
    expect(stepVolume(95, 5, 200, later)).toBe(100);
    expect(stepVolume(90, 15, 200, later)).toBe(100);
    expect(stepVolume(110, -15, 200, later)).toBe(100);
  });

  it('steps that keep coming stay at 100%; after a pause they go on', () => {
    expect(stepVolume(100, 5, 200, 50)).toBe(100);
    expect(stepVolume(100, -5, 200, 50)).toBe(100);
    expect(stepVolume(100, 5, 200, later)).toBe(105);
    expect(stepVolume(100, -5, 200, later)).toBe(95);
  });

  it('elsewhere a step is a step, and without a boost there is no rest', () => {
    expect(stepVolume(120, 5, 200, 10)).toBe(125);
    expect(stepVolume(40, -5, 200, 10)).toBe(35);
    expect(stepVolume(100, 5, 100, later)).toBe(100);
    expect(stepVolume(95, 5, 100, 10)).toBe(100);
  });
});

describe('wheelVolumeSteps', () => {
  it('takes one step per mouse notch, up louder', () => {
    expect(wheelVolumeSteps(0, -100, 0)).toEqual({ steps: 1, carried: 0 });
    expect(wheelVolumeSteps(0, 100, 0)).toEqual({ steps: -1, carried: 0 });
    expect(wheelVolumeSteps(0, -300, 0)).toEqual({ steps: 3, carried: 0 });
  });

  it('adds up a touchpad before stepping', () => {
    let carried = 0;
    let steps = 0;
    for (let i = 0; i < 9; i++) ({ steps, carried } = wheelVolumeSteps(carried, -10, 0));
    expect(steps).toBe(0);
    ({ steps, carried } = wheelVolumeSteps(carried, -10, 0));
    expect(steps).toBe(1);
    expect(carried).toBeCloseTo(0);
  });

  it('turns lines and pages into pixels', () => {
    expect(wheelVolumeSteps(0, -3, 1).steps).toBe(0);
    expect(wheelVolumeSteps(-1, -3, 1).steps).toBe(1);
    expect(wheelVolumeSteps(0, 1, 2).steps).toBe(-8);
  });
});
