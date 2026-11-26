import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import FocusButton from '../ui/FocusButton';
import FocusSelect from '../ui/FocusSelect';
import FocusGroup from '../ui/FocusGroup';
import { setVisualizationSettings, useVisualizationSettings } from './visualizationSettings';

export function BackgroundSourceSelect() {
  const settings = useVisualizationSettings();
  return <label className="settings-row">Slideshow source <FocusSelect label="Slideshow source" value={settings.mediaSource}
    choices={[{ value: 'collection', label: 'Collection default' }, { value: 'artist', label: 'Artist artwork' }, { value: 'album', label: 'Album cover' }, ...settings.mediaSources.map((item) => ({ value: item.id, label: item.name }))]}
    onChange={(mediaSource) => setVisualizationSettings({ mediaSource })} /></label>;
}

export default function BackgroundSources() {
  const settings = useVisualizationSettings();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function add(kind: 'images' | 'video') {
    setBusy(true); setError('');
    try {
      const path = await open(kind === 'images' ? { directory: true, title: 'Add slideshow image folder' } : { title: 'Add background video', filters: [{ name: 'Background video', extensions: ['mp4', 'm4v', 'webm'] }] });
      if (typeof path !== 'string') return;
      await invoke('visualization_media', { kind, path });
      const existing = settings.mediaSources.find((item) => item.path === path && item.kind === kind);
      const id = existing?.id ?? crypto.randomUUID();
      const name = path.replace(/\\/g, '/').split('/').filter(Boolean).slice(-1)[0] ?? path;
      setVisualizationSettings({ mediaSources: existing ? settings.mediaSources : [...settings.mediaSources, { id, name, kind, path }], mediaSource: id, background: 'plain' });
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  return <section className="collection-background-settings">
    <h3>Slideshow folders and videos</h3>
    <p className="settings-hint">Save image folders or muted looping videos here, then choose them in the full-screen Visualizer panel under Art. Collection default uses the playing track’s collection background.</p>
    <FocusGroup kind="row" className="settings-row">
      <FocusButton disabled={busy} onSelect={() => void add('images')}>Add slideshow folder</FocusButton>
      <FocusButton disabled={busy} onSelect={() => void add('video')}>Add background video</FocusButton>
    </FocusGroup>
    {settings.mediaSources.map((item) => <FocusGroup kind="row" className="settings-row" key={item.id}>
      <span title={item.path}>{item.name} · {item.kind === 'images' ? 'Images' : 'Video'}</span>
      <FocusButton label={'Remove background ' + item.name} onSelect={() => setVisualizationSettings({ mediaSources: settings.mediaSources.filter((source) => source.id !== item.id), mediaSource: settings.mediaSource === item.id ? 'collection' : settings.mediaSource })}>Remove</FocusButton>
    </FocusGroup>)}
    <BackgroundSourceSelect />
    {error && <p role="alert" className="music-error">{error}</p>}
  </section>;
}

