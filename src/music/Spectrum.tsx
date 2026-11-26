import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { spectrum, spectrumBands } from './spectrumAnalysis';
import { useVisualizationSettings, VISUALIZER_QUALITY } from './visualizationSettings';
import { useMusicLanguage } from './language';

export type SpectrumStyle = 'radial' | 'led' | 'spectrum';
interface Frame { left: number[]; right: number[]; ready: boolean; error: string | null }
export default function Spectrum({ running, style }: { running: boolean; style: SpectrumStyle }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const settings = useVisualizationSettings(), quality = VISUALIZER_QUALITY[settings.quality];
  const sensitivity = useRef(settings.spectrumSensitivity);
  useEffect(() => { sensitivity.current = settings.spectrumSensitivity; }, [settings.spectrumSensitivity]);
  const { t } = useMusicLanguage();
  const [status, setStatus] = useState('starting');
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)'), change = () => setReduced(query.matches);
    query.addEventListener('change', change); return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const target = canvas.current, context = target?.getContext('2d', { alpha: false });
    if (!target || !context || !running || reduced) return;
    let alive = true, pending = false, animation = 0, last = 0, reset = true, failed = false;
    let levels = Array<number>(64).fill(0), peaks = [...levels], input = [...levels];
    const resize = () => {
      const scale = Math.min(1, quality.width / Math.max(1, target.clientWidth), quality.height / Math.max(1, target.clientHeight));
      target.width = Math.max(1, Math.round(target.clientWidth * scale)); target.height = Math.max(1, Math.round(target.clientHeight * scale));
    };
    resize(); const observer = new ResizeObserver(resize); observer.observe(target);
    const fail = () => { if (alive) { failed = true; setStatus('error'); } };
    const draw = (time: number) => {
      if (!alive || failed) return;
      animation = requestAnimationFrame(draw);
      const dt = Math.min(.1, (time - last) / 1000);
      if (dt < 1 / quality.fps) return;
      last = time;
      if (!pending) {
        pending = true;
        void invoke<Frame>('music_visualizer_frame', { reset }).then((frame) => {
          if (!alive) return;
          if (frame.error || frame.left.length !== 1024 || frame.right.length !== 1024) { fail(); return; }
          if (frame.ready) {
            const bins = spectrum(frame.left, frame.right);
            for (let i = 0; i < bins.length; i++) bins[i] *= sensitivity.current;
            input = spectrumBands(bins, 64); setStatus('live');
          }
        }).catch(fail).finally(() => { pending = false; }); reset = false;
      }
      levels = levels.map((v, i) => v + (input[i] - v) * (1 - Math.exp(-dt / (input[i] > v ? .035 : .2))));
      peaks = peaks.map((v, i) => Math.max(levels[i], v - dt * .22));
      const w = target.width, h = target.height;
      context.fillStyle = '#090c10'; context.fillRect(0, 0, w, h);
      if (style === 'radial') {
        const cx = w / 2, cy = h / 2, radius = Math.min(w, h) * .13, reach = Math.min(w, h) * .31;
        for (let i = 0; i < 64; i++) {
          const a = -Math.PI / 2 + i / 64 * Math.PI * 2, b = a + Math.PI * 2 / 64 * .83;
          const wedge = (r: number, end: number) => { context.beginPath(); context.arc(cx, cy, end, a, b); context.arc(cx, cy, r, b, a, true); context.closePath(); context.fill(); };
          context.fillStyle = `hsl(${195 - i / 64 * 210} 88% 58%)`;
          wedge(radius, radius + Math.max(1, levels[i] * reach));
          context.globalAlpha = .65; wedge(radius + peaks[i] * reach + 3, radius + peaks[i] * reach + 4); context.globalAlpha = 1;
        }
        context.strokeStyle = '#ffffff22'; context.lineWidth = 1; context.beginPath(); context.arc(cx, cy, radius - 5, 0, Math.PI * 2); context.stroke();
      } else {
        const margin = Math.max(12, w * .025), base = h * .92, height = h * .8, bw = (w - 2 * margin) / 64;
        for (let i = 0; i < 64; i++) {
          const x = margin + i * bw, width = Math.max(1, bw * .68);
          if (style === 'led') {
            const rows = 56, step = height / rows;
            for (let row = 0; row < rows; row++) {
              const value = row / rows;
              context.fillStyle = value < levels[i] ? value > .88 ? '#ff354e' : value > .65 ? '#f5f52f' : '#28f755' : '#ffffff08';
              context.fillRect(x, base - (row + 1) * step, width, Math.max(1, step * .67));
            }
            context.fillStyle = '#d7ffe1'; context.fillRect(x, base - peaks[i] * height - 2, width, 2);
          } else {
            const gradient = context.createLinearGradient(0, base, 0, base - height);
            gradient.addColorStop(0, '#087bc0'); gradient.addColorStop(.38, '#12d9b1'); gradient.addColorStop(.65, '#d2ea32'); gradient.addColorStop(.85, '#fa8c34'); gradient.addColorStop(1, '#ff4276');
            context.globalAlpha = .12; context.fillStyle = gradient; context.fillRect(x, base - height, width, height);
            context.globalAlpha = 1; context.fillRect(x, base - height * levels[i], width, height * levels[i]);
          }
        }
        context.fillStyle = '#9ca9b8'; context.font = `${Math.max(9, w / 100)}px sans-serif`;
        for (const hz of [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]) {
          const x = margin + Math.log(hz / 40) / Math.log(18000 / 40) * (w - margin * 2);
          context.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), x, h * .97);
        }
      }
      target.dataset.frame = String(Number(target.dataset.frame || 0) + 1);
      target.dataset.energy = String(Math.max(...levels));
    };
    animation = requestAnimationFrame(draw);
    return () => { alive = false; cancelAnimationFrame(animation); observer.disconnect(); };
  }, [running, reduced, quality, style]);
  return <>
    <canvas ref={canvas} className="music-spectrum" role="img" aria-label={t(style)} data-status={!running || reduced ? 'paused' : status} style={{ visibility: status === 'live' && !reduced ? 'visible' : 'hidden' }} />
    {running && (reduced || status !== 'live') && <p role="status" className="music-viz-status">{t(reduced ? 'reducedMotion' : status === 'error' ? 'spectrumUnavailable' : 'spectrumStarting')}</p>}
  </>;
}

