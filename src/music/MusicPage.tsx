import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useArtistArt } from './artistArt';
import FocusButton from '../ui/FocusButton';
import FocusGroup from '../ui/FocusGroup';
import TileGrid from '../ui/TileGrid';
import { useLanding } from '../ui/focusStore';
import { focusTo, returnFocusTo } from '../ui/focus';
import { stopGlide } from '../ui/focusScroll';
import { getMusicLibrary, saveCollectionPreferences, MUSIC_LIBRARY_CHANGED, type MusicLibrary, type MusicTrack, type MusicSort } from './api';
import { albumsOf, clock, folderMp3s, isMp3, type Album } from './model';
import type { MusicPlayer } from './useMusicPlayer';
import Cover from './Cover';
import MusicTagEditor, { type TagEditorMode } from './MusicTagEditor';
import { musicSearchText, useMusicLanguage } from './language';
import CollectionLayout from '../ui/CollectionLayout';
import LibraryIcon from '../ui/LibraryIcon';
import FocusInput from '../ui/FocusInput';
import { MUSIC_SORTS, sortTracks, sortAlbums, groupAlbums } from './sorting';
import { setMusicCollection, useMusicCollection } from './collectionSelection';
import { saveCollectionSort, useCollectionSort } from './collectionSort';
import './music.css';

type Tab = 'Artists' | 'Albums' | 'Songs' | 'Queue';
export default function MusicPage({ player, initialTab = 'Artists', onManage }: { player: MusicPlayer; initialTab?: Tab; onManage: () => void }) {
  const { language, t } = useMusicLanguage();
  const [library, setLibrary] = useState<MusicLibrary>({ roots: [], tracks: [] });
  const collectionId = useMusicCollection();
  const collections = useMemo(() => library.collections ?? [{ id: 1, name: 'Music' }], [library.collections]);
  const selectedCollection = collectionId === 0 || collections.some((item) => item.id === collectionId) ? collectionId : 1;
  const sort = useCollectionSort(selectedCollection, collections.find((item) => item.id === selectedCollection)?.default_sort ?? 'artist');
  const [tab, setTab] = useState<Tab>(initialTab);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [album, setAlbum] = useState<Album | null>(null);
  const [tagEditor, setTagEditor] = useState<TagEditorMode | null>(null);
  const [tagNotice, setTagNotice] = useState('');
  const [savedTrackId, setSavedTrackId] = useState<number | null>(null);
  const [artist, setArtist] = useState<string | null>(null);
  const detailArrival=useRef(false);
  useLayoutEffect(()=>{
    if(!detailArrival.current)return;
    detailArrival.current=false;
    const page=document.querySelector('.music-detail-page')?.closest<HTMLElement>('.browse');
    if(page){stopGlide(page);page.scrollTop=0;}
    focusTo(album ? 'music-album-play' : 'music-detail-back');
  },[artist,album]);
  const local = useRef({ current: { tab, album, artist }, past: [] as { tab: Tab; album: Album | null; artist: string | null }[], future: [] as { tab: Tab; album: Album | null; artist: string | null }[] });
  useEffect(() => { local.current.current = { tab, album, artist }; }, [tab, album, artist]);
  const visit = (next: { tab: Tab; album: Album | null; artist: string | null }) => {
    if (tab === next.tab && album?.key === next.album?.key && artist === next.artist) return;
    setSavedTrackId(null);
    setTagNotice('');
    local.current.past.push({ tab, album, artist }); local.current.future = [];
    if(next.album || next.artist) {detailArrival.current=true;returnFocusTo(next.album ? 'music-album-play' : 'music-detail-back',0);}
    setTab(next.tab); setAlbum(next.album); setArtist(next.artist);
    window.dispatchEvent(new Event('kinema-local-navigation'));
  };
  const back = useCallback(() => {
    const current=local.current.current;
    if(!current.album && !current.artist)return;
    returnFocusTo(current.album ? `music:album:${current.album.key}` : `music:artist:${current.artist}`);
    const next={tab:current.album ? current.tab : 'Artists' as Tab,album:null,artist:current.album ? current.artist : null};
    local.current.past.push(current);local.current.future=[];
    setSavedTrackId(null);
    setTagNotice('');
    setTab(next.tab);setAlbum(null);setArtist(next.artist);
    window.dispatchEvent(new Event('kinema-local-navigation'));
  },[]);
  useEffect(()=>{
    if(!album && !artist)return;
    const key=(event:KeyboardEvent)=>{
      if(!['Escape','Backspace','BrowserBack'].includes(event.key) || document.querySelector('.floating-player,[role="dialog"]'))return;
      event.preventDefault();event.stopImmediatePropagation();back();
    };
    window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
  },[album,artist,back]);
  useEffect(() => {
    const move = (event: Event) => {
      const direction = (event as CustomEvent<string>).detail;
      const history = local.current;
      const source = direction === 'back' ? history.past : history.future;
      if (document.querySelector('.music-tag-editor')) {
        event.preventDefault();
        return;
      }
      const next = source.pop(); if (!next) return;
      event.preventDefault();
      (direction === 'back' ? history.future : history.past).push(history.current);
      setSavedTrackId(null);
      setTagNotice('');
      setTab(next.tab); setAlbum(next.album); setArtist(next.artist);
    };
    window.addEventListener('kinema-mouse-navigation', move);
    return () => window.removeEventListener('kinema-mouse-navigation', move);
  }, []);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const chooseCollection = (id: number) => {
    setMusicCollection(id);
    setTab('Artists');
    setAlbum(null);
    setArtist(null);
    setQuery('');
    setSavedTrackId(null);
    setTagNotice('');
    local.current.past = [];
    local.current.future = [];
  };

  useEffect(() => {
    let live = true, request = 0;
    const refresh = () => {
      const token = ++request;
      void getMusicLibrary().then((data) => { if (live && token === request) { setLibrary(data); setError(''); } }).catch((e) => { if (live && token === request) setError(String(e)); });
    };
    refresh();
    window.addEventListener(MUSIC_LIBRARY_CHANGED, refresh);
    return () => { live = false; window.removeEventListener(MUSIC_LIBRARY_CHANGED, refresh); };
  }, []);
  const available = useMemo(() => {
    const ids = selectedCollection !== 0 && library.collection_tracks
      ? new Set(library.collection_tracks.filter((item) => item.collection_id === selectedCollection).map((item) => item.track_id))
      : null;
    return library.tracks.filter((track) => !track.missing && (ids ? ids.has(track.id) : selectedCollection === 0 || selectedCollection === 1));
  }, [library.tracks, library.collection_tracks, selectedCollection]);
  useLanding(album ? 'music-album-play' : artist ? 'music-detail-back' : available.length || tab === 'Queue' ? 'music-results' : 'music:sort:artist');
  const filtered = useMemo(() => {
    const needle = musicSearchText(query.trim());
    return sortTracks(available.filter((track) => artist ? track.album_artist.normalize('NFC').toLowerCase()===artist.normalize('NFC').toLowerCase() : !needle || musicSearchText(`${track.title} ${track.artist} ${track.album} ${track.album_artist}`).includes(needle)), sort);
  }, [available, query, artist, sort]);
  const albums = useMemo(() => sortAlbums(albumsOf(filtered), sort), [filtered, sort]);
  const artists = useMemo(() => [...new Set(filtered.map((t) => t.album_artist))], [filtered]);
  const allAlbums = useMemo(() => albumsOf(available), [available]);
  const shownAlbum = album ? (
    allAlbums.find((item) => savedTrackId !== null && item.tracks.some((track) => track.id === savedTrackId))
      ?? allAlbums.find((item) => item.key === album.key) ?? album
  ) : null;
  const songs = shownAlbum?.tracks ?? filtered;
  const view: Tab = tab === 'Queue' ? 'Queue' : sort === 'artist' ? 'Artists' : sort === 'title' ? 'Songs' : 'Albums';
  const albumGroups = groupAlbums(albums, sort, language === 'ja');
  const artistName = shownAlbum?.artist || artist || null;
  const { art } = useArtistArt(artistName);
  const albumsByArtist = useMemo(() => {
    const result = new Map<string, Album[]>();
    for (const item of allAlbums) {
      const key = item.artist.normalize('NFC').toLocaleLowerCase();
      const group = result.get(key) ?? []; group.push(item); result.set(key,group);
    }
    return result;
  }, [allAlbums]);
  const firstTrackByArtist = useMemo(() => {
    const result = new Map<string, MusicTrack>();
    for (const item of filtered) if (!result.has(item.album_artist)) result.set(item.album_artist,item);
    return result;
  }, [filtered]);
  const sidebarItems = useMemo(() => [{ id: 0, name: language === 'ja' ? 'すべての音楽' : 'All music', count: library.tracks.filter((track) => !track.missing).length }, ...collections.map((collection) => {
    const ids = library.collection_tracks ? new Set(library.collection_tracks.filter((item) => item.collection_id === collection.id).map((item) => item.track_id)) : null;
    return { id: collection.id, name: collection.name, count: library.tracks.filter((track) => !track.missing && (ids ? ids.has(track.id) : collection.id === 1)).length };
  })], [library.tracks, library.collection_tracks, collections, language]);

  const albumTiles=(items: Album[],detail=false) => <TileGrid className="music-album-grid" count={items.length}>{items.map((a)=><FocusButton key={a.key} focusKey={`music:album:${a.key}`} className="music-album-tile" label={`${a.title} ${a.artist}`} onSelect={()=>visit({tab,album:a,artist})}><div className="music-album-art"><Cover key={a.artwork} path={a.artwork} label={a.title}/></div><strong>{a.title}</strong><span>{detail ? t('albumTracks',{n:a.tracks.length}) : a.artist}</span></FocusButton>)}</TileGrid>;
  if(shownAlbum) {
    const mp3s = shownAlbum.tracks.filter(isMp3);
    const folderTracks = tagEditor ? folderMp3s(mp3s, available) : [];
    const years=[...new Set(shownAlbum.tracks.map((track)=>track.year).filter((year):year is number=>year!==null && year>0))];
    const genres=[...new Set(shownAlbum.tracks.map((track)=>track.genre).filter(Boolean))];
    const total=Math.floor(shownAlbum.tracks.reduce((sum,track)=>sum+Math.max(0,track.duration),0));
    const metadata=[years.length===1 ? String(years[0]) : null,genres.slice(0,2).join(' / '),t('albumTracks',{n:shownAlbum.tracks.length}),t('albumDuration',{minutes:Math.floor(total/60),seconds:total%60})].filter(Boolean);
    return <main className="music-page music-detail-page music-album-detail" lang={language}>
      <DetailBackdrop path={shownAlbum.artwork}/>
      <FocusGroup kind="row"><FocusButton focusKey="music-detail-back" className="music-detail-back" onSelect={back}>{t('back')}</FocusButton></FocusGroup>
      {error && <p role="alert" className="music-error">{error}</p>}
      <section className="music-detail-hero music-album-heading">
        <div className="music-detail-image music-album-art"><Cover key={shownAlbum.artwork} path={shownAlbum.artwork} label={shownAlbum.title}/></div>
        <div className="music-detail-info"><h1>{shownAlbum.title}</h1>
          <p className="music-detail-artist-name">{shownAlbum.artist}</p>
          <p className="music-detail-metadata">{metadata.map((value,index)=><span key={index}>{value}</span>)}</p>
          <PlayActions tracks={songs} player={player} playFocusKey="music-album-play"/>
          {mp3s.length > 0 && (
            <FocusGroup kind="row" className="music-actions music-tag-actions">
              <FocusButton onSelect={() => setTagEditor('auto')}>{t('tagMatch')}</FocusButton>
              <FocusButton onSelect={() => setTagEditor('manual')}>{t('tagManual')}</FocusButton>
              <FocusButton onSelect={() => setTagEditor('edit')}>{t('tagEdit')}</FocusButton>
            </FocusGroup>
          )}
          {tagNotice && <p role="status">{tagNotice}</p>}
        </div>
      </section>
      <section className="music-detail-tracks"><h2>{t('tracks')}</h2><SongList tracks={songs} player={player}/></section>
      {tagEditor && mp3s.length > 0 && (
        <MusicTagEditor
          tracks={mp3s}
          extraTracks={folderTracks}
          mode={tagEditor}
          onClose={() => setTagEditor(null)}
          onSaved={(id, warning) => {
            setSavedTrackId(id);
            setTagEditor(null);
            setTagNotice(warning ? t('tagSavedWarning', { warning }) : t('tagSaved'));
            window.dispatchEvent(new Event(MUSIC_LIBRARY_CHANGED));
          }}
        />
      )}
    </main>;
  }
  if(artist) {
    const image=art?.thumb || albums[0]?.artwork || null;
    const biography=language==='ja' ? art?.biography_ja || art?.biography_en : art?.biography_en;
    return <main className="music-page music-detail-page music-artist-detail" lang={language}>
      <DetailBackdrop path={art?.background || art?.thumb || albums[0]?.artwork || null}/>
      <FocusGroup kind="row"><FocusButton focusKey="music-detail-back" className="music-detail-back" onSelect={back}>{t('back')}</FocusButton></FocusGroup>
      {error && <p role="alert" className="music-error">{error}</p>}
      <section className="music-detail-hero">
        <div className="music-detail-image"><Cover key={image} path={image} label={artist}/></div>
        <div className="music-detail-info"><h1>{artist}</h1><Biography key={artist} text={biography}/>{art?.biography_url && biography===art.biography_en && <p className="music-bio-credit">Wikipedia · <a href={art.biography_url} target="_blank" rel="noreferrer">Source</a> · CC BY-SA</p>}</div>
      </section>
      <section className="music-detail-albums"><h2>{t('Albums')}</h2>{albumTiles(albums,true)}</section>
    </main>;
  }
  const hasRoots = library.roots.some((root) => selectedCollection === 0 || (root.collection_id ?? 1) === selectedCollection);
  const collectionName = collections.find((item) => item.id === selectedCollection)?.name;
  const selectedName = selectedCollection === 0 || selectedCollection === 1 && collectionName === 'Music' ? t('music') : collectionName ?? t('music');
  const summary = view === 'Artists' ? `${artists.length} ${t('Artists').toLowerCase()}` : view === 'Albums' ? `${albums.length} ${t('Albums').toLowerCase()}` : `${view === 'Queue' ? player.queue.length : filtered.length} ${t('Songs').toLowerCase()}`;
  const chooseSort = async (value: MusicSort) => {
    if (sorting) return;
    setSorting(true); setError('');
    try {
      if (selectedCollection === 0) saveCollectionSort(0, value);
      else {
        const collection = collections.find((item) => item.id === selectedCollection);
        if (!collection) return;
        await saveCollectionPreferences({ ...collection, default_sort: value });
        setLibrary((current) => ({ ...current, collections: current.collections?.map((item) => item.id === selectedCollection ? { ...item, default_sort: value } : item) }));
        window.dispatchEvent(new Event(MUSIC_LIBRARY_CHANGED));
      }
      setTab('Artists');
    } catch (reason) { setError(String(reason)); }
    finally { setSorting(false); }
  };
  const artistTiles = (names: string[]) => <TileGrid className="music-artist-list music-album-grid" count={names.length}>{names.map((name) => {
    const artistAlbums = albumsByArtist.get(name.normalize('NFC').toLocaleLowerCase()) ?? [];
    return <FocusButton key={name} focusKey={`music:artist:${name}`} className="music-album-tile" onSelect={() => visit({ tab, album: null, artist: name })}><div className="music-album-art"><Cover path={artistAlbums[0]?.artwork ?? null} label={name} /></div><strong>{name}</strong><span>{t('artistAlbums', { n: artistAlbums.length })}</span></FocusButton>;
  })}</TileGrid>;
  const artistGroups = groupMusicItems(artists, sort, (name) => firstTrackByArtist.get(name), language === 'ja');
  const songGroups = groupMusicItems(filtered, sort, (track) => track, language === 'ja');
  return <CollectionLayout scope="music" items={sidebarItems} selected={selectedCollection} onSelect={chooseCollection} onManage={onManage} mainFocus="music-results">{(toggle) => <main className="music-page sidebar-music" lang={language}>
    <FocusGroup kind="row" className="library-toolbar">
      {toggle}
      <div className="library-title"><h1>{view === 'Queue' ? t('Queue') : selectedName}</h1><span className="muted">{summary}</span></div>
      <FocusGroup kind="row" className="library-view-tabs" aria-label={language === 'ja' ? '音楽の表示' : 'Browse music by'} current={'music:sort:' + sort}>
        {MUSIC_SORTS.map((item) => <FocusButton key={item.value} focusKey={'music:sort:' + item.value} disabled={sorting} pressed={view !== 'Queue' && sort === item.value} className={view !== 'Queue' && sort === item.value ? 'active' : ''} onSelect={() => void chooseSort(item.value)}>{language === 'ja' ? item.ja : item.label}</FocusButton>)}
      </FocusGroup>
      <FocusButton focusKey="music:tab:Queue" className="library-queue" pressed={view === 'Queue'} onSelect={() => visit({ tab: view === 'Queue' ? 'Artists' : 'Queue', album: null, artist: null })}><LibraryIcon name="queue" /> {t('Queue')} ({player.queue.length})</FocusButton>
      <FocusButton className="library-icon-button" label={t('search')} expanded={searchOpen} onSelect={() => {
        setSearchOpen(!searchOpen);
        if (searchOpen) setQuery('');
        else requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.sidebar-music .library-search input')?.focus());
      }}><LibraryIcon name={searchOpen ? 'close' : 'search'} /></FocusButton>
    </FocusGroup>
    {(searchOpen || query) && view !== 'Queue' && <label className="library-search music-search">{t('search')}<FocusInput type="search" value={query} placeholder={t('searchHint')} onChange={setQuery} /></label>}
    {error && <p role="alert" className="music-error">{error}</p>}
    {!hasRoots && view !== 'Queue' && <section className="music-empty"><h2>{t('emptyTitle')}</h2><p>{t('empty')}</p></section>}
    <FocusGroup kind="list" focusKey="music-results" focusable={view === 'Queue' || filtered.length > 0} className="library-results">
      {view === 'Queue' ? <section><FocusGroup kind="row" className="music-actions"><FocusButton onSelect={player.shuffleQueue}>{t('shuffleQueue')}</FocusButton><FocusButton onSelect={player.cycleRepeat}>{t('repeat')}: {t(player.repeat)}</FocusButton></FocusGroup>{!player.queue.length && <p>{t('emptyQueue')}</p>}<SongList tracks={player.queue} player={player} queue /></section>
        : view === 'Songs' ? <section><PlayActions tracks={filtered} player={player} />{songGroups.map((group) => <section className="music-library-group" key={group.label + group.start}>{group.label && <h2>{group.label}</h2>}<SongList tracks={group.items} player={player} playbackTracks={filtered} startIndex={group.start} /></section>)}</section>
        : view === 'Artists' ? <>{artistGroups.map((group) => <section className="music-library-group" key={group.label + group.start}>{group.label && <h2>{group.label}</h2>}{artistTiles(group.items)}</section>)}</>
        : <section>{albumGroups.map((group) => <section className="music-library-group" key={group.label || 'all'}>{group.label && <h2>{group.label}</h2>}{albumTiles(group.albums)}</section>)}</section>}
      {hasRoots && !available.length && <p>{t('noSongs')}</p>}
    </FocusGroup>
  </main>}</CollectionLayout>;

}

function DetailBackdrop({path}:{path:string|null}) {
  return <div className="music-detail-backdrop music-artist-backdrop" aria-hidden="true">{path && <img src={convertFileSrc(path)} alt=""/>}<div className="music-detail-scrim"/></div>;
}
function Biography({text}:{text?:string|null}) {
  const {t}=useMusicLanguage();const [expanded,setExpanded]=useState(false);
  if(!text)return <p className="music-detail-bio music-bio-empty">{t('biographyUnavailable')}</p>;
  const long=text.length>550;
  const shown=long && !expanded ? text.slice(0,550).replace(/\s+\S*$/,'')+'…' : text;
  return <><p className="music-detail-bio">{shown}</p>{long && <FocusButton className="music-bio-more" onSelect={()=>setExpanded(!expanded)}>{t(expanded ? 'readLess':'readMore')}</FocusButton>}</>;
}

function PlayActions({ tracks, player, playFocusKey }: { tracks: MusicTrack[]; player: MusicPlayer; playFocusKey?: string }) {
  const { t } = useMusicLanguage();
  return <FocusGroup kind="row" className="music-actions"><FocusButton focusKey={playFocusKey} disabled={!tracks.length} onSelect={() => player.play(tracks)}>▶ {t('play')}</FocusButton><FocusButton disabled={!tracks.length} onSelect={() => player.play(tracks, 0, true)}>{t('shuffle')}</FocusButton><FocusButton disabled={!tracks.length} onSelect={() => player.add(tracks)}>{t('addQueue')}</FocusButton></FocusGroup>;
}
function SongList({ tracks, player, queue = false, playbackTracks, startIndex = 0 }: { tracks: MusicTrack[]; player: MusicPlayer; queue?: boolean; playbackTracks?: MusicTrack[]; startIndex?: number }) {
  const { t } = useMusicLanguage();
  return <FocusGroup kind="list" className="music-song-list">{tracks.map((track, index) => <FocusGroup kind="row" key={`${track.id}:${index}`} className={`music-song ${player.active && player.track?.id === track.id ? 'playing' : ''}`}>
    <FocusButton focusKey={`music:${queue ? 'queue' : 'song'}:${track.id}:${index}`} className="music-song-main" onSelect={() => queue ? player.jump(index) : player.play(playbackTracks ?? tracks, startIndex + index)}><span className="music-song-number">{queue ? index + 1 : track.track || startIndex + index + 1}</span><span className="music-song-label"><strong>{track.title}</strong><small>{track.artist} · {track.album}</small></span><span>{clock(track.duration)}</span></FocusButton>
    <FocusButton label={t(queue ? 'removeSong' : 'addSong', { title: track.title })} onSelect={() => queue ? player.remove(index) : player.add([track])}>{t(queue ? 'remove' : 'addQueue')}</FocusButton>
  </FocusGroup>)}</FocusGroup>;
}


function groupMusicItems<T>(items: T[], sort: MusicSort, trackOf: (item: T) => MusicTrack | undefined, japanese: boolean) {
  if (sort !== 'year' && sort !== 'genre') return [{ label: '', items, start: 0 }];
  const groups: { label: string; items: T[]; start: number }[] = [];
  items.forEach((item, index) => {
    const track = trackOf(item);
    const label = sort === 'year' ? track?.year ? String(track.year) : japanese ? '年不明' : 'Unknown year' : track?.genre.trim() || (japanese ? 'ジャンル不明' : 'Unknown genre');
    const previous = groups[groups.length - 1];
    if (previous?.label.toLowerCase() === label.toLowerCase()) previous.items.push(item); else groups.push({ label, items: [item], start: index });
  });
  return groups;
}
