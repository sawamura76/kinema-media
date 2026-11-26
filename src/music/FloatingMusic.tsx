import { useEffect, useState } from 'react';
import FloatingPlayer from '../player/FloatingPlayer';
import { mpvCommand, readProperty } from '../player/engine';
import type { MusicPlayer } from './useMusicPlayer';

export default function FloatingMusic({ player }: { player: MusicPlayer }) {
  const [volume, setVolume] = useState(80);
  useEffect(() => {
    let alive = true;
    const read = () => { void readProperty<number>('volume', 'double').then((value) => { if (alive && value !== null) setVolume(Math.max(0, Math.min(100, value))); }).catch(console.warn); };
    read(); const timer = window.setInterval(read, 1000); return () => { alive = false; window.clearInterval(timer); };
  }, []);
  const track = player.track;
  return <FloatingPlayer title={track?.title ?? 'Music'} artist={track?.artist} album={track?.album} artwork={track?.artwork} paused={player.paused} loading={player.loading} error={player.error} volume={volume}
    onPause={player.pause} onPrevious={player.previous} onNext={player.next} onVolume={(value) => {
      setVolume(value); window.dispatchEvent(new CustomEvent('kinema-music-volume', { detail: value }));
      void mpvCommand('set', ['volume', String(value)]).catch(console.warn);
    }} />;
}
