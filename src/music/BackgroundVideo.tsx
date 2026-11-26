import { useEffect, useRef } from 'react';

export function BackgroundVideo({ src, paused, onError }: { src: string; paused: boolean; onError: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (paused) video.pause();
    else void video.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      onError();
    });
  }, [src, paused, onError]);
  return <video ref={ref} className="music-background-video" src={src} muted loop playsInline
    preload="metadata" onError={onError} aria-hidden="true" />;
}
