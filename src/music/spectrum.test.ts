import { describe, expect, it } from 'vitest';
import { spectrum, spectrumBands } from './spectrumAnalysis';

describe('spectrum analysis', () => {
  it('keeps unsigned PCM silence at zero', () => {
    const silence = Array<number>(1024).fill(128);
    expect(Math.max(...spectrumBands(spectrum(silence, silence), 64))).toBe(0);
  });
  it('places a known tone in its frequency band, with calibrated amplitude', () => {
    const bin = 24;
    const tone = Array.from({ length: 1024 }, (_, i) => 128 + 64 * Math.sin(2 * Math.PI * bin * i / 1024));
    const bins = spectrum(tone, tone);
    expect(bins.indexOf(Math.max(...bins))).toBe(bin);
    expect(bins[bin]).toBeCloseTo(.5, 2);
    const bands = spectrumBands(bins, 64), index = bands.indexOf(Math.max(...bands));
    const frequency = bin * 44100 / 1024;
    expect(Math.abs(index - Math.log(frequency / 40) / Math.log(18000 / 40) * 64)).toBeLessThan(2);
    expect(bands[index]).toBeGreaterThan(.9);
    const inverted = tone.map((v) => 256 - v);
    expect(spectrum(tone, inverted)[bin]).toBeCloseTo(.5, 2);
  });
});

