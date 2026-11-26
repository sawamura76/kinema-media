/**
 * The volume control in the player bar.
 *
 * A remote has no slider to drag, and Left/Right are how it moves along the
 * row — a horizontal slider here would trap it. So it is a button that works
 * vertically, the way TV volume does: with the ring on it, Up and Down change
 * the level (a bar above it shows where it is) and OK mutes. Left and Right
 * still leave. A mouse clicks to mute, scrolls to change the level, or
 * clicks and drags on the bar that opens above it.
 *
 * While the sound goes to a receiver untouched, the level here would do
 * nothing, so it says the receiver has the volume rather than pretending.
 *
 * Where mpv plays, the level goes to 200%: above the mark at 100 the bar is
 * drawn in the boost colour, and the control warns that a boost can clip.
 */
import { useRef, type PointerEvent } from 'react';
import { useNavLeaf } from '../ui/focusStore';
import { VolumeIcon } from './icons';
import { levelOnBar, VOLUME_NORMAL, VOLUME_STEP, volumeBar } from './volume';

export const PLAYER_VOLUME_KEY = 'player-volume';

interface Props {
  level: number;
  /** The top of the bar: 200 where the sound can be boosted, else 100. */
  max: number;
  muted: boolean;
  /** Sound is bitstreamed to a receiver, whose volume is the one that counts. */
  receiver: boolean;
  onChange: (delta: number) => void;
  /** An absolute level from the mouse on the bar; `save` once it is let go. */
  onSet: (level: number, save: boolean) => void;
  onToggleMute: () => void;
}

/** The level at the pointer's height on the bar, 0 at the bottom to `max` at the top. */
function levelAt(e: PointerEvent<HTMLDivElement>, max: number): number {
  const rect = e.currentTarget.getBoundingClientRect();
  return levelOnBar((rect.bottom - e.clientY) / rect.height, max);
}


export default function VolumeControl({
  level,
  max,
  muted,
  receiver,
  onChange,
  onSet,
  onToggleMute,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { focused, props } = useNavLeaf(PLAYER_VOLUME_KEY, ref, {
    on: true,
    onSelect: () => {
      if (!receiver) onToggleMute();
    },
    // Up and Down are the level; Left and Right go on along the row.
    onArrow: (arrow) => {
      if (arrow !== 'up' && arrow !== 'down') return false;
      if (!receiver) onChange(arrow === 'up' ? VOLUME_STEP : -VOLUME_STEP);
      return true;
    },
  });

  const boosted = !receiver && !muted && level > VOLUME_NORMAL;
  const name = receiver
    ? 'Volume is on the receiver'
    : muted
      ? 'Sound off, press to turn it on'
      : `Volume ${level}%${boosted ? ', boosted' : ''}`;
  const bar = volumeBar(muted ? 0 : level, max);

  return (
    <div
      ref={ref}
      {...props}
      className={`volume-control ${focused ? 'focused' : ''} ${receiver ? 'receiver' : ''} ${boosted ? 'boosted' : ''}`}
      role="button"
      aria-label={name}
      title={
        receiver
          ? name
          : `${name}. Scroll to change, click to mute (M)${boosted ? '. Above 100% the sound is boosted, held below clipping' : ''}`
      }
      onClick={() => !receiver && onToggleMute()}
      onWheel={(e) => !receiver && onChange(e.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP)}
    >
      <VolumeIcon muted={muted && !receiver} />
      <span className="volume-value">{receiver ? 'Receiver' : muted ? 'Off' : level}</span>
      {/* A click in here is on the bar, not the control: it must not mute. */}
      <div className="volume-pop" aria-hidden="true" onClick={(e) => e.stopPropagation()}>
        {receiver ? (
          <span className="volume-pop-note">Use the receiver’s volume</span>
        ) : (
          <>
            {/* The hit area is wider than the thin track it draws. */}
            <div
              className="volume-hit"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                onSet(levelAt(e, max), false);
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) onSet(levelAt(e, max), false);
              }}
              onPointerUp={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                e.currentTarget.releasePointerCapture(e.pointerId);
                onSet(levelAt(e, max), true);
              }}
            >
              <div className="volume-track">
                <div className="volume-fill" style={{ height: `${bar.normal}%` }} />
                <div
                  className="volume-fill volume-boost"
                  style={{ bottom: `${bar.normal}%`, height: `${bar.boost}%` }}
                />
                {/* The film's own level: 100%. */}
                {bar.mark !== null && (
                  <div className="volume-mark" style={{ bottom: `${bar.mark}%` }} />
                )}
              </div>
            </div>
            <span className="volume-pop-hint">▲▼</span>
          </>
        )}
      </div>
    </div>
  );
}
