import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import FocusButton from '../ui/FocusButton';
import FocusGroup from '../ui/FocusGroup';
import FocusSelect from '../ui/FocusSelect';
import { MUSIC_LIBRARY_CHANGED, saveCollectionPreferences, type MusicCollection, type CollectionBackground } from './api';

export default function CollectionBackgroundSettings({ collection }: { collection: MusicCollection }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function choose(kind: CollectionBackground) {
    setBusy(true);
    setError('');
    try {
      let path = '';
      if (kind === 'images' || kind === 'video') {
        const result = await open(kind === 'images'
          ? { directory: true, title: 'Choose slideshow images' }
          : { title: 'Choose background video', filters: [{ name: 'Background video', extensions: ['mp4', 'm4v', 'webm'] }] });
        if (typeof result !== 'string') return;
        path = result;
      }
      await saveCollectionPreferences({ ...collection, background_kind: kind, background_path: path });
      window.dispatchEvent(new Event(MUSIC_LIBRARY_CHANGED));
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  return <section className="collection-background-settings">
    <h3>{collection.name} background</h3>
    <FocusGroup kind="row" className="settings-row">
      <FocusSelect label={'Background for ' + collection.name} value={collection.background_kind ?? 'artist'}
        choices={[{ value: 'artist', label: 'Artist artwork' }, { value: 'album', label: 'Album cover' },
          { value: 'images', label: 'Image folder' }, { value: 'video', label: 'Looping video' }]}
        disabled={busy} onChange={(kind) => void choose(kind as CollectionBackground)} />
      <FocusButton disabled={busy} onSelect={() => void choose('images')}>Choose image folder</FocusButton>
      <FocusButton disabled={busy} onSelect={() => void choose('video')}>Choose video</FocusButton>
    </FocusGroup>
    {collection.background_path && <p className="muted collection-background-path">{collection.background_path}</p>}
    <p className="settings-hint">The background follows tracks from this collection in full-screen music. Videos loop muted. MP4 with H.264 video works with Windows WebView2. Slideshow timing is in Visualizations.</p>
    {error && <p role="alert" className="music-error">{error}</p>}
  </section>;
}
