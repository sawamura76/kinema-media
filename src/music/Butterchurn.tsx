import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Visualizer } from 'butterchurn';
import { presets } from './butterchurnPresets';
import { useMusicLanguage } from './language';
import { useVisualizationSettings, VISUALIZER_QUALITY } from './visualizationSettings';

interface Frame { left: number[]; right: number[]; ready: boolean; error: string | null }
export default function Butterchurn({ running, preset, rotate, onNext }: { running: boolean; preset: number; rotate: boolean; onNext: () => void }) {
  const { t } = useMusicLanguage();
  const settings = useVisualizationSettings();
  const quality = VISUALIZER_QUALITY[settings.quality];
  const interval = useRef(settings.presetSeconds);
  const sensitivity = useRef(settings.butterchurnSensitivity);
  useEffect(() => { sensitivity.current = settings.butterchurnSensitivity; }, [settings.butterchurnSensitivity]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Visualizer | null>(null);
  const selected = useRef(preset);
  const playing = useRef(running);
  const rotating = useRef(rotate);
  const rotationAt = useRef(0);
  useEffect(() => { interval.current = settings.presetSeconds; rotationAt.current = performance.now(); }, [settings.presetSeconds]);
  useEffect(() => { rotating.current = rotate; rotationAt.current = performance.now(); }, [rotate]);
  useEffect(() => { playing.current = running; }, [running]);
  const next = useRef(onNext);
  const [status, setStatus] = useState<'starting' | 'live' | 'error'>('starting');
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => { next.current = onNext; }, [onNext]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)'); const change = () => setReduced(media.matches);
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    selected.current = preset;
    rotationAt.current = performance.now();
    try { engine.current?.loadPreset(presets[preset % presets.length].preset, settings.presetBlendSeconds); } catch (e) { console.warn('Butterchurn preset', e); }
  }, [preset, settings.presetBlendSeconds]);
  useEffect(() => {
    const target = canvas.current;
    if (!target || reduced) return;
    let alive = true, failed = false, animation = 0, last = 0, pending = false;
    let audio: AudioContext | undefined;
    let gl: WebGL2RenderingContext | null = null;
    let observer: ResizeObserver | undefined;
    let signal: Frame = { left: Array(1024).fill(128), right: Array(1024).fill(128), ready: false, error: null };
    let reset = true;
    const fail = (e: unknown) => { if (alive) { failed = true; console.warn('Butterchurn', e); setStatus('error'); cancelAnimationFrame(animation); } };
    void import('butterchurn').then((library) => {
      if (!alive) return;
      target.width = quality.width;
      target.height = quality.height;
      gl = target.getContext('webgl2', { alpha: false, antialias: false });
      if (!gl) throw new Error('WebGL 2 unavailable');
      audio = new AudioContext({ sampleRate: 44100 });
      const visualizer = library.default.createVisualizer(audio, target, { width: quality.width, height: quality.height, meshWidth: quality.meshWidth, meshHeight: quality.meshHeight, pixelRatio: 1, textureRatio: 1 });
      engine.current = visualizer;
      visualizer.loadPreset(presets[selected.current % presets.length].preset, 0);
      const resize = () => {
        const scale = Math.min(1, quality.width / Math.max(1, target.clientWidth), quality.height / Math.max(1, target.clientHeight));
        const width = Math.max(1, Math.round(target.clientWidth * scale));
        const height = Math.max(1, Math.round(target.clientHeight * scale));
        // Match the drawing buffer to the GL viewport, otherwise the default
        // 300x150 buffer clips and magnifies a larger render.
        target.width = width;
        target.height = height;
        visualizer.setRendererSize(width, height);
      };
      resize(); observer = new ResizeObserver(resize); observer.observe(target);
      const draw = (time: number) => {
        if (!alive || failed) return;
        animation = requestAnimationFrame(draw);
        if (!playing.current) return;
        if (time - last < 1000 / quality.fps) return;
        last = time;
        if (rotating.current && time - rotationAt.current >= interval.current * 1000) { rotationAt.current = time; next.current(); }
        if (!pending) {
          pending = true;
          void invoke<Frame>('music_visualizer_frame', { reset }).then((frame) => {
            if (!alive || failed) return;
            if (frame.error) { fail(frame.error); return; }
            if (frame.left.length !== 1024 || frame.right.length !== 1024) { fail('Invalid PCM frame'); return; }
            signal = frame;
            if (frame.ready) setStatus('live');
          }).catch(fail).finally(() => { pending = false; });
          reset = false;
        }
        if (!signal.ready) return;
        const amplify = (value: number) => Math.max(0, Math.min(255, 128 + (value - 128) * sensitivity.current));
        const left = Uint8Array.from(signal.left, amplify), right = Uint8Array.from(signal.right, amplify);
        const mixed = Uint8Array.from(left, (value, i) => Math.round((value + right[i]) / 2));
        try { visualizer.render({ audioLevels: { timeByteArray: mixed, timeByteArrayL: left, timeByteArrayR: right } }); target.dataset.frame = String(Number(target.dataset.frame || 0) + 1); }
        catch (e) { fail(e); }
      };
      animation = requestAnimationFrame(draw);
    }).catch(fail);
    const lost = (event: Event) => { event.preventDefault(); fail('WebGL context lost'); };
    target.addEventListener('webglcontextlost', lost);
    return () => {
      alive = false; cancelAnimationFrame(animation); observer?.disconnect(); engine.current = null;
      target.removeEventListener('webglcontextlost', lost);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      if (audio) void audio.close().catch(console.warn);
      // The native PCM worker stops when polling ceases (two-second watchdog).
    };
  }, [reduced, quality]);
  return <>
    <canvas key={`${reduced ? 'still' : 'motion'}-${settings.quality}`} ref={canvas} className="music-butterchurn" role="img" aria-label="Butterchurn" data-status={!running || reduced ? 'paused' : status} style={{ visibility: status === 'live' && !reduced ? 'visible' : 'hidden' }} />
    {running && (reduced || status !== 'live') && <p className="music-viz-status" role="status">{t(reduced ? 'reducedMotion' : status === 'error' ? 'butterchurnUnavailable' : 'butterchurnStarting')}</p>}
  </>;
}
