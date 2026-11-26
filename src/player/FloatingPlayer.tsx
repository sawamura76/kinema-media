import { getCurrentWindow } from '@tauri-apps/api/window';
import { FocusScreen } from '../ui/focusEngine';
import FocusGroup from '../ui/FocusGroup';
import { FocusProvider } from '../ui/FocusGroup';
import { useFocusGroup } from '../ui/focusGroups';
import FocusButton from '../ui/FocusButton';
import { useLanding } from '../ui/focusStore';
import { FullscreenIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon, VolumeIcon } from './icons';
import Cover from '../music/Cover';
import { useMusicLanguage } from '../music/language';
import { restoreFloating } from './floating';
import './floating.css';

interface Props {
  video?: boolean; title: string; artist?: string; album?: string; artwork?: string | null;
  paused: boolean; loading?: boolean; error?: string | null; volume: number; receiver?: boolean;
  onPause: () => void; onVolume: (volume: number) => void;
  onPrevious?: () => void; onNext?: () => void;
}
function Landing() { useLanding('floating-play'); return null; }
export default function FloatingPlayer({ video = false, title, artist, album, artwork, paused, loading, error, volume, receiver, onPause, onVolume, onPrevious, onNext }: Props) {
  return <FocusScreen><Landing /><FloatingContent {...{ video, title, artist, album, artwork, paused, loading, error, volume, receiver, onPause, onVolume, onPrevious, onNext }} /></FocusScreen>;
}
function FloatingContent({ video, title, artist, album, artwork, paused, loading, error, volume, receiver, onPause, onVolume, onPrevious, onNext }: Props) {
  const { language, t } = useMusicLanguage();
  const { ref, focusKey } = useFocusGroup('menu', { current: 'floating-play', wrap: 'none' });
  const ja = language === 'ja';
  return <FocusProvider value={focusKey}><section ref={ref} className={`floating-player ${video ? 'floating-video' : 'floating-music'}`} role="dialog" aria-modal="true" aria-label={ja ? 'ミニプレーヤー' : 'Floating mini-player'}>
    <header className="floating-header" onPointerDown={(event) => {
      if (event.button === 0 && !(event.target as HTMLElement).closest('button')) void getCurrentWindow().startDragging().catch(console.warn);
    }}>
      <span>{video ? title : 'Kinema Media'}</span>
      <FocusButton label={ja ? 'メイン画面に戻る' : 'Restore main window'} title={ja ? 'メイン画面に戻る' : 'Restore main window'} onSelect={() => { void restoreFloating().catch(console.warn); }}><FullscreenIcon /></FocusButton>
    </header>
    {!video && <div className="floating-track">
      <div className="floating-art"><Cover key={artwork} path={artwork ?? null} label={album || title} /></div>
      <div className="floating-details"><strong title={title}>{title}</strong><span title={artist}>{artist}</span><small title={album}>{album}</small></div>
    </div>}
    {(error || loading) && <p className="floating-notice" role={error ? 'alert' : 'status'}>{error || (ja ? '読み込み中…' : 'Loading…')}</p>}
    <FocusGroup kind="row" className="floating-controls" current="floating-play">
      <FocusButton label={video ? (ja ? '10秒戻る' : 'Back 10 seconds') : t('previous')} disabled={!onPrevious} onSelect={() => onPrevious?.()}><PreviousIcon /></FocusButton>
      <FocusButton focusKey="floating-play" label={video ? (ja ? (paused ? '動画を再生' : '動画を一時停止') : (paused ? 'Play video' : 'Pause video')) : t(paused ? 'resume' : 'pause')} className="floating-play" onSelect={onPause}>{paused ? <PlayIcon /> : <PauseIcon />}</FocusButton>
      <FocusButton label={video ? (ja ? '10秒進む' : 'Forward 10 seconds') : t('next')} disabled={!onNext} onSelect={() => onNext?.()}><NextIcon /></FocusButton>
      <label className="floating-volume"><VolumeIcon muted={volume === 0} /><input type="range" aria-label={t('volume')} min="0" max="100" step={video ? 5 : 1} value={volume} disabled={receiver} onChange={(event) => onVolume(Number(event.target.value))} /><span>{receiver ? (ja ? '外部' : 'AVR') : Math.round(volume)}</span></label>
    </FocusGroup>
  </section></FocusProvider>;
}
