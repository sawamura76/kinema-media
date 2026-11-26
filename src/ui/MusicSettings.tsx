import { useCallback, useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { addMusicRoot, getMusicLibrary, moveMusicRoot, removeMusicRoot, scanMusic, MUSIC_LIBRARY_CHANGED, saveCollectionPreferences, type MusicSort, type MusicRoot, type MusicCollection } from '../music/api';
import { albumArtStatus, cancelAlbumArt, findAlbumArt, findArtistArt, type AlbumArtProgress } from '../music/api';
import { listen } from '@tauri-apps/api/event';
import { useMusicLanguage } from '../music/language';
import FocusButton from './FocusButton';
import FocusGroup from './FocusGroup';
import ConfirmButton from './ConfirmButton';
import CollectionBar from '../music/CollectionBar';
import CollectionBackgroundSettings from '../music/CollectionBackgroundSettings';
import { saveCollectionSort, useCollectionSort } from '../music/collectionSort';
import { MUSIC_SORTS } from '../music/sorting';
import FocusSelect from './FocusSelect';
import { setMusicCollection, useMusicCollection } from '../music/collectionSelection';

/** Shares the Settings location, while keeping audio out of the video matcher. */
export default function MusicFolderSettings() {
  const [roots, setRoots] = useState<MusicRoot[]>([]);
  const storedCollectionId = useMusicCollection();
  const [collections, setCollections] = useState<MusicCollection[]>([{ id: 1, name: 'Music' }]);
  const collectionId = collections.some((item) => item.id === storedCollectionId) ? storedCollectionId : 1;
  const allMusicSort = useCollectionSort(0, 'artist');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [art, setArt] = useState<AlbumArtProgress | null>(null);
  useEffect(() => {
    let alive=true, off: (()=>void) | undefined;
    void listen<AlbumArtProgress>('music-album-art-progress',(event)=>{ if(alive)setArt(event.payload); }).then((fn)=>{if(alive)off=fn;else fn();}).then(()=>albumArtStatus()).then((value)=>{if(alive)setArt(value);}).catch(console.warn);
    return ()=>{alive=false;off?.();};
  },[]);
  const refresh = useCallback(async () => {
    const library = await getMusicLibrary();
    setRoots(library.roots);
    setCollections(library.collections ?? [{ id: 1, name: 'Music' }]);
  }, []);
  useEffect(() => {
    const changed = () => { void refresh().catch((reason) => setError(String(reason))); };
    window.addEventListener(MUSIC_LIBRARY_CHANGED, changed);
    return () => window.removeEventListener(MUSIC_LIBRARY_CHANGED, changed);
  }, [refresh]);
  useEffect(() => {
    let alive = true;
    void getMusicLibrary().then((data) => { if (alive) { setRoots(data.roots); setCollections(data.collections ?? [{ id: 1, name: "Music" }]); } }).catch((e) => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, []);
  const scan = async (add = false) => {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      if (add) {
        const folder = await open({ directory: true, multiple: false, title: 'Choose your music folder' });
        if (typeof folder !== 'string') return;
        await addMusicRoot(folder, collectionId); await refresh();
      }
      setMessage('Reading music tags and artwork…');
      const report = await scanMusic(); await refresh();
      setMessage(`${report.added} added · ${report.updated} updated · ${report.unchanged} unchanged${report.missing ? ` · ${report.missing} missing` : ''}`);
      if (report.errors.length) setError(report.errors.slice(0, 3).join(' · '));
    } catch (e) { setError(String(e)); setMessage(''); } finally { setBusy(false); }
  };
  return <section className="settings-section music-folder-settings">
    <h2>Music folders</h2>
    <CollectionBar collections={collections} value={collectionId} onChange={setMusicCollection} />
    <FocusGroup kind="row" className="settings-row">
      <label>Default sort for {collections.find((item) => item.id === collectionId)?.name}
        <FocusSelect label="Default collection sorting" disabled={busy}
          value={collections.find((item) => item.id === collectionId)?.default_sort ?? 'artist'} choices={MUSIC_SORTS}
          onChange={(value) => {
            const collection = collections.find((item) => item.id === collectionId);
            if (!collection) return;
            setBusy(true); setError('');
            void saveCollectionPreferences({ ...collection, default_sort: value as MusicSort })
              .then(refresh).then(() => window.dispatchEvent(new Event(MUSIC_LIBRARY_CHANGED)))
              .catch((reason) => setError(String(reason))).finally(() => setBusy(false));
          }} />
      </label>
      <label>Default sort for All music
        <FocusSelect label="Default All music sorting" value={allMusicSort} choices={MUSIC_SORTS}
          onChange={(value) => saveCollectionSort(0, value as MusicSort)} />
      </label>
    </FocusGroup>
    {collections.find((item) => item.id === collectionId) && <CollectionBackgroundSettings
      collection={collections.find((item) => item.id === collectionId)!} />}
    <p className="settings-intro">Choose where your music lives. Adding a folder scans its tags and artwork. Use Scan music now after adding or changing audio files. Removing a folder leaves your audio files untouched.</p>
    {!roots.length && <p className="muted">No music folders yet.</p>}
    <ul className="settings-roots">{roots.map((root) => <li key={root.id}>
      <span className="root-kind">Music</span><span className="root-path">{root.path}</span>
      <label>Collection
        <select aria-label={'Collection for ' + root.path} disabled={busy} value={root.collection_id ?? 1}
          onChange={(event) => {
            const id = Number(event.target.value);
            setBusy(true);
            void moveMusicRoot(root.id, id).then(refresh).then(() => {
              window.dispatchEvent(new Event(MUSIC_LIBRARY_CHANGED));
            }).catch((reason) => setError(String(reason))).finally(() => setBusy(false));
          }}>
          {collections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <ConfirmButton className="settings-remove" disabled={busy} confirmLabel="Remove music folder" onConfirm={() => { void removeMusicRoot(root.id).then(refresh).catch((e) => setError(String(e))); }}>Remove</ConfirmButton>
    </li>)}</ul>
    <FocusGroup kind="row" className="settings-row">
      <FocusButton className="btn-secondary" disabled={busy} onSelect={() => void scan(true)}>Add music folder</FocusButton>
      <FocusButton className="btn-secondary" disabled={busy || !roots.length} onSelect={() => void scan()}>Scan music now</FocusButton>
    </FocusGroup>
    <h3>Missing album artwork</h3>
    <p className="settings-intro">Find missing covers using album artist and title. Existing artwork stays in place. Clear matches from TheAudioDB or MusicBrainz / Cover Art Archive are cached locally; your audio files are never changed. Artist and album names are sent to those services. Uncertain matches are left blank.</p>
    <FocusGroup kind="row" className="settings-row">
      <FocusButton className="btn-secondary" disabled={busy || !!art?.running || !roots.length} onSelect={() => {
        setError(''); setArt({ kind:'albums',images:0,running:true,total:0,checked:0,found:0,unmatched:0,errors:0,cancelled:false,current:'',last_error:null });
        void findAlbumArt().then((value)=>{setArt(value);if(!value.total)setMessage('No missing covers with usable album artist/title tags were found.');}).catch((e)=>{setError(String(e));void albumArtStatus().then(setArt);});
      }}>Find missing album art</FocusButton>
      <FocusButton className="btn-secondary" disabled={busy || !!art?.running || !roots.length} onSelect={()=>{
        setError('');setArt({kind:'artists',images:0,running:true,total:0,checked:0,found:0,unmatched:0,errors:0,cancelled:false,current:'',last_error:null});
        void findArtistArt().then((value)=>{setArt(value);if(!value.total)setMessage('No tagged album artists were found.');}).catch((e)=>{setError(String(e));void albumArtStatus().then(setArt);});
      }}>Download artist slideshow art</FocusButton>
      {art?.running && <FocusButton className="btn-secondary" onSelect={()=>{void cancelAlbumArt().catch((e)=>setError(String(e)));}}>Cancel artwork search</FocusButton>}
    </FocusGroup>
    <p className="muted">Artist slideshow downloads refresh every album artist's available TheAudioDB fanart, wide photo and portrait (up to six images per artist). Use Visualizer → Art → Artist background and Rotate for the slideshow. Cancel stops after the current request.</p>
    {art && (art.running || art.checked>0 || art.cancelled || art.errors>0) && <p role="status" className="album-art-progress">{art.running ? `Checking ${art.checked} / ${art.total}${art.current ? ` · ${art.current}` : ''}` : art.cancelled ? 'Search cancelled' : 'Artwork search complete'} · {art.found} {art.kind==='artists' ? `artists refreshed · ${art.images} images available` : 'albums updated'} · {art.unmatched} unmatched{art.errors ? ` · ${art.errors} errors` : ''}</p>}
    {art?.last_error && <p className="muted">Last lookup error: {art.last_error}</p>}
    {message && <p role="status" className="settings-progress">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function MusicLanguageSettings() {
  const { language, toggle } = useMusicLanguage();
  return <section className="settings-section"><h2>Music interface language</h2>
    <FocusGroup kind="row" className="settings-row"><FocusButton className="btn-secondary" onSelect={toggle} label="Music language / 音楽の表示言語">{language === 'ja' ? '日本語 / English' : 'English / 日本語'}</FocusButton></FocusGroup>
  </section>;
}
