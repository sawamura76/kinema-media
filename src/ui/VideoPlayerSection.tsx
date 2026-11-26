/**
 * Settings → Playback → Opening videos: offering Kinema Media to Windows as a video
 * player (default_player.rs), and taking the offer back. On Linux, the
 * unpacked folder's way to the app menu and "Open with" (app_menu.rs).
 *
 * Windows does not let a program make itself the default; the offer puts
 * Kinema Media in each video type's "Open with" and in Default apps, and opens
 * Kinema Media's page there for the choice. Only where the system has that
 * (`offers_player`).
 */
import { useEffect, useState } from 'react';
import ConfirmButton from './ConfirmButton';
import FocusButton from './FocusButton';
import FocusGroup from './FocusGroup';
import { userError } from './errors';
import { offerAsPlayer, openDefaultApps, playerOffer, removeAsPlayer } from './api';

export default function VideoPlayerSection({ linux }: { linux: boolean }) {
  const [offered, setOffered] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    playerOffer()
      .then((answer) => live && setOffered(answer.offered))
      .catch((e: unknown) => live && setError(userError(e)));
    return () => {
      live = false;
    };
  }, []);

  const run = (action: () => Promise<void>) => {
    setError(null);
    action()
      .then(playerOffer)
      .then((answer) => setOffered(answer.offered))
      .catch((e: unknown) => setError(userError(e)));
  };

  return (
    <section className="settings-section">
      <h2>Opening videos</h2>
      <p className="settings-intro">
        Kinema Media plays any video you open with it from {linux ? 'your file manager' : 'File Explorer'},
        or drop on its window, whether
        or not it is in your library. One in the library plays as itself; any other is remembered
        where you stopped. Started for a video, Kinema Media closes when the video is done.
      </p>
      {offered === null && !error ? null : linux ? (
        <>
          <FocusGroup kind="row" className="settings-row">
            {offered ? (
              <ConfirmButton
                className="btn-secondary"
                confirmLabel="Yes, take Kinema Media out"
                onConfirm={() => run(removeAsPlayer)}
              >
                Take Kinema Media out of the app menu
              </ConfirmButton>
            ) : (
              <FocusButton
                className="btn-secondary"
                onSelect={() => run(offerAsPlayer)}
              >
                Add Kinema Media to the app menu
              </FocusButton>
            )}
          </FocusGroup>
          <p className="settings-hint">
            {offered
              ? 'Kinema Media is in the app menu and in Open with for video files, from this folder. '
              : 'Puts this folder’s Kinema Media in the app menu and in Open with for video files. '}
            Your file manager is where you choose which program opens each kind of video.
          </p>
        </>
      ) : offered ? (
        <>
          <FocusGroup kind="row" className="settings-row">
            <FocusButton
              className="btn-secondary"
              onSelect={() => run(openDefaultApps)}
            >
              Choose what Kinema Media opens
            </FocusButton>
            <ConfirmButton
              className="btn-secondary"
              confirmLabel="Yes, remove Kinema Media"
              onConfirm={() => run(removeAsPlayer)}
            >
              Remove
            </ConfirmButton>
          </FocusGroup>
          <p className="settings-hint">
            Kinema Media is in Open with for video files, and in Windows&rsquo; Default apps, where you
            choose which kinds of video it opens. Remove takes it out of both again.
          </p>
        </>
      ) : (
        <>
          <FocusGroup kind="row" className="settings-row">
            <FocusButton
              className="btn-secondary"
              onSelect={() => run(offerAsPlayer)}
            >
              Offer Kinema Media as a video player
            </FocusButton>
          </FocusGroup>
          <p className="settings-hint">
            Puts Kinema Media in Open with for video files and opens Windows&rsquo; Default apps, where
            you choose which kinds of video Kinema Media opens. Windows does not let a program choose
            that for itself.
          </p>
        </>
      )}
      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}
