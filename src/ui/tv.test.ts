import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ settings: new Map<string,string>(), fullscreen: false, fixed: false }));
vi.mock('../metadata/api', () => ({ getSetting: vi.fn(async (key: string) => state.settings.get(key) ?? null), setSetting: vi.fn(async (key: string, value: string) => { state.settings.set(key,value); }) }));
vi.mock('../capabilities', () => ({ capabilitiesNow: () => ({ windowed: !state.fixed }), loadCapabilities: async () => ({ windowed: !state.fixed }) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ isFullscreen: async () => state.fullscreen, setFullscreen: async (on: boolean) => { state.fullscreen = on; } }) }));
import { isTvMode, loadTvMode, setUiMode, uiModeNow } from './tv';
beforeEach(() => { state.settings.clear(); state.fullscreen=false; state.fixed=false; vi.stubGlobal('document',{ documentElement: { dataset: {} } }); });
describe('device layout modes', () => {
  it('keeps existing TV settings and restores the saved handheld preset', async () => {
    state.settings.set('tv_mode','on'); await loadTvMode(); expect(uiModeNow()).toBe('tv'); expect(state.fullscreen).toBe(true);
    state.settings.set('ui_mode','handheld'); await loadTvMode(); expect(uiModeNow()).toBe('handheld'); expect(document.documentElement.dataset.uiMode).toBe('handheld');
  });
  it('saves a handheld layout, keeps video exits fullscreen, and can return to PC', async () => {
    await loadTvMode(); setUiMode('handheld');
    expect(state.settings.get('ui_mode')).toBe('handheld'); expect(isTvMode()).toBe(true);
    expect(document.documentElement.dataset.tv).toBe('off');
    await vi.waitFor(() => expect(state.fullscreen).toBe(true));
    setUiMode('pc'); await vi.waitFor(() => expect(state.fullscreen).toBe(false)); expect(isTvMode()).toBe(false);
  });
  it('retains the TV-only policy on devices without a desktop window', async () => {
    state.fixed=true; await loadTvMode(); setUiMode('handheld'); expect(uiModeNow()).toBe('tv');
  });
});
