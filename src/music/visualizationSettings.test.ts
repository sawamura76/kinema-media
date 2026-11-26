import { describe, expect, it } from 'vitest';
import { normalizeVisualizations } from './visualizationSettings';
import { presets } from './butterchurnPresets';

describe('saved visualizer rotation lists', () => {
  it('recovers usable lists from empty or obsolete preferences', () => {
    const settings = normalizeVisualizations({ artModes: [], spectrumModes: ['obsolete'], presetNames: ['deleted preset'] });
    expect(settings.artModes).toContain('plain');
    expect(settings.spectrumModes).toContain('radial');
    expect(settings.presetNames).toContain(presets[0].name);
  });
  it('retains a single selected preset and independent static/rotation choices', () => {
    const name = presets[3].name;
    const settings = normalizeVisualizations({ presetNames: [name, name], artRotate: false, spectrumRotate: true, rotate: false, spectrumSeconds: 15, spectrumSensitivity: 2 });
    expect(settings.presetNames).toEqual([name]);
    expect(settings).toMatchObject({ artRotate: false, spectrumRotate: true, rotate: false, spectrumSeconds: 15, spectrumSensitivity: 2 });
  });
  it('keeps corrupted sensitivity and timing within safe bounds', () => {
    const settings = normalizeVisualizations({ spectrumSensitivity: Infinity, butterchurnSensitivity: -12, spectrumSeconds: NaN });
    expect(settings.spectrumSensitivity).toBe(1);
    expect(settings.butterchurnSensitivity).toBe(.25);
    expect(settings.spectrumSeconds).toBe(30);
  });
});
