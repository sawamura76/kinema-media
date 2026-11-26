import { useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import FocusButton from '../ui/FocusButton';
import FocusGroup, { FocusProvider } from '../ui/FocusGroup';
import { useFocusGroup } from '../ui/focusGroups';
import FocusInput from '../ui/FocusInput';
import { matchMusicAlbum, previewMusicCover, saveMusicTags, searchMusicReleases, getMusicReleaseMatch, type MatchDraft, type ReleasePreview, type MusicReleaseChoice, type MusicTrack, type TagPatch } from './api';
import { useMusicLanguage } from './language';

const sharedFields = ['album', 'album_artist', 'artist', 'year', 'genre', 'disc'] as const;
const trackFields = ['title', 'artist', 'track', 'disc'] as const;
type Field = Exclude<keyof TagPatch, 'id'>;
type Values = Record<Field, string>;

function valuesOf(track: MusicTrack): Values {
  return {
    album: track.album === 'Unknown album' ? '' : track.album,
    album_artist: track.album_artist === 'Unknown artist' ? '' : track.album_artist,
    artist: track.artist === 'Unknown artist' ? '' : track.artist,
    title: track.title,
    genre: track.genre,
    year: track.year?.toString() ?? '',
    track: track.track ? String(track.track) : '',
    disc: String(track.disc),
  };
}

export type TagEditorMode = 'auto' | 'manual' | 'edit';

interface Props {
  tracks: MusicTrack[];
  extraTracks: MusicTrack[];
  mode: TagEditorMode;
  onClose: () => void;
  onSaved: (trackId: number, warning: string) => void;
}

export default function MusicTagEditor({ tracks, extraTracks, mode, onClose, onSaved }: Props) {
  const { t } = useMusicLanguage();
  const { ref, focusKey } = useFocusGroup('menu', { current: mode === 'manual' ? 'music-tags-search' : 'music-tags-match' });
  const [selected, setSelected] = useState(tracks);
  const [patches, setPatches] = useState<Record<number, Omit<TagPatch, 'id'>>>({});
  const [cover, setCover] = useState<string | null>(null);
  const [matchedCover, setMatchedCover] = useState(false);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<'match' | 'save' | 'cover' | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<ReleasePreview | null>(null);
  const [showTracks, setShowTracks] = useState(false);
  const started = useRef(false);
  const [manual, setManual] = useState(mode === 'manual');
  const first = tracks[0];
  const pathParts = first.path.split(/[/\\]/);
  const [albumQuery, setAlbumQuery] = useState(valuesOf(first).album || pathParts[pathParts.length - 2] || '');
  const [artistQuery, setArtistQuery] = useState(valuesOf(first).album_artist);
  const [choices, setChoices] = useState<MusicReleaseChoice[]>([]);

  async function search() {
    setBusy('match');
    setError('');
    setStatus(t('tagMatching'));
    setChoices([]);
    try {
      const releases = await searchMusicReleases(albumQuery, artistQuery);
      setChoices(releases);
      setStatus(releases.length ? '' : t('tagNoResults'));
    } catch (reason) {
      setError(String(reason));
      setStatus('');
    } finally {
      setBusy(null);
    }
  }

  async function match(targets: MusicTrack[], releaseId?: string) {
    setBusy('match');
    setError('');
    setStatus(t('tagMatching'));
    try {
      const ids = targets.map((track) => track.id);
      if (releaseId) {
        setPreview(await getMusicReleaseMatch(ids, releaseId));
        setStatus('');
        return;
      }
      const draft = await matchMusicAlbum(ids);
      if (!draft) {
        setStatus(t('tagNoMatch'));
        return;
      }
      setPreview({
        album: draft.album,
        artist: draft.artist,
        tracks: [],
        draft,
      });
      setStatus('');
    } catch (reason) {
      setError(String(reason));
      setStatus('');
    } finally {
      setBusy(null);
    }
  }

  function applyPreview(draft: MatchDraft) {
    setPreview(null);
    setPatches((before) => {
      const next = { ...before };
      for (const { id, ...fields } of draft.tracks) {
        const supplied = Object.fromEntries(Object.entries(fields).filter(([, value]) => typeof value === 'string'));
        next[id] = { ...next[id], ...supplied };
      }
      return next;
    });
    if (draft.cover) {
      setCoverPreview(convertFileSrc(draft.cover));
      setCover(draft.cover);
      setMatchedCover(true);
    }
    setStatus(t('tagMatchFound', { artist: draft.artist, album: draft.album }));
    setShowTracks(true);
    setManual(false);
    setChoices([]);
  }

  useEffect(() => {
    if (mode === 'auto' && !started.current) {
      started.current = true;
      void match(tracks);
    }
    // One search per editor opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape' || event.key === 'BrowserBack') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!busy) {
          if (preview) setPreview(null);
          else onClose();
        }
      }
    }
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [busy, onClose, preview]);

  const values = (track: MusicTrack): Values => ({ ...valuesOf(track), ...patches[track.id] });
  const edit = (targets: MusicTrack[], field: Field, value: string) => {
    if (busy) return;
    setPatches((before) => {
      const next = { ...before };
      for (const track of targets) {
        const updated = { ...next[track.id], [field]: value };
        if (value === valuesOf(track)[field]) delete updated[field];
        next[track.id] = updated;
      }
      return next;
    });
  };
  const pending = selected.filter((track) =>
    Object.entries(patches[track.id] ?? {}).some(([field, value]) => value !== valuesOf(track)[field as Field]));
  const coverTargets = cover ? selected.filter((track) => !matchedCover || !track.artwork) : [];

  async function save() {
    setBusy('save');
    setError('');
    setStatus(t('tagSaving'));
    try {
      // A matched cover fills gaps. A file explicitly chosen by the user replaces every front cover.
      const ids = new Set([...pending, ...coverTargets].map((track) => track.id));
      const report = await saveMusicTags(selected.filter((track) => ids.has(track.id)).map((track) => ({
        id: track.id,
        ...patches[track.id],
        embed_cover: coverTargets.includes(track),
      })), cover);
      onSaved(tracks[0].id, report.errors.slice(0, 2).join(' · '));
    } catch (reason) {
      setError(String(reason));
      setStatus('');
    } finally {
      setBusy(null);
    }
  }

  async function chooseCover() {
    setBusy('cover');
    setError('');
    try {
      const image = await open({
        title: t('tagChooseCover'),
        filters: [{ name: t('tagImages'), extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      });
      if (typeof image === 'string') {
        const preview = await previewMusicCover(image);
        setCoverPreview(convertFileSrc(preview));
        setCover(preview);
        setMatchedCover(false);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  }

  const labels: Record<Field, string> = {
    album: t('tagAlbum'), album_artist: t('tagAlbumArtist'), artist: t('tagTrackArtist'),
    title: t('tagTitle'), year: t('tagYear'), genre: t('tagGenre'),
    track: t('tagNumber'), disc: t('tagDisc'),
  };
  const canInclude = selected.length === tracks.length && extraTracks.length > tracks.length;
  const existingCover = selected.find((track) => track.artwork)?.artwork;
  const displayCover = cover ? coverPreview : existingCover ? convertFileSrc(existingCover) : null;

  return (
    <FocusProvider value={focusKey}>
      <div className="leave-backdrop music-tag-backdrop">
        <div className="leave music-tag-editor" ref={ref} role="dialog" aria-modal="true" aria-label={t(preview ? 'tagPreview' : manual ? 'tagManual' : 'tagEdit')}>
          {preview ? (
            <>
              <h2>{t('tagPreview')}</h2>
              <p>{preview.artist} · {preview.album}</p>
              <p className="muted">{preview.draft ? t('tagReviewPairs') : t('tagReleaseMismatch')}</p>
              <div className="music-match-comparison">
                <strong>{t('tagCurrent')}</strong>
                <strong>MusicBrainz</strong>
                {Array.from({ length: Math.max(selected.length, preview.tracks.length) }, (_, index) => {
                  const local = selected[index];
                  const proposal = local && preview.draft?.tracks.find((track) => track.id === local.id);
                  const remote = preview.draft ? proposal : preview.tracks[index];
                  return (
                    <div className="music-match-pair" key={local?.id ?? 'remote-' + index}>
                      <div>
                        <span>{local ? [local.disc, local.track || '?'].join('.') + ' · ' + local.title : '—'}</span>
                        {local && <small>{local.path.split(/[/\\\\]/).pop()}</small>}
                      </div>
                      <div>{remote ? [remote.disc, remote.track].join('.') + ' · ' + remote.title : '—'}</div>
                    </div>
                  );
                })}
              </div>
              <FocusGroup kind="row" className="music-tag-actions music-tag-footer">
                <FocusButton focusKey="music-tags-preview-back" onSelect={() => setPreview(null)}>{t('back')}</FocusButton>
                {preview.draft && <FocusButton onSelect={() => applyPreview(preview.draft!)}>{t('tagUseMatch')}</FocusButton>}
                <FocusButton onSelect={onClose}>{t('tagCancel')}</FocusButton>
              </FocusGroup>
            </>
          ) : <>
          <h2>{t(manual ? 'tagManual' : 'tagEdit')}</h2>
          <p className="muted">{t('tagScope', { n: selected.length })}</p>
          <FocusGroup kind="row" className="music-tag-actions">
            <FocusButton focusKey="music-tags-match" disabled={!!busy} onSelect={() => void match(selected)}>{t('tagMatch')}</FocusButton>
            <FocusButton disabled={!!busy} onSelect={() => setManual(!manual)}>{t(manual ? 'tagEdit' : 'tagManual')}</FocusButton>
            {canInclude && (
              <FocusButton disabled={!!busy} onSelect={() => { setSelected(extraTracks); setStatus(''); }}>
                {t('tagIncludeFolder', { n: extraTracks.length })}
              </FocusButton>
            )}
          </FocusGroup>
          {manual && (
            <section className="music-tag-manual">
              <FocusGroup kind="row" className="music-tag-search">
                <label>{t('tagAlbum')}<FocusInput value={albumQuery} onChange={setAlbumQuery} /></label>
                <label>{t('tagAlbumArtist')}<FocusInput value={artistQuery} onChange={setArtistQuery} /></label>
                <FocusButton focusKey="music-tags-search" disabled={!!busy || !albumQuery.trim()} onSelect={() => void search()}>{t('tagSearch')}</FocusButton>
              </FocusGroup>
              <FocusGroup kind="list" className="music-tag-releases">
                {choices.map((choice) => (
                  <FocusButton key={choice.id} disabled={!!busy} onSelect={() => void match(selected, choice.id)}>
                    <strong>{choice.album} · {choice.artist}</strong>
                    <small>{[choice.date, choice.country, choice.description, t('albumTracks', { n: choice.track_count })].filter(Boolean).join(' · ')}</small>
                  </FocusButton>
                ))}
              </FocusGroup>
            </section>
          )}
          {!manual && <div className="music-tag-body">
            <FocusGroup kind="list" className="music-tag-fields">
              {sharedFields.map((field) => {
                const distinct = new Set(selected.map((track) => values(track)[field]));
                return (
                  <label key={field}>
                    <span>{labels[field]}</span>
                    <FocusInput
                      value={distinct.size === 1 ? [...distinct][0] : ''}
                      placeholder={distinct.size > 1 ? t('tagMixed') : undefined}
                      onChange={(value) => edit(selected, field, value)}
                    />
                  </label>
                );
              })}
            </FocusGroup>
            <div className="music-tag-cover">
              {displayCover && <img src={displayCover} alt={t('tagCover')} />}
              <FocusGroup kind="list" className="music-tag-actions">
                <FocusButton disabled={!!busy} onSelect={() => void chooseCover()}>{t('tagChooseCover')}</FocusButton>
                {cover && <FocusButton disabled={!!busy} onSelect={() => setCover(null)}>{t('tagUndoCover')}</FocusButton>}
              </FocusGroup>
              {cover && <small>{t(matchedCover ? 'tagMatchedCover' : 'tagReplaceCover')}</small>}
            </div>
          </div>}
          {!manual && <FocusButton disabled={!!busy} onSelect={() => setShowTracks(!showTracks)}>{t(showTracks ? 'tagHideTracks' : 'tagShowTracks')}</FocusButton>}
          {!manual && showTracks && (
            <FocusGroup kind="list" className="music-tag-tracks">
              {selected.map((track) => (
                <section key={track.id}>
                  <p className="muted">{track.path.split(/[/\\]/).pop()}</p>
                  <FocusGroup kind="row" className="music-tag-track">
                    {trackFields.map((field) => (
                      <label key={field}>
                        <span>{labels[field]}</span>
                        <FocusInput value={values(track)[field]} onChange={(value) => edit([track], field, value)} />
                      </label>
                    ))}
                  </FocusGroup>
                </section>
              ))}
            </FocusGroup>
          )}
          {status && <p role="status">{status}</p>}
          {error && <p role="alert" className="music-error">{error}</p>}
          <FocusGroup kind="row" className="music-tag-actions music-tag-footer">
            <FocusButton disabled={!!busy} onSelect={onClose}>{t('tagCancel')}</FocusButton>
            <FocusButton disabled={!!busy || manual || (!pending.length && !coverTargets.length)} onSelect={() => void save()}>{t('tagSave')}</FocusButton>
          </FocusGroup>
          </>}
        </div>
      </div>
    </FocusProvider>
  );
}

