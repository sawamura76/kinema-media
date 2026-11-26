/** Manual device layout presets; legacy TV shortcuts and fullscreen behavior remain supported. */
import { useSyncExternalStore } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { capabilitiesNow, loadCapabilities } from '../capabilities';
import { getSetting, setSetting } from '../metadata/api';

export const TV_MODE_KEY = 'tv_mode';
export const UI_MODE_KEY = 'ui_mode';
export type UiMode = 'pc' | 'tv' | 'handheld';
let mode: UiMode = 'pc';
export const HANDHELD_SCALE_KEY = 'handheld_scale';
const listeners = new Set<() => void>();
function apply() {
  document.documentElement.dataset.tv = mode === 'tv' ? 'on' : 'off';
  document.documentElement.dataset.uiMode = mode;
  document.documentElement.style.setProperty('--handheld-scale', '1');
}
async function fillScreen(on: boolean) {
  try { const win = getCurrentWindow(); if ((await win.isFullscreen()) !== on) await win.setFullscreen(on); }
  catch (error) { console.warn('layout: could not change fullscreen', error); }
}
export function alwaysTv() { return capabilitiesNow()?.windowed === false; }
function emit() { listeners.forEach((listener) => listener()); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export async function loadTvMode() {
  const [legacy, stored, scale] = await Promise.all([
    getSetting(TV_MODE_KEY).catch(() => null), getSetting(UI_MODE_KEY).catch(() => null), getSetting(HANDHELD_SCALE_KEY).catch(() => null), loadCapabilities(),
  ]);
  mode = alwaysTv() ? 'tv' : stored === 'handheld' || stored === 'tv' || stored === 'pc' ? stored : legacy === 'on' ? 'tv' : 'pc';
  if (scale !== '100') await setSetting(HANDHELD_SCALE_KEY, '100').catch((error) => console.warn('layout: could not reset scale', error));
  apply(); emit();
  if (mode !== 'pc' && !alwaysTv()) await fillScreen(true);
}
export function setUiMode(next: UiMode) {
  if (alwaysTv() || !['pc','tv','handheld'].includes(next)) return;
  const fullscreen = mode !== 'pc';
  mode = next; apply(); emit();
  if ((mode !== 'pc') !== fullscreen) void fillScreen(mode !== 'pc');
  // Keep older builds' TV flag consistent; the three-way setting is authoritative here.
  void Promise.all([setSetting(UI_MODE_KEY, mode), setSetting(TV_MODE_KEY, mode === 'tv' ? 'on' : 'off')]).catch((error) => console.warn('layout: could not save setting', error));
}
export function setTvMode(on: boolean) { setUiMode(on ? 'tv' : 'pc'); }
/** TV and handheld modes keep the shell fullscreen after leaving a video. */
export function isTvMode() { return mode !== 'pc'; }
export function uiModeNow() { return mode; }
export function useTvMode() { return useSyncExternalStore(subscribe, () => mode === 'tv'); }
export function useUiMode() { return useSyncExternalStore(subscribe, () => mode); }

