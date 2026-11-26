import { useSyncExternalStore } from 'react';
import { presets } from './butterchurnPresets';

export const ART_MODES = ['plain', 'blurred'] as const;
export const SPECTRUM_MODES = ['radial', 'led', 'spectrum'] as const;

export type VisualizerQuality = 'battery' | 'balanced' | 'high';
export interface VisualizationSettings {
  mediaSources: { id: string; name: string; kind: 'images' | 'video'; path: string }[];
  mediaSource: string;
  slideshowSeconds: number; presetSeconds: number; imageFadeSeconds: number;
  presetBlendSeconds: number; controlsSeconds: number; quality: VisualizerQuality;
  rotate: boolean; background: 'plain' | 'blurred' | 'butterchurn' | 'radial' | 'led' | 'spectrum';
  artistArt: boolean; showDetails: boolean; imageFit: 'fill' | 'fit';
  artRotate: boolean; spectrumRotate: boolean; spectrumSeconds: number;
  artModes: string[]; spectrumModes: string[]; presetNames: string[];
  butterchurnSensitivity: number; spectrumSensitivity: number;
}
export const DEFAULT_VISUALIZATIONS: VisualizationSettings = {
  mediaSources: [], mediaSource: 'collection',
  slideshowSeconds: 15, presetSeconds: 30, imageFadeSeconds: 2, presetBlendSeconds: 2,
  controlsSeconds: 10, quality: 'balanced', rotate: true, background: 'blurred',
  artistArt: true, showDetails: true, imageFit: 'fill',
  artRotate: true, spectrumRotate: false, spectrumSeconds: 30,
  artModes: [...ART_MODES], spectrumModes: [...SPECTRUM_MODES], presetNames: presets.map((p) => p.name),
  butterchurnSensitivity: 1, spectrumSensitivity: 1,
};
export const VISUALIZER_QUALITY = {
  battery: { width: 640, height: 360, fps: 24, meshWidth: 24, meshHeight: 18 },
  balanced: { width: 960, height: 540, fps: 30, meshWidth: 32, meshHeight: 24 },
  high: { width: 1280, height: 720, fps: 60, meshWidth: 48, meshHeight: 36 },
};
export function normalizeVisualizations(input: Partial<VisualizationSettings>): VisualizationSettings {
  const value = { ...DEFAULT_VISUALIZATIONS, ...input };
  const number = (n: number, fallback: number, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  value.mediaSources = Array.isArray(value.mediaSources) ? value.mediaSources.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.path === 'string' && ['images', 'video'].includes(item.kind)).slice(0, 100) : [];
  if (!['collection', 'artist', 'album', ...value.mediaSources.map((item) => item.id)].includes(value.mediaSource)) value.mediaSource = 'collection';
  value.slideshowSeconds = number(value.slideshowSeconds, 15, 5, 300);
  value.presetSeconds = number(value.presetSeconds, 30, 10, 300);
  value.imageFadeSeconds = number(value.imageFadeSeconds, 2, 0, Math.min(5, value.slideshowSeconds / 2));
  value.presetBlendSeconds = number(value.presetBlendSeconds, 2, 0, Math.min(10, value.presetSeconds / 2));
  value.controlsSeconds = number(value.controlsSeconds, 10, 0, 60);
  value.spectrumSeconds = number(value.spectrumSeconds, 30, 5, 300);
  value.butterchurnSensitivity = number(value.butterchurnSensitivity, 1, .25, 3);
  value.spectrumSensitivity = number(value.spectrumSensitivity, 1, .25, 3);
  const selection = (list: unknown, allowed: readonly string[]) => {
    const selected = Array.isArray(list) ? allowed.filter((name) => list.includes(name)) : [];
    return selected.length ? selected : [...allowed];
  };
  value.artModes = selection(value.artModes, ART_MODES);
  value.spectrumModes = selection(value.spectrumModes, SPECTRUM_MODES);
  value.presetNames = selection(value.presetNames, presets.map((p) => p.name));
  if (!['battery', 'balanced', 'high'].includes(value.quality)) value.quality = 'balanced';
  if (!['plain', 'blurred', 'butterchurn', 'radial', 'led', 'spectrum'].includes(value.background)) value.background = 'blurred';
  if (!['fill', 'fit'].includes(value.imageFit)) value.imageFit = 'fill';
  for (const key of ['rotate', 'artistArt', 'showDetails', 'artRotate', 'spectrumRotate'] as const) if (typeof value[key] !== 'boolean') value[key] = DEFAULT_VISUALIZATIONS[key];
  return value;
}
const KEY = 'kinema.media.visualizations';
const listeners = new Set<() => void>();
let previous: string | undefined;
let cached = DEFAULT_VISUALIZATIONS;
function snapshot() {
  try {
    const raw = localStorage.getItem(KEY);
    const legacy = [localStorage.getItem('kinema.music.rotatePresets'), localStorage.getItem('kinema.music.background'), localStorage.getItem('kinema.music.artistBackground')];
    const signature = JSON.stringify([raw, legacy]);
    if (signature !== previous) {
      previous = signature;
      let input = {};
      try { input = raw ? JSON.parse(raw) : {}; } catch { /* Retain defaults for damaged settings. */ }
      cached = normalizeVisualizations({ rotate: legacy[0] !== 'off', background: legacy[1] as VisualizationSettings['background'] || 'blurred', artistArt: legacy[2] !== 'off', ...input });
    }
  } catch { return DEFAULT_VISUALIZATIONS; }
  return cached;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener); };
}
export function setVisualizationSettings(change: Partial<VisualizationSettings>) {
  const settings = normalizeVisualizations({ ...snapshot(), ...change });
  localStorage.setItem(KEY, JSON.stringify(settings));
  localStorage.setItem('kinema.music.rotatePresets', settings.rotate ? 'on' : 'off');
  localStorage.setItem('kinema.music.background', settings.background);
  localStorage.setItem('kinema.music.artistBackground', settings.artistArt ? 'on' : 'off');
  previous = undefined;
  listeners.forEach((listener) => listener());
}
export function useVisualizationSettings() { return useSyncExternalStore(subscribe, snapshot); }
