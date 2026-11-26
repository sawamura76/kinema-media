import CollectionLayout from '../ui/CollectionLayout';
import LibraryIcon from '../ui/LibraryIcon';
import { returnFocusTo } from '../ui/focus';
import { browseGames, gameCollections, type GameSort, type Shortcut } from './model';
import { useEffect, useMemo, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import FocusButton from '../ui/FocusButton';
import FocusInput from '../ui/FocusInput';
import FocusSelect from '../ui/FocusSelect';
import FocusGroup, { FocusProvider } from '../ui/FocusGroup';
import ConfirmButton from '../ui/ConfirmButton';
import TileGrid from '../ui/TileGrid';
import { useFocusGroup } from '../ui/focusGroups';
import { useLanding } from '../ui/focusStore';
import { previewMusicCover } from '../music/api';
import BoxArtCropper from './BoxArtCropper';
import './games.css';

const blank: Shortcut = { id: null, title: '', target: '', arguments: [], working_directory: '', artwork: null, platform: '', kind: 'game' };

export default function GamesPage() {
  const [games, setGames] = useState<Shortcut[]>([]);
  const [editor, setEditor] = useState<Shortcut | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [collectionKey, setCollectionKey] = useState(() => localStorage.getItem('kinema.games.collection') ?? 'all');
  const [sort, setSort] = useState<GameSort>(() => { const value=localStorage.getItem('kinema.games.sort'); return value==='za'||value==='platform' ? value : 'az'; });
  const [dense, setDense] = useState(() => localStorage.getItem('kinema.games.compact')==='yes');
  const [search, setSearch] = useState(''), [searchOpen, setSearchOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const [error, setError] = useState('');
  const [launching, setLaunching] = useState<number | null>(null);
  const refresh = () => invoke<Shortcut[]>('game_shortcuts').then(setGames);
  useEffect(() => {
    let alive=true;
    void invoke<Shortcut[]>('game_shortcuts').then((items)=>{if(alive)setGames(items);}).catch((reason)=>{if(alive)setError(String(reason));});
    return ()=>{alive=false;};
  },[]);
  const collections=useMemo(()=>gameCollections(games),[games]);
  const collection=collections.find((item)=>item.key===collectionKey) ?? collections[0];
  const shown=useMemo(()=>browseGames(games,collection.key,search,sort),[games,collection.key,search,sort]);
  const current=shown.find((game)=>game.id===selected) ?? shown[0];
  const managed=games.find((game)=>game.id===selected) ?? games[0];
  useLanding(managing || editor ? null : games.length ? 'games-results' : 'games-empty-manage');
  function manage() { if(current?.id!==undefined)setSelected(current.id); setManaging(true); }
  function closeManager() {
    setManaging(false);
    returnFocusTo(document.querySelector('.collection-sidebar') ? 'library-manage-games' : 'library-collections-toggle-games');
  }
  async function launch(game: Shortcut) {
    if(game.id===null||launching!==null)return;
    setSelected(game.id);setLaunching(game.id);setError('');
    try { await invoke('game_launch',{id:game.id}); }
    catch(reason){setError(String(reason));}finally{setLaunching(null);}
  }
  return <>
    <CollectionLayout scope="games" items={collections} selected={collection.id} mainFocus="games-results" onManage={manage} onSelect={(id)=>{
      const next=collections.find((item)=>item.id===id);if(!next)return;
      setCollectionKey(next.key);localStorage.setItem('kinema.games.collection',next.key);setSearch('');setSearchOpen(false);
    }}>{(toggle)=><main className={'games-page sidebar-games'+(dense?' games-dense':'')}>
      <FocusGroup kind="row" className="library-toolbar">
        {toggle}
        <div className="library-title"><h1>{collection.key==='all' ? 'Games & apps' : collection.name}</h1><span className="muted">{shown.length} {shown.length===1?'shortcut':'shortcuts'}</span></div>
        <label className="library-sort-label">Sort <FocusSelect label="Sort games and apps by" value={sort} choices={[{value:'az',label:'A–Z'},{value:'za',label:'Z–A'},{value:'platform',label:'Platform'}]} onChange={(value)=>{setSort(value as GameSort);localStorage.setItem('kinema.games.sort',value);}} /></label>
        <FocusButton className="library-icon-button" label={dense?'Use large game covers':'Use compact game covers'} pressed={dense} onSelect={()=>{setDense(!dense);localStorage.setItem('kinema.games.compact',dense?'no':'yes');}}><LibraryIcon name="grid" /></FocusButton>
        <FocusButton className="library-icon-button" label="Search games and apps" expanded={searchOpen} onSelect={()=>{
          setSearchOpen(!searchOpen);if(searchOpen)setSearch('');else requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('.games-library-search input')?.focus());
        }}><LibraryIcon name={searchOpen?'close':'search'} /></FocusButton>
      </FocusGroup>
      {searchOpen&&<label className="library-search games-library-search">Search<FocusInput type="search" value={search} onChange={setSearch} placeholder="Game, app, or platform" /></label>}
      {error&&<p className="music-error" role="alert">{error}</p>}
      {!games.length&&<section className="games-empty"><h2>Your games and apps, together</h2><p>Add shortcuts and cover art in Manage games & apps. Platform labels such as Steam, Emulators, or Utilities become sidebar groups.</p><FocusButton focusKey="games-empty-manage" className="btn-secondary" onSelect={manage}>Manage games & apps</FocusButton></section>}
      {!!games.length&&!shown.length&&<p className="muted">No shortcuts match this collection or search.</p>}
      <TileGrid className="games-grid" focusKey="games-results" count={shown.length}>
        {shown.map((game)=><FocusButton key={game.id} focusKey={'game:'+game.id} className={'game-tile kind-'+game.kind+(current?.id===game.id?' selected':'')} disabled={launching!==null} label={'Launch '+game.title} onHighlight={()=>setSelected(game.id)} onSelect={()=>void launch(game)}>
          <div className="game-cover">{game.artwork?<img src={convertFileSrc(game.artwork)} alt="" loading="lazy" />:<span aria-hidden="true">{game.title.slice(0,2).toUpperCase()}</span>}</div>
          <strong>{game.title}</strong><span>{game.platform||(game.kind==='app'?'App':'PC')}</span>
        </FocusButton>)}
      </TileGrid>
      {launching!==null&&<p role="status">Launching…</p>}
    </main>}</CollectionLayout>
    {managing&&!editor&&<GamesManager games={games} current={managed} onSelect={setSelected} onClose={closeManager}
      onAdd={()=>setEditor({...blank,kind:collection.key==='apps'?'app':'game',platform:collection.platform??''})}
      onEdit={(game)=>setEditor({...game,arguments:[...game.arguments]})}
      onRemove={async(game)=>{await invoke('game_remove',{id:game.id});await refresh();}} />}
    {editor&&<GameEditor value={editor} onClose={()=>setEditor(null)} onSaved={(id)=>{setSelected(id);setEditor(null);void refresh().catch((reason)=>setError(String(reason)));}} />}
  </>;
}

function GamesManager({games,current,onSelect,onAdd,onEdit,onRemove,onClose}:{games:Shortcut[];current:Shortcut|undefined;onSelect:(id:number)=>void;onAdd:()=>void;onEdit:(game:Shortcut)=>void;onRemove:(game:Shortcut)=>Promise<void>;onClose:()=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const {ref,focusKey}=useFocusGroup('menu',{current:games.length?'games-manager-selection':'games-manager-add'});
  useLanding(games.length?'games-manager-selection':'games-manager-add');
  useEffect(()=>{
    const back=(event:KeyboardEvent)=>{if(['Escape','Backspace','BrowserBack'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();if(!busy)onClose();}};
    window.addEventListener('keydown',back,true);return()=>window.removeEventListener('keydown',back,true);
  },[busy,onClose]);
  return <FocusProvider value={focusKey}><div className="leave-backdrop" onPointerDown={(event)=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
    <section className="leave game-editor games-manager" ref={ref} role="dialog" aria-modal="true" aria-label="Manage games & apps">
      <h2>Manage games & apps</h2><p className="muted">Add launch shortcuts and artwork here. Platform labels create sidebar groups automatically.</p>
      <FocusButton focusKey="games-manager-add" className="btn-primary" disabled={busy} onSelect={onAdd}>Add game or app</FocusButton>
      {!!games.length&&<label className="game-manager-choice">Shortcut<FocusSelect focusKey="games-manager-selection" label="Shortcut to manage" value={String(current?.id??'')} disabled={busy} choices={[...games].sort((a,b)=>a.title.localeCompare(b.title)).map((game)=>({value:String(game.id),label:game.title}))} onChange={(id)=>onSelect(Number(id))} /></label>}
      {current&&<FocusGroup kind="row" className="games-actions">
        <FocusButton className="btn-secondary" disabled={busy} onSelect={()=>onEdit(current)}>Edit selected</FocusButton>
        <ConfirmButton key={current.id} className="btn-secondary" disabled={busy} confirmLabel={'Remove '+current.title} onConfirm={()=>{
          setBusy(true);setError('');void onRemove(current).catch((reason)=>setError(String(reason))).finally(()=>setBusy(false));
        }}>Remove selected</ConfirmButton>
      </FocusGroup>}
      <p className="settings-hint">Removing a shortcut keeps your installed game or app files.</p>
      {error&&<p className="music-error" role="alert">{error}</p>}
      <FocusGroup kind="row" className="games-actions game-editor-actions"><FocusButton className="btn-secondary" disabled={busy} onSelect={onClose}>Done</FocusButton></FocusGroup>
    </section>
  </div></FocusProvider>;
}

function GameEditor({ value, onClose, onSaved }: { value: Shortcut; onClose: () => void; onSaved: (id: number) => void }) {
  const [draft, setDraft] = useState(value);
  const [cropping, setCropping] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { ref, focusKey } = useFocusGroup('menu', { current: 'game-title' });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (cropping) return;
      if (event.key === 'Escape' || event.key === 'BrowserBack') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!busy) onClose();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [busy, onClose, cropping]);
  async function choose(kind: 'target' | 'artwork' | 'working_directory') {
    setError('');
    setBusy(true);
    try {
      const path = await open(kind === 'working_directory' ? { directory: true, title: 'Working directory' }
        : kind === 'target' ? { title: 'Choose game or app', filters: [{ name: 'Applications and shortcuts', extensions: ['exe', 'lnk', 'url'] }] }
        : { title: 'Choose cover artwork', filters: [{ name: 'Cover images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
      if (typeof path !== 'string') return;
      if (kind === 'artwork') {
        const image = await previewMusicCover(path);
        setCropping(image);
      } else {
        setDraft((before) => ({ ...before, [kind]: path, title: before.title || (kind === 'target' ? path.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || '' : '') }));
      }
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  async function save() {
    setError('');
    setBusy(true);
    try { const id=await invoke<number>('game_save', { shortcut: draft }); onSaved(id); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  if (cropping) return <BoxArtCropper path={cropping} onCancel={()=>{setCropping(null);returnFocusTo("game-choose-art");}} onUse={(artwork)=>{setDraft((before)=>({...before,artwork}));setCropping(null);returnFocusTo("game-choose-art");}}/>;
  return <FocusProvider value={focusKey}><div className="leave-backdrop">
    <div className="leave game-editor" ref={ref} role="dialog" aria-modal="true" aria-label="Game or app shortcut">
      <h2>{draft.id === null ? 'Add game or app' : 'Edit shortcut'}</h2>
      <FocusGroup kind="list" className="game-fields">
        <label>Title<FocusInput focusKey="game-title" value={draft.title} onChange={(title) => setDraft({ ...draft, title })} /></label>
        <label>Type<FocusSelect label="Shortcut type" value={draft.kind} choices={[{ value: 'game', label: 'Game' }, { value: 'app', label: 'App' }]}
          onChange={(kind) => setDraft({ ...draft, kind: kind as Shortcut['kind'] })} /></label>
        <label>Platform or launcher<FocusInput value={draft.platform} onChange={(platform) => setDraft({ ...draft, platform })} placeholder="PC, Steam, Emulators, Utilities…" /></label>
        <p className="settings-hint">Use the same platform or launcher label to group shortcuts together in the sidebar.</p>
        <label>Executable, shortcut, or launch link<FocusInput value={draft.target} onChange={(target) => setDraft({ ...draft, target })} placeholder="C:\Games\Game.exe or steam://rungameid/…" /></label>
        <FocusGroup kind="row" className="games-actions">
          <FocusButton disabled={busy} onSelect={() => void choose('target')}>Choose executable or shortcut</FocusButton>
          <FocusButton focusKey="game-choose-art" disabled={busy} onSelect={() => void choose('artwork')}>Choose cover art</FocusButton>
        </FocusGroup>
        {draft.artwork && <img className="game-editor-cover" src={convertFileSrc(draft.artwork)} alt="Cover preview" />}
        {draft.artwork && <FocusButton onSelect={() => setDraft({ ...draft, artwork: null })}>Remove artwork</FocusButton>}
        {draft.arguments.map((argument, index) => <FocusGroup kind="row" className="game-argument" key={index}>
          <label>Argument {index + 1}<FocusInput value={argument} onChange={(changed) => setDraft({ ...draft, arguments: draft.arguments.map((item, i) => i === index ? changed : item) })} /></label>
          <FocusButton onSelect={() => setDraft({ ...draft, arguments: draft.arguments.filter((_, i) => i !== index) })}>Remove argument</FocusButton>
        </FocusGroup>)}
        <FocusButton disabled={busy} onSelect={() => setDraft({ ...draft, arguments: [...draft.arguments, ''] })}>Add launch argument</FocusButton>
        <label>Working directory (optional)<FocusInput value={draft.working_directory} onChange={(working_directory) => setDraft({ ...draft, working_directory })} /></label>
        <FocusButton disabled={busy} onSelect={() => void choose('working_directory')}>Choose working directory</FocusButton>
      </FocusGroup>
      {error && <p role="alert" className="music-error">{error}</p>}
      <FocusGroup kind="row" className="games-actions game-editor-actions">
        <FocusButton disabled={busy} onSelect={onClose}>Cancel</FocusButton>
        <FocusButton disabled={busy || !draft.title.trim() || !draft.target.trim()} onSelect={() => void save()}>Save</FocusButton>
      </FocusGroup>
    </div>
  </div></FocusProvider>;
}
