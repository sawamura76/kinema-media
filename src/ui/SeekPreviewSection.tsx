/**
 * Settings → Advanced → Seek previews: the pictures above the seek bar
 * (player/seekPreview.ts), how much space they take, and a button that
 * deletes them. They are kept until their file leaves the library; deleting
 * them is safe, they are made again while watching.
 *
 * Drawn where pictures are made (`capabilities.seek_previews`): a computer,
 * and Android since round 11. On Android they are kept within a cap (a tenth
 * of the device's room, said here), and the whole-library job is not offered:
 * it would only fill the cap and push out the films watched (PLAN.md).
 */
import { useCallback, useEffect, useState } from 'react';
import ChoiceRow from './ChoiceRow';
import FocusButton from './FocusButton';
import { userError } from './errors';
import { count, formatBytes } from './format';
import { useCapabilities } from '../capabilities';
import { hasMpv } from '../player/engine';
import {
  deleteSeekPreviews,
  previewJobStatus,
  seekPreviewUsage,
  setPreviewJob,
  type PreviewJobStatus,
  type SeekPreviewUsage,
} from '../player/seekPreview';

/** How often the job's progress is read while it is on. */
const JOB_POLL_MS = 3000;

/** The line under the switch: where the job is, in words. */
export function jobLine(job: PreviewJobStatus, bytes: number | null): string {
  const of = `${job.done} of ${count(job.total, 'file')}`;
  const space = bytes === null ? '' : `, ${formatBytes(bytes)} used`;
  switch (job.state) {
    case 'running':
      return `Making pictures: ${of} done${space}.`;
    case 'waiting':
      return `Waiting for the film to end: ${of} done${space}.`;
    case 'finished':
      return job.unreachable > 0
        ? `${of} done${space}. ${count(job.unreachable, 'file')} could not be reached; they are tried again when Kinema Media starts.`
        : `Every file has its pictures: ${of}${space}.`;
    case 'idle':
      return `Starting soon: ${of} done${space}.`;
    default:
      return job.done > 0 ? `Stopped: ${of} done${space}. It carries on where it stopped.` : '';
  }
}

export default function SeekPreviewSection() {
  const can = useCapabilities();
  const [usage, setUsage] = useState<SeekPreviewUsage | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<PreviewJobStatus | null>(null);
  const here = !!can?.seek_previews;
  // The whole-library job: computers (preview_job.rs).
  const jobHere = here && hasMpv();

  const read = useCallback(() => {
    seekPreviewUsage()
      .then(setUsage)
      .catch((e: unknown) => setError(userError(e)));
  }, []);
  useEffect(() => {
    if (here) read();
  }, [here, read]);
  // While the job is on: its progress, and the space, kept up to date.
  const on = job?.enabled ?? false;
  useEffect(() => {
    if (!jobHere) return;
    let cancelled = false;
    const look = () =>
      previewJobStatus()
        .then((s) => !cancelled && setJob(s))
        .catch(() => undefined);
    void look();
    if (!on) return () => void (cancelled = true);
    const timer = window.setInterval(() => {
      void look();
      read();
    }, JOB_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobHere, on, read]);
  if (!here) return null;

  return (
    <section className="settings-section">
      <h2>Seek previews</h2>
      <p className="settings-intro">
        {usage?.limit != null ? (
          <>
            The seek bar shows a small picture of where it points. Kinema Media makes them while you watch,
            one every ten seconds of the film, and keeps them on this device in up to{' '}
            {formatBytes(usage.limit)}, set from its free space; when that is full, the pictures of
            the films watched longest ago go first ({count(usage.files, 'picture')},{' '}
            {formatBytes(usage.bytes)} now). Deleting them is safe: they are made again.
          </>
        ) : (
          <>
            The seek bar shows a small picture of where it points. Kinema Media makes them while you watch,
            one every ten seconds of the film, and keeps them on this computer until the file leaves
            the library
            {usage ? ` (${count(usage.files, 'picture')}, ${formatBytes(usage.bytes)})` : ''}. Deleting
            them is safe: they are made again.
          </>
        )}
      </p>
      {jobHere && <ChoiceRow
        label="Make previews for the whole library"
        choices={[
          { value: 'off', label: 'Off' },
          { value: 'on', label: 'On' },
        ]}
        value={on ? 'on' : 'off'}
        onChange={(v) => {
          setError(null);
          setPreviewJob(v === 'on')
            .then(setJob)
            .catch((e: unknown) => setError(userError(e)));
        }}
        note="Kinema Media makes the pictures of every film and episode in the background, one file at a time, so the seek bar has them before you watch. It stops for any film you play, rests between pictures, and picks up where it stopped after a restart. Off stops it."
      >
        {job && jobLine(job, usage?.bytes ?? null) && (
          <p className="settings-ok" role="status">
            {jobLine(job, usage?.bytes ?? null)}
          </p>
        )}
      </ChoiceRow>}
      <FocusButton
        className="btn-secondary"
        onSelect={() =>
          void (async () => {
            setError(null);
            try {
              const removed = await deleteSeekPreviews();
              setNote(
                `Deleted ${count(removed, 'picture')}.${on ? ' Making them for the whole library is off.' : ''}`,
              );
              read();
              void previewJobStatus().then(setJob).catch(() => undefined);
            } catch (e) {
              setError(userError(e));
            }
          })()
        }
      >
        Delete seek previews
      </FocusButton>
      {note && <p className="settings-ok">{note}</p>}
      {error && <p className="settings-warn">{error}</p>}
    </section>
  );
}
