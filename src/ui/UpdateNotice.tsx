/**
 * "Skrin X is available" with the one-press update (Settings → Advanced).
 *
 * Pressing "Update to Skrin X" downloads the release's file for this kind of
 * copy, checks it against the release's checksum and hands it to the system's
 * own installer (updates.rs). Never on its own. A copy that cannot update
 * itself (the Windows ZIP, a tar.gz) keeps "Open the download page".
 */
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import FocusButton from './FocusButton';
import { useClaim } from './focusStore';
import { openLink } from './links';
import type { Release } from './updates';

type Step =
  | { s: 'ready' }
  | { s: 'downloading'; done: number; total: number | null }
  | { s: 'closing' }
  | { s: 'installed' }
  | { s: 'opened' }
  | { s: 'permission' }
  | { s: 'failed'; message: string };

const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

export default function UpdateNotice({ update }: { update: Release }) {
  const [step, setStep] = useState<Step>({ s: 'ready' });
  // The pressed button goes as the steps change: the ring follows to the next
  // control instead of sitting on nothing (a remote would be stranded).
  useClaim('update-go', Boolean(update.install) && (step.s === 'ready' || step.s === 'permission'));
  useClaim('update-restart', step.s === 'installed');
  useClaim('update-page', step.s === 'failed');

  useEffect(() => {
    let live = true;
    const off = listen<{ done: number; total: number | null }>('update-progress', (e) => {
      if (live) setStep({ s: 'downloading', done: e.payload.done, total: e.payload.total });
    });
    return () => {
      live = false;
      void off.then((f) => f());
    };
  }, []);

  const start = () => {
    setStep({ s: 'downloading', done: 0, total: null });
    invoke<{ state: 'closing' | 'installed' | 'opened' | 'permission' }>('install_update')
      .then((r) => setStep({ s: r.state }))
      .catch((e: unknown) => setStep({ s: 'failed', message: String(e) }));
  };

  const page = (
    <FocusButton
      focusKey="update-page"
      className={update.install ? undefined : 'btn-primary'}
      onSelect={() => void openLink(update.url)}
    >
      Open the download page ↗
    </FocusButton>
  );

  let body: React.ReactNode;
  switch (step.s) {
    case 'ready':
    case 'permission':
      body = update.install ? (
        <>
          <FocusButton focusKey="update-go" className="btn-primary" onSelect={start}>
            Update to Skrin {update.version}
          </FocusButton>
          {step.s === 'permission' && (
            <p className="settings-update-note">
              Allow Skrin to install apps on the screen that opened, then press Update again.
            </p>
          )}
        </>
      ) : (
        page
      );
      break;
    case 'downloading':
      body = (
        <span className="settings-update-note" role="status">
          {step.total
            ? `Downloading… ${Math.floor((step.done / step.total) * 100)} % of ${mb(step.total)}`
            : step.done
              ? `Downloading… ${mb(step.done)}`
              : 'Starting the download…'}
        </span>
      );
      break;
    case 'closing':
      body = (
        <span className="settings-update-note" role="status">
          The installer is open. Skrin closes now so it can be replaced; your library and
          settings stay.
        </span>
      );
      break;
    case 'opened':
      body = (
        <span className="settings-update-note" role="status">
          Android’s installer is open: confirm there. Your library and settings stay.
        </span>
      );
      break;
    case 'installed':
      body = (
        <>
          <span className="settings-update-note" role="status">
            Skrin {update.version} is installed.
          </span>
          <FocusButton
            focusKey="update-restart"
            className="btn-primary"
            onSelect={() => void invoke('restart_after_update')}
          >
            Restart Skrin
          </FocusButton>
        </>
      );
      break;
    case 'failed':
      body = (
        <>
          <p className="settings-update-note" role="alert">
            {step.message}
          </p>
          {page}
        </>
      );
      break;
  }

  return (
    <div className="settings-update">
      <strong>Skrin {update.version} is available.</strong>
      {body}
    </div>
  );
}
