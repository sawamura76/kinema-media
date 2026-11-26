import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import FocusButton from './FocusButton';
import FocusInput from './FocusInput';
import FocusSelect from './FocusSelect';
import FocusGroup from './FocusGroup';
import { addLibraryRoot, type LibraryRoot } from '../library/api';
import { runScanPipeline } from '../library/pipeline';
import { addVideoCollection, assignVideoRoot, VIDEO_COLLECTIONS_CHANGED, type VideoCollections, type VideoKind } from '../library/videoCollections';

export default function VideoCollectionBar({ kind, library, value, onChange }: { kind: VideoKind; library: VideoCollections | null; value: number; onChange: (id: number) => void }) {
  const [adding, setAdding] = useState(false), [name, setName] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const items = library?.collections.filter((item) => item.kind === kind) ?? [{ id: kind === 'movies' ? 1 : 2, name: kind === 'movies' ? 'Movies' : 'TV shows', kind }];
  async function create() {
    setBusy(true); setError('');
    try { const id = await addVideoCollection(name, kind); onChange(id); setAdding(false); setName(''); }
    catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  }
  async function folder() {
    setBusy(true); setError(''); setStatus('');
    try {
      const path = await open({ directory: true, title: kind === 'movies' ? 'Add movies to collection' : 'Add TV to collection' });
      if (typeof path !== 'string') return;
      const root = await addLibraryRoot(path, kind);
      await assignVideoRoot(root, value || (kind === 'movies' ? 1 : 2));
      setStatus('Scanning library…');
      const outcome = await runScanPipeline();
      if (outcome.status === 'failed') throw new Error(outcome.error);
      if (outcome.status === 'done' && outcome.summary.errors.length) setError(outcome.summary.errors.slice(0, 3).join(' · '));
      window.dispatchEvent(new Event(VIDEO_COLLECTIONS_CHANGED));
      setStatus(outcome.status === 'skipped' ? 'Folder added. A scan is already running; use Scan now in Settings if the new folder does not appear.' : 'Scan finished.');
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  }
  return <section className="video-collection-bar" aria-label={kind === 'movies' ? 'Movie collections' : 'TV collections'}>
    <FocusGroup kind="row" className="video-collection-actions">
      <label>Collection <FocusSelect focusKey={'settings-' + kind + '-collections'} label={kind === 'movies' ? 'Movie collection' : 'TV collection'} value={String(value)} disabled={busy}
        choices={[{ value: '0', label: 'All collections' }, ...items.map((item) => ({ value: String(item.id), label: item.name }))]} onChange={(id) => onChange(Number(id))} /></label>
      <FocusButton className="btn-secondary" disabled={busy} onSelect={() => setAdding(!adding)}>Add collection</FocusButton>
      <FocusButton className="btn-secondary" disabled={busy || value === 0} onSelect={() => void folder()}>Add folder</FocusButton>
    </FocusGroup>
    {adding && <FocusGroup kind="row" className="video-collection-actions"><label>Collection name <FocusInput value={name} onChange={setName} onEnter={() => { if (name.trim() && !busy) void create(); }} /></label>
      <FocusButton className="btn-primary" disabled={busy || !name.trim()} onSelect={() => void create()}>Create collection</FocusButton><FocusButton className="btn-secondary" disabled={busy} onSelect={() => setAdding(false)}>Cancel</FocusButton></FocusGroup>}
    {status && <p role="status">{status}</p>}{error && <p role="alert" className="settings-error">{error}</p>}
  </section>;
}

export function VideoRootCollection({ root, library }: { root: LibraryRoot; library: VideoCollections | null }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  if (root.kind === 'videos' || !library) return null;
  const value = library.roots.find((item) => item.root_id === root.id)?.collection_id ?? (root.kind === 'movies' ? 1 : 2);
  return <label className="video-root-collection">Collection <FocusSelect label={'Collection for ' + root.path} value={String(value)} disabled={busy}
    choices={library.collections.filter((item) => item.kind === root.kind).map((item) => ({ value: String(item.id), label: item.name }))}
    onChange={(id) => { setBusy(true); setError(''); void assignVideoRoot(root.id, Number(id)).catch((reason) => setError(String(reason))).finally(() => setBusy(false)); }} />
    {error && <span role="alert" className="settings-error">{error}</span>}
  </label>;
}
