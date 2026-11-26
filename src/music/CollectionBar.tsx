import { useOutsideDismiss } from '../ui/useOutsideDismiss';
import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import FocusButton from '../ui/FocusButton';
import FocusInput from '../ui/FocusInput';
import FocusGroup from '../ui/FocusGroup';
import { addMusicCollection, addMusicRoot, MUSIC_LIBRARY_CHANGED, scanMusic, type MusicCollection } from './api';
import { useMusicLanguage } from './language';

interface Props {
  collections: MusicCollection[];
  value: number;
  onChange: (id: number) => void;
}

export default function CollectionBar({ collections, value, onChange }: Props) {
  const { t } = useMusicLanguage();
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  useOutsideDismiss(expanded, '.music-collections', () => setExpanded(false));
  const current = collections.find((item) => item.id === value);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const id = await addMusicCollection(name.trim());
      window.dispatchEvent(new Event(MUSIC_LIBRARY_CHANGED));
      onChange(id);
      setAdding(false);
      setName('');
      setStatus('');
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function addFolder() {
    if (busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const path = await open({ directory: true, multiple: false, title: t('collectionFolder') });
      if (typeof path !== 'string') return;
      await addMusicRoot(path, value);
      setStatus(t('scanning'));
      const report = await scanMusic();
      setStatus(t('scanned', { added: report.added, updated: report.updated, unchanged: report.unchanged }));
      if (report.errors.length) setError(report.errors.slice(0, 3).join(' · '));
    } catch (reason) {
      setError(String(reason));
    } finally {
      window.dispatchEvent(new Event(MUSIC_LIBRARY_CHANGED));
      setBusy(false);
    }
  }

  return <section className="music-collections" aria-label={t('collectionsLabel')}>
    <FocusGroup kind="row" className="music-collection-actions">
      <span>{t('collectionLabel')}</span>
      <FocusButton focusKey="music-collection-picker" expanded={expanded} controls="music-collection-options"
        disabled={busy} onSelect={() => setExpanded(!expanded)}>
        {current?.name ?? t('music')} ▾
      </FocusButton>
      <FocusButton disabled={busy} onSelect={() => { setAdding(!adding); setExpanded(false); }}>{t('addCollection')}</FocusButton>
      <FocusButton disabled={busy || !current} onSelect={() => void addFolder()}>{t('collectionAddMusic')}</FocusButton>
    </FocusGroup>
    {expanded && <FocusGroup kind="list" className="music-collection-options" role="listbox" aria-label={t('collectionsLabel')}>
      {collections.map((item) => <FocusButton key={item.id} pressed={value === item.id}
        onSelect={() => { onChange(item.id); setExpanded(false); setStatus(''); }}>{item.name}</FocusButton>)}
    </FocusGroup>}
    {adding && <FocusGroup kind="row" className="music-collection-actions">
      <label>{t('collectionName')}<FocusInput value={name} onChange={setName} onEnter={() => void create()} /></label>
      <FocusButton disabled={busy || !name.trim()} onSelect={() => void create()}>{t('collectionCreate')}</FocusButton>
      <FocusButton disabled={busy} onSelect={() => setAdding(false)}>{t('tagCancel')}</FocusButton>
    </FocusGroup>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert" className="music-error">{error}</p>}
  </section>;
}
