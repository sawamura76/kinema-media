/**
 * Settings → Privacy: "Send Kinema Media's lookups through a proxy".
 *
 * For someone who wants posters but not TMDB seeing their own address: a
 * VPN's or Tor's local proxy (HTTP(S) or SOCKS5). Off by default. The rule
 * behind every sentence here: with it on, nothing goes direct. A bad address
 * is refused when it is typed, and one that stops working makes lookups fail
 * — said, never silently direct (net.rs). What the proxy does not cover is
 * said below the row, in plain words.
 */
import { useEffect, useState } from 'react';
import { getSetting } from '../metadata/api';
import {
  checkProxy,
  normaliseProxy,
  PROXY_ADDRESS_KEY,
  PROXY_ENABLED_KEY,
  saveProxy,
} from '../net/proxy';
import ChoiceRow from './ChoiceRow';
import { userError } from './errors';
import FocusButton from './FocusButton';
import FocusGroup from './FocusGroup';
import FocusInput from './FocusInput';

export default function ProxySection() {
  const [on, setOn] = useState(false);
  const [address, setAddress] = useState('');
  const [saved, setSaved] = useState('');
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([getSetting(PROXY_ENABLED_KEY), getSetting(PROXY_ADDRESS_KEY)]).then(
      ([enabled, where]) => {
        if (!live) return;
        setOn(enabled === 'on');
        setAddress(where ?? '');
        setSaved(where ?? '');
      }
    );
    return () => {
      live = false;
    };
  }, []);

  const say = (text: string, bad = false) => setMessage({ text, bad });

  /** Validate, then keep. Off with a bad address stays off. */
  async function apply(enabled: boolean) {
    try {
      let kept = address.trim();
      if (enabled) kept = await normaliseProxy(address);
      await saveProxy(enabled, enabled ? kept : address);
      if (enabled) setAddress(kept);
      setSaved(enabled ? kept : address.trim());
      setOn(enabled);
      say(
        enabled
          ? 'On. Kinema Media’s lookups now go through the proxy. If it stops answering they fail; they do not go direct.'
          : 'Off. Kinema Media’s lookups go straight out again.'
      );
    } catch (e) {
      setOn(false);
      say(userError(e), true);
    }
  }

  async function check() {
    if (busy) return;
    setBusy(true);
    say('Asking TMDB through the proxy…');
    try {
      say(await checkProxy(address));
    } catch (e) {
      say(userError(e), true);
    } finally {
      setBusy(false);
    }
  }

  const edited = on && address.trim() !== saved.trim();

  return (
    <section className="settings-section proxy-section">
      <h2>Proxy</h2>
      <ChoiceRow
        label="Send Kinema Media’s lookups through a proxy"
        choices={[
          { value: 'off', label: 'Off' },
          { value: 'on', label: 'On' },
        ]}
        value={on ? 'on' : 'off'}
        onChange={(v) => void apply(v === 'on')}
        note="The lookups on the list below, the pictures from them, the update check and the update download go through the address you give: a VPN’s or Tor’s own proxy on this computer, for instance. Addresses at home, such as a NAS or your own server, are not sent through it."
        hint="If the proxy cannot be reached, lookups fail and Kinema Media says so; they never go direct. Not covered: a YouTube trailer plays from YouTube itself, and installing ffmpeg with winget uses Windows’ own settings."
      />
      <label className="settings-field">
        <span>
          Proxy address{' '}
          <span className="muted">(HTTP(S) or SOCKS5, such as 127.0.0.1:8080 or socks5h://127.0.0.1:9050; socks5h also lets the proxy look up names, which Tor wants)</span>
        </span>
        <FocusInput
          className="settings-input"
          value={address}
          onChange={setAddress}
          placeholder="127.0.0.1:8080"
          onEnter={() => void apply(on)}
        />
      </label>
      <FocusGroup kind="row" className="settings-row">
        <FocusButton className="btn-secondary" onSelect={() => void check()}>
          Check
        </FocusButton>
        {edited && (
          <FocusButton className="btn-secondary" onSelect={() => void apply(on)}>
            Use this address
          </FocusButton>
        )}
      </FocusGroup>
      {message && (
        <p className={message.bad ? 'settings-error' : 'settings-note'} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}
