import { useEffect, useRef, useState } from 'react';
import FocusButton from '../ui/FocusButton';
import FocusGroup from '../ui/FocusGroup';
import SeekBar from '../player/SeekBar';
import { CloseIcon, FullscreenIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon, VolumeIcon } from '../player/icons';
import { mpvCommand, readProperty } from '../player/engine';
import { clock } from './model';
import { useMusicLanguage } from './language';
import Cover from './Cover';
import type { MusicPlayer } from './useMusicPlayer';

/** Video's seek row and round transport, with track stepping instead of ±10s. */
export default function MusicBar({ player, onQueue, onFullscreen, onAlbum, fullscreen = false }: { player: MusicPlayer; onQueue: () => void; onFullscreen: () => void; onAlbum: () => void; fullscreen?: boolean }) {
  const { language, t } = useMusicLanguage();
  const [volume, setVolume] = useState(80);
  const [draft, setDraft] = useState<{ path: string; seconds: number } | null>(null);
  const pending = useRef<number | null>(null);
  const dragPath = useRef<string | null>(null);
  useEffect(() => { if (player.active) void readProperty<number>('volume', 'double').then((v) => { if (v !== null) setVolume(Math.min(100, v)); }).catch(console.warn); }, [player.active]);
  useEffect(() => {
    const changed = (event: Event) => setVolume((event as CustomEvent<number>).detail);
    window.addEventListener('kinema-music-volume', changed); return () => window.removeEventListener('kinema-music-volume', changed);
  }, []);
  if ((!player.active && !fullscreen) || !player.track) return null;
  const track = player.track;
  const duration = Math.max(0, player.duration);
  const position = draft?.path === track.path ? draft.seconds : player.position;
  const progress = duration > 0 ? Math.max(0, Math.min(100, position / duration * 100)) : 0;
  const preview = (seconds: number) => { pending.current = Math.max(0, Math.min(duration, seconds)); dragPath.current = track.path; setDraft({ path: track.path, seconds: pending.current }); };
  const commit = () => {
    if (pending.current !== null && dragPath.current === track.path) player.seek(pending.current);
    pending.current = null; dragPath.current = null; setDraft(null);
  };
  const setLevel = (value: number) => { const level = Math.min(100, Math.max(0, value)); setVolume(level); player.unmute(); void mpvCommand('set', ['volume', String(level)]).catch(console.warn); };
  return <aside className="music-player music-player-video-style" data-sticky-bottom="" aria-label={t('nowPlaying')} aria-busy={player.loading} lang={language}>
    <div className="player-controls">
      <div className="player-seek-row">
        <span className="player-time">{clock(position)}</span>
        <SeekBar focusKey="music-seek" label={t('position')} progress={progress}
          onScrub={(dir, repeat) => preview((dragPath.current === track.path ? pending.current ?? player.position : player.position) + dir * (repeat ? 10 : 5))}
          onRelease={commit} onEnter={player.pause}>
          <input className="player-seek" type="range" min={0} max={100} step={0.05} value={progress} tabIndex={-1}
            aria-hidden="true" disabled={!duration || player.loading || !player.active}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); preview(player.position); }}
            onChange={(e) => preview(Number(e.target.value) / 100 * duration)}
            onPointerUp={(e) => { commit(); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); e.currentTarget.blur(); }}
            onPointerCancel={() => { pending.current = null; setDraft(null); }}
          />
        </SeekBar>
        <span className="player-time">{clock(duration)}</span>
      </div>
      <FocusGroup kind="row" className="player-buttons" current="music-play">
        <div className="player-group player-group-left music-track-info">
          <FocusButton focusKey="music-current-album" className="music-now-art" label={`${language === 'ja' ? 'アルバムを開く' : 'Open album'}: ${track.album}`} onSelect={onAlbum}><Cover key={track.artwork} path={track.artwork} label={track.album} /></FocusButton>
          <div className="music-now-title"><strong>{track.title}</strong><span>{track.artist}</span>{player.error && <small role="alert">{player.error}</small>}</div>
        </div>
        <div className="player-group player-group-centre">
          <FocusButton className="icon-button" label={t('previous')} title={t('previous')} onSelect={player.previous}><PreviousIcon /></FocusButton>
          <FocusButton focusKey="music-play" className="icon-button play-button" label={t((!player.active || player.paused) ? 'resume' : 'pause')} title={t((!player.active || player.paused) ? 'resume' : 'pause')} onSelect={player.pause}>{(!player.active || player.paused) ? <PlayIcon /> : <PauseIcon />}</FocusButton>
          <FocusButton className="icon-button" label={t('next')} title={t('next')} onSelect={player.next}><NextIcon /></FocusButton>
        </div>
        <div className="player-group player-group-right">
          <FocusButton className={`labelled-button ${player.repeat !== 'off' ? 'active' : ''}`} label={`${t('repeat')}: ${t(player.repeat)}`} onSelect={player.cycleRepeat}>{t('repeat')}: {t(player.repeat)}</FocusButton>
          <FocusButton className="labelled-button" onSelect={onQueue}>{t('Queue')}</FocusButton>
          <FocusButton focusKey="music-fullscreen" className={`icon-button ${fullscreen ? 'active' : ''}`} label={t(fullscreen ? 'exitNowPlaying' : 'openNowPlaying')} title={t(fullscreen ? 'exitNowPlaying' : 'openNowPlaying')} onSelect={onFullscreen}><FullscreenIcon /></FocusButton>
          <div className="music-volume-control"><span role="img" aria-label={player.muted || volume === 0 ? 'Muted' : 'Sound on'}><VolumeIcon muted={player.muted || volume === 0} /></span><input aria-label={t('volume')} title={t('volume')} type="range" min="0" max="100" value={player.muted ? 0 : volume} onChange={(e) => setLevel(Number(e.target.value))} /></div>
          <FocusButton focusKey="music-close" className="icon-button music-close" label={language === 'ja' ? '音楽プレーヤーを閉じる' : 'Close music player'} title={language === 'ja' ? '音楽プレーヤーを閉じる' : 'Close music player'} onSelect={() => {
            void player.stop().catch(console.warn);
            if (fullscreen) onFullscreen();
          }}><CloseIcon /></FocusButton>
        </div>
      </FocusGroup>
    </div>
  </aside>;
}
