import { useCallback, useEffect, useMemo, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import FocusButton from '../ui/FocusButton';
import FocusGroup from '../ui/FocusGroup';
import { FocusScreen } from '../ui/focusEngine';
import { useLanding } from '../ui/focusStore';
import Cover from './Cover';
import Butterchurn from './Butterchurn';
import Spectrum from './Spectrum';
import VisualizerPanel from './VisualizerPanel';
import { returnFocusTo } from '../ui/focus';
import { presets } from './butterchurnPresets';
import { useArtistArt } from './artistArt';
import MusicBar from './MusicBar';
import { BackgroundVideo } from './BackgroundVideo';
import { useCollectionBackground } from './useCollectionBackground';
import { useMusicLanguage } from './language';
import type { MusicPlayer } from './useMusicPlayer';
import { setVisualizationSettings, useVisualizationSettings } from './visualizationSettings';

// Restoring one stage must finish before a quickly reopened stage enters.
let fullscreenWork: Promise<void> = Promise.resolve();
function Landing() { useLanding('music-play'); return null; }

/** A full-window music stage with ambient and measured-audio artwork modes. */
export default function MusicNowPlaying({ player, onClose, onQueue, onAlbum, suspended = false }: { player: MusicPlayer; onClose: () => void; onQueue: () => void; onAlbum: () => void; suspended?: boolean }) {
  const { language, t } = useMusicLanguage();
  const settings = useVisualizationSettings();
  const background = settings.background;
  const [panel, setPanel] = useState(false);
  const closePanel = useCallback(() => { if (document.querySelector('.music-viz-panel')) returnFocusTo('music-visualizer'); setPanel(false); }, []);
  const [hidden, setHidden] = useState(document.hidden);
  const track = player.track;
  const custom = useCollectionBackground(track?.id);
  const [failedVideo, setFailedVideo] = useState<string | null>(null);
  const videoError = failedVideo !== null && failedVideo === custom.media.video;
  const failVideo = useCallback(() => setFailedVideo(custom.media.video), [custom.media.video]);
  const artistBackground = settings.mediaSource === 'album' || custom.collection?.background_kind === 'album' ? false : settings.mediaSource === 'artist' ? true : settings.artistArt;
  const { art } = useArtistArt(artistBackground ? track?.album_artist || track?.artist || null : null);
  const gallery = useMemo(() => {
    if (custom.media.images.length) return custom.media.images;
    const downloaded = artistBackground ? [...(art?.gallery ?? []), art?.background, art?.thumb].filter((p): p is string => !!p) : [];
    return [...new Set(downloaded.length ? downloaded : track?.artwork ? [track.artwork] : [])];
  }, [artistBackground, art, track, custom.media.images]);
  const galleryKey = gallery.join('|');
  const [slide, setSlide] = useState({ key: '', index: 0 });
  const slideIndex = slide.key === galleryKey ? slide.index % Math.max(1, gallery.length) : 0;
  const [preset, setPreset] = useState(() => Math.max(0, presets.findIndex((p) => p.name === localStorage.getItem('kinema.music.preset'))));
  useEffect(() => { localStorage.setItem('kinema.music.preset', presets[preset].name); }, [preset]);
  const rotate = settings.rotate;
  const nextPreset = () => setPreset((index) => {
    for (let step = 1; step <= presets.length; step++) {
      const next = (index + step) % presets.length;
      if (settings.presetNames.includes(presets[next].name)) return next;
    }
    return index;
  });
  useEffect(() => {
    if (suspended || !settings.artRotate || hidden || !player.active || player.paused || !['plain', 'blurred'].includes(background)) return;
    const timer = window.setInterval(() => {
      if (gallery.length > 1) setSlide((current) => ({ key: galleryKey, index: current.key === galleryKey ? (current.index + 1) % gallery.length : 1 }));
      if (settings.artModes.length > 1) setVisualizationSettings({ background: settings.artModes[(settings.artModes.indexOf(background) + 1) % settings.artModes.length] as 'plain' | 'blurred' });
    }, settings.slideshowSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [galleryKey, gallery.length, hidden, player.active, player.paused, background, settings.slideshowSeconds, settings.artRotate, settings.artModes, suspended]);
  useEffect(() => {
    if (suspended || !settings.spectrumRotate || hidden || !player.active || player.paused || !['radial', 'led', 'spectrum'].includes(background)) return;
    const timer = window.setInterval(() => setVisualizationSettings({ background: settings.spectrumModes[(settings.spectrumModes.indexOf(background) + 1) % settings.spectrumModes.length] as 'radial' }), settings.spectrumSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [background, settings.spectrumModes, settings.spectrumRotate, settings.spectrumSeconds, player.active, player.paused, hidden, suspended]);
  const [idle, setIdle] = useState(false);
  const controlsVisible = settings.controlsSeconds === 0 || !idle || !player.active || player.loading || !!player.error;
  useEffect(() => {
    let timer: number;
    let closing: number;
    const hide = () => { setIdle(true); closing = window.setTimeout(closePanel, 350); };
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      window.clearTimeout(closing);
      if (settings.controlsSeconds > 0) timer = window.setTimeout(hide, settings.controlsSeconds * 1000);
    };
    const events = ['pointermove', 'pointerdown', 'wheel', 'keydown', 'kinema-gamepad-activity'];
    events.forEach((event) => window.addEventListener(event, wake, true));
    if (settings.controlsSeconds > 0) timer = window.setTimeout(hide, settings.controlsSeconds * 1000);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(closing);
      events.forEach((event) => window.removeEventListener(event, wake, true));
    };
  }, [settings.controlsSeconds, closePanel]);
  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  useEffect(() => {
    const win = getCurrentWindow();
    let cancelled = false;
    let changed = false;
    fullscreenWork = fullscreenWork.then(async () => {
      if (cancelled) return;
      const alreadyFull = await win.isFullscreen();
      if (!alreadyFull && !cancelled) { await win.setFullscreen(true); changed = true; }
    }).catch((e) => console.warn('music: could not enter fullscreen', e));
    return () => { cancelled = true; fullscreenWork = fullscreenWork.then(async () => { if (changed) await win.setFullscreen(false); }).catch(console.warn); };
  }, []);
  return <FocusScreen keys={controlsVisible && !suspended}><Landing /><main className={`music-now-playing background-${background}${settings.imageFit === 'fit' ? ' music-art-fit' : ''}${controlsVisible ? '' : ' music-controls-hidden'}`} lang={language} data-paused={player.paused || !player.active || hidden || suspended ? 'true' : 'false'}>
    <div className="music-now-backdrop" aria-hidden="true">
      {gallery.map((path, index) => (
        index === slideIndex || index === (slideIndex + 1) % gallery.length || index === (slideIndex + gallery.length - 1) % gallery.length
      ) ? <img className={index === slideIndex ? 'music-slide current' : 'music-slide'} key={path} src={convertFileSrc(path)} style={{ transitionDuration: `${settings.imageFadeSeconds}s`, objectFit: settings.imageFit === 'fit' ? 'contain' : 'cover' }} alt="" /> : null)}
    </div>
    {background === 'butterchurn' && <Butterchurn running={player.active && !player.paused && !player.loading && !hidden && !suspended} preset={preset} rotate={rotate} onNext={nextPreset} />}
    {(background === 'radial' || background === 'led' || background === 'spectrum') && <Spectrum running={player.active && !player.paused && !player.loading && !hidden && !suspended} style={background} />}
    {!videoError && custom.media.video && ['plain', 'blurred'].includes(background) && <BackgroundVideo
      src={convertFileSrc(custom.media.video)}
      paused={!player.active || player.paused || hidden || suspended} onError={failVideo} />}
    {(custom.error || videoError) && <p className="music-viz-status" role="status">
      {custom.error || 'The background video could not play. Try an H.264 MP4 or WebM file.'}
    </p>}
    <div className="music-now-shade" aria-hidden="true" />
    <div inert={!controlsVisible} aria-hidden={!controlsVisible}><FocusGroup kind="row" className="music-now-toolbar">
      <FocusButton focusKey="music-now-back" onSelect={onClose}>← {t('exitNowPlaying')}</FocusButton>
      <FocusButton focusKey="music-visualizer" expanded={panel} controls="music-visualizer-panel" onSelect={() => setPanel(!panel)}>{language === 'ja' ? 'ビジュアライザー' : 'Visualizer'}</FocusButton>
    </FocusGroup></div>
    {panel && !suspended && <div id="music-visualizer-panel" inert={!controlsVisible} aria-hidden={!controlsVisible}><VisualizerPanel preset={preset} onPreset={setPreset} onNext={nextPreset} onClose={closePanel} /></div>}
    {settings.showDetails && (track ? <section className="music-now-content" aria-label={t('nowPlaying')}>
      <div className="music-now-cover"><Cover key={track.artwork} path={track.artwork} label={track.album} /></div>
      <div className="music-now-details">
        <p className="music-now-artist">{track.artist}</p>
        <p className="music-now-album">{track.album}</p>
        <h1 className="music-now-track">{track.title}</h1>
      </div>
    </section> : <section className="music-now-content"><h1>{t('music')}</h1><p>{t('noSongs')}</p></section>)}
    <div inert={!controlsVisible} aria-hidden={!controlsVisible}><MusicBar player={player} onQueue={onQueue} onAlbum={onAlbum} onFullscreen={onClose} fullscreen /></div>
  </main></FocusScreen>;
}
