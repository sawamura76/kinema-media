/**
 * The picture above the seek bar (round 10): where the mouse points on the
 * bar, or where a held Left/Right or a drag is taking the film. The picture is
 * the nearest one made (seekPreview.ts); until the first arrives, the time
 * alone. Nothing is drawn where pictures are not made (no capability) except
 * the time, which the bar already shows beside it — so nothing at all there.
 */
import type { CSSProperties } from 'react';
import { formatTime } from '../ui/format';
import { previewsHere, useSeekPreview } from './seekPreview';

export default function SeekPreviewPicture({
  fileId,
  at,
  duration,
}: {
  fileId: number | null;
  /** Seconds into the film the bar points at; null hides the preview. */
  at: number | null;
  duration: number | null;
}) {
  const picture = useSeekPreview(fileId, at);
  if (at === null || !duration || fileId === null || !previewsHere()) return null;
  const pct = Math.min(100, Math.max(0, (at / duration) * 100));
  return (
    <div
      className="seek-preview"
      style={{ '--at': `${pct}%` } as CSSProperties}
      data-at={picture.at ?? undefined}
      aria-hidden="true"
    >
      {picture.url ? (
        <img className="seek-preview-picture" src={picture.url} alt="" draggable={false} />
      ) : (
        <div className="seek-preview-picture seek-preview-empty" />
      )}
      <span className="seek-preview-time">{formatTime(at)}</span>
    </div>
  );
}
