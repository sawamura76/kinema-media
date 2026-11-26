import { useSyncExternalStore } from 'react';
const KEY = 'kinema.media.mouseNavigation';
const listeners = new Set<() => void>();
function snapshot() { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } }
function subscribe(listener: () => void) {
  listeners.add(listener); window.addEventListener('storage', listener);
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener); };
}
export function setMouseNavigation(enabled: boolean) {
  localStorage.setItem(KEY, enabled ? 'on' : 'off'); listeners.forEach((listener) => listener());
}
export function useMouseNavigationEnabled() { return useSyncExternalStore(subscribe, snapshot); }
